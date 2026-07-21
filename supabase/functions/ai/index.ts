// ============================================================================
// KonX / Kaeya AI proxy  (Supabase Edge Function)
//
// The desktop app calls THIS function — with the signed-in user's token —
// instead of calling Gemini/OpenAI directly. The real API keys live here as
// Supabase secrets and NEVER reach the user's computer. We also enforce a
// per-plan daily limit so usage can't run away.
//
// Request shapes:
//   TEXT rewrite:  POST { text, instruction, provider?, tier?, model?, temperature? }
//   VISION/guide:  POST { image, system, prompt, provider?, tier?, model?, temperature? }
//                  (image = base64 JPEG; system+prompt built by the app — the
//                   screen-helper prompt or the one-step guide prompt)
//   VOICE (in):    POST { mode:"voice", audio, provider?, model? }
//                  (audio = base64 WAV, client-captured via the webview's own
//                   mic API — no Rust/native capture involved. The server, not
//                   the client, measures the real duration from the WAV header
//                   before metering it, so a modified client can't under-report
//                   usage. Metered on TWO dimensions: one request unit, same as
//                   every other call, PLUS real audio-seconds against a
//                   separate daily budget, since speech-to-text is billed per
//                   minute of audio rather than per request.)
//   ->   { text, engine, plan, used, limit, audioSeconds?, audioLimit? }  (200)
//   ->   { error, message }                                                (401/429/502/...)
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { cors, json } from "../_shared/cors.ts";

const SYSTEM_PROMPT =
  "You are Kaeya, a writing assistant. Apply the user's instruction to their text " +
  "and reply with ONLY the resulting text — nothing else. Do NOT greet the user or " +
  "address them by name. Do NOT add any preamble, introduction, explanation, notes, " +
  "labels, or sign-off, and do NOT wrap the result in quotation marks. If the text " +
  "is already correct for the instruction, return it unchanged.";

// The "answer/generate" brain (radial Answer + Explain). Unlike SYSTEM_PROMPT
// this does NOT rewrite a selection — it fulfills a request and writes fresh
// content into the user's document. The shape + length are the USER's to
// decide: a list when they ask for a list, a short answer when that's all it
// needs, a full multi-page document when they ask for one. Never artificially
// shorten or pad.
const GENERATE_SYSTEM_PROMPT =
  "You are Kaeya, a helpful assistant that writes content directly into the user's " +
  "document (usually Microsoft Word). Fulfill the user's request as fully as it needs, " +
  "and in EXACTLY the format they ask for: if they ask for a list, give a list; if they " +
  "ask for a full or multi-page document, write it in full; otherwise answer normally. " +
  "\n\nFORMAT RULES (important — the text goes straight into Word, which does NOT " +
  "understand Markdown):\n" +
  "- Write PLAIN text only. Do NOT use any Markdown symbols: no #, no *, no **, no " +
  "underscores for emphasis, no backticks, and no --- divider lines.\n" +
  "- For a heading, just write it on its own line in Title Case (e.g. 'Personal " +
  "Finance'), with a blank line after it. Number sections as '1. Personal Finance' if " +
  "sections help.\n" +
  "- For a list, put each item on its own line starting with '• ' (a bullet and a " +
  "space). Do not start lines with * or -.\n" +
  "- Separate paragraphs with a single blank line.\n\n" +
  "QUALITY RULES:\n" +
  "- Never repeat yourself. Each section, heading, and bullet must appear ONCE and say " +
  "something new. Do not restate the same point.\n" +
  "- Cover the topic in a logical order and finish what you start — do not skip a " +
  "promised section or cut one short.\n" +
  "- Always answer in complete sentences. Even for a one-fact question, reply with a " +
  "full sentence and a little helpful context (e.g. 'The capital of Liberia is " +
  "Monrovia, which is also its largest city.'), never a single bare word.\n" +
  "- Use plain, clear language a beginner can understand.\n\n" +
  "Reply with ONLY the content itself — no greeting, no preamble, no \"Here is…\", no " +
  "sign-off, and no surrounding quotation marks.";

// Give a generated answer room to be long (a real multi-page document). The
// small rewrite path relies on the model default, which is plenty for a rewrite.
const GENERATE_MAX_TOKENS = 8192;

// How many requests each plan gets per day (text + vision + voice share this meter).
const DAILY_LIMIT: Record<string, number> = { free: 40, pro: 5000, team: 5000 };

// Separate daily budget for actual SECONDS of voice audio (speech-to-text is
// billed per minute, not per request, so one voice call can cost far more
// than one text call). Tune these once real usage patterns are known — a
// push-to-talk clip is capped client-side at ~15-20s, so free-tier is roughly
// "15-20 short requests worth" of audio per day.
const AUDIO_DAILY_LIMIT_SECONDS: Record<string, number> = { free: 300, pro: 3000, team: 3000 };

