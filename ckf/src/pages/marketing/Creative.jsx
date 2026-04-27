import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import MarketingNav from './MarketingNav.jsx';

/**
 * Creative.jsx — vertical slice for the new creative-agent pipeline.
 *
 * One page per creative. Walks the operator through:
 *   brief -> strategy -> (variants_ad | outline -> hooks -> draft) ->
 *   critique -> ship -> performance attach.
 *
 * Each stage:
 *   - "Run" button calls agent_run_stage with the brief + creative_id.
 *   - The parsed JSON renders as a structured view (not raw).
 *   - Operator can Approve (advance), Reroll (re-call same stage), or Reject
 *     (open feedback panel).
 *
 * Routing:
 *   /business/marketing/creative           -> intake form (new creative)
 *   /business/marketing/creative/:id       -> in-flight pipeline for that creative
 */
export default function Creative() {
  const { id } = useParams();
  if (!id) return <Intake />;
  return <Pipeline id={id} />;
}

// ─── Brief intake ──────────────────────────────────────────────────────────
function Intake() {
  const nav = useNavigate();
  const [creativeType, setCreativeType] = useState('ad');
  const [objective, setObjective] = useState('');
  const [audience, setAudience] = useState('');
  const [platform, setPlatform] = useState('meta');
  const [format, setFormat] = useState('static');
  const [length, setLength] = useState('');
  const [kpiMetric, setKpiMetric] = useState('purchase');
  const [kpiTarget, setKpiTarget] = useState('');
  const [constraints, setConstraints] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const brief = {
        objective,
        audience,
        kpi_target: { metric: kpiMetric, target_value: kpiTarget ? Number(kpiTarget) : null },
        platform,
        format,
        length_or_duration: length || null,
        constraints: constraints.split('\n').map((s) => s.trim()).filter(Boolean),
      };
      const r = await call('mktg-ads', { action: 'creative_create', creative_type: creativeType, brief });
      nav(`/business/marketing/creative/${r.creative.creative_id}`, { replace: true });
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="app">
      <Header title="New creative" crumb="Marketing · creative agent" back />
      <MarketingNav />

      <form className="card" onSubmit={submit} style={{ marginBottom: 14 }}>
        <div className="section-title" style={{ margin: '0 0 8px' }}>Brief</div>

        <div className="row" style={{ marginBottom: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <input type="radio" name="ct" value="ad" checked={creativeType === 'ad'} onChange={() => setCreativeType('ad')} />
            Ad (static / carousel)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <input type="radio" name="ct" value="video_script" checked={creativeType === 'video_script'} onChange={() => setCreativeType('video_script')} />
            Video script
          </label>
        </div>

        <div className="field">
          <label>Objective (what is this creative for?)</label>
          <textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} required
            placeholder="e.g. Acquire new customers in eczema/sensitive-skin segment via cold meta traffic." />
        </div>

        <div className="field">
          <label>Audience</label>
          <input value={audience} onChange={(e) => setAudience(e.target.value)} required
            placeholder="e.g. Cold NZ women 28-55, eczema flare-ups, mums, sensitive babies" />
        </div>

        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Platform</label>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="meta">Meta</option>
              <option value="google">Google</option>
              <option value="tiktok">TikTok</option>
              <option value="youtube">YouTube</option>
              <option value="shorts">Shorts</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Format</label>
            <input value={format} onChange={(e) => setFormat(e.target.value)} placeholder="static / video / carousel / reel" />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Length or duration</label>
            <input value={length} onChange={(e) => setLength(e.target.value)} placeholder="≤30s / 1080×1920" />
          </div>
        </div>

        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>KPI metric</label>
            <input value={kpiMetric} onChange={(e) => setKpiMetric(e.target.value)} placeholder="purchase / CTR / AVD" />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>KPI target (optional)</label>
            <input value={kpiTarget} onChange={(e) => setKpiTarget(e.target.value)} placeholder="numeric" />
          </div>
        </div>

        <div className="field">
          <label>Constraints (one per line)</label>
          <textarea value={constraints} onChange={(e) => setConstraints(e.target.value)} rows={3}
            placeholder="No medical claims&#10;Must include EANZ Gold Supporter&#10;CTA = Shop now" />
        </div>

        {err && <div className="error">{err}</div>}
        <div className="row">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Creating…' : 'Start pipeline →'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Pipeline (one creative) ───────────────────────────────────────────────
function Pipeline({ id }) {
  const [creative, setCreative] = useState(null);
  const [results, setResults] = useState({});  // stage -> agent response
  const [running, setRunning] = useState(null); // stage currently running
  const [err, setErr] = useState('');

  async function load() {
    try {
      const r = await call('mktg-ads', { action: 'creative_get', creative_id: id });
      setCreative(r.creative);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [id]);

  async function runStage(stage, extra) {
    setRunning(stage); setErr('');
    try {
      const r = await call('mktg-ads', {
        action: 'agent_run_stage',
        stage,
        creative_id: id,
        brief: creative.brief,
        extra,
      });
      setResults((s) => ({ ...s, [stage]: r }));
      if (!r.ok) setErr(`${stage}: ${r.validation_error || r.error}`);
    } catch (e) { setErr(e.message); } finally { setRunning(null); }
  }

  async function patchComponents(patch) {
    await call('mktg-ads', { action: 'creative_update_components', creative_id: id, patch });
    await load();
  }

  async function transition(to_status, extras = {}) {
    setErr('');
    try {
      await call('mktg-ads', { action: 'creative_transition', creative_id: id, to_status, extras });
      await load();
    } catch (e) { setErr(e.message); }
  }

  if (err && !creative) return <div className="app"><div className="error">{err}</div></div>;
  if (!creative) return <div className="app"><div className="loading">Loading…</div></div>;

  const isVideo = creative.creative_type === 'video_script';
  const status = creative.status;

  return (
    <div className="app">
      <Header title="Creative pipeline" crumb={`${creative.creative_type} · ${status}`} back />
      <MarketingNav />

      {err && <div className="error">{err}</div>}

      <BriefCard brief={creative.brief} />

      <StageBlock
        title="1. Strategy" stage="strategy" running={running}
        result={results.strategy} onRun={() => runStage('strategy')}
        onApprove={async () => {
          // Stash the chosen angle in components for downstream stages.
          await patchComponents({ strategy: results.strategy?.parsed });
        }}
      >
        {results.strategy?.ok && <StrategyView data={results.strategy.parsed} />}
      </StageBlock>

      {!isVideo && (
        <StageBlock
          title="2. Variants" stage="variants_ad" running={running}
          result={results.variants_ad}
          onRun={() => runStage('variants_ad', { strategy: results.strategy?.parsed })}
          onApprove={null /* picked per-variant below */}
        >
          {results.variants_ad?.ok && (
            <VariantsAdPicker
              variants={results.variants_ad.parsed.variants}
              onPick={async (v) => {
                await patchComponents({
                  headline: v.headline, body: v.body, cta: v.cta,
                  composition_pattern: v.composition_pattern,
                  palette: v.visual_style?.palette || [],
                  image_ref: v.image_prompt,
                });
              }}
            />
          )}
        </StageBlock>
      )}

      {isVideo && (
        <>
          <StageBlock
            title="2. Outline" stage="outline" running={running}
            result={results.outline}
            onRun={() => runStage('outline', { strategy: results.strategy?.parsed })}
            onApprove={async () => {
              await patchComponents({ script: { outline_beats: results.outline?.parsed?.beats || [] } });
            }}
          >
            {results.outline?.ok && <OutlineView data={results.outline.parsed} />}
          </StageBlock>

          <StageBlock
            title="3. Hooks" stage="hooks" running={running}
            result={results.hooks}
            onRun={() => runStage('hooks', { outline: results.outline?.parsed })}
            onApprove={null}
          >
            {results.hooks?.ok && (
              <HooksPicker
                hooks={results.hooks.parsed.hook_variants}
                onPick={async (h) => {
                  await patchComponents({ script: { ...(creative.components?.script || {}), hook: h.opening_lines_verbatim, hook_type: h.archetype } });
                }}
              />
            )}
          </StageBlock>

          <StageBlock
            title="4. Draft" stage="draft" running={running}
            result={results.draft}
            onRun={() => runStage('draft', { outline: results.outline?.parsed, hook: creative.components?.script?.hook })}
            onApprove={async () => {
              await patchComponents({
                script: { ...(creative.components?.script || {}), full_script: results.draft?.parsed?.full_script || '' },
              });
            }}
          >
            {results.draft?.ok && (
              <DraftEditor
                draft={results.draft.parsed}
                initialEdits={creative.user_edits_diff || ''}
                onSaveEdits={async (diff, edited) => {
                  await call('mktg-ads', {
                    action: 'creative_update_components', creative_id: id,
                    patch: {}, // no-op; just trigger the update path. The diff goes to the draft via a separate call below.
                  });
                  // Persist the diff onto the creative row so feedback stage can read it.
                  await call('mktg-ads', {
                    action: 'creative_transition', creative_id: id, to_status: status,  // no-op transition? skip
                    extras: { user_edits_diff: diff },
                  }).catch(() => {});
                  await patchComponents({ script: { ...(creative.components?.script || {}), full_script: edited } });
                }}
              />
            )}
          </StageBlock>
        </>
      )}

      <StageBlock
        title={isVideo ? '5. Critique' : '3. Critique'} stage="critique" running={running}
        result={results.critique}
        onRun={() => runStage('critique', {
          to_critique: isVideo
            ? { full_script: creative.components?.script?.full_script, hook: creative.components?.script?.hook }
            : { headline: creative.components?.headline, body: creative.components?.body, cta: creative.components?.cta },
        })}
        onApprove={null}
      >
        {results.critique?.ok && <CritiqueView data={results.critique.parsed} />}
      </StageBlock>

      {/* Lifecycle: approve / reject / ship / perform */}
      {status === 'drafted' && (
        <ApprovalCard
          critique={results.critique?.parsed}
          onApprove={(reason) => transition('user_approved', { approval_reason: reason || null, feedback_analysis: results.feedback?.parsed || null })}
          onReject={(feedback_analysis) => transition('user_rejected', { feedback_analysis })}
          onRunFeedback={() => runStage('feedback', {
            chosen: creative.components,
            user_edits_diff: creative.user_edits_diff,
          })}
          feedbackResult={results.feedback}
        />
      )}

      {status === 'user_approved' && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="section-title" style={{ margin: '0 0 6px' }}>Mark shipped</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
            Once you've launched the creative on the platform, mark shipped to enable performance capture.
          </div>
          <button className="primary" onClick={() => transition('shipped')}>Mark shipped</button>
        </div>
      )}

      {status === 'shipped' && (
        <PerformanceForm
          creativeType={creative.creative_type}
          onSubmit={(performance) => transition('performed', { performance })}
        />
      )}

      {status === 'performed' && creative.performance && (
        <PerformedSummary perf={creative.performance} />
      )}

      {status === 'user_rejected' && (
        <div className="card" style={{ marginBottom: 12, opacity: 0.7 }}>
          <div className="section-title" style={{ margin: '0 0 6px' }}>Rejected</div>
          <div style={{ fontSize: 13 }}>This creative was rejected. Start a new brief from the Drafts page.</div>
        </div>
      )}
    </div>
  );
}

// ─── Brief readout ─────────────────────────────────────────────────────────
function BriefCard({ brief }) {
  if (!brief) return null;
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="section-title" style={{ margin: '0 0 6px' }}>Brief</div>
      <div style={{ fontSize: 13 }}>{brief.objective}</div>
      <div className="meta" style={{ marginTop: 6 }}>
        <span>{brief.platform}</span>
        <span>{brief.format}</span>
        {brief.length_or_duration && <span>{brief.length_or_duration}</span>}
        <span>aud: {brief.audience}</span>
      </div>
      {Array.isArray(brief.constraints) && brief.constraints.length > 0 && (
        <ul style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0', paddingLeft: 18 }}>
          {brief.constraints.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      )}
    </div>
  );
}

// ─── Generic stage block ───────────────────────────────────────────────────
function StageBlock({ title, stage, running, result, onRun, onApprove, children }) {
  const isRunning = running === stage;
  const hasResult = !!result;
  const ok = result?.ok;
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="section-title" style={{ margin: 0 }}>{title}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onRun} disabled={isRunning} className={hasResult ? '' : 'primary'} style={{ fontSize: 12, padding: '5px 10px' }}>
            {isRunning ? 'Running…' : (hasResult ? 'Reroll' : 'Run')}
          </button>
          {onApprove && hasResult && ok && (
            <button onClick={onApprove} className="primary" style={{ fontSize: 12, padding: '5px 10px' }}>
              Approve
            </button>
          )}
        </div>
      </div>

      {hasResult && !ok && (
        <div className="error" style={{ fontSize: 12 }}>
          Validation failed: {result.validation_error || result.error}
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: 'pointer' }}>Raw output</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, marginTop: 6 }}>{result.raw}</pre>
          </details>
        </div>
      )}

      {hasResult && ok && children}

      {hasResult && (
        <div className="meta" style={{ marginTop: 8, fontSize: 10 }}>
          <span>{result.latency_ms}ms</span>
          <span>{result.input_tokens}+{result.output_tokens} tok</span>
          {result.cost_usd !== null && result.cost_usd !== undefined && <span>${result.cost_usd.toFixed(4)}</span>}
          {result.retried && <span className="pill warn">retried</span>}
        </div>
      )}
    </div>
  );
}

