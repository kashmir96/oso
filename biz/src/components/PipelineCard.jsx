import { useState } from 'react';
import { call } from '@ckf-lib/api.js';

/**
 * PipelineCard — editable bubble for one stage of the marketing-mode flow.
 *
 * The server (creative_pipeline executor) inserts a chat message with
 * content_blocks=[{type:'pipeline_card', stage, creative_id, payload}] after
 * each stage runs. Chat.jsx detects that block and renders THIS component
 * inline. Curtis tweaks the structured fields, hits Submit, and the edits
 * persist to mktg_creatives.components. Then we post a synthetic user
 * message to the chat ("approved <stage>, advance") so the AI continues.
 *
 * Stages handled:
 *   - strategy:    angle + audience-fit (read-only-ish, just Continue)
 *   - variants_ad: pick + edit headline/body/cta
 *   - outline:     edit beats (timestamp + line + b-roll per row)
 *   - hooks:       pick + edit hook text + archetype
 *   - draft:       edit full script
 *   - critique:    read-only verdict + scores; just Continue
 *
 * Submit posts a friendly user message back to the chat so the AI sees the
 * acknowledgement and runs the next stage. The next-stage hint comes back
 * from the server (pipeline.NEXT_STAGE_HINT).
 */
export default function PipelineCard({ stage, creative_id, payload, onSubmit, locked }) {
  if (stage === 'strategy')   return <StrategyCard   creative_id={creative_id} payload={payload} onSubmit={onSubmit} locked={locked} />;
  if (stage === 'variants_ad')return <VariantsCard   creative_id={creative_id} payload={payload} onSubmit={onSubmit} locked={locked} />;
  if (stage === 'outline')    return <OutlineCard    creative_id={creative_id} payload={payload} onSubmit={onSubmit} locked={locked} />;
  if (stage === 'hooks')      return <HooksCard      creative_id={creative_id} payload={payload} onSubmit={onSubmit} locked={locked} />;
  if (stage === 'draft')      return <DraftCard      creative_id={creative_id} payload={payload} onSubmit={onSubmit} locked={locked} />;
  if (stage === 'critique')   return <CritiqueCard   creative_id={creative_id} payload={payload} onSubmit={onSubmit} locked={locked} />;
  return (
    <div className="pipeline-card" style={cardShell}>
      <div className="pipeline-card-head">Unknown stage: {stage}</div>
      <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>{JSON.stringify(payload, null, 2)}</pre>
    </div>
  );
}

// ─── Common shell + helpers ────────────────────────────────────────────────
const cardShell = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--card-bg, rgba(255,255,255,0.02))',
  padding: 12,
  marginTop: 4,
};

function CardHeader({ stage, locked }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {stage}
      </div>
      {locked && <span className="pill" style={{ fontSize: 10 }}>submitted</span>}
    </div>
  );
}

function SubmitRow({ busy, locked, onSubmit, label = 'Submit & continue', secondaryLabel, onSecondary }) {
  if (locked) return null;
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
      {secondaryLabel && (
        <button onClick={onSecondary} disabled={busy} style={{ fontSize: 12, padding: '6px 12px' }}>
          {secondaryLabel}
        </button>
      )}
      <button onClick={onSubmit} disabled={busy} className="primary" style={{ fontSize: 12, padding: '6px 12px' }}>
        {busy ? 'Saving…' : label}
      </button>
    </div>
  );
}

// Generic submit handler that calls the backend then notifies the parent.
async function submitEdits(creative_id, stage, edits, onSubmit, setBusy, setErr) {
  setBusy(true); setErr('');
  try {
    const r = await call('mktg-ads', { action: 'pipeline_save_stage_edits', creative_id, stage, edits });
    if (r.error) throw new Error(r.error);
    onSubmit?.({ stage, edits, next_stage_hint: r.next_stage_hint });
  } catch (e) { setErr(e.message); } finally { setBusy(false); }
}

// ─── Strategy ───────────────────────────────────────────────────────────────
function StrategyCard({ creative_id, payload, onSubmit, locked }) {
  const [angle, setAngle] = useState(payload?.primary_angle || '');
  const [fit,   setFit]   = useState(payload?.audience_message_fit || '');
  const [busy, setBusy]   = useState(false);
  const [err,  setErr]    = useState('');
  return (
    <div style={cardShell}>
      <CardHeader stage="strategy" locked={locked} />
      <Field label="Primary angle"
        value={angle} onChange={setAngle}
        multiline disabled={locked || busy} />
      <Field label="Audience-message fit"
        value={fit} onChange={setFit}
        multiline disabled={locked || busy} />
      {Array.isArray(payload?.flags) && payload.flags.length > 0 && (
        <div className="meta" style={{ fontSize: 10, marginTop: 4 }}>
          {payload.flags.map((f) => <span key={f} className="pill warn">{f}</span>)}
          {payload.exemplar_strength && <span className={`pill ${payload.exemplar_strength === 'weak' ? 'warn' : ''}`}>{payload.exemplar_strength}</span>}
        </div>
      )}
      {err && <div className="error" style={{ fontSize: 11, marginTop: 6 }}>{err}</div>}
      <SubmitRow
        busy={busy} locked={locked}
        onSubmit={() => submitEdits(creative_id, 'strategy', { primary_angle: angle, audience_message_fit: fit }, onSubmit, setBusy, setErr)}
        label="Approve angle & continue"
      />
    </div>
  );
}

