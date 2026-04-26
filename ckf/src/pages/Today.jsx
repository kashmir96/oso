import { useEffect, useState } from 'react';
import Header from '../components/Header.jsx';
import { call, callCached, notifyChanged } from '../lib/api.js';
import { nzToday, fmtShortDate } from '../lib/format.js';

const CATEGORIES = ['personal','health','business','social','finance','marketing','other'];

// Routine page: today's checklist on top, then upcoming (later this week,
// business tasks with due_dates, planned items from the latest diary).
//
// Calendar events from connected providers (Google Calendar etc.) will be
// merged into both sections once the OAuth + sync function lands. The
// rendering already uses a normalised `Item` shape so plugging them in
// later is one map() call.
export default function Today() {
  const [today, setToday] = useState(null);
  const [todayBlendItems, setTodayBlendItems] = useState([]);
  const [later, setLater] = useState(null);
  const [calStatus, setCalStatus] = useState('unknown'); // 'unknown' | 'ok' | 'not_connected' | 'error'
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState('');
  const date = nzToday();

  async function load() {
    try {
      // Calendar fetch tracks its own status separately so we can show whether
      // it's "not connected" vs "errored" vs "no events" — the previous silent
      // fallback hid the difference.
      let calRange = { events: [], from: null, to: null };
      try {
        const tomorrow = new Date(date + 'T00:00:00Z');
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const from = new Date().toISOString();
        const to = new Date(tomorrow.getTime() + 7 * 86400e3).toISOString();
        calRange = await callCached('ckf-calendar', { action: 'list_range', from, to }, 60_000);
        setCalStatus('ok');
      } catch (e) {
        if (/not connected/i.test(e.message)) setCalStatus('not_connected');
        else setCalStatus('error');
      }

      const [todayRoutine, business, lastDiary, errands] = await Promise.all([
        callCached('ckf-tasks', { action: 'today', date }),
        callCached('ckf-business', { action: 'list' }),
        callCached('ckf-diary', { action: 'recent', limit: 1 }),
        callCached('ckf-errands', { action: 'list', status: 'open' }),
      ]);
      setToday(todayRoutine.tasks);

      const todayCalendar = [];
      const futureCalendar = [];
      for (const e of (calRange?.events || [])) {
        const day = (e.start || '').slice(0, 10);
        if (day === date) todayCalendar.push(e);
        else futureCalendar.push(e);
      }

      const businessTasks = (business.tasks || [])
        .filter((t) => !['done','cancelled'].includes(t.status));

      // Errands split — both personal + business categories merge in. Errands
      // with a remind_at or due_date today land in Today; rest in Later.
      const errandsList = (errands.errands || []).filter((e) => e.status === 'open');
      function errandWhen(e) {
        if (e.remind_at) return e.remind_at;
        if (e.due_date) return `${e.due_date}T23:59:00`;
        return null;
      }
      function errandDay(e) {
        if (e.remind_at) return e.remind_at.slice(0, 10);
        if (e.due_date) return e.due_date;
        return null;
      }
      const errandsToday = errandsList
        .filter((e) => errandDay(e) === date)
        .map((e) => ({
          id: `er-${e.id}`, title: e.title,
          category: e.category, meta: e.category + (e.remind_at ? ' · ⏰' : (e.due_date ? ' · due today' : '')),
          source: 'errand', when: errandWhen(e),
        }));
      const errandsLater = errandsList
        .filter((e) => {
          const d = errandDay(e);
          return d == null || d > date;
        })
        .map((e) => ({
          id: `er-${e.id}`, title: e.title,
          category: e.category,
          meta: e.due_date ? `${e.category} · due ${fmtShortDate(e.due_date)}` : (e.remind_at ? `${e.category} · ⏰` : e.category),
          source: 'errand', when: errandWhen(e),
        }));

      const businessToday = businessTasks
        .filter((t) => t.due_date === date)
        .map((t) => ({
          id: `b-${t.id}`, title: t.title, category: 'business',
          meta: `${t.assigned_to ? `${t.assigned_to} · ` : ''}P${t.priority || 3}`,
          source: 'business', when: `${t.due_date}T23:59:00`,
        }));
      const calToday = todayCalendar.map((e) => ({
        id: `cal-${e.id}`, title: e.summary, category: 'calendar',
        meta: e.all_day ? 'all day' : new Date(e.start).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit' }),
        source: 'calendar', when: e.start, all_day: e.all_day,
      }));
      const todayBlend = [...calToday, ...businessToday, ...errandsToday]
        .sort((a, b) => (a.when || 'z').localeCompare(b.when || 'z'));

      const businessLater = businessTasks
        .filter((t) => t.due_date && t.due_date > date)
        .map((t) => ({
          id: `b-${t.id}`, title: t.title, category: 'business',
          meta: `due ${fmtShortDate(t.due_date)}${t.assigned_to ? ` · ${t.assigned_to}` : ''}`,
          source: 'business', when: `${t.due_date}T23:59:00`,
        }));
      const calLater = futureCalendar.map((e) => ({
        id: `cal-${e.id}`, title: e.summary, category: 'calendar',
        meta: e.all_day
          ? `${fmtShortDate((e.start || '').slice(0, 10))} · all day`
          : new Date(e.start).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }),
        source: 'calendar', when: e.start, all_day: e.all_day,
      }));

      const recent = (lastDiary.entries || [])[0];
      const plannedTomorrow = recent
        ? [
            ...((recent.tomorrow_personal_tasks || []).map((t, i) => ({
              id: `dpers-${recent.id}-${i}`, title: t.task || t.title || '',
              category: 'personal', meta: 'planned for tomorrow', source: 'diary', when: null,
            }))),
            ...((recent.tomorrow_business_tasks || []).map((t, i) => ({
              id: `dbiz-${recent.id}-${i}`, title: t.task || t.title || '',
              category: 'business', meta: 'planned for tomorrow', source: 'diary', when: null,
            }))),
          ].filter((x) => x.title)
        : [];

      const merged = [...calLater, ...businessLater, ...errandsLater, ...plannedTomorrow]
        .sort((a, b) => (a.when || 'z').localeCompare(b.when || 'z'));

      setLater(merged);
      setTodayBlendItems(todayBlend);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener('ckf-data-changed', handler);
    return () => window.removeEventListener('ckf-data-changed', handler);
    /* eslint-disable-next-line */
  }, [date]);

  async function setStatus(routineTaskId, status) {
    try {
      await call('ckf-tasks', { action: 'set_status', routine_task_id: routineTaskId, date, status });
      notifyChanged();
      load();
    } catch (e) { setErr(e.message); }
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!today) return <div className="app"><div className="loading">Loading…</div></div>;

  return (
    <div className="app">
      <Header title="Routine" right={<button onClick={() => setAdding(true)}>+ Add</button>} />
      {calStatus === 'not_connected' && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '6px 10px', background: 'var(--bg-elev)', border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: 10 }}>
          Calendar not connected — events won't show here. Connect it in <a href="/ckf/settings">Settings → Connections</a>.
        </div>
      )}
      {calStatus === 'error' && (
        <div className="error">Calendar fetch failed. Try reconnecting from Settings.</div>
      )}
      {adding && <TaskForm onSaved={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}
      {editing && <TaskForm task={editing} onSaved={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />}

      <div className="section-title">Today · {fmtShortDate(date)}</div>
      {today.length === 0 ? (
        <div className="empty">No routine tasks today. Tell the chat what you want, or tap "+ Add".</div>
      ) : (
        <div className="card">
          {today.map((t) => {
            const status = t.log?.status || 'not_started';
            return (
              <div key={t.id} className={`today-task ${status === 'done' ? 'done' : ''}`}>
                <div
                  className={`checkbox ${status === 'done' ? 'done' : status === 'skipped' ? 'skipped' : ''}`}
                  onClick={() => setStatus(t.id, status === 'done' ? 'not_started' : 'done')}
                  role="button" tabIndex={0}
                >
                  {status === 'done' ? '✓' : status === 'skipped' ? '–' : ''}
                </div>
                <div className="body">
                  <div className="title" onClick={() => setEditing(t)} style={{ cursor: 'pointer' }}>
                    {t.title}
                  </div>
                  <div className="meta">
                    {t.category}{t.estimated_minutes ? ` · ${t.estimated_minutes}m` : ''}{t.assigned_to ? ` · ${t.assigned_to}` : ''}
                  </div>
                </div>
                {status !== 'skipped' && status !== 'done' && (
                  <button className="skip" onClick={() => setStatus(t.id, 'skipped')}>skip</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {todayBlendItems.length > 0 && (
        <div className="card" style={{ marginTop: 8 }}>
          {todayBlendItems.map((it) => (
            <div key={it.id} className="today-task">
              <div className="checkbox" style={{ borderStyle: 'dashed' }} aria-hidden="true" />
              <div className="body">
                <div className="title">{it.title}</div>
                <div className="meta">
                  {it.meta}
                  {it.source === 'business' && <span className="pill" style={{ marginLeft: 6 }}>business</span>}
                  {it.source === 'calendar' && <span className="pill" style={{ marginLeft: 6 }}>calendar</span>}
                  {it.source === 'errand' && <span className="pill" style={{ marginLeft: 6 }}>errand</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-title">Later</div>
      {!later || later.length === 0 ? (
        <div className="empty">Nothing scheduled later. Calendar sync coming soon.</div>
      ) : (
        <div className="card">
          {later.map((it) => (
            <div key={it.id} className="today-task">
              <div className="checkbox" style={{ borderStyle: 'dashed' }} aria-hidden="true" />
              <div className="body">
                <div className="title">{it.title}</div>
                <div className="meta">
                  {it.category}{it.meta ? ` · ${it.meta}` : ''}
                  {it.source === 'business' && <span className="pill" style={{ marginLeft: 6 }}>business</span>}
                  {it.source === 'diary' && <span className="pill" style={{ marginLeft: 6 }}>diary</span>}
                  {it.source === 'calendar' && <span className="pill" style={{ marginLeft: 6 }}>calendar</span>}
                  {it.source === 'errand' && <span className="pill" style={{ marginLeft: 6 }}>errand</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskForm({ task, onSaved, onCancel }) {
  const [title, setTitle] = useState(task?.title || '');
  const [category, setCategory] = useState(task?.category || 'personal');
  const [recurrence, setRecurrence] = useState(task?.recurrence_rule || 'daily');
  const [priority, setPriority] = useState(task?.priority ?? 3);
  const [estimated, setEstimated] = useState(task?.estimated_minutes ?? '');
  const [assignedTo, setAssignedTo] = useState(task?.assigned_to || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isEdit = !!task;

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const action = isEdit ? 'update' : 'create';
      await call('ckf-tasks', {
        action, ...(isEdit ? { id: task.id } : {}),
        title, category, recurrence_rule: recurrence,
        priority: Number(priority),
        estimated_minutes: estimated === '' ? null : Number(estimated),
        assigned_to: assignedTo || null,
      });
      notifyChanged();
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function onDelete() {
    if (!confirm('Delete this task?')) return;
    await call('ckf-tasks', { action: 'delete', id: task.id });
    notifyChanged();
    onSaved();
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 14 }}>
      <div className="field">
        <label>Task</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="row">
        <div className="field">
          <label>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            {[1,2,3,4,5].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Recurrence</label>
        <input value={recurrence} onChange={(e) => setRecurrence(e.target.value)} placeholder="daily, weekly, mon,wed,fri" />
      </div>
      <div className="row">
        <div className="field">
          <label>Estimated min</label>
          <input type="number" value={estimated} onChange={(e) => setEstimated(e.target.value)} />
        </div>
        <div className="field">
          <label>Assigned to</label>
          <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="optional" />
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="row">
        {isEdit && <button type="button" className="danger" onClick={onDelete}>Delete</button>}
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
