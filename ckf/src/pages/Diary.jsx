import { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Header from '../components/Header.jsx';
import { call } from '../lib/api.js';
import { nzToday, fmtShortDate } from '../lib/format.js';

// One step at a time, smooth transitions, Cmd/Ctrl+Enter to advance.
// Auto-saves to localStorage keyed by the date so a refresh doesn't nuke progress.

const TEXT_STEPS = [
  // Personal lens
  { key: 'personal_good',          prompt: "What was good today?",                    hint: "small or big — what landed well" },
  { key: 'personal_bad',           prompt: "What was bad today?",                     hint: "what frustrated you, what hurt" },
  { key: 'wasted_time',            prompt: "Where did you waste time?",               hint: "be specific — apps, meetings, indecision" },
  { key: 'time_saving_opportunities', prompt: "Where could you have saved time?",     hint: "what would you delegate, automate, or skip" },
  { key: 'eighty_twenty',          prompt: "What was the 20% that drove the most value?", hint: "if everything else fell away, this would still matter" },
  { key: 'simplify_tomorrow',      prompt: "What can you cut, simplify, or streamline tomorrow?" },
  { key: 'social_reflection',      prompt: "How was your social life today?",         hint: "presence, depth, who, what" },
  { key: 'personal_lessons',       prompt: "What did you learn today?" },
  { key: 'physical_reflection',    prompt: "Physical — body, energy, sleep, training", hint: "honest read of your physical state" },
  { key: 'mental_reflection',      prompt: "Mental — focus, mood, mental load",       hint: "what's loud in your head right now" },
  { key: 'spiritual_reflection',   prompt: "Spiritual — purpose, alignment, presence", hint: "are you living in line with what matters" },
  { key: 'growth_opportunities',   prompt: "Where could you grow? What did you avoid?", hint: "the thing you didn't want to write down" },
  // Business lens
  { key: 'business_wins',          prompt: "What did the business win today?" },
  { key: 'business_losses',        prompt: "What did the business lose today?" },
  { key: 'business_activity',      prompt: "What did the business actually do today?" },
  { key: 'business_lessons',       prompt: "What did you learn in the business today?" },
  { key: 'marketing_objectives',   prompt: "What marketing objectives need attention?" },
  { key: 'delegation_notes',       prompt: "Who needs to be assigned what?" },
  { key: 'bottlenecks',            prompt: "What bottlenecks showed up?" },
  { key: 'change_tomorrow',        prompt: "What should change tomorrow?" },
];

function lsKey(date) { return `ckf_diary_draft_${date}`; }

export default function Diary() {
  const { date: rawDate } = useParams();
  const date = rawDate === 'today' ? nzToday() : rawDate;
  const nav = useNavigate();

  const [loaded, setLoaded] = useState(false);
  const [stepIdx, setStepIdx] = useState(-1); // -1 = yesterday review
  const [draft, setDraft] = useState({});
  const [yesterday, setYesterday] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Load persisted entry (may be partial) and yesterday's tasks for review
        const [entryRes, yest] = await Promise.all([
          call('ckf-diary', { action: 'get', date }),
          call('ckf-diary', { action: 'get_yesterday_tasks', today: date }),
        ]);
        if (!alive) return;

        const ls = localStorage.getItem(lsKey(date));
        const localDraft = ls ? JSON.parse(ls) : null;
        const initial = {
          tomorrow_personal_tasks: [],
          tomorrow_business_tasks: [],
          ...(entryRes.entry || {}),
          ...(localDraft || {}),
        };
        setDraft(initial);
        setYesterday(yest.yesterday || null);
        setStepIdx(yest.yesterday ? -1 : 0);
        setAiResult(entryRes.entry?.ai_summary ? {
          summary: entryRes.entry.ai_summary,
          actions: entryRes.entry.ai_actions || {},
        } : null);
        setLoaded(true);
      } catch (e) {
        if (alive) setErr(e.message);
      }
    })();
    return () => { alive = false; };
  }, [date]);

  // Autosave to localStorage (debounced via timeout)
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      localStorage.setItem(lsKey(date), JSON.stringify(draft));
    }, 250);
    return () => clearTimeout(t);
  }, [draft, date, loaded]);

  const totalSteps = TEXT_STEPS.length + 2; // text steps + tomorrow_personal + tomorrow_business
  const TOMORROW_PERSONAL_IDX = TEXT_STEPS.length;
  const TOMORROW_BUSINESS_IDX = TEXT_STEPS.length + 1;

  const setVal = useCallback((k, v) => setDraft((d) => ({ ...d, [k]: v })), []);

  function next() {
    setStepIdx((i) => Math.min(i + 1, totalSteps));
  }
  function prev() {
    setStepIdx((i) => Math.max(i - 1, yesterday ? -1 : 0));
  }

  // Cmd/Ctrl+Enter to advance
  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (stepIdx === totalSteps - 1) submit();
      else next();
    }
  }

  async function markYesterday(list, idx, done) {
    if (!yesterday?.id) return;
    await call('ckf-diary', {
      action: 'mark_yesterday_task',
      entry_id: yesterday.id, list, index: idx, done,
    });
    setYesterday((y) => {
      const arr = [...(y[list] || [])];
      arr[idx] = { ...arr[idx], done };
      return { ...y, [list]: arr };
    });
  }

  async function submit() {
    setSubmitting(true); setErr('');
    try {
      const res = await call('ckf-diary', { action: 'save', date, ...draft });
      setAiResult(res.ai || null);
      localStorage.removeItem(lsKey(date));
      setStepIdx(totalSteps); // review screen
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;
  if (!loaded) return <div className="app"><div className="loading">Loading…</div></div>;

  // ── Final review screen ──
  if (stepIdx >= totalSteps) {
    return <Review date={date} ai={aiResult} onDone={() => nav('/')} />;
  }

  // ── Yesterday review ──
  if (stepIdx === -1 && yesterday) {
    const allTasks = [
      ...((yesterday.tomorrow_personal_tasks || []).map((t, i) => ({ ...t, list: 'tomorrow_personal_tasks', i }))),
      ...((yesterday.tomorrow_business_tasks || []).map((t, i) => ({ ...t, list: 'tomorrow_business_tasks', i }))),
    ];
    return (
      <div className="app">
        <Header title={`Diary · ${fmtShortDate(date)}`} back />
        <Progress total={totalSteps + 1} idx={0} />
        <div className="diary-step">
          <div className="prompt">Yesterday's tasks — what got done?</div>
          <div className="hint">From {fmtShortDate(yesterday.date)}</div>
          {allTasks.length === 0 ? (
            <div className="empty">No tasks were set for yesterday.</div>
          ) : (
            <div className="card">
              {allTasks.map((t, k) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                  <div style={{ flex: 1 }}>
                    <div>{t.task || t.title || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t.list === 'tomorrow_business_tasks' ? 'business' : 'personal'}</div>
                  </div>
                  <button onClick={() => markYesterday(t.list, t.i, true)} className={t.done === true ? 'primary' : ''}>Done</button>
                  <button onClick={() => markYesterday(t.list, t.i, false)} className={t.done === false ? 'primary' : ''}>Missed</button>
                </div>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 14 }}>
            <button onClick={() => setStepIdx(0)} className="primary">Continue</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Tomorrow tasks (two list-editor steps) ──
  if (stepIdx === TOMORROW_PERSONAL_IDX || stepIdx === TOMORROW_BUSINESS_IDX) {
    const isBusiness = stepIdx === TOMORROW_BUSINESS_IDX;
    const key = isBusiness ? 'tomorrow_business_tasks' : 'tomorrow_personal_tasks';
    return (
      <div className="app" onKeyDown={onKeyDown}>
        <Header title={`Diary · ${fmtShortDate(date)}`} back />
        <Progress total={totalSteps + 1} idx={stepIdx + (yesterday ? 2 : 1)} />
        <div className="diary-step">
          <div className="prompt">{isBusiness ? "Tomorrow's business tasks" : "Tomorrow's personal tasks"}</div>
          <div className="hint">The most important things — keep it tight.</div>
          <TaskListEditor list={draft[key] || []} onChange={(v) => setVal(key, v)} />
          <div className="row" style={{ marginTop: 14 }}>
            <button onClick={prev}>Back</button>
            {stepIdx === TOMORROW_BUSINESS_IDX
              ? <button onClick={submit} className="primary" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit diary'}</button>
              : <button onClick={next} className="primary">Next</button>}
          </div>
        </div>
      </div>
    );
  }

  // ── Text steps ──
  const step = TEXT_STEPS[stepIdx];
  return (
    <div className="app" onKeyDown={onKeyDown}>
      <Header title={`Diary · ${fmtShortDate(date)}`} back />
      <Progress total={totalSteps + 1} idx={stepIdx + (yesterday ? 1 : 0) + 1} />
      <div className="diary-step">
        <div className="prompt">{step.prompt}</div>
        {step.hint && <div className="hint">{step.hint}</div>}
        <textarea
          autoFocus
          value={draft[step.key] || ''}
          onChange={(e) => setVal(step.key, e.target.value)}
          placeholder="…"
        />
        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={prev} disabled={stepIdx === 0 && !yesterday}>Back</button>
          <button onClick={next} className="primary">Next</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'right' }}>
          ⌘/Ctrl+Enter to advance
        </div>
      </div>
    </div>
  );
}

function Progress({ total, idx }) {
  return (
    <div className="diary-progress">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={i === idx ? 'active' : i < idx ? 'done' : ''} />
      ))}
    </div>
  );
}

