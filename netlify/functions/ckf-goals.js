/**
 * ckf-goals.js — goals + goal_logs.
 * Actions: list, create, update, archive, delete, log_value, history,
 *          mark_done (checkbox), mark_fail (restraint reset).
 */
const { sbSelect, sbInsert, sbUpdate, sbDelete } = require('./_lib/ckf-sb.js');
const { withGate, reply } = require('./_lib/ckf-guard.js');

function nzToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());
}

function daysBetween(fromDateStr, toDateStr) {
  if (!fromDateStr || !toDateStr) return 0;
  const a = Date.UTC(...fromDateStr.split('-').map(Number).map((v, i) => i === 1 ? v - 1 : v));
  const b = Date.UTC(...toDateStr.split('-').map(Number).map((v, i) => i === 1 ? v - 1 : v));
  return Math.round((b - a) / 86400000);
}

// Window start for a timeframe, in NZ-relative dates (YYYY-MM-DD strings).
function windowStart(timeframe, today = nzToday()) {
  if (timeframe === 'daily') return today;
  if (timeframe === 'weekly') {
    const d = new Date(today + 'T00:00:00Z');
    const dow = d.getUTCDay();              // 0=Sun, 1=Mon
    const offset = dow === 0 ? -6 : 1 - dow; // back to Monday
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }
  if (timeframe === 'monthly') return today.slice(0, 8) + '01';
  return null; // lifetime: no window
}

// Recompute current_value for a numeric-style goal based on its timeframe + aggregate.
// Returns the new value (number or null), without persisting.
async function deriveCurrentValue(goal) {
  if (goal.goal_type && goal.goal_type !== 'numeric') return goal.current_value;
  if (goal.data_source && goal.data_source !== 'manual') return goal.current_value; // owned by sync

  const tf = goal.timeframe || 'lifetime';
  const ag = goal.aggregate || 'last';
  const start = windowStart(tf);

  let filter = `goal_id=eq.${goal.id}`;
  if (start) filter += `&for_date=gte.${start}`;
  // Order so 'last' takes the freshest reading regardless of insert order.
  const rows = await sbSelect('goal_logs', `${filter}&order=for_date.desc.nullslast,created_at.desc&select=value,for_date,created_at`);
  if (!rows || rows.length === 0) {
    return tf === 'lifetime' ? goal.current_value : 0;
  }
  if (ag === 'last') return Number(rows[0].value);
  if (ag === 'count') return rows.length;
  const nums = rows.map((r) => Number(r.value)).filter((n) => Number.isFinite(n));
  if (nums.length === 0) return 0;
  if (ag === 'sum') return nums.reduce((s, v) => s + v, 0);
  if (ag === 'avg') return nums.reduce((s, v) => s + v, 0) / nums.length;
  return Number(rows[0].value);
}

// For restraint goals, recompute current_value on read so the streak ticks up
// automatically. Persists the new value if it changed.
async function refreshRestraintValue(goal) {
  if (goal.goal_type !== 'restraint' || !goal.streak_started_at) return goal;
  const today = nzToday();
  const days = Math.max(0, daysBetween(goal.streak_started_at, today));
  if (Number(goal.current_value) !== days) {
    await sbUpdate('goals', `id=eq.${goal.id}`, { current_value: days });
    goal.current_value = days;
  }
  return goal;
}

