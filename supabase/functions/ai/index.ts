// ============================================================================
// KonX / Kaeya AI proxy  (Supabase Edge Function)
//
// The desktop app calls THIS function — with the signed-in user's token —
// instead of calling Gemini/OpenAI directly. The real API keys live here as
// Supabase secrets and NEVER reach the user's computer. We also enforce a
// per-plan daily limit so usage can't run away.
//
// Two request shapes, both metered the same way:
//   TEXT rewrite:  POST { text, instruction, provider?, tier?, model?, temperature? }
//   VISION/guide:  POST { image, system, prompt, provider?, tier?, model?, temperature? }
//                  (image = base64 JPEG; system+prompt built by the app — the
//                   screen-helper prompt or the one-step guide prompt)
//   ->   { text, engine, plan, used, limit }   (200)
//   ->   { error, message }                     (401/429/502/...)
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

// How many requests each plan gets per day (text + vision share the same meter).
const DAILY_LIMIT: Record<string, number> = { free: 40, pro: 5000, team: 5000 };

// Model ids per provider + task size (must match models available on your keys).
// The small tiers are multimodal too, so they double as the vision retry target.
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

// ---- vision (a photo of the user's screen + a prompt) ----
async function callGeminiVision(key: string, model: string, system: string, prompt: string, imageB64: string, temperature: number): Promise<ModelResult> {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: "image/jpeg", data: imageB64 } },
        ] }],
        generationConfig: { temperature },
      }),
    },
  );
  const v = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: r.status, message: v?.error?.message ?? "Gemini error" };
  return { ok: true, out: (v?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim() };
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
  const isVision = image.length > 0;

  // 3) Build the model job (text vs vision) and validate the inputs. `run` takes
  //    a model id so the transient-overload retry can re-run on the small model.
  let tier: "small" | "large";
  let model: string;
  let temperature: number;
  let run: (key: string, m: string) => Promise<ModelResult>;

  if (isVision) {
    // The app builds the system + prompt (screen-helper text, or the one-step
    // guide JSON prompt); the server just runs it with the real key + meters it.
    const system = String(payload.system ?? "");
    const prompt = String(payload.prompt ?? "");
    if (!prompt.trim()) return json({ error: "empty", message: "No prompt" }, 400);
    if (!system.trim()) return json({ error: "empty", message: "No system prompt" }, 400);
    tier = payload.tier === "small" ? "small" : "large";   // reading a screen is a big task
    temperature = typeof payload.temperature === "number" ? payload.temperature : 0.3;
    model = String(payload.model || MODELS[provider][tier]);
    const call = provider === "openai" ? callOpenAIVision : callGeminiVision;
    run = (key, m) => call(key, m, system, prompt, image, temperature);
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

  // 5) Call the real model with the SERVER-side key. If it comes back momentarily
  //    overloaded, retry once on the provider's smaller (still multimodal) model.
  //    Collect any failure so the reserved unit can be refunded (only successes count).
  let out = "";
  let engine = "";
  let failure: { message: string; status: number } | null = null;
  try {
    const key = provider === "openai" ? Deno.env.get("OPENAI_API_KEY") : Deno.env.get("GEMINI_API_KEY");
    if (!key) {
      failure = { message: `${provider === "openai" ? "OpenAI" : "Gemini"} key not configured`, status: 503 };
    } else {
      const small = MODELS[provider].small;
      let res = await run(key, model);
      if (!res.ok && model !== small && isTransient(res.status, res.message)) {
        const alt = await run(key, small);
        if (alt.ok) res = alt;
      }
      if (res.ok) { out = res.out; engine = provider; }
      else failure = { message: res.message, status: 502 };
    }
  } catch (e) {
    failure = { message: String(e), status: 502 };
  }

  if (!failure && !out) failure = { message: "The AI returned nothing", status: 502 };

  // 6) Only a successful call counts. Refund the reserved unit on any failure.
  if (failure) {
    await admin.rpc("refund_usage", { p_user: user.id });
    return json({ error: "provider", message: failure.message }, failure.status);
  }

  return json({ text: out, engine, plan, used, limit });
});
