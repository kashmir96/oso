/**
 * mktg-agent.js — stage-dispatched agent service.
 *
 * Implements section 4 (Pipeline) + Hard Requirements 4-6 + 8 from the spec:
 *   - Single system prompt loaded once and reused across stages.
 *   - Stage parameter switches output schema (Zod, see _lib/mktg-agent-stages).
 *   - Strict JSON validation per stage. Reject + retry once on schema
 *     violation. After two failures, surface raw output to operator with
 *     the validation error.
 *   - Append context envelope (from mktg-retrieval.retrieve()) to each call.
 *   - Per-call telemetry into mktg_agent_calls (stage, envelope hash, raw
 *     output, validation result, latency, tokens, cost).
 *   - Prompt-version assertion at boot (mismatch = throw).
 *
 * Public API:
 *   runStage({ user_id, stage, brief, creative_id?, model?, extra? }) ->
 *     {
 *       ok: true,  parsed, raw, retried, latency_ms, input_tokens, output_tokens, call_id
 *     | ok: false, error, raw, retried, validation_error, call_id
 *     }
 *
 * Model: defaults to MKTG_GENERATION_MODEL env var, then 'claude-opus-4-7'
 * (the spec hard-requires Opus for marketing setup per the user). Override
 * per call with opts.model.
 */
const crypto = require('node:crypto');
const Anthropic = require('@anthropic-ai/sdk');

const { sbSelect, sbInsert } = require('./ckf-sb.js');
const { retrieve } = require('./mktg-retrieval.js');
const { validateStageOutput, STAGE_NAMES } = require('./mktg-agent-stages.js');
const { SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION, SYSTEM_PROMPT_HASH } = require('./mktg-prompt.js');

const DEFAULT_MODEL = process.env.MKTG_GENERATION_MODEL || 'claude-opus-4-7';
const MAX_OUTPUT_TOKENS = 4000;

// Anthropic Opus 4.7 list price (per Mtok). Update when Anthropic changes
// the price card or the model id changes. Cost telemetry is a primary
// system metric (Hard Req #6); inaccurate is worse than missing, so we
// surface model-not-in-card as cost=null rather than guess.
const PRICE_CARD = {
  'claude-opus-4-7':         { input: 15.00, output: 75.00 },
  'claude-opus-4-5':         { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6':       { input:  3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 1.00, output:  5.00 },
};

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function envelopeHash(env) {
  return crypto.createHash('sha256').update(JSON.stringify(env)).digest('hex').slice(0, 32);
}

function envelopeSummary(env) {
  return {
    exemplars_n:        Array.isArray(env.exemplars) ? env.exemplars.length : 0,
    patterns_n:         Array.isArray(env.playbook_patterns) ? env.playbook_patterns.length : 0,
    pain_points_n:      Array.isArray(env.pain_points) ? env.pain_points.length : 0,
    social_proof_n:     Array.isArray(env.social_proof) ? env.social_proof.length : 0,
    verbatim_n:         Array.isArray(env.verbatim_phrases) ? env.verbatim_phrases.length : 0,
    flags:              env.flags || [],
    brand_seed_full:    !!env.brand_seed_full,
  };
}

// Strip markdown fences + locate JSON body. Tolerant of leading prose.
function parseJSON(text) {
  if (!text) throw new Error('Empty model response');
  let s = text.trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  // Find first { or [
  const firstOpen = ['[', '{'].map((c) => s.indexOf(c)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (firstOpen !== undefined && firstOpen > 0) s = s.slice(firstOpen);
  return JSON.parse(s);
}

function computeCost(model, input_tokens, output_tokens) {
  const card = PRICE_CARD[model];
  if (!card) return null;
  return ((input_tokens || 0) * card.input + (output_tokens || 0) * card.output) / 1_000_000;
}

// ─── Prompt-version assertion (Hard Req #8) ────────────────────────────────
// Lazy assertion: only checked when the agent first runs. We don't crash on
// boot of an unrelated function. If the latest mktg_prompt_versions row
// disagrees with the in-code hash, we either auto-insert (first run with no
// version row) or throw (version row exists with a different hash, meaning
// someone edited the prompt without inserting a changelog entry).
let _promptAsserted = false;
async function assertPromptVersion() {
  if (_promptAsserted) return;
  const rows = await sbSelect('mktg_prompt_versions', `version=eq.${encodeURIComponent(SYSTEM_PROMPT_VERSION)}&select=prompt_hash&limit=1`);
  if (!rows?.length) {
    // First run with this version — auto-insert. Changelog stub.
    try {
      await sbInsert('mktg_prompt_versions', {
        version:     SYSTEM_PROMPT_VERSION,
        prompt_hash: SYSTEM_PROMPT_HASH,
        prompt_text: SYSTEM_PROMPT,
        changelog:   `Initial registration of ${SYSTEM_PROMPT_VERSION} from in-code definition.`,
      });
    } catch (e) {
      // 23505 -> race; another invocation registered it first. Re-check below.
      if (!String(e.message || e).includes('23505')) {
        throw new Error(`mktg_prompt_versions insert failed: ${e.message || e}`);
      }
    }
    _promptAsserted = true;
    return;
  }
  if (rows[0].prompt_hash !== SYSTEM_PROMPT_HASH) {
    throw new Error(
      `Prompt version ${SYSTEM_PROMPT_VERSION} has hash mismatch. ` +
      `In-code: ${SYSTEM_PROMPT_HASH.slice(0,12)}...; DB: ${rows[0].prompt_hash.slice(0,12)}.... ` +
      `Per Hard Requirement #8, bump SYSTEM_PROMPT_VERSION and insert a new row in mktg_prompt_versions.`
    );
  }
  _promptAsserted = true;
}

// Test-only hook to reset the assertion state.
function _resetPromptAssertion() { _promptAsserted = false; }

// ─── Build the user message (envelope + stage instruction) ─────────────────
function buildUserMessage(stage, envelope, extra) {
  const envelopeJson = JSON.stringify(envelope, null, 2);
  const extraBlock = extra ? `\n<extra>\n${typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2)}\n</extra>\n` : '';
  return `<context>\n${envelopeJson}\n</context>\n${extraBlock}\nProduce the output for stage="${stage}". Return ONLY the JSON matching the stage's schema. No prose around it.`;
}

// ─── Single Anthropic call ────────────────────────────────────────────────
async function callClaude({ c, model, userMessage }) {
  const t0 = Date.now();
  const resp = await c.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });
  const latency_ms = Date.now() - t0;
  const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return {
    text,
    latency_ms,
    input_tokens:  resp.usage?.input_tokens || 0,
    output_tokens: resp.usage?.output_tokens || 0,
  };
}