// ─── Variants (ads) ─────────────────────────────────────────────────────────
function VariantsCard({ creative_id, payload, onSubmit, locked }) {
  const variants = Array.isArray(payload?.variants) ? payload.variants : [];
  const [pickedIdx, setPickedIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const v = variants[pickedIdx] || {};
  // Editable fields for the picked variant.
  const [headline, setHeadline] = useState(v.headline || '');
  const [body,     setBody]     = useState(v.body || v.body_preview || '');
  const [cta,      setCta]      = useState(v.cta || '');

  function pick(i) {
    setPickedIdx(i);
    const next = variants[i] || {};
    setHeadline(next.headline || '');
    setBody(next.body || next.body_preview || '');
    setCta(next.cta || '');
  }

  return (
    <div style={cardShell}>
      <CardHeader stage="variants" locked={locked} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {variants.map((vv, i) => (
          <button key={i} onClick={() => pick(i)}
            className={i === pickedIdx ? 'primary' : ''}
            disabled={locked || busy}
            style={{ fontSize: 11, padding: '4px 10px' }}>
            #{vv.idx || (i + 1)} {vv.axis ? `· ${vv.axis}` : ''}
          </button>
        ))}
      </div>
      <Field label="Headline"   value={headline} onChange={setHeadline} disabled={locked || busy} />
      <Field label="Body"       value={body}     onChange={setBody}     disabled={locked || busy} multiline rows={4} />
      <Field label="CTA"        value={cta}      onChange={setCta}      disabled={locked || busy} />
      {err && <div className="error" style={{ fontSize: 11, marginTop: 6 }}>{err}</div>}
      <SubmitRow
        busy={busy} locked={locked}
        onSubmit={() => submitEdits(creative_id, 'variants_ad', {
          picked: { headline, body, cta, ...v && { composition_pattern: v.composition_pattern, palette: v.visual_style?.palette, image_ref: v.image_prompt } },
        }, onSubmit, setBusy, setErr)}
        label="Use this variant & continue"
      />
    </div>
  );
}

// ─── Outline (video) ────────────────────────────────────────────────────────
function OutlineCard({ creative_id, payload, onSubmit, locked }) {
  // payload.beats may be plain strings ("[0:00] open with...") or objects.
  // Normalise to objects with timestamp/beat/broll.
  const initialBeats = (payload?.beats || []).map((b) => {
    if (typeof b === 'string') {
      const m = b.match(/^\[([^\]]+)\]\s*(.*)$/);
      return { timestamp: m?.[1] || '', beat: m?.[2] || b, broll: '' };
    }
    return { timestamp: b.timestamp || '', beat: b.beat || '', broll: b.broll || '' };
  });
  const [beats, setBeats] = useState(initialBeats);
  const [tmpl,  setTmpl]  = useState(payload?.structure_template || '');
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  function update(i, key, val) {
    setBeats((b) => b.map((row, ix) => ix === i ? { ...row, [key]: val } : row));
  }
  function addBeat() {
    setBeats((b) => [...b, { timestamp: '', beat: '', broll: '' }]);
  }
  function removeBeat(i) {
    setBeats((b) => b.filter((_, ix) => ix !== i));
  }

  return (
    <div style={cardShell}>
      <CardHeader stage="outline" locked={locked} />
      <Field label="Structure template" value={tmpl} onChange={setTmpl} disabled={locked || busy} />
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 4px' }}>
        Beats — edit timestamps, lines, and B-roll cues. {payload?.runtime ? `Runtime: ${payload.runtime}` : ''}
      </div>
      {beats.map((b, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr 24px', gap: 6, marginBottom: 6 }}>
          <input value={b.timestamp} onChange={(e) => update(i, 'timestamp', e.target.value)} placeholder="0:00" disabled={locked || busy} style={{ fontSize: 12 }} />
          <input value={b.beat}      onChange={(e) => update(i, 'beat', e.target.value)}      placeholder="beat" disabled={locked || busy} style={{ fontSize: 12 }} />
          <input value={b.broll}     onChange={(e) => update(i, 'broll', e.target.value)}     placeholder="b-roll" disabled={locked || busy} style={{ fontSize: 12 }} />
          {!locked && (
            <button onClick={() => removeBeat(i)} disabled={busy} style={{ fontSize: 12, padding: 2 }} title="remove">✕</button>
          )}
        </div>
      ))}
      {!locked && (
        <button onClick={addBeat} disabled={busy} style={{ fontSize: 11, padding: '3px 10px', marginTop: 4 }}>
          + add beat
        </button>
      )}
      {err && <div className="error" style={{ fontSize: 11, marginTop: 6 }}>{err}</div>}
      <SubmitRow
        busy={busy} locked={locked}
        onSubmit={() => submitEdits(creative_id, 'outline', { structure_template: tmpl, beats }, onSubmit, setBusy, setErr)}
        label="Save outline & continue"
      />
    </div>
  );
}

