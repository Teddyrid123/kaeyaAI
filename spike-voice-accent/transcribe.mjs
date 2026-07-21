// Stage 0 accent spike (Kaeya Voice design, 2026-07-20): send every recording
// in ./clips through Gemini, and through OpenAI Whisper if a working key is
// present, and print what each one heard. Reads the SAME local key file the
// real app already uses — nothing new to set up.
//
// Run it: node transcribe.mjs
// Drop recordings into: spike-voice-accent/clips/  (any of .m4a .mp3 .wav .ogg .opus .webm .aac)
// Results (a fill-in scorecard) land in: spike-voice-accent/results/

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { homedir } from 'node:os';

const KEYS_PATH = join(homedir(), 'AppData', 'Roaming', 'KonX', 'keys.json');
const CLIPS_DIR = join(import.meta.dirname, 'clips');
const OUT_DIR = join(import.meta.dirname, 'results');

const MIME = {
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.webm': 'audio/webm', '.aac': 'audio/aac',
};

function loadKeys() {
  if (!existsSync(KEYS_PATH)) {
    console.error(`No keys file found at ${KEYS_PATH}.\nOpen Kaeya once and set your keys there first, then run this again.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(KEYS_PATH, 'utf8'));
}

function isTransientOverload(status, message) {
  if (status === 429) return true;
  const m = (message || '').toLowerCase();
  return status === 503 || m.includes('high demand') || m.includes('overloaded') || m.includes('unavailable') || m.includes('try again');
}

async function callGemini(model, key, b64, mime) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    contents: [{
      parts: [
        { text: 'Write down exactly what the speaker says, word for word, in plain text. Do not translate, summarize, or add anything else - just the transcript.' },
        { inline_data: { mime_type: mime, data: b64 } },
      ],
    }],
  };
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  return { ok: res.ok, status: res.status, json };
}

// Same fallback the real app already uses: gemini-flash-latest can come back
// 503 "high demand" even with a valid key. Retry once on the small model,
// which stays available, before giving up. Also retries once on a plain
// network hiccup (fetch failed) with no fallback needed.
async function transcribeGemini(key, buf, mime) {
  const b64 = buf.toString('base64');
  let r = await callGemini('gemini-flash-latest', key, b64, mime);
  if (!r.ok && isTransientOverload(r.status, r.json.error?.message)) {
    r = await callGemini('gemini-flash-lite-latest', key, b64, mime);
  }
  if (!r.ok) return `ERROR ${r.status}: ${r.json.error?.message || 'request failed'}`;
  return (r.json.candidates?.[0]?.content?.parts?.[0]?.text || '(no transcript returned)').trim();
}

async function transcribeWhisper(key, buf, mime, filename) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), filename);
  form.append('model', 'whisper-1');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  const json = await res.json();
  if (!res.ok) return `ERROR ${res.status}: ${json.error?.message || res.statusText}`;
  return (json.text || '(no transcript returned)').trim();
}

async function main() {
  const keys = loadKeys();
  if (!existsSync(CLIPS_DIR)) mkdirSync(CLIPS_DIR, { recursive: true });
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const files = readdirSync(CLIPS_DIR).filter((f) => MIME[extname(f).toLowerCase()]);
  if (files.length === 0) {
    console.log(`No clips found. Drop your recordings into:\n  ${CLIPS_DIR}`);
    return;
  }

  console.log(`Found ${files.length} clip(s). Sending each to Gemini${keys.openai ? ' and Whisper' : ''}...\n`);

  let report = `# Accent spike results\n\n`;
  report += `Generated ${new Date().toISOString()}\n\n`;
  report += `For each clip: what Gemini heard, and what Whisper heard (if your OpenAI credit is set up). Fill in what was ACTUALLY said, then tick correct or wrong. Add up the ticks at the bottom for your number.\n\n`;

  for (const file of files) {
    const path = join(CLIPS_DIR, file);
    const buf = readFileSync(path);
    const mime = MIME[extname(file).toLowerCase()];
    console.log(`=== ${file} ===`);

    let gemini = '(no Gemini key)';
    if (keys.gemini) {
      try { gemini = await transcribeGemini(keys.gemini, buf, mime); }
      catch (e) {
        // One retry on a plain network hiccup before giving up.
        try { gemini = await transcribeGemini(keys.gemini, buf, mime); }
        catch (e2) { gemini = `ERROR: ${e2.message}`; }
      }
    }
    console.log('Gemini :', gemini);

    let whisper = '(no OpenAI key — add credit to test this one)';
    if (keys.openai) {
      try { whisper = await transcribeWhisper(keys.openai, buf, mime, file); }
      catch (e) { whisper = `ERROR: ${e.message}`; }
    }
    console.log('Whisper:', whisper);
    console.log('');

    report += `## ${file}\n\n`;
    report += `- **Gemini heard:** ${gemini}\n`;
    report += `- **Whisper heard:** ${whisper}\n`;
    report += `- **What was actually said:** _(fill in)_\n`;
    report += `- **Gemini correct?** ☐ yes  ☐ no\n`;
    report += `- **Whisper correct?** ☐ yes  ☐ no\n\n`;
  }

  report += `## Totals\n\n- Gemini: ___ / ${files.length} correct\n- Whisper: ___ / ${files.length} correct\n`;

  const outPath = join(OUT_DIR, `accent-spike-${Date.now()}.md`);
  writeFileSync(outPath, report);
  console.log(`Scorecard saved to:\n  ${outPath}`);
}

main();
