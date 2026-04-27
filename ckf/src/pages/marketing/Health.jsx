import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import { fmtRelative } from '../../lib/format.js';
import MarketingNav from './MarketingNav.jsx';

/**
 * Health.jsx — operator dashboard for the creative-agent system.
 *
 * Sections (per spec section 7.1):
 *  - Recent performed records w/ percentile.
 *  - Pending proposals (patterns, anti-patterns, pain points, stat checks)
 *    with one-click Approve / Reject.
 *  - Stats due for re-verification (subset of pending proposals).
 *  - Last self-audit memo (markdown rendered as plain text for now).
 *  - Taste-vs-performance audit result.
 *  - Token usage + cost over the last 30 days, by stage.
 *  - Recent job runs (cron health).
 */
export default function Health() {
  const [perf, setPerf]           = useState(null);
  const [proposals, setProposals] = useState(null);
  const [memos, setMemos]         = useState(null);
  const [calls, setCalls]         = useState(null);
  const [runs, setRuns]           = useState(null);
  const [err, setErr] = useState('');

  async function load() {
    setErr('');
    try {
      const [pf, prop, m, ag, jr] = await Promise.all([
        call('mktg-ads', { action: 'agent_calls_summary' }), // kept for cost view; recent perf below uses creatives
        call('mktg-ads', { action: 'proposals_list', status: 'pending' }),
        call('mktg-ads', { action: 'audit_memos_list' }),
        call('mktg-ads', { action: 'agent_calls_summary' }),
        call('mktg-ads', { action: 'job_runs_list' }),
      ]);
      // Pull recent performed creatives via list_drafts on the legacy table?
      // The new spec lives in mktg_creatives; we expose via creative_get only.
      // Add a thin proxy to mktg-data for the dashboard list. For now use the
      // agent_calls_summary as a stand-in; a follow-up can add a dedicated
      // creatives_recent_performed action when there's data to show.
      setPerf(pf);
      setProposals(prop.proposals || []);
      setMemos(m.memos || []);
      setCalls(ag.calls || []);
      setRuns(jr.runs || []);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!proposals) return <div className="app"><div className="loading">Loading…</div></div>;

  const statChecks = proposals.filter((p) => p.type === 'stat_check');
  const patternProposals = proposals.filter((p) => ['pattern','anti_pattern','pattern_deprecate','pain_point','pain_point_deprecate','retention_drop_signature'].includes(p.type));
  const auditActions = proposals.filter((p) => ['taste_audit_action','self_audit_action'].includes(p.type));
  const lastSelfAudit = (memos || []).find((m) => m.kind === 'self_audit');
  const lastTaste = (memos || []).find((m) => m.kind === 'taste_vs_performance');

  // Cost / token aggregation by stage
  const totals = aggregateCalls(calls || []);

  return (
    <div className="app">
      <Header title="System health" crumb="Marketing · creative agent" back />
      <MarketingNav />

      <Section title="Pending proposals" badge={patternProposals.length}>
        {patternProposals.length === 0 ? <Empty>No pending pattern / pain-point proposals.</Empty> : (
          <div className="row-list">
            {patternProposals.map((p) => <ProposalRow key={p.proposal_id} p={p} onChange={load} />)}
          </div>
        )}
      </Section>

      <Section title="Stats due for re-verification" badge={statChecks.length}>
        {statChecks.length === 0 ? <Empty>No stats currently due.</Empty> : (
          <div className="row-list">
            {statChecks.map((p) => <ProposalRow key={p.proposal_id} p={p} onChange={load} />)}
          </div>
        )}
      </Section>

      <Section title="Audit actions" badge={auditActions.length}>
        {auditActions.length === 0 ? <Empty>No audit actions pending.</Empty> : (
          <div className="row-list">
            {auditActions.map((p) => <ProposalRow key={p.proposal_id} p={p} onChange={load} />)}
          </div>
        )}
      </Section>

      <Section title="Taste vs performance">
        {lastTaste ? (
          <div className="card" style={{ padding: 12 }}>
            <div className="meta" style={{ marginBottom: 6 }}>
              <span>{fmtRelative(lastTaste.created_at)}</span>
              {lastTaste.signals?.divergence && <span className="pill warn">DIVERGING</span>}
              {lastTaste.signals?.low_confidence && <span className="pill">low N</span>}
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0 }}>{lastTaste.content_md}</pre>
          </div>
        ) : <Empty>No audit yet -- runs after 25 new performed records.</Empty>}
      </Section>

      <Section title="Last self-audit memo">
        {lastSelfAudit ? (
          <div className="card" style={{ padding: 12 }}>
            <div className="meta" style={{ marginBottom: 6 }}>
              <span>{fmtRelative(lastSelfAudit.created_at)}</span>
              <span>kill rate {pct(lastSelfAudit.signals?.critic_kill_rate)}</span>
              <span>fail rate {pct(lastSelfAudit.signals?.validation_failure_rate)}</span>
              <span>${(lastSelfAudit.signals?.total_cost_usd ?? 0).toFixed(2)}</span>
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0 }}>{lastSelfAudit.content_md}</pre>
          </div>
        ) : <Empty>No self-audit memo yet -- runs monthly.</Empty>}
      </Section>

      <Section title="Token & cost (last 30d, by stage)">
        <CostTable totals={totals} />
      </Section>

      <Section title="Recent job runs">
        {runs.length === 0 ? <Empty>No scheduled job runs yet.</Empty> : (
          <div className="row-list">
            {runs.slice(0, 12).map((r) => (
              <div key={r.run_id} className="row-item" style={{ padding: 8 }}>
                <div className="name" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{r.job}</span>
                  <span className={r.outcome === 'error' ? 'pill warn' : 'pill'}>{r.outcome}</span>
                </div>
                <div className="meta">
                  <span>{fmtRelative(r.ran_at)}</span>
                  {r.duration_ms != null && <span>{r.duration_ms}ms</span>}
                  {r.proposals_n > 0 && <span>{r.proposals_n} proposals</span>}
                  {r.reason && <span style={{ color: 'var(--text-muted)' }}>{r.reason}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ─── Pieces ────────────────────────────────────────────────────────────────
function Section({ title, badge, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{title}</span>
        {badge != null && <span className="pill" style={{ fontSize: 11 }}>{badge}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <div className="empty" style={{ fontSize: 12 }}>{children}</div>;
}

function ProposalRow({ p, onChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function approve() {
    setBusy(true); setErr('');
    try { await call('mktg-ads', { action: 'proposal_approve', proposal_id: p.proposal_id }); onChange(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function reject() {
    if (!confirm('Reject this proposal?')) return;
    setBusy(true); setErr('');
    try { await call('mktg-ads', { action: 'proposal_reject', proposal_id: p.proposal_id }); onChange(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const payload = p.payload || {};
  const title = payload.name || payload.kind || payload.proof_id || `${p.type} proposal`;
  return (
    <div className="row-item" style={{ padding: 10 }}>
      <div className="name" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{title}</span>
        <span className="pill" style={{ fontSize: 11 }}>{p.type}</span>
      </div>
      {payload.description && <div style={{ fontSize: 12, marginTop: 4 }}>{payload.description}</div>}
      {payload.content && <div style={{ fontSize: 12, marginTop: 4 }}>"{payload.content}"</div>}
      {p.rationale && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{p.rationale}</div>}
      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: 'pointer', fontSize: 11 }}>Payload</summary>
        <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap', marginTop: 4 }}>{JSON.stringify(payload, null, 2)}</pre>
      </details>
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={approve} disabled={busy} className="primary" style={{ fontSize: 12, padding: '4px 10px' }}>
          {busy ? '…' : 'Approve'}
        </button>
        <button onClick={reject} disabled={busy} className="danger" style={{ fontSize: 12, padding: '4px 10px' }}>
          Reject
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {p.job} · {fmtRelative(p.created_at)}
        </span>
      </div>
      {err && <div className="error" style={{ fontSize: 11 }}>{err}</div>}
    </div>
  );
}

function CostTable({ totals }) {
  const stages = Object.keys(totals.by_stage).sort();
  if (stages.length === 0) return <Empty>No agent calls in the last 30 days.</Empty>;
  return (
    <div className="card" style={{ padding: 0 }}>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: 8 }}>Stage</th>
            <th style={{ textAlign: 'right', padding: 8 }}>Calls</th>
            <th style={{ textAlign: 'right', padding: 8 }}>Tokens in</th>
            <th style={{ textAlign: 'right', padding: 8 }}>Tokens out</th>
            <th style={{ textAlign: 'right', padding: 8 }}>$</th>
            <th style={{ textAlign: 'right', padding: 8 }}>Fails</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s) => {
            const t = totals.by_stage[s];
            return (
              <tr key={s} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: 8 }}>{s}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>{t.n}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>{t.in_tokens}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>{t.out_tokens}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>${t.cost_usd.toFixed(4)}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>{t.failures || ''}</td>
              </tr>
            );
          })}
          <tr style={{ fontWeight: 600 }}>
            <td style={{ padding: 8 }}>Total</td>
            <td style={{ padding: 8, textAlign: 'right' }}>{totals.total.n}</td>
            <td style={{ padding: 8, textAlign: 'right' }}>{totals.total.in_tokens}</td>
            <td style={{ padding: 8, textAlign: 'right' }}>{totals.total.out_tokens}</td>
            <td style={{ padding: 8, textAlign: 'right' }}>${totals.total.cost_usd.toFixed(4)}</td>
            <td style={{ padding: 8, textAlign: 'right' }}>{totals.total.failures || ''}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function aggregateCalls(calls) {
  const by_stage = {};
  const total = { n: 0, in_tokens: 0, out_tokens: 0, cost_usd: 0, failures: 0 };
  for (const c of calls) {
    const s = c.stage || 'unknown';
    if (!by_stage[s]) by_stage[s] = { n: 0, in_tokens: 0, out_tokens: 0, cost_usd: 0, failures: 0 };
    const t = by_stage[s];
    t.n++; total.n++;
    t.in_tokens  += c.input_tokens  || 0; total.in_tokens  += c.input_tokens  || 0;
    t.out_tokens += c.output_tokens || 0; total.out_tokens += c.output_tokens || 0;
    t.cost_usd   += Number(c.cost_usd || 0); total.cost_usd += Number(c.cost_usd || 0);
    if (c.validation_status === 'failed') { t.failures++; total.failures++; }
  }
  return { by_stage, total };
}

function pct(x) {
  if (x == null || isNaN(x)) return '—';
  return (x * 100).toFixed(0) + '%';
}