// ─── Hooks (video) ──────────────────────────────────────────────────────────
function HooksCard({ creative_id, payload, onSubmit, locked }) {
  const hooks = Array.isArray(payload?.hooks) ? payload.hooks : [];
  const [pickedIdx, setPickedIdx] = useState(0);
  const h = hooks[pickedIdx] || {};
  const [hookText, setHookText] = useState(h.opening || '');
  const [archetype, setArchetype] = useState(h.archetype || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function pick(i) {
    setPickedIdx(i);
    const next = hooks[i] || {};
    setHookText(next.opening || '');
    setArchetype(next.archetype || '');
  }

  return (
    <div style={cardShell}>
      <CardHeader stage="hooks" locked={locked} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {hooks.map((hh, i) => (
          <button key={i} onClick={() => pick(i)}
            className={i === pickedIdx ? 'primary' : ''}
            disabled={locked || busy}
            style={{ fontSize: 11, padding: '4px 10px' }}>
            #{hh.idx || (i + 1)} · {hh.archetype || '?'}
          </button>
        ))}
      </div>
      <Field label="Opening line (verbatim)" value={hookText} onChange={setHookText} disabled={locked || busy} multiline rows={2} />
      <Field label="Archetype" value={archetype} onChange={setArchetype} disabled={locked || busy} />
      {h.rationale && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{h.rationale}</div>}
      {err && <div className="error" style={{ fontSize: 11, marginTop: 6 }}>{err}</div>}
      <SubmitRow
        busy={busy} locked={locked}
        onSubmit={() => submitEdits(creative_id, 'hooks', { picked: { hook: hookText, hook_type: archetype, first_visual: h.visual } }, onSubmit, setBusy, setErr)}
        label="Use this hook & continue"
      />
    </div>
  );
}

// ─── Draft (video full script) ──────────────────────────────────────────────
function DraftCard({ creative_id, payload, onSubmit, locked }) {
  const [script, setScript] = useState(payload?.full_script || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const wc = script.trim() ? script.trim().split(/\s+/).length : 0;
  return (
    <div style={cardShell}>
      <CardHeader stage="draft" locked={locked} />
      <textarea
        value={script}
        onChange={(e) => setScript(e.target.value)}
        rows={Math.min(16, Math.max(8, script.split('\n').length + 2))}
        disabled={locked || busy}
        style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, padding: 8, borderRadius: 6, border: '1px solid var(--border)', resize: 'vertical' }}
      />
      <div className="meta" style={{ fontSize: 10, marginTop: 2 }}>
        {wc} words · ~{Math.max(1, Math.round(wc / 2.5))}s spoken
      </div>
      {err && <div className="error" style={{ fontSize: 11, marginTop: 6 }}>{err}</div>}
      <SubmitRow
        busy={busy} locked={locked}
        onSubmit={() => submitEdits(creative_id, 'draft', { full_script: script }, onSubmit, setBusy, setErr)}
        label="Save script & continue"
      />
    </div>
  );
}

// ─── Critique (read-only verdict + scores) ──────────────────────────────────
function CritiqueCard({ creative_id, payload, onSubmit, locked }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const verdict = payload?.verdict || 'unknown';
  const scores = payload?.scores || {};
  const verdictPill = verdict === 'ship' ? 'pill' : verdict === 'replace' ? 'pill warn' : 'pill';
  return (
    <div style={cardShell}>
      <CardHeader stage="critique" locked={locked} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <span className={verdictPill} style={{ fontSize: 12 }}>{verdict.toUpperCase()}</span>
        {payload?.repairs_used > 0 && <span className="pill" style={{ fontSize: 10 }}>repaired ×{payload.repairs_used}</span>}
      </div>
      {Object.keys(scores).length > 0 && (
        <div style={{ fontSize: 11, marginBottom: 6, color: 'var(--text-dim)' }}>
          {Object.entries(scores).map(([k, v]) => `${k} ${v}`).join(' · ')}
        </div>
      )}
      {payload?.rationale && <div style={{ fontSize: 13, marginBottom: 6 }}>{payload.rationale}</div>}
      {err && <div className="error" style={{ fontSize: 11, marginTop: 6 }}>{err}</div>}
      <SubmitRow
        busy={busy} locked={locked}
        onSubmit={() => submitEdits(creative_id, 'critique', {}, onSubmit, setBusy, setErr)}
        label="Approve & continue"
      />
    </div>
  );
}

// ─── Tiny field helper ──────────────────────────────────────────────────────
function Field({ label, value, onChange, multiline, rows = 3, disabled }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          disabled={disabled}
          style={{ width: '100%', fontSize: 13, padding: 6, borderRadius: 6, border: '1px solid var(--border)', resize: 'vertical', fontFamily: 'inherit' }}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={{ width: '100%', fontSize: 13, padding: 6, borderRadius: 6, border: '1px solid var(--border)' }}
        />
      )}
    </div>
  );
}