// Hard ceiling on a single voice clip, enforced server-side (the client also
// caps recording length, but the server never trusts that alone).
const MAX_VOICE_SECONDS = 25;

const TRANSCRIBE_SYSTEM_PROMPT = "You are a transcription engine.";
const TRANSCRIBE_PROMPT =
  "Write down exactly what the speaker says, word for word, in plain text. Do not " +
  "translate, summarize, or add anything else — just the transcript.";

// Model ids per provider + task size (must match models available on your keys).
// The small tiers are multimodal too, so they double as the vision/voice retry target.
// Whisper (OpenAI's only speech-to-text model) has no small/large split — voice
// requests on "openai" always use it directly, never this map.
const MODELS: Record<string, { small: string; large: string }> = {
  openai: { small: "gpt-4o-mini", large: "gpt-4o" },
  gemini: { small: "gemini-flash-lite-latest", large: "gemini-flash-latest" },
};

// A model can be momentarily overloaded (e.g. Gemini 503 "high demand") even
// when the key is perfectly valid. Detect that so we can retry on the smaller,
// more-available model instead of failing the whole request.
function isTransient(status: number, message: string): boolean {
  const m = (message || "").toLowerCase();
  return status === 503 || status === 429 || m.includes("high demand") ||
    m.includes("overloaded") || m.includes("unavailable") || m.includes("try again");
}

type ModelResult = { ok: true; out: string } | { ok: false; status: number; message: string };

// ---- audio duration (server-side, never trusted from the client) ----
function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Walk a WAV file's chunks to find "fmt " (sample rate / channels / bit depth)
// and "data" (byte count), then compute seconds directly — a simple header
// read, not real audio decoding. This is why the client is required to send
// WAV rather than a compressed format: no decoder needed here at all.
function wavDurationSeconds(bytes: Uint8Array<ArrayBuffer>): number | null {
  if (bytes.length < 12) return null;
  const text = (i: number, n: number) => new TextDecoder().decode(bytes.subarray(i, i + n));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let offset = 12;
  let sampleRate = 0, numChannels = 0, bitsPerSample = 0, dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const chunkId = text(offset, 4);
    const chunkSize = dv.getUint32(offset + 4, true);
    if (chunkId === "fmt " && offset + 24 <= bytes.length) {
      numChannels = dv.getUint16(offset + 10, true);
      sampleRate = dv.getUint32(offset + 12, true);
      bitsPerSample = dv.getUint16(offset + 22, true);
    } else if (chunkId === "data") {
      dataSize = chunkSize;
    }
    offset += 8 + chunkSize + (chunkSize % 2);   // chunks are word-aligned
    if (sampleRate && dataSize) break;
  }
  if (!sampleRate || !numChannels || !bitsPerSample || !dataSize) return null;
  return dataSize / (sampleRate * numChannels * (bitsPerSample / 8));
}

// ---- text ----
async function callGeminiText(key: string, model: string, system: string, userMsg: string, temperature: number, maxTokens?: number): Promise<ModelResult> {
  const generationConfig: Record<string, unknown> = { temperature };
  if (maxTokens) generationConfig.maxOutputTokens = maxTokens;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: userMsg }] }],
        generationConfig,
      }),
    },
  );
  const v = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: r.status, message: v?.error?.message ?? "Gemini error" };
  return { ok: true, out: (v?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim() };
}

async function callOpenAIText(key: string, model: string, system: string, userMsg: string, temperature: number, maxTokens?: number): Promise<ModelResult> {
  const body: Record<string, unknown> = {
    model,
    temperature,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ],
  };
  if (maxTokens) body.max_tokens = maxTokens;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const v = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: r.status, message: v?.error?.message ?? "OpenAI error" };
  return { ok: true, out: (v?.choices?.[0]?.message?.content ?? "").trim() };
}

// ---- media (a photo of the user's screen, or a voice clip, + a prompt) ----
// Shared by vision (mime "image/jpeg") and voice (mime "audio/wav") — the
// request shape is identical, only the mime type and the media bytes differ.
async function callGeminiMedia(key: string, model: string, system: string, prompt: string, mediaB64: string, mimeType: string, temperature: number): Promise<ModelResult> {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: mediaB64 } },
        ] }],
        generationConfig: { temperature },
      }),
    },
  );
  const v = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: r.status, message: v?.error?.message ?? "Gemini error" };
  return { ok: true, out: (v?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim() };
}

