// ============================================================================
// KonX AI proxy  (Supabase Edge Function)
//
// The desktop app calls THIS function — with the signed-in user's token —
// instead of calling Gemini/OpenAI directly. The real API keys live here as
// Supabase secrets and NEVER reach the user's computer. We also enforce a
// per-plan daily limit so usage can't run away.
//
//   POST { text, instruction, provider?, tier?, model?, temperature? }
//   ->   { text, engine, plan, used, limit }   (200)
//   ->   { error, message }                     (401/429/502/...)
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { cors, json } from "../_shared/cors.ts";

const SYSTEM_PROMPT =
  "You are KonX, a friendly writing assistant. Rewrite the user's text exactly " +
  "as their instruction asks. Reply with ONLY the rewritten text — no preamble, " +
  "no explanation, no surrounding quotation marks.";

// How many rewrites each plan gets per day. Tune freely.
const DAILY_LIMIT: Record<string, number> = { free: 40, pro: 5000, team: 5000 };

// Model ids per provider + task size (must match models available on your keys).
const MODELS: Record<string, { small: string; large: string }> = {
  openai: { small: "gpt-4o-mini", large: "gpt-4o" },
  gemini: { small: "gemini-flash-lite-latest", large: "gemini-flash-latest" },
};

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

  const text = String(payload.text ?? "");
  const instruction = String(payload.instruction ?? "");
  const provider = payload.provider === "openai" ? "openai" : "gemini";
  const tier = payload.tier === "large" ? "large" : "small";
  const temperature = typeof payload.temperature === "number" ? payload.temperature : 0.5;
  const model = String(payload.model || MODELS[provider][tier]);
  if (!text.trim()) return json({ error: "empty", message: "No text to rewrite" }, 400);

  // 3) Determine the plan from `subscriptions` — a table users CANNOT write
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

  // 4) Call the real model with the SERVER-side key. Collect any failure so the
  //    reserved unit can be refunded once (only successes are counted).
  const userMsg = `Instruction: ${instruction.trim()}\n\nText:\n${text}`;
  let out = "";
  let engine = "";
  let failure: { message: string; status: number } | null = null;
  try {
    if (provider === "openai") {
      const key = Deno.env.get("OPENAI_API_KEY");
      if (!key) {
        failure = { message: "OpenAI key not configured", status: 503 };
      } else {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model, temperature,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userMsg },
            ],
          }),
        });
        const v = await r.json();
        if (!r.ok) failure = { message: v?.error?.message ?? "OpenAI error", status: 502 };
        else { out = (v?.choices?.[0]?.message?.content ?? "").trim(); engine = "openai"; }
      }
    } else {
      const key = Deno.env.get("GEMINI_API_KEY");
      if (!key) {
        failure = { message: "Gemini key not configured", status: 503 };
      } else {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              contents: [{ parts: [{ text: userMsg }] }],
              generationConfig: { temperature },
            }),
          },
        );
        const v = await r.json();
        if (!r.ok) failure = { message: v?.error?.message ?? "Gemini error", status: 502 };
        else { out = (v?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim(); engine = "gemini"; }
      }
    }
  } catch (e) {
    failure = { message: String(e), status: 502 };
  }

  if (!failure && !out) failure = { message: "The AI returned nothing", status: 502 };

  // 5) Only a successful rewrite counts. Refund the reserved unit on any failure.
  if (failure) {
    await admin.rpc("refund_usage", { p_user: user.id });
    return json({ error: "provider", message: failure.message }, failure.status);
  }

  return json({ text: out, engine, plan, used, limit });
});