// ─── Per-stage views ───────────────────────────────────────────────────────
function StrategyView({ data }) {
  return (
    <>
      <div style={{ fontSize: 13, marginBottom: 8 }}><strong>Angle:</strong> {data.primary_angle}</div>
      <div style={{ fontSize: 12, marginBottom: 8 }}>{data.audience_message_fit}</div>
      {Array.isArray(data.alternatives_considered) && data.alternatives_considered.length > 0 && (
        <details style={{ marginBottom: 6 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12 }}>Alternatives considered ({data.alternatives_considered.length})</summary>
          <ul style={{ paddingLeft: 18, marginTop: 4 }}>
            {data.alternatives_considered.map((a, i) => (
              <li key={i} style={{ fontSize: 12, marginBottom: 4 }}>
                <strong>{a.angle}</strong> — {a.why_rejected}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="meta" style={{ fontSize: 10 }}>
        <span className={`pill ${data.exemplar_strength === 'weak' ? 'warn' : ''}`}>{data.exemplar_strength}</span>
        {data.flags.map((f) => <span key={f} className="pill warn">{f}</span>)}
        {data.citations.length > 0 && <span>{data.citations.length} citations</span>}
      </div>
    </>
  );
}

function VariantsAdPicker({ variants, onPick }) {
  return (
    <div className="row-list">
      {variants.map((v, i) => (
        <div key={v.variant_id || i} className="row-item">
          <div className="name" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>{v.headline}</span>
            <button onClick={() => onPick(v)} className="primary" style={{ fontSize: 11, padding: '4px 10px' }}>Pick</button>
          </div>
          <div className="meta">
            <span>{v.axis_explored}</span>
            <span>{v.composition_pattern}</span>
          </div>
          {v.body && <div style={{ fontSize: 12, marginTop: 6 }}>{v.body}</div>}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            CTA: {v.cta} · palette: {(v.visual_style?.palette || []).join(', ')}
          </div>
          <details style={{ marginTop: 4 }}>
            <summary style={{ cursor: 'pointer', fontSize: 11 }}>Image prompt</summary>
            <div style={{ fontSize: 11, marginTop: 4 }}>{v.image_prompt}</div>
          </details>
        </div>
      ))}
    </div>
  );
}

function OutlineView({ data }) {
  return (
    <>
      <div style={{ fontSize: 12, marginBottom: 6 }}><strong>Structure:</strong> {data.structure_template} · est {data.estimated_runtime}</div>
      <div className="row-list">
        {data.beats.map((b, i) => (
          <div key={i} className="row-item">
            <div className="name">[{b.timestamp}] {b.beat}</div>
            {b.broll && <div className="meta"><strong>B-roll:</strong> {b.broll}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

function HooksPicker({ hooks, onPick }) {
  return (
    <div className="row-list">
      {hooks.map((h) => (
        <div key={h.variant_id} className="row-item">
          <div className="name" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>"{h.opening_lines_verbatim}"</span>
            <button onClick={() => onPick(h)} className="primary" style={{ fontSize: 11, padding: '4px 10px' }}>Pick</button>
          </div>
          <div className="meta">
            <span>{h.archetype}</span>
            <span>{h.first_visual}</span>
          </div>
          <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-dim)' }}>{h.rationale}</div>
          {Array.isArray(h.citations) && h.citations.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>cites: {h.citations.join(', ')}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function DraftEditor({ draft, initialEdits, onSaveEdits }) {
  const [edited, setEdited] = useState(draft.full_script);
  const [busy, setBusy] = useState(false);
  // Whitespace-tolerant diff summary -- not character-level. Stored as a
  // plain note so the feedback stage can read what changed.
  function summarise(orig, e) {
    if (orig.trim() === e.trim()) return '';
    const dropped = orig.split('\n').filter((l) => !e.includes(l.trim())).slice(0, 3);
    const added   = e.split('\n').filter((l) => !orig.includes(l.trim())).slice(0, 3);
    return [
      dropped.length ? `dropped: ${dropped.map((l) => l.trim()).join(' / ')}` : null,
      added.length   ? `added: ${added.map((l) => l.trim()).join(' / ')}` : null,
    ].filter(Boolean).join(' | ');
  }
  return (
    <>
      <textarea value={edited} onChange={(e) => setEdited(e.target.value)} rows={12} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }} />
      <div className="meta" style={{ marginTop: 4 }}>
        <span>{edited.length} chars · {edited.split(/\s+/).length} words</span>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={async () => { setBusy(true); await onSaveEdits(summarise(draft.full_script, edited), edited); setBusy(false); }} disabled={busy}>
          {busy ? 'Saving…' : 'Save edits'}
        </button>
      </div>
      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: 'pointer', fontSize: 11 }}>Section breakdown ({draft.section_breakdown?.length || 0})</summary>
        <ul style={{ paddingLeft: 18, marginTop: 4 }}>
          {(draft.section_breakdown || []).map((s, i) => (
            <li key={i} style={{ fontSize: 12, marginBottom: 4 }}>
              [{s.timestamp}] {s.spoken_line}{s.broll ? ` // b-roll: ${s.broll}` : ''}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

function CritiqueView({ data }) {
  const verdictClass = data.verdict === 'ship' ? 'pill' : data.verdict === 'replace' ? 'pill warn' : 'pill';
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <span className={verdictClass} style={{ fontSize: 12 }}>{data.verdict.toUpperCase()}</span>
        <span style={{ fontSize: 12 }}>
          brief {data.scores.brief_fit}/5 · pattern {data.scores.pattern_adherence}/5 · hook {data.scores.hook_strength}/5 · brand {data.scores.brand_fit}/5
        </span>
      </div>
      <div className="meta" style={{ fontSize: 11, marginBottom: 8 }}>
        anti-pattern: {data.scores.anti_pattern_check} · retention-drop: {data.scores.retention_drop_signature_check}
      </div>
      <div style={{ fontSize: 13 }}>{data.rationale}</div>
      {data.repair_instructions && (
        <div style={{ fontSize: 12, marginTop: 8, padding: 8, background: 'var(--bg-soft)', borderRadius: 6 }}>
          <strong>Repair:</strong> {data.repair_instructions}
        </div>
      )}
    </>
  );
}

// ─── Approval / feedback panel ─────────────────────────────────────────────
function ApprovalCard({ critique, onApprove, onReject, onRunFeedback, feedbackResult }) {
  const [reason, setReason] = useState('');
  const [pickedChips, setPickedChips] = useState([]);
  const fb = feedbackResult?.parsed;
  const verdictBlocksApproval = critique && critique.verdict === 'replace';
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="section-title" style={{ margin: '0 0 8px' }}>Decision</div>

      {verdictBlocksApproval && (
        <div className="error" style={{ fontSize: 12, marginBottom: 8 }}>
          Critique verdict is "replace" -- start over before approving.
        </div>
      )}

      <div className="row" style={{ marginBottom: 10 }}>
        <button onClick={onRunFeedback} disabled={!critique}>Analyse feedback</button>
      </div>

      {fb && (
        <>
          {Array.isArray(fb.candidate_reasons_for_user_confirmation) && fb.candidate_reasons_for_user_confirmation.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>One-tap reasons (pick any that apply)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {fb.candidate_reasons_for_user_confirmation.map((c, i) => {
                  const picked = pickedChips.includes(i);
                  return (
                    <button key={i} onClick={() => setPickedChips((p) => picked ? p.filter((x) => x !== i) : [...p, i])}
                      className={picked ? 'primary' : ''}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 14 }}>
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
            confidence: {fb.confidence} · generalizable: {String(fb.generalizable)}
            {fb.generalization_caveat && <> · caveat: {fb.generalization_caveat}</>}
          </div>
        </>
      )}

      <div className="field">
        <label>Approval reason / note (optional)</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
          placeholder="Why this version, anything to remember." />
      </div>

      <div className="row">
        <button className="primary" disabled={verdictBlocksApproval}
          onClick={() => {
            const chipReasons = pickedChips.map((i) => fb.candidate_reasons_for_user_confirmation[i]).join(' · ');
            const composed = [reason, chipReasons].filter(Boolean).join(' || ') || 'approved';
            onApprove(composed);
          }}>Approve</button>
        <button className="danger"
          onClick={() => onReject(fb || { diffs: [], edit_analysis: [], top_hypotheses: [], candidate_reasons_for_user_confirmation: [], user_note_reconciliation: null, generalizable: false, generalization_caveat: 'rejected without feedback analysis', pattern_tags: [], confidence: 'low' })}>
          Reject
        </button>
      </div>
    </div>
  );
}

// ─── Performance attach form (for shipped creatives) ───────────────────────
function PerformanceForm({ creativeType, onSubmit }) {
  const [m, setM] = useState({});
  const fields = creativeType === 'ad'
    ? ['impressions','clicks','ctr','conversions','spend','roas','primary_kpi_value']
    : ['views','ctr_thumbnail','avd_seconds','avg_percentage_viewed','engagement_rate'];
  const [pct, setPct] = useState('');
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="section-title" style={{ margin: '0 0 8px' }}>Attach performance</div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
        Numeric values where you have them. percentile_within_account is required.
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {fields.map((f) => (
          <div key={f} className="field" style={{ flex: '1 1 140px' }}>
            <label>{f}</label>
            <input value={m[f] ?? ''} onChange={(e) => setM((s) => ({ ...s, [f]: e.target.value }))} placeholder="number" />
          </div>
        ))}
      </div>
      <div className="field">
        <label>percentile_within_account (0-100, REQUIRED)</label>
        <input value={pct} onChange={(e) => setPct(e.target.value)} required placeholder="0-100" />
      </div>
      <div className="row">
        <button className="primary"
          onClick={() => {
            const num = (k) => m[k] !== '' && m[k] != null ? Number(m[k]) : null;
            const performance = {
              captured_at: new Date().toISOString(),
              percentile_within_account: Number(pct),
            };
            if (creativeType === 'ad') {
              performance.ad_metrics = Object.fromEntries(fields.map((f) => [f, num(f)]));
            } else {
              performance.video_metrics = Object.fromEntries(fields.map((f) => [f, num(f)]));
            }
            onSubmit(performance);
          }}
        >
          Mark performed
        </button>
      </div>
    </div>
  );
}

function PerformedSummary({ perf }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="section-title" style={{ margin: '0 0 6px' }}>Performance</div>
      <div className="meta">
        <span>percentile {perf.percentile_within_account}</span>
        {perf.ad_metrics && (
          <>
            {perf.ad_metrics.impressions != null && <span>{perf.ad_metrics.impressions} impr</span>}
            {perf.ad_metrics.ctr != null && <span>CTR {(perf.ad_metrics.ctr * 100).toFixed(2)}%</span>}
            {perf.ad_metrics.spend != null && <span>${perf.ad_metrics.spend} spend</span>}
            {perf.ad_metrics.roas != null && <span>ROAS {perf.ad_metrics.roas}</span>}
          </>
        )}
        {perf.video_metrics && (
          <>
            {perf.video_metrics.views != null && <span>{perf.video_metrics.views} views</span>}
            {perf.video_metrics.avg_percentage_viewed != null && <span>{perf.video_metrics.avg_percentage_viewed}% AVD</span>}
          </>
        )}
      </div>
    </div>
  );
}
