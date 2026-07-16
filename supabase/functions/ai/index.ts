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

const today = () => new Date().toISOString().slice(0, 10);

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

  // 3) Look up the user's plan + today's usage (service role bypasses RLS).
  const admin = createClient(url, service);
  const { data: prof } = await admin.from("profiles").select("plan").eq("id", user.id).maybeSingle();
  const plan = prof?.plan ?? "free";
  const limit = DAILY_LIMIT[plan] ?? DAILY_LIMIT.free;

  const { data: usedRow } = await admin
    .from("usage_daily").select("count")
    .eq("user_id", user.id).eq("day", today()).maybeSingle();
  const usedToday = usedRow?.count ?? 0;
  if (usedToday >= limit) {
    return json({ error: "limit", message: `Daily limit reached (${limit}). Upgrade for more.`, plan, used: usedToday, limit }, 429);
  }

  // 4) Call the real model with the SERVER-side key.
  const userMsg = `Instruction: ${instruction.trim()}\n\nText:\n${text}`;
  let out = "";
  let engine = "";
  try {
    if (provider === "openai") {
      const key = Deno.env.get("OPENAI_API_KEY");
      if (!key) return json({ error: "no-key", message: "OpenAI key not configured" }, 503);
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
      if (!r.ok) return json({ error: "provider", message: v?.error?.message ?? "OpenAI error" }, 502);
      out = (v?.choices?.[0]?.message?.content ?? "").trim();
      engine = "openai";
    } else {
      const key = Deno.env.get("GEMINI_API_KEY");
      if (!key) return json({ error: "no-key", message: "Gemini key not configured" }, 503);
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
      if (!r.ok) return json({ error: "provider", message: v?.error?.message ?? "Gemini error" }, 502);
      out = (v?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
      engine = "gemini";
    }
  } catch (e) {
    return json({ error: "provider", message: String(e) }, 502);
  }

  if (!out) return json({ error: "empty", message: "The AI returned nothing" }, 502);

  // 5) Count this successful use, then return the rewrite.
  await admin.rpc("increment_usage", { p_user: user.id });
  return json({ text: out, engine, plan, used: usedToday + 1, limit });
});