exports.handler = withGate(async (event, { user }) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const { action } = body;

  if (action === 'list') {
    const rows = await sbSelect(
      'goals',
      `user_id=eq.${user.id}&order=created_at.desc&select=*`
    );
    for (const g of rows) {
      // Restraint streaks tick automatically.
      await refreshRestraintValue(g);
      // Numeric goals with a window/aggregate compute their value from logs.
      if ((!g.goal_type || g.goal_type === 'numeric') && (g.timeframe && g.timeframe !== 'lifetime' || (g.aggregate && g.aggregate !== 'last'))) {
        const derived = await deriveCurrentValue(g);
        if (derived != null && Number(g.current_value) !== Number(derived)) {
          await sbUpdate('goals', `id=eq.${g.id}`, { current_value: derived });
          g.current_value = derived;
        }
      }
    }
    return reply(200, { goals: rows });
  }

  if (action === 'create') {
    const { name, category, current_value, start_value, target_value, unit, direction, goal_type, timeframe, aggregate } = body;
    if (!name || !category) return reply(400, { error: 'name and category required' });
    const type = goal_type || 'numeric';
    const today = nzToday();

    let row;
    if (type === 'checkbox') {
      row = await sbInsert('goals', {
        user_id: user.id,
        name, category, goal_type: 'checkbox',
        current_value: 0, start_value: 0,
        target_value: target_value ?? null,
        unit: unit || 'days',
        direction: 'higher_better',
        last_completed_at: null,
      });
    } else if (type === 'restraint') {
      row = await sbInsert('goals', {
        user_id: user.id,
        name, category, goal_type: 'restraint',
        current_value: 0, start_value: 0,
        target_value: target_value ?? null,
        unit: unit || 'days',
        direction: 'higher_better',
        streak_started_at: today,
      });
    } else {
      row = await sbInsert('goals', {
        user_id: user.id,
        name, category, goal_type: 'numeric',
        current_value: current_value ?? null,
        start_value: start_value ?? current_value ?? null,
        target_value: target_value ?? null,
        unit: unit || null,
        direction: direction || 'higher_better',
        timeframe: timeframe || 'lifetime',
        aggregate: aggregate || 'last',
      });
      if (current_value != null) {
        await sbInsert('goal_logs', {
          goal_id: row.id, user_id: user.id, value: current_value, note: 'initial', for_date: today,
        });
      }
    }
    return reply(200, { goal: row });
  }

  // Checkbox goals: tap to mark today done. Idempotent for the same day.
  if (action === 'mark_done') {
    const { goal_id } = body;
    if (!goal_id) return reply(400, { error: 'goal_id required' });
    const goal = (await sbSelect('goals', `id=eq.${goal_id}&user_id=eq.${user.id}&select=*&limit=1`))?.[0];
    if (!goal) return reply(404, { error: 'goal not found' });
    if (goal.goal_type !== 'checkbox') return reply(400, { error: 'mark_done is for checkbox goals only' });

    const today = nzToday();
    if (goal.last_completed_at === today) {
      return reply(200, { goal, already_done_today: true });
    }
    const wasYesterday = goal.last_completed_at && daysBetween(goal.last_completed_at, today) === 1;
    const newStreak = wasYesterday ? (Number(goal.current_value) || 0) + 1 : 1;

    const rows = await sbUpdate('goals', `id=eq.${goal_id}&user_id=eq.${user.id}`, {
      current_value: newStreak,
      last_completed_at: today,
    });
    await sbInsert('goal_logs', { goal_id, user_id: user.id, value: newStreak, note: 'checkbox tick' });
    return reply(200, { goal: rows?.[0] });
  }

  // Restraint goals: log a fail; resets the streak to 0 from today.
  if (action === 'mark_fail') {
    const { goal_id, note } = body;
    if (!goal_id) return reply(400, { error: 'goal_id required' });
    const goal = (await sbSelect('goals', `id=eq.${goal_id}&user_id=eq.${user.id}&select=*&limit=1`))?.[0];
    if (!goal) return reply(404, { error: 'goal not found' });
    if (goal.goal_type !== 'restraint') return reply(400, { error: 'mark_fail is for restraint goals only' });
    const today = nzToday();
    const rows = await sbUpdate('goals', `id=eq.${goal_id}&user_id=eq.${user.id}`, {
      current_value: 0,
      streak_started_at: today,
    });
    await sbInsert('goal_logs', { goal_id, user_id: user.id, value: 0, note: note || 'fail — streak reset' });
    return reply(200, { goal: rows?.[0] });
  }

  if (action === 'update') {
    const { id, ...patch } = body;
    if (!id) return reply(400, { error: 'id required' });
    delete patch.action;
    const rows = await sbUpdate('goals', `id=eq.${id}&user_id=eq.${user.id}`, patch);
    return reply(200, { goal: rows[0] });
  }

  if (action === 'archive') {
    if (!body.id) return reply(400, { error: 'id required' });
    const rows = await sbUpdate('goals', `id=eq.${body.id}&user_id=eq.${user.id}`, { status: 'archived' });
    return reply(200, { goal: rows[0] });
  }

  if (action === 'delete') {
    if (!body.id) return reply(400, { error: 'id required' });
    await sbDelete('goals', `id=eq.${body.id}&user_id=eq.${user.id}`);
    return reply(200, { success: true });
  }

  if (action === 'log_value') {
    const { goal_id, value, note, for_date } = body;
    if (!goal_id || value == null) return reply(400, { error: 'goal_id and value required' });
    const g = (await sbSelect('goals', `id=eq.${goal_id}&user_id=eq.${user.id}&select=*&limit=1`))?.[0];
    if (!g) return reply(404, { error: 'goal not found' });
    if (g.data_source && g.data_source !== 'manual') {
      return reply(400, { error: `"${g.name}" is auto-synced from ${g.data_source}${g.data_source_field ? ` (${g.data_source_field})` : ''}. Unlink first.` });
    }
    const logFor = for_date || nzToday();
    const log = await sbInsert('goal_logs', {
      goal_id, user_id: user.id, value, note: note || null, for_date: logFor,
    });
    // Re-derive current_value rather than blindly overwriting — backdated logs
    // should NOT clobber a newer reading just because they were entered last.
    const derived = await deriveCurrentValue(g);
    if (derived != null) {
      await sbUpdate('goals', `id=eq.${goal_id}&user_id=eq.${user.id}`, { current_value: derived });
    }
    return reply(200, { log, current_value: derived });
  }

  if (action === 'history') {
    const { goal_id, limit } = body;
    if (!goal_id) return reply(400, { error: 'goal_id required' });
    const lim = Math.min(Number(limit) || 60, 365);
    const rows = await sbSelect(
      'goal_logs',
      `goal_id=eq.${goal_id}&user_id=eq.${user.id}&order=created_at.desc&limit=${lim}&select=*`
    );
    return reply(200, { logs: rows });
  }

  return reply(400, { error: 'Unknown action' });
});
