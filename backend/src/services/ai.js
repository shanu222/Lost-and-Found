// AI provider chain used for translation (and nothing that touches secrets).
// Providers are tried in the order set in `ai_provider_order`
// (default: openai → gemini → openrouter), each with a timeout and retries.
// All keys and models are editable live in Admin → Settings.
import { logger } from '../lib/logger.js';
import { settings } from './settings.js';

async function post(url, headers, body, timeoutMs) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const providers = {
  async openai(s, system, user) {
    if (!s.openai_api_key) return null;
    for (const model of [s.openai_model, s.openai_fallback_model].filter((m, i, a) => m && a.indexOf(m) === i)) {
      try {
        const j = await post(`${s.openai_base_url}/chat/completions`, { Authorization: `Bearer ${s.openai_api_key}` }, {
          model, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }, s.ai_timeout_ms);
        const text = j.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      } catch (err) {
        logger.warn({ err: err.message, model }, 'openai failed');
      }
    }
    return null;
  },
  async gemini(s, system, user) {
    if (!s.gemini_api_key) return null;
    for (const model of [s.gemini_model, s.gemini_fallback_model].filter((m, i, a) => m && a.indexOf(m) === i)) {
      try {
        const j = await post(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          { 'x-goog-api-key': s.gemini_api_key },
          { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0 } },
          s.ai_timeout_ms,
        );
        const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim();
        if (text) return text;
      } catch (err) {
        logger.warn({ err: err.message, model }, 'gemini failed');
      }
    }
    return null;
  },
  async openrouter(s, system, user) {
    if (!s.openrouter_api_key) return null;
    const models = String(s.openrouter_models || '').split(',').map((m) => m.trim()).filter(Boolean);
    for (const model of models) {
      try {
        const j = await post('https://openrouter.ai/api/v1/chat/completions', {
          Authorization: `Bearer ${s.openrouter_api_key}`, 'HTTP-Referer': process.env.APP_URL || 'https://foundback.app', 'X-Title': 'FoundBack',
        }, { model, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, s.ai_timeout_ms);
        const text = j.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      } catch (err) {
        logger.warn({ err: err.message, model }, 'openrouter failed');
      }
    }
    return null;
  },
};

/** Run a prompt through the provider chain. Returns { text, provider } or throws. */
export async function complete(system, user) {
  const s = await settings();
  const order = String(s.ai_provider_order || 'openai,gemini,openrouter').split(',').map((x) => x.trim()).filter((x) => providers[x]);
  for (let attempt = 0; attempt <= s.ai_max_retries; attempt++) {
    for (const name of order) {
      const text = await providers[name](s, system, user);
      if (text) return { text, provider: name };
    }
  }
  throw new Error('All AI providers failed');
}

/** True when at least one AI provider has a key. */
export async function aiConfigured() {
  const s = await settings();
  return Boolean(s.openai_api_key || s.gemini_api_key || s.openrouter_api_key);
}