// ---- voice (Whisper) — a completely different shape (multipart upload, not
// JSON), so unlike Gemini's media call there is no shared function with
// vision here. Whisper is the only OpenAI speech-to-text model; there is no
// small/large split and therefore no overload-retry target for this path.
async function callOpenAIAudio(key: string, audioBytes: Uint8Array<ArrayBuffer>): Promise<ModelResult> {
  const form = new FormData();
  form.append("file", new Blob([audioBytes], { type: "audio/wav" }), "clip.wav");
  form.append("model", "whisper-1");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const v = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: r.status, message: v?.error?.message ?? "OpenAI error" };
  return { ok: true, out: (v?.text ?? "").trim() };
}

async function callOpenAIVision(key: string, model: string, system: string, prompt: string, imageB64: string, temperature: number): Promise<ModelResult> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageB64}` } },
        ] },
      ],
    }),
  });
  const v = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: r.status, message: v?.error?.message ?? "OpenAI error" };
  return { ok: true, out: (v?.choices?.[0]?.message?.content ?? "").trim() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method", message: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1) Who is calling? Verify the user's login token.
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "auth", message: "Not signed in" }, 401);

  // 2) Read the request.
  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json({ error: "bad", message: "Bad request" }, 400); }

  const provider = payload.provider === "openai" ? "openai" : "gemini";
  const image = typeof payload.image === "string" ? (payload.image as string) : "";
  const audio = typeof payload.audio === "string" ? (payload.audio as string) : "";
  const isVision = image.length > 0;
  const isVoice = payload.mode === "voice" && audio.length > 0;

  // 3) Build the model job (text / vision / voice) and validate the inputs.
  //    `run` takes a model id so the transient-overload retry can re-run on
  //    the small model. `audioSeconds` stays 0 for non-voice requests.
  let tier: "small" | "large";
  let model: string;
  let temperature: number;
  let run: (key: string, m: string) => Promise<ModelResult>;
  let audioSeconds = 0;

  if (isVoice) {
    const audioBytes = decodeBase64(audio);
    const seconds = wavDurationSeconds(audioBytes);
    if (seconds === null) return json({ error: "bad", message: "Could not read the recording" }, 400);
    if (seconds > MAX_VOICE_SECONDS) {
      return json({ error: "bad", message: `Recording too long (max ${MAX_VOICE_SECONDS}s)` }, 400);
    }
    audioSeconds = Math.max(1, Math.ceil(seconds));
    tier = "small";   // transcription, not reasoning — the small tier is enough and cheaper
    temperature = 0;
    model = provider === "openai" ? "whisper-1" : String(payload.model || MODELS.gemini.small);
    run = provider === "openai"
      ? (key, _m) => callOpenAIAudio(key, audioBytes)
      : (key, m) => callGeminiMedia(key, m, TRANSCRIBE_SYSTEM_PROMPT, TRANSCRIBE_PROMPT, audio, "audio/wav", temperature);
  } else if (isVision) {
    // The app builds the system + prompt (screen-helper text, or the one-step
    // guide JSON prompt); the server just runs it with the real key + meters it.
    const system = String(payload.system ?? "");
    const prompt = String(payload.prompt ?? "");
    if (!prompt.trim()) return json({ error: "empty", message: "No prompt" }, 400);
    if (!system.trim()) return json({ error: "empty", message: "No system prompt" }, 400);
    tier = payload.tier === "small" ? "small" : "large";   // reading a screen is a big task
    temperature = typeof payload.temperature === "number" ? payload.temperature : 0.3;
    model = String(payload.model || MODELS[provider][tier]);
    run = provider === "openai"
      ? (key, m) => callOpenAIVision(key, m, system, prompt, image, temperature)
      : (key, m) => callGeminiMedia(key, m, system, prompt, image, "image/jpeg", temperature);
  } else if (payload.mode === "generate") {
    // ANSWER / EXPLAIN: fulfill the user's request as fresh content (not a
    // rewrite). `text` IS the request; the user's own words drive the shape and
    // length. Reading/writing a full answer is a big task -> large tier.
    const request = String(payload.text ?? "");
    if (!request.trim()) return json({ error: "empty", message: "No request" }, 400);
    tier = payload.tier === "small" ? "small" : "large";
    temperature = typeof payload.temperature === "number" ? payload.temperature : 0.55;
    model = String(payload.model || MODELS[provider][tier]);
    const call = provider === "openai" ? callOpenAIText : callGeminiText;
    run = (key, m) => call(key, m, GENERATE_SYSTEM_PROMPT, request, temperature, GENERATE_MAX_TOKENS);
  } else {
    const text = String(payload.text ?? "");
    const instruction = String(payload.instruction ?? "");
    if (!text.trim()) return json({ error: "empty", message: "No text to rewrite" }, 400);
    tier = payload.tier === "large" ? "large" : "small";
    temperature = typeof payload.temperature === "number" ? payload.temperature : 0.5;
    model = String(payload.model || MODELS[provider][tier]);
    const userMsg = `Instruction: ${instruction.trim()}\n\nText:\n${text}`;
    const call = provider === "openai" ? callOpenAIText : callGeminiText;
    run = (key, m) => call(key, m, SYSTEM_PROMPT, userMsg, temperature);
  }

  // 4) Determine the plan from `subscriptions` — a table users CANNOT write
  //    (no update/insert RLS policy; only the service-role payment webhook sets
  //    it). We never trust `profiles.plan` for limits: users can edit their own
  //    profile row. A plan only counts while the subscription is active.
  const admin = createClient(url, service);
  const { data: sub } = await admin
    .from("subscriptions").select("plan,status")
    .eq("user_id", user.id).maybeSingle();
  const plan = sub?.status === "active" ? (sub?.plan ?? "free") : "free";
  const limit = DAILY_LIMIT[plan] ?? DAILY_LIMIT.free;

  // Atomically RESERVE one unit up front. The returned count is the gate, so
  // parallel calls each get a distinct number and cannot slip past the cap.
  // We refund below if we exceed the limit or the model call fails.
  const { data: reserved, error: quotaErr } = await admin.rpc("consume_quota", { p_user: user.id });
  if (quotaErr) return json({ error: "quota", message: "Could not check usage" }, 500);
  const used = (reserved as number) ?? 0;
  if (used > limit) {
    await admin.rpc("refund_usage", { p_user: user.id });
    return json({ error: "limit", message: `Daily limit reached (${limit}). Upgrade for more.`, plan, used: limit, limit }, 429);
  }

  // 4b) Voice ALSO reserves against the audio-seconds budget — a second,
  //     independent gate on top of the request-count gate above, since audio
  //     cost scales with duration, not with request count. Refund the
  //     request-count unit too if this check fails, so a rejected voice call
  //     never silently costs a "free" request.
  const audioLimit = AUDIO_DAILY_LIMIT_SECONDS[plan] ?? AUDIO_DAILY_LIMIT_SECONDS.free;
  let audioUsed = 0;
  if (isVoice) {
    const { data: audioReserved, error: audioQuotaErr } = await admin.rpc(
      "consume_audio_seconds", { p_user: user.id, p_seconds: audioSeconds },
    );
    if (audioQuotaErr) {
      await admin.rpc("refund_usage", { p_user: user.id });
      return json({ error: "quota", message: "Could not check voice usage" }, 500);
    }
    audioUsed = (audioReserved as number) ?? 0;
    if (audioUsed > audioLimit) {
      await admin.rpc("refund_usage", { p_user: user.id });
      await admin.rpc("refund_audio_seconds", { p_user: user.id, p_seconds: audioSeconds });
      return json({
        error: "limit",
        message: `Daily voice limit reached (${audioLimit}s). Upgrade for more.`,
        plan, audioUsed: audioLimit, audioLimit,
      }, 429);
    }
  }

  // 5) Call the real model with the SERVER-side key. If it comes back momentarily
  //    overloaded, retry once on the provider's smaller (still multimodal) model.
  //    Collect any failure so the reserved unit can be refunded (only successes count).
  //    Whisper has no smaller fallback model, so voice+openai never retries.
  let out = "";
  let engine = "";
  let failure: { message: string; status: number } | null = null;
  try {
    const key = provider === "openai" ? Deno.env.get("OPENAI_API_KEY") : Deno.env.get("GEMINI_API_KEY");
    if (!key) {
      failure = { message: `${provider === "openai" ? "OpenAI" : "Gemini"} key not configured`, status: 503 };
    } else {
      const small = MODELS[provider].small;
      const canRetrySmall = !(isVoice && provider === "openai");
      let res = await run(key, model);
      if (!res.ok && canRetrySmall && model !== small && isTransient(res.status, res.message)) {
        const alt = await run(key, small);
        if (alt.ok) res = alt;
      }
      if (res.ok) { out = res.out; engine = provider; }
      else failure = { message: res.message, status: 502 };
    }
  } catch (e) {
    failure = { message: String(e), status: 502 };
  }

  // An empty result is a real failure for text/vision (something's wrong), but
  // NOT for voice — silence or background noise legitimately transcribes to
  // nothing, and that's a successful call, not a broken one. The app decides
  // client-side whether a too-short transcript should offer a retry.
  if (!failure && !out && !isVoice) failure = { message: "The AI returned nothing", status: 502 };

  // 6) Only a successful call counts. Refund the reserved unit(s) on any failure.
  if (failure) {
    await admin.rpc("refund_usage", { p_user: user.id });
    if (isVoice) await admin.rpc("refund_audio_seconds", { p_user: user.id, p_seconds: audioSeconds });
    return json({ error: "provider", message: failure.message }, failure.status);
  }

  return isVoice
    ? json({ text: out, engine, plan, used, limit, audioUsed, audioLimit })
    : json({ text: out, engine, plan, used, limit });
});
