import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header.jsx';
import { call, callCached, notifyChanged } from '../lib/api.js';
import { processFile, revokePreview } from '../lib/upload.js';
import { fmtShortDate } from '../lib/format.js';

const MEAL_TYPES = ['', 'breakfast', 'lunch', 'dinner', 'snack'];

export default function Meals() {
  const [meals, setMeals] = useState(null);
  const [goals, setGoals] = useState([]);
  const [logToGoalId, setLogToGoalId] = useState(() => localStorage.getItem('ckf_meals_log_goal') || '');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState('');

  async function load() {
    try {
      const [m, g] = await Promise.all([
        callCached('ckf-meals', { action: 'list', limit: 60 }),
        callCached('ckf-goals', { action: 'list' }).catch(() => ({ goals: [] })),
      ]);
      setMeals(m.meals || []);
      // Calorie-style daily-sum goals are eligible auto-log targets
      setGoals((g.goals || []).filter((x) => x.status === 'active' && x.timeframe === 'daily' && x.aggregate === 'sum'));
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  function pickGoal(id) {
    setLogToGoalId(id);
    if (id) localStorage.setItem('ckf_meals_log_goal', id);
    else localStorage.removeItem('ckf_meals_log_goal');
  }

  if (err) return <div className="app"><div className="error">{err}</div></div>;

  return (
    <div className="app">
      <Header
        title="Meals"
        right={<button onClick={() => { setEditing(null); setAdding(true); }}>+ Add</button>}
      />

      {goals.length > 0 && (
        <div className="card" style={{ marginBottom: 12, fontSize: 13 }}>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
            Auto-log calories to
          </label>
          <select value={logToGoalId} onChange={(e) => pickGoal(e.target.value)}>
            <option value="">— none —</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>{g.name} ({g.unit || 'cal'} · daily)</option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            New meals will write a goal_log to this goal using the AI calorie estimate.
          </div>
        </div>
      )}

      {adding && (
        <AddMealForm
          logToGoalId={logToGoalId || null}
          onSaved={() => { setAdding(false); load(); }}
          onCancel={() => setAdding(false)}
        />
      )}
      {editing && (
        <EditMealForm
          meal={editing}
          onSaved={() => { setEditing(null); load(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {!meals ? (
        <div className="loading">Loading…</div>
      ) : meals.length === 0 ? (
        <div className="empty">No meals yet. Tap "+ Add" or share the trainer link from Settings.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {meals.map((m) => <MealRow key={m.id} meal={m} onEdit={() => setEditing(m)} />)}
        </div>
      )}
    </div>
  );
}

function pickValue(m, k) {
  return m['manual_' + k] != null ? m['manual_' + k] : m['ai_' + k];
}

function MealRow({ meal, onEdit }) {
  const label = pickValue(meal, 'label') || 'Meal';
  const cal = pickValue(meal, 'calories');
  const p = pickValue(meal, 'protein_g');
  const c = pickValue(meal, 'carbs_g');
  const f = pickValue(meal, 'fat_g');
  return (
    <div className="meal-row" onClick={onEdit} role="button">
      {meal.image_url
        ? <img className="meal-thumb" src={meal.image_url} alt="" />
        : <div className="meal-thumb" />}
      <div className="meal-body">
        <div className="meal-title">{label}</div>
        <div className="meal-meta">
          {fmtShortDate(meal.meal_date)}{meal.meal_type ? ` · ${meal.meal_type}` : ''}
          {meal.source === 'share' && <span className="pill" style={{ marginLeft: 6 }}>shared</span>}
          {meal.ai_confidence && meal.ai_confidence !== 'high' && (
            <span className="pill" style={{ marginLeft: 6 }}>{meal.ai_confidence} conf</span>
          )}
        </div>
        <div className="meal-cal">
          {cal != null ? `${Math.round(cal)} cal` : '— cal'}
          {p != null ? ` · ${Math.round(p)}g P` : ''}
          {c != null ? ` · ${Math.round(c)}g C` : ''}
          {f != null ? ` · ${Math.round(f)}g F` : ''}
        </div>
      </div>
    </div>
  );
}

function AddMealForm({ logToGoalId, onSaved, onCancel }) {
  const [att, setAtt] = useState(null);
  const [notes, setNotes] = useState('');
  const [mealType, setMealType] = useState('');
  const [mealDate, setMealDate] = useState(() =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date())
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const camRef = useRef(null);
  const fileRef = useRef(null);

  async function pickImage(files, fromCamera) {
    if (!files?.[0]) return;
    setErr('');
    try {
      const a = await processFile(files[0]);
      if (att) revokePreview(att);
      setAtt({ ...a, fromCamera });
    } catch (e) { setErr(e.message); }
  }

  async function submit(e) {
    e.preventDefault();
    if (!att) return;
    setBusy(true); setErr('');
    try {
      await call('ckf-meals', {
        action: 'create',
        image_base64: att.data_base64,
        mime_type: att.media_type,
        notes: notes || null,
        meal_type: mealType || null,
        meal_date: mealDate,
        log_to_goal_id: logToGoalId || null,
      });
      revokePreview(att);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 12 }}>
      <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
        onChange={(e) => { pickImage(e.target.files, true); e.target.value = ''; }} />
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { pickImage(e.target.files, false); e.target.value = ''; }} />

      {att?.preview_url ? (
        <img src={att.preview_url} alt="" style={{ width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 10, background: '#0a0b0d', marginBottom: 8 }} />
      ) : (
        <div className="row">
          <button type="button" onClick={() => camRef.current?.click()} style={{ flex: 1 }}>📷 Take photo</button>
          <button type="button" onClick={() => fileRef.current?.click()} style={{ flex: 1 }}>📎 Choose photo</button>
        </div>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Type</label>
          <select value={mealType} onChange={(e) => setMealType(e.target.value)}>
            {MEAL_TYPES.map((t) => <option key={t} value={t}>{t || '—'}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Date</label>
          <input type="date" value={mealDate} onChange={(e) => setMealDate(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Notes (optional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything to add — portion size, prep, etc." />
      </div>

      {err && <div className="error">{err}</div>}
      <div className="row">
        <button type="button" onClick={() => { if (att) revokePreview(att); onCancel(); }}>Cancel</button>
        <button type="submit" className="primary" disabled={!att || busy}>
          {busy ? 'Estimating…' : 'Save + estimate'}
        </button>
      </div>
    </form>
  );
}

function EditMealForm({ meal, onSaved, onCancel }) {
  const [label, setLabel] = useState(meal.manual_label ?? meal.ai_label ?? '');
  const [calories, setCalories] = useState(meal.manual_calories ?? meal.ai_calories ?? '');
  const [protein, setProtein] = useState(meal.manual_protein_g ?? meal.ai_protein_g ?? '');
  const [carbs, setCarbs] = useState(meal.manual_carbs_g ?? meal.ai_carbs_g ?? '');
  const [fat, setFat] = useState(meal.manual_fat_g ?? meal.ai_fat_g ?? '');
  const [notes, setNotes] = useState(meal.notes || '');
  const [mealType, setMealType] = useState(meal.meal_type || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await call('ckf-meals', {
        action: 'update', id: meal.id,
        manual_label: label || null,
        manual_calories: calories === '' ? null : Number(calories),
        manual_protein_g: protein === '' ? null : Number(protein),
        manual_carbs_g: carbs === '' ? null : Number(carbs),
        manual_fat_g: fat === '' ? null : Number(fat),
        notes: notes || null,
        meal_type: mealType || null,
      });
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function del() {
    if (!confirm('Delete this meal?')) return;
    await call('ckf-meals', { action: 'delete', id: meal.id });
    notifyChanged();
    onSaved();
  }

  return (
    <form className="card" onSubmit={save} style={{ marginBottom: 12 }}>
      {meal.image_url && (
        <img src={meal.image_url} alt="" style={{ width: '100%', maxHeight: 240, objectFit: 'contain', borderRadius: 10, background: '#0a0b0d', marginBottom: 8 }} />
      )}
      <div className="field">
        <label>Label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={meal.ai_label || ''} />
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Calories</label>
          <input type="number" step="any" value={calories} onChange={(e) => setCalories(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Protein (g)</label>
          <input type="number" step="any" value={protein} onChange={(e) => setProtein(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Carbs (g)</label>
          <input type="number" step="any" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Fat (g)</label>
          <input type="number" step="any" value={fat} onChange={(e) => setFat(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Type</label>
          <select value={mealType} onChange={(e) => setMealType(e.target.value)}>
            {MEAL_TYPES.map((t) => <option key={t} value={t}>{t || '—'}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>

      {meal.ai_ingredients && meal.ai_ingredients.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
          AI saw: {meal.ai_ingredients.map((it) => `${it.item}${it.portion ? ` (${it.portion})` : ''}`).join(', ')}
        </div>
      )}

      {err && <div className="error">{err}</div>}
      <div className="row">
        <button type="button" className="danger" onClick={del}>Delete</button>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
