/*
 * KonX AI — the model-router (Phase 2).
 *
 * This is the "brain" layer. It decides WHICH model should handle a request
 * (small model for small jobs, big model for big jobs) and then runs it.
 *
 * Right now there are no API keys, so every request is handled by a built-in
 * MOCK brain — but the routing decisions below are REAL. The moment a key is
 * added to `config.keys`, the same request flows to the real provider instead,
 * with no other code changes needed.
 *
 * Providers supported: OpenAI and Google Gemini (Joseph's chosen brains).
 */
;(function () {
  "use strict";

  // ------------------------------------------------------------------
  // 1) Providers + model tiers.
  //    NOTE: the model IDs below are editable placeholders — confirm the
  //    exact current model names when we wire up real keys.
  // ------------------------------------------------------------------
  var PROVIDERS = {
    openai: {
      label: "OpenAI",
      small: { id: "gpt-4o-mini", label: "GPT-4o mini" },
      large: { id: "gpt-4o",      label: "GPT-4o" }
    },
    gemini: {
      label: "Google Gemini",
      // Free-tier friendly: the Flash family works without billing. The Pro
      // models need billing (swap them in here once the account has credit).
      small: { id: "gemini-flash-lite-latest", label: "Gemini Flash-Lite" },
      large: { id: "gemini-flash-latest",      label: "Gemini Flash" }
    }
  };

  var config = {
    // Default to Gemini: its free Flash tier works today. OpenAI needs credit.
    activeProvider: "gemini",         // "openai" | "gemini" — user-switchable in the UI
    keys: { openai: "", gemini: "" }, // (keys actually live natively in %APPDATA%\KonX\keys.json)
    // The user's personal details (from the Personalize tab). Blank by default.
    // These are woven into every rewrite so KonX matches how the user writes.
    persona: { name: "", role: "", style: "", goals: "", notes: "" }
  };

  // Turn the saved personal details into a short instruction the model can use.
  function personaPreamble() {
    var p = config.persona || {};
    var bits = [];
    if (p.name)  bits.push("the user prefers to be called " + p.name);
    if (p.role)  bits.push("they are a " + p.role);
    if (p.style) bits.push("match this writing style: " + p.style);
    if (p.goals) bits.push("their goal: " + p.goals);
    if (p.notes) bits.push("also note: " + p.notes);
    if (!bits.length) return "";
    return "About the user (use this only to guide the rewrite; never greet them, never " +
           "address them by name, and do not mention any of this in the output): " +
           bits.join("; ") + ". ";
  }
  function withPersona(instruction) {
    var pre = personaPreamble();
    return pre ? pre + (instruction || "") : (instruction || "");
  }

  // ------------------------------------------------------------------
  // 2) Task classifier — is this a SMALL job or a BIG job?
  //    Small: short text + simple instruction (fix grammar, shorten...).
  //    Big:   long text, or a complex instruction (tone, rewrite, translate...),
  //           or the user turned on "Deep think".
  // ------------------------------------------------------------------
  function classify(text, instruction, opts) {
    opts = opts || {};
    if (opts.deepThink) return "large";

    var t = text || "";
    var ins = (instruction || "").toLowerCase();
    var words = t.trim() ? t.trim().split(/\s+/).length : 0;
    var score = 0;

    if (t.length > 220) score += 2;
    if (words > 40) score += 1;

    var simple = /(fix|grammar|spell|typo|shorter|concise|brief|punctuat|capital)/.test(ins);
    var complex = /(tone|formal|professional|rewrite|improve|summar|translat|explain|persuas|expand|creativ|story|email|draft)/.test(ins);

    if (complex) score += 2;
    if (simple && !complex) score -= 1;

    return score >= 2 ? "large" : "small";
  }

  // Decide provider + model for a request (no work done yet).
  function route(text, instruction, opts) {
    opts = opts || {};
    var provider = opts.provider || config.activeProvider;
    if (!PROVIDERS[provider]) provider = "openai";
    var tier = classify(text, instruction, opts);
    var m = PROVIDERS[provider][tier];
    return {
      provider: provider,
      providerLabel: PROVIDERS[provider].label,
      tier: tier,                 // "small" | "large"
      model: m.id,
      modelLabel: m.label
    };
  }

  // ------------------------------------------------------------------
  // 3) The MOCK brain (Phase 2 placeholder — no real AI yet).
  //    Same spirit as the Phase 0 stub, a little smarter per instruction.
  // ------------------------------------------------------------------
  function tidy(t) {
    t = t.replace(/\s+/g, " ").trim();
    var fixes = {
      realy: "really", teh: "the", jumpd: "jumped", recieve: "receive",
      seperate: "separate", definately: "definitely", occured: "occurred",
      untill: "until", wich: "which", thier: "their", alot: "a lot",
      wont: "won't", dont: "don't", cant: "can't"
    };
    for (var k in fixes) { t = t.replace(new RegExp("\\b" + k + "\\b", "gi"), fixes[k]); }
    t = t.replace(/\bi\b/g, "I");
    if (t.length) t = t.charAt(0).toUpperCase() + t.slice(1);
    if (!/[.!?]$/.test(t)) t += ".";
    return t;
  }

  function mockGenerate(text, instruction) {
    if (!text || !text.trim()) return "";
    var ins = (instruction || "").toLowerCase();
    var base = tidy(text);

    if (/short|concise|brief|punch|trim/.test(ins)) {
      return base
        .replace(/\b(really|very|just|actually|basically|literally)\s+/gi, "")
        .replace(/\bin order to\b/gi, "to")
        .replace(/\s+/g, " ")
        .trim();
    }
    if (/formal|professional|tone|polite/.test(ins)) {
      return base
        .replace(/\bdon't\b/gi, "do not").replace(/\bcan't\b/gi, "cannot")
        .replace(/\bwon't\b/gi, "will not").replace(/\bit's\b/gi, "it is")
        .replace(/\bI'm\b/gi, "I am").replace(/\bgonna\b/gi, "going to")
        .replace(/\bwanna\b/gi, "want to");
    }
    return base;
  }

  // ------------------------------------------------------------------
  // 4) Provider call. Asks the native engine (Rust) to run the real model
  //    using the key stored privately in %APPDATA%\KonX\keys.json. If the key
  //    is missing or the request fails, it falls back to the demo brain so the
  //    app never breaks.
  // ------------------------------------------------------------------
  // 4a) The SERVER path (preferred once the user is signed in): asks the Kaeya
  //     backend proxy to run the real model with the server-side key, metering
  //     usage per plan. Returns null when we should fall back to the local path
  //     (not signed in / server unreachable); returns { reason } when the server
  //     was reached but refused (daily limit / expired login).
  function callServer(pick, text, instruction, temperature) {
    var Auth = window.KaeyaAuth;
    if (!Auth || !Auth.isSignedIn()) return Promise.resolve(null);

    return Auth.getAccessToken().then(function (token) {
      if (!token) return null;
      return fetch(Auth.url + "/functions/v1/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": Auth.anon,
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify({
          text: text,
          instruction: instruction,
          provider: pick.provider,
          tier: pick.tier,
          model: pick.model,
          temperature: (typeof temperature === "number" ? temperature : 0.5)
        })
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; },
          function () { return { ok: r.ok, status: r.status, body: {} }; });
      }).then(function (res) {
        if (res.ok && res.body && res.body.text) {
          return { text: res.body.text, engine: res.body.engine || pick.provider,
                   used: res.body.used, limit: res.body.limit };
        }
        if (res.status === 429) return { reason: "limit" };   // daily cap hit
        if (res.status === 401) return { reason: "auth" };    // login expired
        return null;   // any other server error -> try the local path instead
      }).catch(function () { return null; });   // offline / network -> local path
    }).catch(function () { return null; });
  }

  // 4b) The LOCAL path (offline / not-signed-in fallback): asks the native Rust
  //     engine to run the model with the key in %APPDATA%\KonX\keys.json; if that
  //     is missing or fails, uses the built-in demo brain so the app never breaks.
  function callLocal(pick, text, instruction, temperature) {
    var invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;

    if (invoke) {
      return invoke("ai_generate", {
        provider: pick.provider,
        model: pick.model,
        text: text,
        instruction: instruction,
        temperature: (typeof temperature === "number" ? temperature : 0.5)
      }).then(function (res) {
        return { text: res.text, engine: res.engine };   // engine: "openai" | "gemini"
      }).catch(function (err) {
        return delay(120).then(function () {
          return { text: mockGenerate(text, instruction), engine: "mock", reason: classifyError(err) };
        });
      });
    }

    // Not running inside the app (e.g. plain browser preview) -> demo brain.
    return delay(220).then(function () {
      return { text: mockGenerate(text, instruction), engine: "mock", reason: "preview" };
    });
  }

  // Router: server first (when signed in), local as the safety net.
  function callProvider(pick, text, instruction, temperature) {
    return callServer(pick, text, instruction, temperature).then(function (sres) {
      if (sres && sres.text) return { text: sres.text, engine: sres.engine };
      // Server was reached but refused (limit / expired login): respect it —
      // show the demo brain result with the reason, don't silently bypass.
      if (sres && sres.reason) {
        return delay(100).then(function () {
          return { text: mockGenerate(text, instruction), engine: "mock", reason: sres.reason };
        });
      }
      // Not signed in / server unreachable -> local engine (then demo brain).
      return callLocal(pick, text, instruction, temperature);
    });
  }

  // Turn a raw provider error into a short, human reason for the badge.
  function classifyError(err) {
    var s = ("" + (err && err.message ? err.message : err)).toLowerCase();
    if (s.indexOf("no_key") !== -1 || s.indexOf("no key") !== -1) return "no-key";
    if (s.indexOf("429") !== -1 || s.indexOf("quota") !== -1 || s.indexOf("rate") !== -1) return "limit";
    if (s.indexOf("insufficient") !== -1 || s.indexOf("billing") !== -1) return "billing";
    return "offline";
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // Tidy a real-AI result: drop surrounding quotes and any leading greeting /
  // preamble the model tacked on ("Welcome, Joseph.", "Here is the corrected
  // version:", "Sure! ...") despite being told not to. Conservative: only removes
  // a single leading greeting clause, and never returns empty.
  function cleanOutput(t) {
    if (!t) return t;
    var out = ("" + t).trim();
    // Strip matching wrapping quotes (straight or curly).
    if (out.length > 1) {
      var a = out.charAt(0), b = out.charAt(out.length - 1);
      if ((a === '"' && b === '"') || (a === "“" && b === "”") ||
          (a === "'" && b === "'")) {
        out = out.slice(1, -1).trim();
      }
    }
    // Remove one leading greeting/preamble clause, if present.
    var greet = /^(hi|hello|hey|welcome|sure|certainly|of course|okay|ok|absolutely|here(?:'s| is| are)|here you go)\b[^.!?\n]*[.!?:]["”]?\s+/i;
    var stripped = out.replace(greet, "").trim();
    if (stripped.length) out = stripped;
    return out;
  }

  // Normalize text so we can tell when the model just handed back the same thing.
  function normalize(t) {
    return (t || "").toLowerCase().replace(/\s+/g, " ").replace(/[\s"'.,!?;:]+$/,"").trim();
  }
  function sameText(a, b) {
    var na = normalize(a), nb = normalize(b);
    return na.length > 0 && na === nb;
  }

  // Public entry point the UI calls. Returns the routing info + the result text.
  function run(text, instruction, opts) {
    var pick = route(text, instruction, opts);
    var base = withPersona(instruction);   // persona-enriched instruction sent to the model

    function finish(res) {
      // Clean up chit-chat/quotes on real-AI output (the mock is already clean).
      var text = (res.engine && res.engine !== "mock") ? cleanOutput(res.text) : res.text;
      return {
        provider: pick.provider,
        providerLabel: pick.providerLabel,
        tier: pick.tier,
        model: pick.model,
        modelLabel: pick.modelLabel,
        engine: res.engine,
        reason: res.reason || null,   // why we fell back to the demo brain, if we did
        text: text
      };
    }

    // First pass at a moderate temperature.
    return callProvider(pick, text, base, 0.55).then(function (res) {
      // If a real model just gave the SAME text back (common when re-improving
      // already-good text), push once more for a genuinely different version —
      // but ONLY for big/complex tasks. For a simple "fix grammar" on already-
      // clean text, returning it unchanged is the correct answer, not a rewrite.
      if (res.engine !== "mock" && pick.tier === "large" && sameText(res.text, text)) {
        var harder = base +
          " The text may already be polished — produce a NOTICEABLY different and further improved version. Do not return the original wording unchanged.";
        return callProvider(pick, text, harder, 0.95).then(function (res2) {
          // If it STILL matches, keep whatever we got (nothing more to gain).
          return finish(res2 && res2.text ? res2 : res);
        });
      }
      return finish(res);
    });
  }

  // ------------------------------------------------------------------
  // 5) The on-screen helper (v1.0). Sends a photo of the user's screen +
  //    their question to the vision model and returns friendly, step-by-step
  //    guidance. The screenshot is taken natively by the Rust engine, so this
  //    is the local path only for now (server-side vision comes next). If it
  //    can't run (no key / not in the app), it falls back to a gentle message.
  // ------------------------------------------------------------------
  function runVision(question) {
    var provider = config.activeProvider;
    if (!PROVIDERS[provider]) provider = "gemini";
    var m = PROVIDERS[provider].large;   // reading a screen is a big task
    var invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;

    function shape(res) {
      return {
        provider: provider,
        providerLabel: PROVIDERS[provider].label,
        tier: "large",
        model: m.id,
        modelLabel: m.label,
        engine: res.engine,
        reason: res.reason || null,
        text: res.text
      };
    }
    function fallback(reason) {
      return shape({
        engine: "mock",
        reason: reason || "offline",
        text: "I couldn't look at your screen just now. Tell me which app you're " +
              "using and what you'd like to do, and I'll walk you through it step by step."
      });
    }

    if (!invoke) return delay(200).then(function () { return fallback("preview"); });

    return invoke("screen_help", {
      question: withPersona(question),
      provider: provider,
      model: m.id,
      temperature: 0.4
    }).then(function (res) {
      return shape({ text: res.text, engine: res.engine });
    }).catch(function (err) {
      return fallback(classifyError(err));
    });
  }

  window.KonxAI = {
    route: route,
    run: run,
    runVision: runVision,
    config: config,
    providers: PROVIDERS,
    setProvider: function (name) { if (PROVIDERS[name]) config.activeProvider = name; },
    setKey: function (name, value) { if (config.keys.hasOwnProperty(name)) config.keys[name] = value || ""; },
    setPersona: function (p) {
      p = p || {};
      config.persona = {
        name:  (p.name  || "").toString(),
        role:  (p.role  || "").toString(),
        style: (p.style || "").toString(),
        goals: (p.goals || "").toString(),
        notes: (p.notes || "").toString()
      };
    }
  };
})();
