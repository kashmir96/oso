import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GoalCard from '../components/GoalCard.jsx';
import TodayStrip from '../components/TodayStrip.jsx';
import { call, callCached } from '../lib/api.js';
import { fmtShortDate } from '../lib/format.js';
import Chat from './Chat.jsx';

const BUSINESS_CATEGORIES = new Set(['business', 'marketing', 'finance']);

// Business: business goals + jobs strip + business chat (from main),
// then a hub section below: Marketing playbook entry + Projects +
// Website improvements queue + two floating mode FABs.
export default function Business() {
  const nav = useNavigate();
  const [goals, setGoals] = useState(null);
  const [openTaskCount, setOpenTaskCount] = useState(0);
  const [projects, setProjects] = useState(null);
  const [websiteTasks, setWebsiteTasks] = useState(null);
  const [addingProject, setAddingProject] = useState(false);
  const [addingWebsite, setAddingWebsite] = useState(false);
  const [marketingBusy, setMarketingBusy] = useState(false);
  const [websiteBusy, setWebsiteBusy] = useState(false);
  const [err, setErr] = useState('');

  function refresh() {
    Promise.all([
      callCached('ckf-goals', { action: 'list' }),
      callCached('ckf-business', { action: 'list' }).catch(() => ({ tasks: [] })),
      call('ckf-business', { action: 'list_projects' }).catch(() => ({ projects: [] })),
      call('ckf-business', { action: 'list_website' }).catch(() => ({ website_tasks: [] })),
    ])
      .then(([g, b, p, w]) => {
        const filtered = g.goals.filter((x) =>
          x.status === 'active' && BUSINESS_CATEGORIES.has(x.category)
        );
        setGoals(filtered);
        setOpenTaskCount((b.tasks || []).filter((t) => !['done', 'cancelled'].includes(t.status)).length);
        setProjects(p.projects || []);
        setWebsiteTasks(w.website_tasks || []);
      })
      .catch((e) => setErr(e.message));
  }

  useEffect(() => { refresh(); }, []);

  // Marketing mode FAB — fresh marketing chat with ad-creation kickoff.
  async function startMarketingMode() {
    setMarketingBusy(true); setErr('');
    try {
      const conv = await call('mktg-chat', { action: 'create_conversation', kind: 'context' });
      const cid = conv.conversation.id;
      call('mktg-chat', { action: 'auto_open', conversation_id: cid, mode_hint: 'create_ad' })
        .catch(() => {});
      nav(`/business/marketing/chat/${cid}`);
    } catch (e) {
      setErr(e.message);
      setMarketingBusy(false);
    }
  }

  // Website mode FAB — fresh diary chat in capture-only mode.
  // ?mode=website_capture flag is read by Chat.jsx and threaded through to
  // ckf-chat so every message becomes a queued website task.
  async function startWebsiteMode() {
    setWebsiteBusy(true); setErr('');
    try {
      const conv = await call('ckf-chat', { action: 'create_conversation', mode: 'business' });
      const cid = conv.conversation.id;
      nav(`/chat/${cid}?mode=website_capture`);
    } catch (e) {
      setErr(e.message);
      setWebsiteBusy(false);
    }
  }

  async function setWebsiteStatus(id, status) {
    await call('ckf-business', { action: 'update_website', id, status });
    refresh();
  }
  async function delWebsite(id) {
    if (!confirm('Delete this website task?')) return;
    await call('ckf-business', { action: 'delete_website', id });
    refresh();
  }

  const activeProjects = (projects || []).filter((p) => p.status === 'active');
  const archivedProjects = (projects || []).filter((p) => p.status !== 'active');
  const queuedWebsite = (websiteTasks || []).filter((w) => w.status === 'queued' || w.status === 'in_progress');
  const doneWebsite   = (websiteTasks || []).filter((w) => w.status === 'done' || w.status === 'wont_do');

  return (
    <div className="home">
      <div className="home-goals">
        <div className="home-goals-head">
          <div className="home-title">Business goals</div>
          <Link to="/business/tasks" className="home-manage">
            Tasks{openTaskCount ? ` (${openTaskCount})` : ''}
          </Link>
        </div>
        {err && <div className="error">{err}</div>}
        {!goals ? (
          <div className="loading" style={{ padding: '8px 0' }}>Loading…</div>
        ) : goals.length === 0 ? (
          <div className="empty" style={{ padding: '6px 12px', textAlign: 'left' }}>
            No business goals yet. Tell the chat what business metric you want to track —
            revenue, weekly content output, CPA, conversion rate.
          </div>
        ) : (
          <div className="goal-grid home-goal-grid">
            {goals.map((g) => <GoalCard key={g.id} goal={g} onChanged={refresh} />)}
          </div>
        )}
      </div>

      <TodayStrip
        title="Jobs"
        scope="business"
        defaultCategory="business"
        moreHref="/business/tasks"
      />

      <div className="home-chat">
        <Chat embedded scope="business" />
      </div>

      {/* ─────── Marketing + projects + website queue (added on this branch) ─────── */}
      <div className="app" style={{ paddingTop: 8, paddingBottom: 16 }}>
        <Link to="/business/marketing" className="card" style={{ marginBottom: 14, display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600 }}>Marketing playbook →</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                Campaigns, concepts, ads, scripts and the reference library.
              </div>
            </div>
            <span className="pill">PrimalPantry</span>
          </div>
        </Link>

        <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Projects</span>
          <button onClick={() => setAddingProject(true)} style={{ fontSize: 11, padding: '4px 10px' }}>+ Project</button>
        </div>
        {addingProject && (
          <NewProjectForm onSaved={() => { setAddingProject(false); refresh(); }} onCancel={() => setAddingProject(false)} />
        )}
        {projects && activeProjects.length === 0 && !addingProject && (
          <div className="empty" style={{ padding: '14px 0' }}>No active projects.</div>
        )}
        {activeProjects.map((p) => <ProjectCard key={p.id} project={p} />)}
        {archivedProjects.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary className="dim" style={{ fontSize: 12, cursor: 'pointer' }}>
              {archivedProjects.length} archived project{archivedProjects.length === 1 ? '' : 's'}
            </summary>
            <div style={{ marginTop: 6 }}>
              {archivedProjects.map((p) => <ProjectCard key={p.id} project={p} />)}
            </div>
          </details>
        )}

        <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
          <span>Website improvements <span className="dim" style={{ fontSize: 10 }}>· Claude Code queue</span></span>
          <button onClick={() => setAddingWebsite(true)} style={{ fontSize: 11, padding: '4px 10px' }}>+ Improvement</button>
        </div>
        {addingWebsite && (
          <NewWebsiteForm onSaved={() => { setAddingWebsite(false); refresh(); }} onCancel={() => setAddingWebsite(false)} />
        )}
        {websiteTasks && queuedWebsite.length === 0 && !addingWebsite && (
          <div className="empty" style={{ padding: '10px 0', fontSize: 12 }}>
            Nothing queued. Tell the diary chat "website: fix X" and it'll land here.
          </div>
        )}
        {queuedWebsite.map((w) => (
          <WebsiteRow key={w.id} task={w} onSetStatus={setWebsiteStatus} onDelete={delWebsite} />
        ))}
        {doneWebsite.length > 0 && (
          <details style={{ marginTop: 6 }}>
            <summary className="dim" style={{ fontSize: 11, cursor: 'pointer' }}>
              {doneWebsite.length} done / wont-do
            </summary>
            <div style={{ marginTop: 4 }}>
              {doneWebsite.map((w) => (
                <WebsiteRow key={w.id} task={w} onSetStatus={setWebsiteStatus} onDelete={delWebsite} compact />
              ))}
            </div>
          </details>
        )}
      </div>

      <button
        onClick={startWebsiteMode}
        disabled={websiteBusy}
        className="fab fab-website"
        title="Capture a backlog of website improvements for Claude Code"
        aria-label="Website mode"
      >
        {websiteBusy ? '…' : '📦 Website mode'}
      </button>
      <button
        onClick={startMarketingMode}
        disabled={marketingBusy}
        className="primary fab fab-pulse"
        title="Start an ad in marketing mode"
        aria-label="Marketing mode"
      >
        {marketingBusy ? '…' : '✨ Marketing mode'}
      </button>
    </div>
  );
}

