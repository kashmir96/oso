import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import { fmtRelative } from '../../lib/format.js';
import MarketingNav from './MarketingNav.jsx';

/**
 * Creative.jsx — read-only result card for one creative produced by the
 * chat-driven pipeline (creative_pipeline tool). The flow itself runs in
 * the business chat; this page is the artifact + lifecycle control surface:
 *
 *   - Brief readout
 *   - Strategy summary
 *   - Final components (headline/body/CTA for ads, full script for video)
 *   - Voiceover player + download
 *   - Lifecycle action buttons appropriate to current status:
 *       user_approved -> Submit to Assistant / Mark shipped
 *       shipped       -> Attach performance
 *       performed     -> Performance summary
 *
 * No more stage-walker UI. If you need to regenerate or reroll, do it in
 * the business chat.
 */
export default function Creative() {
  const { id } = useParams();
  if (!id) return <Empty />;
  return <ResultCard id={id} />;
}

function Empty() {
  return (
    <div className="app">
      <Header title="Creative" crumb="Marketing · result" back />
      <MarketingNav />
      <div className="card" style={{ padding: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>No creative selected</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
          Creatives are produced via the business chat — type "marketing mode"
          in the business chat to start one.
        </div>
        <div style={{ marginTop: 12 }}>
          <Link to="/business/marketing/drafts">
            <button className="primary" style={{ fontSize: 12 }}>Browse all creatives →</button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function ResultCard({ id }) {
  const [creative, setCreative] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await call('mktg-ads', { action: 'creative_get', creative_id: id });
      setCreative(r.creative);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [id]);

  async function transition(to_status, extras = {}) {
    setBusy(true); setErr('');
    try {
      await call('mktg-ads', { action: 'creative_transition', creative_id: id, to_status, extras });
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function generateVO() {
    setBusy(true); setErr('');
    try {
      await call('mktg-vo', { action: 'generate_creative', creative_id: id });
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function deleteVO() {
    if (!confirm('Delete the voiceover MP3? The link will stop working.')) return;
    setBusy(true); setErr('');
    try {
      await call('mktg-vo', { action: 'delete_creative', creative_id: id });
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (err && !creative) return <div className="app"><Header title="Creative" back /><div className="error">{err}</div></div>;
  if (!creative) return <div className="app"><Header title="Creative" back /><div className="loading">Loading…</div></div>;

  const isVideo = creative.creative_type === 'video_script';
  const components = creative.components || {};
  const status = creative.status;
  const hasScript = !!(components.script?.full_script || components.body);

  return (
    <div className="app">
      <Header title="Creative" crumb={`${creative.creative_type} · ${status}`} back />
      <MarketingNav />

      {err && <div className="error">{err}</div>}

      <BriefCard brief={creative.brief} status={status} />

      {components.strategy && <StrategyCard strategy={components.strategy} />}

      {!isVideo && (components.headline || components.body) && (
        <AdComponentsCard components={components} />
      )}

      {isVideo && components.script?.full_script && (
        <ScriptCard script={components.script} />
      )}

      <VoiceoverCard
        creative={creative}
        onGenerate={generateVO}
        onDelete={deleteVO}
        busy={busy}
        hasScript={hasScript}
      />

      <AssetsPanel creative_id={creative.creative_id} status={status} />


      <LifecycleCard
        creative={creative}
        busy={busy}
        onTransition={transition}
        onChange={load}
      />
    </div>
  );
}

// ─── Brief readout ─────────────────────────────────────────────────────────
function BriefCard({ brief, status }) {
  if (!brief) return null;
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div className="section-title" style={{ margin: 0 }}>Brief</div>
        <span className="pill">{status}</span>
      </div>
      <div style={{ fontSize: 14 }}>{brief.objective}</div>
      <div className="meta" style={{ marginTop: 6 }}>
        {brief.platform && <span>{brief.platform}</span>}
        {brief.format && <span>{brief.format}</span>}
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

function StrategyCard({ strategy }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="section-title" style={{ margin: '0 0 6px' }}>Strategy</div>
      <div style={{ fontSize: 13 }}><strong>Angle:</strong> {strategy.primary_angle}</div>
      {strategy.audience_message_fit && (
        <div style={{ fontSize: 12, marginTop: 6 }}>{strategy.audience_message_fit}</div>
      )}
      <div className="meta" style={{ fontSize: 10, marginTop: 6 }}>
        {strategy.exemplar_strength && <span className={`pill ${strategy.exemplar_strength === 'weak' ? 'warn' : ''}`}>{strategy.exemplar_strength}</span>}
        {Array.isArray(strategy.flags) && strategy.flags.map((f) => <span key={f} className="pill warn">{f}</span>)}
        {Array.isArray(strategy.citations) && strategy.citations.length > 0 && <span>{strategy.citations.length} citations</span>}
      </div>
    </div>
  );
}

function AdComponentsCard({ components }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="section-title" style={{ margin: '0 0 8px' }}>Ad components</div>
      {components.headline && <Field label="Headline" value={components.headline} />}
      {components.body && <Field label="Body" value={components.body} multiline />}
      {components.cta && <Field label="CTA" value={components.cta} />}
      {components.image_ref && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11 }}>Image prompt</summary>
          <div style={{ fontSize: 12, marginTop: 4, color: 'var(--text-dim)' }}>{components.image_ref}</div>
        </details>
      )}
      {Array.isArray(components.palette) && components.palette.length > 0 && (
        <div className="meta" style={{ fontSize: 11, marginTop: 6 }}>palette: {components.palette.join(', ')}</div>
      )}
    </div>
  );
}

function ScriptCard({ script }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="section-title" style={{ margin: 0 }}>Script</div>
        <button onClick={() => navigator.clipboard.writeText(script.full_script)} style={{ fontSize: 11, padding: '4px 10px' }}>
          Copy
        </button>
      </div>
      {script.hook && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
          Hook: <em>"{script.hook}"</em> ({script.hook_type || 'unknown'})
        </div>
      )}
      <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{script.full_script}</div>
      {Array.isArray(script.section_breakdown) && script.section_breakdown.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11 }}>Section breakdown ({script.section_breakdown.length})</summary>
          <ul style={{ paddingLeft: 18, marginTop: 4, fontSize: 12 }}>
            {script.section_breakdown.map((s, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                [{s.timestamp}] {s.spoken_line}{s.broll ? ` // ${s.broll}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function VoiceoverCard({ creative, onGenerate, onDelete, busy, hasScript }) {
  const [captions, setCaptions] = useState(null);  // [{format, public_url}]
  const [capBusy, setCapBusy] = useState(false);
  const [capErr,  setCapErr]  = useState('');

  // Load any existing captions for this creative once when we mount.
  useEffect(() => {
    if (!creative?.creative_id || !creative.voiceover_url) return;
    (async () => {
      try {
        const r = await call('mktg-assets', { action: 'list', creative_id: creative.creative_id, kind: undefined });
        const cap = (r.assets || []).filter((a) => a.kind === 'caption_srt' || a.kind === 'caption_vtt' && a.status === 'ready');
        if (cap.length) {
          setCaptions(cap.map((c) => ({
            format: c.kind === 'caption_srt' ? 'srt' : 'vtt',
            public_url: c.public_url,
            asset_id: c.asset_id,
          })));
        }
      } catch { /* ignore — non-blocking */ }
    })();
  }, [creative?.creative_id, creative?.voiceover_url]);

  async function generateCaptions() {
    setCapBusy(true); setCapErr('');
    try {
      const r = await call('mktg-assets', { action: 'generate_captions', creative_id: creative.creative_id });
      if (r.error) throw new Error(r.error);
      setCaptions(r.captions || []);
    } catch (e) { setCapErr(e.message); } finally { setCapBusy(false); }
  }

  if (!hasScript) return null;
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="section-title" style={{ margin: 0 }}>Voiceover (ElevenLabs)</div>
        {creative.voiceover_url && <span className="pill">ready</span>}
      </div>
      {!creative.voiceover_url ? (
        <button onClick={onGenerate} disabled={busy} className="primary" style={{ fontSize: 13, padding: '8px 14px' }}>
          {busy ? 'Generating…' : 'Generate voiceover'}
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input value={creative.voiceover_url} readOnly onClick={(e) => e.target.select()} style={{ flex: 1, fontSize: 12 }} />
            <button onClick={() => navigator.clipboard.writeText(creative.voiceover_url)} style={{ padding: '6px 12px', fontSize: 12 }}>Copy link</button>
            <a href={creative.voiceover_url} target="_blank" rel="noreferrer" style={{ padding: '6px 12px', fontSize: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}>▶ Download MP3</a>
          </div>
          <audio controls src={creative.voiceover_url} style={{ width: '100%', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={onGenerate} disabled={busy} style={{ fontSize: 11, padding: '4px 10px' }}>{busy ? '…' : '↻ Re-render'}</button>
            <button onClick={onDelete} disabled={busy} className="danger" style={{ fontSize: 11, padding: '4px 10px' }}>Delete</button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              voice: {creative.voiceover_voice_id || 'default'}
            </span>
          </div>

          {/* Captions row -- generate or download. */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Captions (from the VO above)</div>
            {captions && captions.length > 0 ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {captions.map((c) => (
                  <a key={c.asset_id} href={c.public_url} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}>
                    Download .{c.format}
                  </a>
                ))}
                <button onClick={generateCaptions} disabled={capBusy} style={{ fontSize: 11, padding: '4px 10px' }}>
                  {capBusy ? 'Re-generating…' : '↻ Regenerate'}
                </button>
              </div>
            ) : (
              <button onClick={generateCaptions} disabled={capBusy} style={{ fontSize: 12, padding: '5px 12px' }}>
                {capBusy ? 'Generating captions…' : '+ Generate AI captions'}
              </button>
            )}
            {capErr && <div className="error" style={{ fontSize: 11, marginTop: 6 }}>{capErr}</div>}
          </div>
        </>
      )}
    </div>
  );
}

function LifecycleCard({ creative, busy, onTransition, onChange }) {
  const status = creative.status;

  if (status === 'drafted') {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ margin: '0 0 6px' }}>Status: drafted</div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Approve / reject this creative in the business chat ("approve" or
          "reject this") — that's where the AI also captures the feedback.
        </div>
      </div>
    );
  }

  if (status === 'user_approved') {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ margin: '0 0 6px' }}>Approved — what next?</div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
          Either send this to the production assistant queue (someone else
          produces the asset and uploads back), or mark shipped if you've
          already launched it yourself.
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button onClick={() => onTransition('submitted')} disabled={busy} className="primary">
            {busy ? '…' : 'Submit to Assistant queue'}
          </button>
          <button onClick={() => onTransition('shipped', {})} disabled={busy}>
            {busy ? '…' : 'Mark shipped'}
          </button>
        </div>
      </div>
    );
  }

  if (status === 'submitted' || status === 'in_production' || status === 'needs_approval') {
    return (
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ margin: '0 0 6px' }}>In production queue</div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
          Tracked at <Link to="/business/marketing/assistant">/business/marketing/assistant</Link>.
          {creative.submitted_at && ` Submitted ${fmtRelative(creative.submitted_at)}.`}
        </div>
        {status === 'needs_approval' && (
          <>
            {creative.production_asset_url && (
              <div style={{ fontSize: 12, marginBottom: 6 }}>
                Asset: <a href={creative.production_asset_url} target="_blank" rel="noreferrer">{creative.production_asset_url}</a>
              </div>
            )}
            {creative.production_notes && (
              <div style={{ fontSize: 12, marginBottom: 8, whiteSpace: 'pre-wrap' }}>
                <strong>Production notes:</strong> {creative.production_notes}
              </div>
            )}
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button onClick={() => onTransition('user_approved', { approval_reason: 'asset approved by Curtis' })} disabled={busy} className="primary">
                {busy ? '…' : 'Approve produced asset'}
              </button>
              <button onClick={() => {
                const note = prompt('Changes needed:', creative.approval_notes || '');
                if (note != null) onTransition('in_production', { approval_notes: note || null });
              }} disabled={busy}>
                Request changes
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (status === 'shipped') {
    return <PerformanceForm creative={creative} onSubmit={(performance) => onTransition('performed', { performance })} busy={busy} />;
  }

  if (status === 'performed' && creative.performance) {
    return <PerformedSummary perf={creative.performance} />;
  }

  if (status === 'user_rejected') {
    return (
      <div className="card" style={{ marginBottom: 12, opacity: 0.7 }}>
        <div className="section-title" style={{ margin: '0 0 6px' }}>Rejected</div>
        <div style={{ fontSize: 13 }}>This creative was rejected. Start a fresh brief in the business chat.</div>
      </div>
    );
  }
  return null;
}

// ─── Assets panel: AI-generated images/videos/captions + uploaded finished files ─
// Lists everything tied to this creative_id, grouped by kind. Lets Curtis
// (or the assistant) upload the finished video file.
function AssetsPanel({ creative_id, status }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const [brollBusy, setBrollBusy] = useState(false);
  const [brollErr, setBrollErr] = useState('');

  async function load() {
    try {
      const r = await call('mktg-assets', { action: 'list', creative_id });
      setItems((r.assets || []).filter((a) => a.status === 'ready' || a.status === 'pending'));
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { if (creative_id) load(); }, [creative_id]);

  // Auto-poll while there are pending video assets. Each pending video
  // takes 30-90s; the cron picks it up within a minute. Poll every 15s
  // until none are pending. Avoids forcing Curtis to manually refresh.
  const hasPending = (items || []).some((a) => a.status === 'pending');
  useEffect(() => {
    if (!creative_id || !hasPending) return;
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [creative_id, hasPending]);

  async function generateBroll() {
    setBrollBusy(true); setBrollErr('');
    try {
      const r = await call('mktg-assets', { action: 'generate_broll_for_creative', creative_id });
      if (r.error) throw new Error(r.error);
      await load();
    } catch (e) { setBrollErr(e.message); } finally { setBrollBusy(false); }
  }

  async function delAsset(asset_id) {
    if (!confirm('Delete this asset? The link will stop working.')) return;
    setBusy(true); setErr('');
    try {
      await call('mktg-assets', { action: 'delete', asset_id });
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function onUploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setUploadErr('File too large (>50MB).');
      e.target.value = '';
      return;
    }
    setUploading(true); setUploadErr('');
    try {
      const buf = await file.arrayBuffer();
      const data_base64 = arrayBufferToBase64(buf);
      await call('mktg-assets', {
        action: 'upload_finished_asset',
        creative_id,
        data_base64,
        mime_type: file.type || 'video/mp4',
        filename: file.name,
      });
      await load();
    } catch (e) { setUploadErr(e.message); }
    finally { setUploading(false); e.target.value = ''; }
  }

  if (!creative_id) return null;
  if (!items) return null;

  const images   = items.filter((a) => a.kind === 'image');
  const videos   = items.filter((a) => a.kind === 'video');
  const captions = items.filter((a) => a.kind === 'caption_srt' || a.kind === 'caption_vtt');

  const isShipReady = status === 'submitted' || status === 'in_production' || status === 'needs_approval' || status === 'shipped' || status === 'performed';

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="section-title" style={{ margin: 0 }}>Assets</div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{items.length} total</span>
      </div>

      {items.length === 0 ? (
        <div className="empty" style={{ fontSize: 12 }}>
          No assets yet. Generate an image / video from the chat ("image:" or "video:"), auto-gen b-roll below, or upload the finished file.
        </div>
      ) : (
        <>
          {videos.length > 0 && <AssetGroup label="Videos" assets={videos} onDelete={delAsset} busy={busy} kind="video" />}
          {images.length > 0 && <AssetGroup label="Images" assets={images} onDelete={delAsset} busy={busy} kind="image" />}
          {captions.length > 0 && <AssetGroup label="Captions" assets={captions} onDelete={delAsset} busy={busy} kind="caption" />}
        </>
      )}

      {/* B-roll auto-gen: only shown when the creative has a script with
          broll_shots. Generates one image per shot in parallel. */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={generateBroll} disabled={brollBusy} style={{ fontSize: 12, padding: '5px 12px' }}>
          {brollBusy ? 'Generating b-roll…' : '+ Auto-gen B-roll from script'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          One image per broll_shot in the script (parallel, ~$0.06 each, max 6).
        </span>
        {brollErr && <div className="error" style={{ fontSize: 11 }}>{brollErr}</div>}
      </div>

      {hasPending && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-dim)' }}>
          ↻ Auto-refreshing while pending videos finish (every 15s)…
        </div>
      )}

      {/* Upload-finished-file slot. Visible once we're past initial drafted --
          mirrors the Assistant queue flow. */}
      {isShipReady && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
            Upload the finished file (the rendered video the editor produced)
          </div>
          <input type="file" onChange={onUploadFile} disabled={uploading}
            accept="video/*,image/*"
            style={{ fontSize: 12 }} />
          {uploading && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>Uploading…</div>}
          {uploadErr && <div className="error" style={{ fontSize: 11, marginTop: 4 }}>{uploadErr}</div>}
        </div>
      )}
      {err && <div className="error" style={{ fontSize: 11, marginTop: 8 }}>{err}</div>}
    </div>
  );
}

function AssetGroup({ label, assets, onDelete, busy, kind }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label} ({assets.length})
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {assets.map((a) => (
          <div key={a.asset_id} style={{ width: 200, border: '1px solid var(--border)', borderRadius: 6, padding: 6, fontSize: 11 }}>
            {kind === 'image' && a.status === 'ready' && (
              <a href={a.public_url} target="_blank" rel="noreferrer">
                <img src={a.public_url} alt={a.prompt || ''} style={{ width: '100%', borderRadius: 4, marginBottom: 4 }} />
              </a>
            )}
            {kind === 'video' && a.status === 'ready' && (
              <video src={a.public_url} controls style={{ width: '100%', borderRadius: 4, marginBottom: 4 }} />
            )}
            {kind === 'video' && a.status === 'pending' && (
              <div style={{ background: 'var(--bg-soft)', padding: 12, textAlign: 'center', borderRadius: 4, marginBottom: 4 }}>
                Generating…<br /><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>refresh in 1-2 min</span>
              </div>
            )}
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-dim)' }} title={a.prompt || ''}>
              {a.provider === 'upload' ? '↑ uploaded' : (a.prompt || a.kind)}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <a href={a.public_url} target="_blank" rel="noreferrer" style={{ fontSize: 10, padding: '2px 6px', textDecoration: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }}>Open</a>
              <button onClick={() => navigator.clipboard.writeText(a.public_url)} style={{ fontSize: 10, padding: '2px 6px' }}>Copy</button>
              <button onClick={() => onDelete(a.asset_id)} disabled={busy} className="danger" style={{ fontSize: 10, padding: '2px 6px', marginLeft: 'auto' }}>Del</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Minimal browser-side base64 encoder for the upload path. Avoids a
// 3rd-party dep -- TextEncoder + btoa with a chunk loop handles big files.
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ─── Performance attach ────────────────────────────────────────────────────
function PerformanceForm({ creative, onSubmit, busy }) {
  const fields = creative.creative_type === 'ad'
    ? ['impressions','clicks','ctr','conversions','spend','roas','primary_kpi_value']
    : ['views','ctr_thumbnail','avd_seconds','avg_percentage_viewed','engagement_rate'];
  const [m, setM] = useState({});
  const [pct, setPct] = useState('');
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="section-title" style={{ margin: '0 0 8px' }}>Attach performance</div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
        Numeric values where you have them. Percentile is required (used by the
        learning loop to weight retrieval).
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
        <button
          className="primary"
          disabled={busy || !pct}
          onClick={() => {
            const num = (k) => m[k] !== '' && m[k] != null ? Number(m[k]) : null;
            const performance = {
              captured_at: new Date().toISOString(),
              percentile_within_account: Number(pct),
            };
            if (creative.creative_type === 'ad') performance.ad_metrics    = Object.fromEntries(fields.map((f) => [f, num(f)]));
            else                                 performance.video_metrics = Object.fromEntries(fields.map((f) => [f, num(f)]));
            onSubmit(performance);
          }}
        >
          {busy ? 'Submitting…' : 'Mark performed'}
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

// ─── Tiny utility ─────────────────────────────────────────────────────────
function Field({ label, value, multiline }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, whiteSpace: multiline ? 'pre-wrap' : 'normal' }}>{value}</div>
    </div>
  );
}
