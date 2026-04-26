import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../components/Header.jsx';
import { call } from '../lib/api.js';
import { fmtShortDate } from '../lib/format.js';

const STATUSES = ['pending','in_progress','done','blocked','cancelled'];

export default function Business() {
  const nav = useNavigate();
  const [tasks, setTasks] = useState(null);
  const [projects, setProjects] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [addingWebsite, setAddingWebsite] = useState(false);
  const [err, setErr] = useState('');
  const [marketingBusy, setMarketingBusy] = useState(false);

  // Floating "Marketing mode" — spawns a fresh marketing chat and
  // auto-greets with the ad-creation kickoff. Lands you in the chat.
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

  // Floating "Website mode" — spawns a fresh diary chat in capture-only mode.
  // Every message Curtis types becomes a website_tasks row; the AI just confirms.
  // Lands you in /ckf/chat/:id?mode=website_capture so the chat passes the
  // hint to auto_open + maintains it across follow-up sends.
  const [websiteBusy, setWebsiteBusy] = useState(false);
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

  const [websiteTasks, setWebsiteTasks] = useState(null);
  async function load() {
    const [t, p, w] = await Promise.all([
      call('ckf-business', { action: 'list' }),
      call('ckf-business', { action: 'list_projects' }),
      call('ckf-business', { action: 'list_website' }).catch(() => ({ website_tasks: [] })),
    ]);
    setTasks(t.tasks);
    setProjects(p.projects);
    setWebsiteTasks(w.website_tasks || []);
  }
  useEffect(() => { load().catch((e) => setErr(e.message)); }, []);

  async function setStatus(id, status) {
    await call('ckf-business', { action: 'update', id, status });
    load();
  }
  async function del(id) {
    if (!confirm('Delete?')) return;
    await call('ckf-business', { action: 'delete', id });
    load();
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!tasks || !projects || !websiteTasks) return <div className="app"><div className="loading">Loading…</div></div>;

  // Standalone tasks only on the Business page — project tasks live on the
  // project detail page so the home view doesn't double-list them.
  const standalone = tasks.filter((t) => !t.project_id);
  const open = standalone.filter((t) => !['done', 'cancelled'].includes(t.status));
  const closed = standalone.filter((t) => ['done', 'cancelled'].includes(t.status));
  const activeProjects = projects.filter((p) => p.status === 'active');
  const archivedProjects = projects.filter((p) => p.status !== 'active');
  const queuedWebsite = websiteTasks.filter((w) => w.status === 'queued' || w.status === 'in_progress');
  const doneWebsite   = websiteTasks.filter((w) => w.status === 'done' || w.status === 'wont_do');

  async function setWebsiteStatus(id, status) {
    await call('ckf-business', { action: 'update_website', id, status });
    load();
  }
  async function delWebsite(id) {
    if (!confirm('Delete this website task?')) return;
    await call('ckf-business', { action: 'delete_website', id });
    load();
  }

  return (
    <div className="app">
      <Header title="Business" right={<button onClick={() => setAdding(true)}>+ Task</button>} />

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
        <NewProjectForm onSaved={() => { setAddingProject(false); load(); }} onCancel={() => setAddingProject(false)} />
      )}
      {activeProjects.length === 0 && !addingProject && (
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
        <span>Tasks</span>
      </div>
      {adding && <NewForm onSaved={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}
      {open.length === 0 ? <div className="empty">Nothing open.</div> : open.map((t) => (
        <div key={t.id} className="card" style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{t.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                {t.objective ? `${t.objective} · ` : ''}
                {t.assigned_to ? `${t.assigned_to} · ` : ''}
                {t.due_date ? `due ${fmtShortDate(t.due_date)} · ` : ''}
                P{t.priority}
              </div>
              {t.description && <div style={{ fontSize: 13, marginTop: 4 }}>{t.description}</div>}
            </div>
            <select value={t.status} onChange={(e) => setStatus(t.id, e.target.value)} style={{ width: 120 }}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ textAlign: 'right', marginTop: 6 }}>
            <button onClick={() => del(t.id)} className="danger" style={{ padding: '4px 10px', fontSize: 12 }}>Delete</button>
          </div>
        </div>
      ))}
      {closed.length > 0 && (
        <>
          <div className="section-title">Done / Cancelled</div>
          {closed.map((t) => (
            <div key={t.id} className="card" style={{ marginBottom: 6, opacity: .6 }}>
              <span className="pill">{t.status}</span> {t.title}
            </div>
          ))}
        </>
      )}

      <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
        <span>Website improvements <span className="dim" style={{ fontSize: 10 }}>· Claude Code queue</span></span>
        <button onClick={() => setAddingWebsite(true)} style={{ fontSize: 11, padding: '4px 10px' }}>+ Improvement</button>
      </div>
      {addingWebsite && (
        <NewWebsiteForm onSaved={() => { setAddingWebsite(false); load(); }} onCancel={() => setAddingWebsite(false)} />
      )}
      {queuedWebsite.length === 0 && !addingWebsite && (
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
            {project.target_date ? ` · target ${project.target_date}` : ''}
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

function NewForm({ onSaved, onCancel }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [objective, setObjective] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [priority, setPriority] = useState(3);
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await call('ckf-business', {
        action: 'create',
        title, description, objective,
        assigned_to: assignedTo || null,
        priority: Number(priority),
        due_date: due || null,
      });
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 14 }}>
      <div className="field"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
      <div className="field"><label>Objective</label><input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What outcome?" /></div>
      <div className="field"><label>Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="row">
        <div className="field"><label>Assigned to</label><input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="me / Linda / …" /></div>
        <div className="field"><label>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>{[1,2,3,4,5].map((p) => <option key={p} value={p}>{p}</option>)}</select>
        </div>
        <div className="field"><label>Due</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
