import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import MarketingNav from './MarketingNav.jsx';
import { STATUS_LABEL, statusPillClass, nzd, num } from './format.js';

const FORMATS = [
  { id: 'static',   label: 'Static',   hint: 'Single image, fastest to ship' },
  { id: 'video',    label: 'Video',    hint: 'Sound-on, ≤30s, talking-head + b-roll' },
  { id: 'carousel', label: 'Carousel', hint: '3–6 cards, ideal for product range' },
  { id: 'reel',     label: 'Reel',     hint: 'Vertical, ≤45s, hook + payoff' },
];

const CTA_OPTIONS = ['SHOP_NOW','LEARN_MORE','SIGN_UP','GET_OFFER'];

const STEPS = [
  { key: 'objective', label: 'Objective' },
  { key: 'campaign',  label: 'Campaign' },
  { key: 'format',    label: 'Format' },
  { key: 'concept',   label: 'Concept' },
  { key: 'creative',  label: 'Creative' },
  { key: 'copy',      label: 'Copy' },
  { key: 'final',     label: 'Final' },
];

function stepIndex(key) { return STEPS.findIndex((s) => s.key === key); }

export default function Wizard() {
  const { id } = useParams();
  const nav = useNavigate();
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Bootstrap: if no id, create a draft and redirect
  useEffect(() => {
    if (id) return;
    let alive = true;
    (async () => {
      try {
        const r = await call('mktg-ads', { action: 'create_draft' });
        if (!alive) return;
        nav(`/business/marketing/wizard/${r.draft.id}`, { replace: true });
      } catch (e) {
        if (alive) setErr(e.message);
      }
    })();
    return () => { alive = false; };
  }, [id, nav]);

  async function load() {
    if (!id) return;
    try {
      const r = await call('mktg-ads', { action: 'get_draft', id });
      setDraft(r.draft);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [id]);

  async function patch(patch) {
    setBusy(true); setErr('');
    try {
      const r = await call('mktg-ads', { action: 'update_draft', id, ...patch });
      setDraft(r.draft);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function regenerate(action, extras = {}) {
    setBusy(true); setErr('');
    try {
      const r = await call('mktg-ads', { action, id, ...extras });
      setDraft(r.draft);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (err && !draft) return (<div className="app"><Header title="Ad creator" back /><MarketingNav /><div className="error">{err}</div></div>);
  if (!draft) return (<div className="app"><Header title="Ad creator" back /><MarketingNav /><div className="loading">Loading…</div></div>);

  const stepKey = draft.current_step || 'objective';

  return (
    <div className="app">
      <Header title="Ad creator" crumb={`Draft · ${draft.id.slice(0, 8)}`} back />
      <MarketingNav />

      <StepProgress current={stepKey} />

      {err && <div className="error">{err}</div>}

      {stepKey === 'objective' && <ObjectiveStep draft={draft} busy={busy} onNext={(objective) => patch({ objective, current_step: 'campaign' })} />}
      {stepKey === 'campaign'  && <CampaignStep  draft={draft} busy={busy} onBack={() => patch({ current_step: 'objective' })} onNext={(campaign_id) => patch({ campaign_id, current_step: 'format' })} />}
      {stepKey === 'format'    && <FormatStep    draft={draft} busy={busy} onBack={() => patch({ current_step: 'campaign' })} onNext={(p) => patch({ ...p, current_step: 'concept' })} />}
      {stepKey === 'concept'   && <ConceptStep   draft={draft} busy={busy} onBack={() => patch({ current_step: 'format' })} onPick={(selected_concept_id) => patch({ selected_concept_id, current_step: 'creative' })} onRegenerate={() => regenerate('generate_concepts')} onGenerate={() => regenerate('generate_concepts')} />}
      {stepKey === 'creative'  && <CreativeStep  draft={draft} busy={busy} onBack={() => patch({ current_step: 'concept' })} onAccept={() => patch({ current_step: 'copy' })} onGenerate={() => regenerate('generate_creative')} onRegenerate={() => regenerate('regenerate_step', { step: 'creative' })} />}
      {stepKey === 'copy'      && <CopyStep      draft={draft} busy={busy} onBack={() => patch({ current_step: 'creative' })} onApprove={(primary_text_final) => patch({ primary_text_final, current_step: 'final' })} onGenerate={() => regenerate('generate_copy')} onRegenerate={(feedback) => regenerate('regenerate_step', { step: 'copy', feedback })} />}
      {stepKey === 'final'     && <FinalStep     draft={draft} busy={busy} onBack={() => patch({ current_step: 'copy' })} onPatch={patch} onTransition={(action, extras) => regenerate(action, extras)} />}
    </div>
  );
}

// ── Progress strip ──
function StepProgress({ current }) {
  const cur = stepIndex(current);
  return (
    <div className="filterbar" style={{ overflowX: 'auto', marginBottom: 14 }}>
      {STEPS.map((s, i) => (
        <div
          key={s.key}
          style={{
            fontSize: 11, padding: '4px 9px', borderRadius: 999,
            border: '1px solid var(--border)', whiteSpace: 'nowrap',
            background: i === cur ? 'var(--accent)' : i < cur ? 'var(--bg-elev-2)' : 'transparent',
            color:      i === cur ? '#06130c' : i < cur ? 'var(--text)' : 'var(--text-dim)',
            fontWeight: i === cur ? 600 : 400,
          }}
        >{i + 1}. {s.label}</div>
      ))}
    </div>
  );
}

// ── Step 1: Objective ──
function ObjectiveStep({ draft, busy, onNext }) {
  const [text, setText] = useState(draft.objective || '');
  return (
    <div className="card">
      <div className="title">What's the objective?</div>
      <div className="sub">Plain English. e.g. "Get more cold-traffic sales of the Reviana day cream", "Reactivate lapsed shampoo-bar customers".</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        style={{ marginTop: 10 }}
        autoFocus
      />
      <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
        <button className="primary" disabled={!text.trim() || busy} onClick={() => onNext(text.trim())}>
          {busy ? '…' : 'Next →'}
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Campaign ──
function CampaignStep({ draft, busy, onBack, onNext }) {
  const [campaigns, setCampaigns] = useState(null);
  const [pick, setPick] = useState(draft.campaign_id || '');
  const [err, setErr] = useState('');

  useEffect(() => {
    call('mktg-data', { action: 'list_campaigns' })
      .then((r) => setCampaigns(r.campaigns))
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="error">{err}</div>;
  if (!campaigns) return <div className="loading">Loading campaigns…</div>;

  return (
    <div>
      <div className="section-title"><span>Pick a campaign</span></div>
      <div className="row-list">
        {campaigns.map((c) => (
          <button
            key={c.id}
            onClick={() => setPick(c.id)}
            className="row-item"
            style={{ textAlign: 'left', cursor: 'pointer', borderColor: pick === c.id ? 'var(--accent)' : undefined }}
          >
            <div className="name">{c.name}</div>
            <div className="meta">
              {c.role_in_funnel && <span>{c.role_in_funnel}</span>}
              <span><strong>{num(c.concept_count)}</strong> concepts</span>
              <span><strong>{num(c.ad_count)}</strong> ads</span>
              {c.total_spend_nzd > 0 && <span><strong>{nzd(c.total_spend_nzd)}</strong> spent</span>}
            </div>
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button onClick={onBack} disabled={busy}>← Back</button>
        <button className="primary" disabled={!pick || busy} onClick={() => onNext(pick)}>{busy ? '…' : 'Next →'}</button>
      </div>
    </div>
  );
}

// ── Step 3: Format / audience / landing URL ──
function FormatStep({ draft, busy, onBack, onNext }) {
  const [format, setFormat] = useState(draft.format || '');
  const [audience, setAudience] = useState(draft.audience_type || '');
  const [landing, setLanding] = useState(draft.landing_url || '');
  const ok = format && audience.trim() && landing.trim();
  return (
    <div>
      <div className="section-title"><span>Format</span></div>
      <div className="stat-grid">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            className="stat"
            onClick={() => setFormat(f.id)}
            style={{ cursor: 'pointer', textAlign: 'left', borderColor: format === f.id ? 'var(--accent)' : undefined }}
          >
            <div className="label">{f.label}</div>
            <div className="sub" style={{ marginTop: 4 }}>{f.hint}</div>
          </button>
        ))}
      </div>

      <div className="field" style={{ marginTop: 18 }}>
        <label>Audience</label>
        <input
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="cold NZ women 25-55 / lapsed customers / lookalike from purchases / interest-based eczema"
        />
      </div>
      <div className="field">
        <label>Landing-page URL</label>
        <input
          value={landing}
          onChange={(e) => setLanding(e.target.value)}
          placeholder="https://primalpantry.co.nz/products/…"
        />
      </div>

      <div className="row">
        <button onClick={onBack} disabled={busy}>← Back</button>
        <button className="primary" disabled={!ok || busy} onClick={() => onNext({ format, audience_type: audience.trim(), landing_url: landing.trim() })}>
          {busy ? '…' : 'Next →'}
        </button>
      </div>
    </div>
  );
}

// ── Step 4: Concept ──
function ConceptStep({ draft, busy, onBack, onPick, onGenerate, onRegenerate }) {
  const recs = Array.isArray(draft.recommended_concepts) ? draft.recommended_concepts : [];
  const hasRecs = recs.length > 0;

  return (
    <div>
      <div className="section-title">
        <span>AI concept recommendations</span>
        {hasRecs && <button onClick={onRegenerate} disabled={busy} style={{ fontSize: 11, padding: '4px 10px' }}>{busy ? '…' : 'Regenerate'}</button>}
      </div>

      {!hasRecs && (
        <div className="card">
          <div>Generate 3 concept recommendations from the playbook + top-performing ads in this campaign, filtered to the objective and format.</div>
          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={onBack} disabled={busy}>← Back</button>
            <button className="primary" onClick={onGenerate} disabled={busy}>{busy ? 'Generating…' : 'Generate concepts'}</button>
          </div>
        </div>
      )}

      {hasRecs && (
        <>
          <div className="row-list">
            {recs.map((r, i) => (
              <button
                key={i}
                onClick={() => onPick(r.id || `__new:${r.name}`)}
                className="row-item"
                style={{ textAlign: 'left', cursor: 'pointer' }}
                disabled={busy}
              >
                <div className="name">
                  {r.name}{' '}
                  {r.id ? (
                    <span className="pill outline" style={{ marginLeft: 6 }}>existing · {r.id}</span>
                  ) : (
                    <span className="pill warn" style={{ marginLeft: 6 }}>new</span>
                  )}
                </div>
                <div className="body">{r.why}</div>
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={onBack} disabled={busy}>← Back</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Step 5: Creative ──
function CreativeStep({ draft, busy, onBack, onAccept, onGenerate, onRegenerate }) {
  const c = draft.creative;
  const isVideo = draft.format === 'video' || draft.format === 'reel';

  if (!c) {
    return (
      <div className="card">
        <div className="title">Generate creative direction</div>
        <div className="sub" style={{ marginTop: 6 }}>
          {isVideo ? 'Produces a video timeline + voiceover script + B-roll shot list ready for Gemini or your shooter.'
                   : 'Produces a visual brief + 3 image-generation prompts + plain-language shot ideas.'}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={onBack} disabled={busy}>← Back</button>
          <button className="primary" onClick={onGenerate} disabled={busy}>{busy ? 'Generating…' : 'Generate creative'}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="section-title">
        <span>Creative direction</span>
        <button onClick={onRegenerate} disabled={busy} style={{ fontSize: 11, padding: '4px 10px' }}>{busy ? '…' : 'Regenerate'}</button>
      </div>

      {isVideo ? <VideoCreative c={c} /> : <ImageCreative c={c} />}

      <div className="row" style={{ marginTop: 14 }}>
        <button onClick={onBack} disabled={busy}>← Back</button>
        <button className="primary" onClick={onAccept} disabled={busy}>Approve & write copy →</button>
      </div>
    </div>
  );
}

function VideoCreative({ c }) {
  return (
    <>
      {Array.isArray(c.timeline) && c.timeline.length > 0 && (
        <div className="detail-block">
          <h2>Timeline</h2>
          <div className="row-list">
            {c.timeline.map((t, i) => (
              <div key={i} className="row-item">
                <div className="name">[{t.ts_sec}s] {t.shot}</div>
                {t.vo && <div className="meta"><strong>VO:</strong> {t.vo}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      {c.vo_script && (
        <div className="detail-block">
          <h2>Continuous voiceover script <CopyBtn text={c.vo_script} /></h2>
          <div className="script-body">{c.vo_script}</div>
        </div>
      )}
      {Array.isArray(c.b_roll_shots) && c.b_roll_shots.length > 0 && (
        <div className="detail-block">
          <h2>B-roll shot list (for Gemini / generation) <CopyBtn text={c.b_roll_shots.join('\n')} /></h2>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {c.b_roll_shots.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
          </ul>
        </div>
      )}
      {Array.isArray(c.shot_list) && c.shot_list.length > 0 && (
        <div className="detail-block">
          <h2>Shot list (for the user to film) <CopyBtn text={c.shot_list.join('\n')} /></h2>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {c.shot_list.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}

function ImageCreative({ c }) {
  return (
    <>
      {c.visual_brief && (
        <div className="detail-block">
          <h2>Visual brief</h2>
          <div className="ad-body">{c.visual_brief}</div>
        </div>
      )}
      {Array.isArray(c.image_prompts) && c.image_prompts.length > 0 && (
        <div className="detail-block">
          <h2>Image-generation prompts</h2>
          <div className="row-list">
            {c.image_prompts.map((p, i) => (
              <div key={i} className="row-item">
                <div className="name">Variant {i + 1} <CopyBtn text={p} /></div>
                <div className="body">{p}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {Array.isArray(c.shot_list) && c.shot_list.length > 0 && (
        <div className="detail-block">
          <h2>Shot list (if filming yourself) <CopyBtn text={c.shot_list.join('\n')} /></h2>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {c.shot_list.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}

// ── Step 6: Copy (with approve / regenerate-with-feedback) ──
function CopyStep({ draft, busy, onBack, onApprove, onGenerate, onRegenerate }) {
  const v1 = draft.primary_text_v1;
  const v2 = draft.primary_text_v2;
  const has = v1 || v2;
  const [pick, setPick] = useState(draft.primary_text_final ? (draft.primary_text_final === v1 ? 'v1' : draft.primary_text_final === v2 ? 'v2' : 'edit') : null);
  const [edit, setEdit] = useState(draft.primary_text_final && pick === 'edit' ? draft.primary_text_final : '');
  const [feedback, setFeedback] = useState('');

  if (!has) {
    return (
      <div className="card">
        <div className="title">Generate primary text + headline + CTA</div>
        <div className="sub" style={{ marginTop: 6 }}>Two versions, different angles. You pick (or edit) one.</div>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={onBack} disabled={busy}>← Back</button>
          <button className="primary" onClick={onGenerate} disabled={busy}>{busy ? 'Writing…' : 'Generate copy'}</button>
        </div>
      </div>
    );
  }

  function approve() {
    const final = pick === 'v1' ? v1 : pick === 'v2' ? v2 : edit.trim();
    if (!final) return;
    onApprove(final);
  }

  return (
    <div>
      <div className="section-title">
        <span>Primary text — pick one</span>
      </div>

      <CopyVariant
        label="Version A"
        body={v1}
        active={pick === 'v1'}
        onPick={() => setPick('v1')}
      />
      <CopyVariant
        label="Version B"
        body={v2}
        active={pick === 'v2'}
        onPick={() => setPick('v2')}
      />

      <div className="card" style={{ borderColor: pick === 'edit' ? 'var(--accent)' : undefined }} onClick={() => setPick('edit')}>
        <div className="title">Edit / write your own</div>
        <textarea
          rows={6}
          value={edit}
          onChange={(e) => { setEdit(e.target.value); setPick('edit'); }}
          placeholder="Type your final primary text here, or pick one of the versions above and tweak it."
          style={{ marginTop: 8 }}
        />
        {pick === 'edit' && (
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => setEdit(v1 || '')} style={{ fontSize: 12 }}>Start from A</button>
            <button onClick={() => setEdit(v2 || '')} style={{ fontSize: 12 }}>Start from B</button>
          </div>
        )}
      </div>

      <div className="detail-block">
        <h2>Other Meta fields</h2>
        <dl className="kv">
          <dt>Headline</dt><dd>{draft.headline || '—'} <CopyBtn text={draft.headline || ''} /></dd>
          <dt>Description</dt><dd>{draft.description || '—'} <CopyBtn text={draft.description || ''} /></dd>
          <dt>CTA</dt><dd>{draft.cta || '—'}</dd>
          <dt>Naming</dt><dd>{draft.naming || '—'} <CopyBtn text={draft.naming || ''} /></dd>
        </dl>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="title">Need changes? Tell the model what to fix.</div>
        <textarea
          rows={2}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="e.g. tighten v1, lose the price drop, lean harder into the founder voice"
          style={{ marginTop: 8 }}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => onRegenerate(feedback)} disabled={busy || !feedback.trim()}>Regenerate with feedback</button>
        </div>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button onClick={onBack} disabled={busy}>← Back</button>
        <button className="primary" onClick={approve} disabled={busy || !pick || (pick === 'edit' && !edit.trim())}>Approve & finish →</button>
      </div>
    </div>
  );
}

function CopyVariant({ label, body, active, onPick }) {
  return (
    <div
      className="card"
      onClick={onPick}
      style={{ cursor: 'pointer', borderColor: active ? 'var(--accent)' : undefined, marginBottom: 10 }}
    >
      <div className="title">
        {label}
        {active && <span className="pill good" style={{ marginLeft: 8 }}>picked</span>}
        <CopyBtn text={body || ''} />
      </div>
      <div className="ad-body" style={{ marginTop: 8 }}>{body}</div>
    </div>
  );
}

// ── Step 7: Final — review, edit any field, then move it through the workflow ──
function FinalStep({ draft, busy, onBack, onPatch, onTransition }) {
  // Local edit state — fields are editable inline; "Save" pushes patches.
  const [naming,       setNaming]       = useState(draft.naming || '');
  const [primaryText,  setPrimaryText]  = useState(draft.primary_text_final || draft.primary_text_v1 || '');
  const [headline,     setHeadline]     = useState(draft.headline || '');
  const [description,  setDescription]  = useState(draft.description || '');
  const [cta,          setCta]          = useState(draft.cta || '');
  const [landingUrl,   setLandingUrl]   = useState(draft.landing_url || '');
  const [approvalNotes, setApprovalNotes] = useState('');
  const [dirty, setDirty] = useState(false);

  // When the underlying draft changes (e.g. an assistant updated production_notes),
  // sync local edits unless the user has unsaved changes.
  useEffect(() => {
    if (dirty) return;
    setNaming(draft.naming || '');
    setPrimaryText(draft.primary_text_final || draft.primary_text_v1 || '');
    setHeadline(draft.headline || '');
    setDescription(draft.description || '');
    setCta(draft.cta || '');
    setLandingUrl(draft.landing_url || '');
  }, [draft.naming, draft.primary_text_final, draft.primary_text_v1, draft.headline, draft.description, draft.cta, draft.landing_url]); // eslint-disable-line

  function bind(setter) {
    return (e) => { setter(e.target.value); setDirty(true); };
  }
  async function save() {
    await onPatch({
      naming, headline, description, cta,
      landing_url: landingUrl,
      primary_text_final: primaryText,
    });
    setDirty(false);
  }

  // Status-machine helpers
  const status = draft.status;
  async function submitToCreator() {
    if (dirty) await save();
    await onTransition('submit_draft');
  }
  async function approveAndSave() {
    if (dirty) await save();
    await onTransition('approve_draft', { approval_notes: approvalNotes || null });
  }

  const editable = status === 'draft' || status === 'submitted' || status === 'in_production' || status === 'needs_approval';

  return (
    <div>
      <div className="section-title">
        <span>Final · review &amp; submit</span>
        <span className={statusPillClass(status)}>{STATUS_LABEL[status] || status}</span>
      </div>

      <FinalField label="Ad name (naming)" hint="Meta → Ad → Name"
        value={naming} onChange={bind(setNaming)} editable={editable} />
      <FinalField label="Primary text" hint="Meta → Primary text" multiline
        value={primaryText} onChange={bind(setPrimaryText)} editable={editable} />
      <FinalField label="Headline" hint="Meta → Headline"
        value={headline} onChange={bind(setHeadline)} editable={editable} />
      <FinalField label="Description" hint="Meta → Description"
        value={description} onChange={bind(setDescription)} editable={editable} />
      <FinalField label="Call to action" hint="Meta → Call to action button"
        value={cta} onChange={bind(setCta)} editable={editable} />
      <FinalField label="Website URL" hint="Meta → Website URL"
        value={landingUrl} onChange={bind(setLandingUrl)} editable={editable} />

      {/* Production handoff info — visible once submitted */}
      {(draft.production_notes || draft.production_asset_url) && (
        <div className="card" style={{ marginTop: 12, borderColor: 'var(--accent-dim)' }}>
          <div className="title">From the assistant</div>
          {draft.production_asset_url && (
            <div className="meta" style={{ marginTop: 6 }}>
              Asset: <a href={draft.production_asset_url} target="_blank" rel="noopener noreferrer">{draft.production_asset_url}</a>
            </div>
          )}
          {draft.production_notes && (
            <div className="ad-body" style={{ marginTop: 8 }}>{draft.production_notes}</div>
          )}
        </div>
      )}

      {draft.creative && (
        <details className="card" style={{ marginTop: 14 }}>
          <summary className="dim" style={{ fontSize: 12, cursor: 'pointer' }}>Creative direction (reference)</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 8 }}>{JSON.stringify(draft.creative, null, 2)}</pre>
        </details>
      )}

      {/* Action row varies by status */}
      <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        <button onClick={onBack} disabled={busy}>← Back to copy</button>
        {dirty && (
          <button onClick={save} disabled={busy}>Save edits</button>
        )}

        {status === 'draft' && (
          <button className="primary" onClick={submitToCreator} disabled={busy}>
            Submit to creator →
          </button>
        )}

        {status === 'submitted' && (
          <span className="pill" style={{ alignSelf: 'center' }}>Waiting for assistant to claim</span>
        )}

        {status === 'in_production' && (
          <span className="pill" style={{ alignSelf: 'center' }}>Assistant working on it</span>
        )}

        {status === 'needs_approval' && (
          <>
            <button onClick={() => onTransition('request_changes', { approval_notes: approvalNotes || null })} disabled={busy}>
              Request changes
            </button>
            <button className="primary" onClick={approveAndSave} disabled={busy}>
              Approve →
            </button>
          </>
        )}

        {status === 'approved' && (
          <button className="primary" onClick={() => onTransition('mark_live')} disabled={busy}>
            Mark live →
          </button>
        )}

        {status === 'live' && (
          <span className="pill good" style={{ alignSelf: 'center' }}>Live in Meta</span>
        )}
      </div>

      {(status === 'needs_approval') && (
        <div className="field" style={{ marginTop: 10 }}>
          <label>Notes for the assistant (optional)</label>
          <textarea rows={2} value={approvalNotes} onChange={(e) => setApprovalNotes(e.target.value)} />
        </div>
      )}

      <div style={{ marginTop: 18, textAlign: 'center' }}>
        <Link to="/business/marketing/wizard" className="dim" style={{ fontSize: 12 }}>+ Start a new draft</Link>
      </div>
    </div>
  );
}

function FinalField({ label, hint, value, onChange, editable, multiline }) {
  return (
    <div className="row-item" style={{ marginBottom: 6 }}>
      <div className="name" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{label}</span>
        <CopyBtn text={value || ''} />
      </div>
      <div className="meta dim">{hint}</div>
      {editable ? (
        multiline
          ? <textarea rows={5} value={value} onChange={onChange} style={{ marginTop: 6 }} />
          : <input value={value} onChange={onChange} style={{ marginTop: 6 }} />
      ) : (
        <div className={multiline ? 'ad-body' : ''} style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{value || '—'}</div>
      )}
    </div>
  );
}

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!text) return;
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      disabled={!text}
      style={{ fontSize: 11, padding: '2px 8px', marginLeft: 8 }}
      title="Copy to clipboard"
    >
      {done ? '✓' : '⎘'}
    </button>
  );
}