function TaskListEditor({ list, onChange }) {
  const [draft, setDraft] = useState('');
  function add() {
    const t = draft.trim();
    if (!t) return;
    onChange([...(list || []), { task: t, done: null }]);
    setDraft('');
  }
  function remove(i) {
    const next = [...list]; next.splice(i, 1); onChange(next);
  }
  return (
    <div>
      <div className="row">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Add a task and press Enter"
        />
        <button type="button" onClick={add} style={{ flex: '0 0 auto' }}>Add</button>
      </div>
      <div className="card" style={{ marginTop: 8 }}>
        {list.length === 0 ? <div className="empty" style={{ padding: 8 }}>No tasks yet.</div> : list.map((t, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ flex: 1 }}>{t.task}</div>
            <button onClick={() => remove(i)} className="danger" style={{ padding: '4px 10px', fontSize: 12 }}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Review({ date, ai, onDone }) {
  return (
    <div className="app">
      <Header title="Submitted" right={<button onClick={onDone} className="primary">Done</button>} />
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>Diary saved for {fmtShortDate(date)}.</div>
      </div>
      {ai?.summary && (
        <>
          <div className="section-title">Read of the day</div>
          <div className="card" style={{ marginBottom: 12 }}>{ai.summary}</div>
        </>
      )}
      {ai?.actions && (
        <>
          <ActionsBlock title="Tomorrow"   items={ai.actions.tomorrow} />
          <ActionsBlock title="This week"  items={ai.actions.week} />
          <ActionsBlock title="Physical"   items={ai.actions.physical} />
          <ActionsBlock title="Mental"     items={ai.actions.mental} />
          <ActionsBlock title="Spiritual"  items={ai.actions.spiritual} />
          <ActionsBlock title="Business"   items={ai.actions.business} />
          <ActionsBlock title="Personal"   items={ai.actions.personal} />
          <ActionsBlock title="Cut"        items={ai.actions.cut} />
          <ActionsBlock title="Double down" items={ai.actions.double_down} />
        </>
      )}
      <div className="card" style={{ marginTop: 12 }}>
        Routine suggestions are pending in <Link to="/settings">Settings → Suggestions</Link>.
      </div>
    </div>
  );
}

function ActionsBlock({ title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <>
      <div className="section-title">{title}</div>
      <div className="card" style={{ marginBottom: 8 }}>
        {items.map((it, i) => <div key={i} style={{ padding: '6px 0' }}>• {it}</div>)}
      </div>
    </>
  );
}
