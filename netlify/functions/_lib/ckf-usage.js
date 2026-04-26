// Per-call API usage logging + dollar cost.
// Hardcoded prices (USD per million tokens / per minute / per 1k chars).
// Update these when contracts change. Anthropic + OpenAI numbers are
// public list prices; ElevenLabs depends on plan and is approximate.
const { sbInsert } = require('./ckf-sb.js');

const PRICES = {
  anthropic: {
    'claude-sonnet-4-20250514':    { input: 3.0,  output: 15.0, cache_read: 0.30, cache_creation: 3.75 },
    'claude-sonnet-4-6':           { input: 3.0,  output: 15.0, cache_read: 0.30, cache_creation: 3.75 },
    'claude-opus-4-7':             { input: 15.0, output: 75.0, cache_read: 1.50, cache_creation: 18.75 },
    'claude-haiku-4-5-20251001':   { input: 1.0,  output: 5.0,  cache_read: 0.10, cache_creation: 1.25 },
    'default':                     { input: 3.0,  output: 15.0, cache_read: 0.30, cache_creation: 3.75 },
  },
  openai: {
    // Whisper is per audio minute.
    'whisper-1': { audio_per_min: 0.006 },
    'default':   { audio_per_min: 0.006 },
  },
  elevenlabs: {
    // Flash v2.5 ~ $0.18 per 1k chars on Creator. Approx — varies by plan.
    'eleven_flash_v2_5':       { per_1k_chars: 0.18 },
    'eleven_multilingual_v2':  { per_1k_chars: 0.30 },
    'default':                 { per_1k_chars: 0.18 },
  },
};

function priceFor(provider, model) {
  const tier = PRICES[provider];
  if (!tier) return null;
  return tier[model] || tier['default'];
}

function computeCost({ provider, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, audio_seconds, chars }) {
  const p = priceFor(provider, model);
  if (!p) return 0;
  if (provider === 'anthropic') {
    const it = (input_tokens || 0) / 1e6;
    const ot = (output_tokens || 0) / 1e6;
    const cr = (cache_read_tokens || 0) / 1e6;
    const cc = (cache_creation_tokens || 0) / 1e6;
    return it * p.input + ot * p.output + cr * p.cache_read + cc * p.cache_creation;
  }
  if (provider === 'openai') {
    const minutes = (audio_seconds || 0) / 60;
    return minutes * p.audio_per_min;
  }
  if (provider === 'elevenlabs') {
    return ((chars || 0) / 1000) * p.per_1k_chars;
  }
  return 0;
}

// Best-effort: never throw out of this. We swallow errors so usage logging
// can never break the host call.
async function logUsage(row) {
  try {
    const cost = computeCost(row);
    await sbInsert('ckf_api_usage', {
      user_id: row.user_id || null,
      provider: row.provider,
      action: row.action || null,
      model: row.model || null,
      input_tokens: row.input_tokens || null,
      output_tokens: row.output_tokens || null,
      cache_read_tokens: row.cache_read_tokens || null,
      cache_creation_tokens: row.cache_creation_tokens || null,
      audio_seconds: row.audio_seconds != null ? row.audio_seconds : null,
      chars: row.chars != null ? row.chars : null,
      cost_usd: Number(cost.toFixed(6)),
    });
  } catch (e) {
    console.error('[ckf-usage] log failed:', e.message);
  }
}

// Convenience: log a Claude messages.create response. Pass response.usage
// (the sdk usage object) along with provider+model+action+user_id.
async function logAnthropicUsage({ user_id, action, model, usage }) {
  if (!usage) return;
  await logUsage({
    user_id, provider: 'anthropic', action, model,
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    cache_read_tokens: usage.cache_read_input_tokens || 0,
    cache_creation_tokens: usage.cache_creation_input_tokens || 0,
  });
}

module.exports = { logUsage, logAnthropicUsage, computeCost, PRICES };