// ── Project card / form (Projects section) ──
function ProjectCard({ project }) {
  const total = project.task_count || 0;
  const done  = project.done_count || 0;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <Link
      to={`/business/projects/${project.id}`}
      className="card"
      style={{ display: 'block', marginBottom: 6, textDecoration: 'none', color: 'inherit' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
            {total === 0 ? 'no tasks' : `${done}/${total} done`}
            {project.target_date ? ` · target ${fmtShortDate(project.target_date)}` : ''}
            {project.status !== 'active' ? ` · ${project.status}` : ''}
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', minWidth: 36, textAlign: 'right' }}>{pct}%</div>
      </div>
      <div className="bar" style={{ marginTop: 6 }}>
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </Link>
  );
}

function NewProjectForm({ onSaved, onCancel }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await call('ckf-business', {
        action: 'create_project',
        title,
        description,
        target_date: targetDate || null,
      });
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 10 }}>
      <div className="field"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus /></div>
      <div className="field"><label>Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
      <div className="field"><label>Target date</label><input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></div>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Create project'}</button>
      </div>
    </form>
  );
}

// ── Website improvements row / form ──
function WebsiteRow({ task, onSetStatus, onDelete, compact }) {
  const next = task.status === 'queued'
    ? 'in_progress'
    : task.status === 'in_progress' ? 'done' : null;
  const nextLabel = task.status === 'queued'
    ? 'Start'
    : task.status === 'in_progress' ? 'Done' : null;
  return (
    <div className="card" style={{ marginBottom: 6, padding: '8px 10px', opacity: compact ? 0.6 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            <span className={
              task.status === 'done' ? 'pill good' :
              task.status === 'in_progress' ? 'pill warn' :
              task.status === 'wont_do' ? 'pill bad' : 'pill'
            } style={{ marginRight: 6 }}>{task.status.replace('_',' ')}</span>
            {task.title}
          </div>
          {task.description && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{task.description}</div>}
          {task.pr_url && (
            <div style={{ fontSize: 11, marginTop: 2 }}>
              <a href={task.pr_url} target="_blank" rel="noopener noreferrer">PR ↗</a>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {next && (
            <button onClick={() => onSetStatus(task.id, next)} style={{ fontSize: 11, padding: '4px 8px' }}>
              {nextLabel}
            </button>
          )}
          <button onClick={() => onDelete(task.id)} className="danger" style={{ fontSize: 11, padding: '4px 8px' }}>×</button>
        </div>
      </div>
    </div>
  );
}

function NewWebsiteForm({ onSaved, onCancel }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(3);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await call('ckf-business', {
        action: 'create_website',
        title,
        description: description || null,
        priority: Number(priority),
      });
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 8, padding: 10 }}>
      <div className="field"><label>What needs to happen?</label><input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus placeholder="e.g. fix dashboard layout on iPhone" /></div>
      <div className="field"><label>Why / context</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
      <div className="row">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>{[1,2,3,4,5].map((p) => <option key={p} value={p}>{p}</option>)}</select>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Queuing…' : 'Queue'}</button>
      </div>
    </form>
  );
}
