import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header.jsx';
import { call } from '../../lib/api.js';
import { nzd, num } from './format.js';
import MarketingNav from './MarketingNav.jsx';

export default function Home() {
  const [campaigns, setCampaigns] = useState(null);
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState('');
  const [seedBusy, setSeedBusy] = useState(false);

  async function loadAll() {
    setErr('');
    try {
      const [s, c] = await Promise.all([
        call('mktg-data', { action: 'summary' }),
        call('mktg-data', { action: 'list_campaigns' }),
      ]);
      setSummary(s);
      setCampaigns(c.campaigns);
    } catch (e) {
      setErr(e.message);
    }
  }
  useEffect(() => { loadAll(); }, []);

  async function runSeed() {
    if (!confirm('Seed the playbook from the bundled JSON? Idempotent — safe to re-run.')) return;
    setSeedBusy(true); setErr('');
    try {
      await call('mktg-seed', { action: 'seed', confirm: 'YES' });
      await loadAll();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSeedBusy(false);
    }
  }

  return (
    <div className="app">
      <Header title="Marketing" crumb="Business · Marketing" back />
      <MarketingNav />

      {err && <div className="error">{err}</div>}
      {!summary && !err && <div className="loading">Loading…</div>}

      {summary && summary.db_empty && (
        <div className="setup-banner">
          <h3>Database is empty.</h3>
          <p>Run the seed to load 86 ads, 30 concepts, 25 copy archetypes, 26 visual archetypes, 7 production scripts and the rest from the bundled JSON.</p>
          <button className="primary" onClick={runSeed} disabled={seedBusy}>
            {seedBusy ? 'Seeding…' : 'Seed playbook'}
          </button>
        </div>
      )}

      {summary && (
        <div className="stat-grid">
          <Stat label="Campaigns" value={summary.counts.mktg_campaigns} />
          <Stat label="Concepts"  value={summary.counts.mktg_concepts} />
          <Stat label="Ads"       value={summary.counts.mktg_ads} />
          <Stat label="Scripts"   value={summary.counts.mktg_production_scripts} />
        </div>
      )}

      <div className="section-title"><span>Make</span></div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Link to="/business/marketing/wizard" className="campaign-card" style={{ flex: '1 1 220px' }}>
          <div className="name">+ New ad draft</div>
          <div className="role">Wizard: objective → campaign → format → concept → creative → copy → final</div>
        </Link>
        <Link to="/business/marketing/chat" className="campaign-card" style={{ flex: '1 1 220px' }}>
          <div className="name">Open chat</div>
          <div className="role">Paste copy, screenshots, links — feed context for future ads</div>
        </Link>
      </div>

      {campaigns && (
        <>
          <div className="section-title"><span>Campaigns</span></div>
          {campaigns.length === 0 && <div className="empty">No campaigns yet.</div>}
          {campaigns.map((c) => (
            <Link key={c.id} to={`/business/marketing/campaigns/${c.id}`} className="campaign-card" style={{ marginBottom: 10 }}>
              <div className="name">{c.name}</div>
              {c.role_in_funnel && <div className="role">{c.role_in_funnel}</div>}
              <div className="stats">
                <span><strong>{num(c.product_count)}</strong> products</span>
                <span><strong>{num(c.concept_count)}</strong> concepts {c.workhorse_count > 0 && <span className="muted">({num(c.workhorse_count)} workhorse)</span>}</span>
                <span><strong>{num(c.ad_count)}</strong> ads</span>
                {c.total_spend_nzd > 0 && <span><strong>{nzd(c.total_spend_nzd)}</strong> spent</span>}
                {c.total_results > 0 && <span><strong>{num(c.total_results)}</strong> sales</span>}
              </div>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value ?? '—'}</div>
    </div>
  );
}