// ─── Public: runStage ──────────────────────────────────────────────────────
async function runStage({ user_id = null, creative_id = null, stage, brief, opts = {} }) {
  if (!STAGE_NAMES.includes(stage)) throw new Error(`runStage: unknown stage "${stage}"`);
  if (!brief || typeof brief !== 'object') throw new Error('runStage: brief object required');

  await assertPromptVersion();

  const model = opts.model || DEFAULT_MODEL;
  const c = client();

  // Retrieve envelope. The retrieval layer already enforces all the filters
  // and budget caps; agent service is just the dispatcher.
  const { envelope } = await retrieve(brief, stage, { creative_type: brief.creative_type });
  const env_hash = envelopeHash(envelope);
  const env_summary = envelopeSummary(envelope);

  // First attempt
  let attempt = await callClaude({ c, model, userMessage: buildUserMessage(stage, envelope, opts.extra) });
  let parsed;
  try { parsed = parseJSON(attempt.text); }
  catch (e) {
    // Treat parse failure as a validation failure for retry purposes
    parsed = null;
  }

  let validation = parsed
    ? validateStageOutput(stage, parsed)
    : { ok: false, error: 'JSON parse failed' };

  let retried = false;
  let secondAttempt = null;
  let secondValidation = null;

  if (!validation.ok) {
    // Spec: retry once with the validation error fed back.
    retried = true;
    const correction = `Your previous output failed validation: ${validation.error}\n\nOutput ONLY the JSON for stage="${stage}" matching the spec schema. No prose.`;
    secondAttempt = await callClaude({
      c, model,
      userMessage: buildUserMessage(stage, envelope, opts.extra) + '\n\n' + correction,
    });
    let parsed2;
    try { parsed2 = parseJSON(secondAttempt.text); } catch (_) { parsed2 = null; }
    secondValidation = parsed2 ? validateStageOutput(stage, parsed2) : { ok: false, error: 'JSON parse failed' };
    if (secondValidation.ok) parsed = secondValidation.data;
    else parsed = null;
  } else {
    parsed = validation.data;
  }

  // Aggregate telemetry
  const total = {
    raw_text:       (secondAttempt ? secondAttempt.text : attempt.text),
    latency_ms:     attempt.latency_ms + (secondAttempt?.latency_ms || 0),
    input_tokens:   attempt.input_tokens + (secondAttempt?.input_tokens || 0),
    output_tokens:  attempt.output_tokens + (secondAttempt?.output_tokens || 0),
  };
  const cost_usd = computeCost(model, total.input_tokens, total.output_tokens);

  let validation_status, validation_error;
  if (parsed)              { validation_status = retried ? 'retry_ok' : 'ok'; validation_error = null; }
  else                     { validation_status = 'failed';
                              validation_error = (secondValidation || validation).error; }

  // Telemetry write — best-effort, never blocks the response.
  let call_id = null;
  try {
    const row = await sbInsert('mktg_agent_calls', {
      user_id,
      creative_id,
      stage,
      prompt_version:   SYSTEM_PROMPT_VERSION,
      model,
      envelope_hash:    env_hash,
      envelope_summary: env_summary,
      raw_output:       total.raw_text,
      parsed_output:    parsed,
      validation_status,
      validation_error,
      retried,
      latency_ms:       total.latency_ms,
      input_tokens:     total.input_tokens,
      output_tokens:    total.output_tokens,
      cost_usd,
    });
    call_id = row?.call_id || row?.[0]?.call_id || null;
  } catch (e) {
    console.error('[mktg-agent] telemetry log failed:', e?.message || e);
  }

  if (parsed) {
    return {
      ok: true,
      stage,
      parsed,
      raw: total.raw_text,
      retried,
      latency_ms: total.latency_ms,
      input_tokens: total.input_tokens,
      output_tokens: total.output_tokens,
      cost_usd,
      call_id,
    };
  }
  return {
    ok: false,
    stage,
    error: 'output failed validation after one retry',
    validation_error,
    raw: total.raw_text,
    retried,
    latency_ms: total.latency_ms,
    input_tokens: total.input_tokens,
    output_tokens: total.output_tokens,
    cost_usd,
    call_id,
  };
}

module.exports = {
  runStage,
  // Exposed for testing
  parseJSON,
  envelopeSummary,
  envelopeHash,
  computeCost,
  buildUserMessage,
  assertPromptVersion,
  _resetPromptAssertion,
  DEFAULT_MODEL,
  PRICE_CARD,
};
