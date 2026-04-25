// Tool definitions + handlers for ckf-chat.
// Tools are executed server-side with the user_id resolved by the gate, so the
// AI cannot access other users' data even if it tries.
const { sbSelect, sbInsert, sbUpdate } = require('./ckf-sb.js');

// ── Anthropic-shaped tool schema ──
const TOOLS = [
  {
    name: 'get_recent_diary_entries',
    description: "Fetch Curtis's most recent diary entries (date, summary, key reflections). Use to ground reads, look for patterns, or check what he wrote about a topic recently.",
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'How many recent entries (default 5, max 30).', minimum: 1, maximum: 30 },
      },
    },
  },
  {
    name: 'get_diary_entry',
    description: "Fetch a single diary entry by date (YYYY-MM-DD).",
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['date'],
    },
  },
  {
    name: 'get_goals',
    description: "Fetch Curtis's goals with current progress. Use to check what he's tracking.",
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active','archived','all'], description: 'default active' },
      },
    },
  },
  {
    name: 'get_today_routine',
    description: "Fetch today's routine tasks with completion status. Use to check his current execution.",
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD; defaults to today NZ' },
      },
    },
  },
  {
    name: 'get_task_completion_pattern',
    description: 'Aggregate routine task completion over the last N days. Returns counts of done/skipped/missed by task title.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 1, maximum: 90, description: 'default 14' } },
    },
  },
  {
    name: 'get_business_tasks',
    description: 'Fetch open business tasks (or filter by status).',
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string' } },
    },
  },
  {
    name: 'get_ninety_day_goals',
    description: 'Fetch active 90-day goals with milestones and weekly actions.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_pending_suggestions',
    description: "Fetch routine suggestions that are awaiting Curtis's approval.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_memory_facts',
    description: 'Fetch long-term memory facts about Curtis. Optionally filter by topic.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'optional topic filter' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
    },
  },
  {
    name: 'get_weekly_summary',
    description: 'Fetch a stored weekly summary by week_start (Monday, YYYY-MM-DD).',
    input_schema: {
      type: 'object',
      properties: { week_start: { type: 'string' } },
      required: ['week_start'],
    },
  },

  // ── Write tools ──
  {
    name: 'save_diary_entry',
    description: "Persist or update Curtis's diary entry for a given date. Use this near the end of a reflective conversation to capture the structured row. Fields are all optional — pass only what was discussed; existing values are preserved for unspecified fields.",
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD; defaults to today NZ' },
        personal_good: { type: 'string' },
        personal_bad: { type: 'string' },
        wasted_time: { type: 'string' },
        time_saving_opportunities: { type: 'string' },
        eighty_twenty: { type: 'string' },
        simplify_tomorrow: { type: 'string' },
        social_reflection: { type: 'string' },
        personal_lessons: { type: 'string' },
        physical_reflection: { type: 'string', description: 'body, energy, sleep, training' },
        mental_reflection: { type: 'string', description: 'focus, mood, mental load' },
        spiritual_reflection: { type: 'string', description: 'purpose, alignment, presence, values' },
        growth_opportunities: { type: 'string', description: 'where could he grow / what did he avoid' },
        tomorrow_personal_tasks: {
          type: 'array',
          items: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
        },
        business_wins: { type: 'string' },
        business_losses: { type: 'string' },
        business_activity: { type: 'string' },
        business_lessons: { type: 'string' },
        marketing_objectives: { type: 'string' },
        delegation_notes: { type: 'string' },
        bottlenecks: { type: 'string' },
        change_tomorrow: { type: 'string' },
        tomorrow_business_tasks: {
          type: 'array',
          items: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
        },
        unfiltered: { type: 'string', description: "The 'anything else on your chest' catch-all from the closing question. Free-form. Save verbatim." },
      },
    },
  },
  {
    name: 'log_goal_value',
    description: "Log a new value for an existing goal. Updates current_value and writes a history row for charting. For counter-style goals (e.g. 'training sessions this month'), call get_goals first to read current_value, then log current+1.",
    input_schema: {
      type: 'object',
      properties: {
        goal_id: { type: 'string', description: 'UUID of the goal' },
        value: { type: 'number' },
        note: { type: 'string' },
      },
      required: ['goal_id', 'value'],
    },
  },
  {
    name: 'create_goal',
    description: `Create a new goal. Pick the type by what Curtis described:
- 'numeric' (default) — a measured value with a target. E.g. body weight, body fat %, revenue. Needs target_value + unit.
- 'checkbox' — a daily yes/no habit; the streak counts up by 1 each day he does it. E.g. "plunge every day", "lift today". current_value tracks streak in days. Tapping the card marks it done.
- 'restraint' — auto-ticks up daily UNLESS he logs a fail. E.g. "no alcohol", "no porn", "screen-free morning". current_value tracks days clean. Tapping the card prompts a "log fail" reset.

Don't create vague goals — turn fuzzy intentions into something concrete. For numeric, ask for a target if it's missing.`,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        category: { type: 'string', enum: ['personal','health','business','social','finance','marketing','other'] },
        goal_type: { type: 'string', enum: ['numeric','checkbox','restraint'], description: 'default numeric' },
        current_value: { type: 'number', description: 'numeric only — starting reading; defaults to start_value' },
        start_value: { type: 'number', description: 'numeric only' },
        target_value: { type: 'number', description: 'numeric — target value; checkbox/restraint — optional streak target in days' },
        unit: { type: 'string', description: 'e.g. kg, %, $, sessions. Defaults to "days" for checkbox/restraint.' },
        direction: { type: 'string', enum: ['higher_better','lower_better'], description: 'numeric only; default higher_better' },
      },
      required: ['name', 'category'],
    },
  },
  {
    name: 'update_goal',
    description: "Update fields on an existing goal — name, target, unit, direction, category. Use when Curtis re-frames a goal (raises target, narrows scope).",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the goal' },
        name: { type: 'string' },
        category: { type: 'string', enum: ['personal','health','business','social','finance','marketing','other'] },
        target_value: { type: 'number' },
        start_value: { type: 'number' },
        unit: { type: 'string' },
        direction: { type: 'string', enum: ['higher_better','lower_better'] },
      },
      required: ['id'],
    },
  },
  {
    name: 'archive_goal',
    description: "Archive a goal (status → archived). Use when Curtis says he's done with it or it's no longer relevant. Reversible from the UI.",
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'mark_goal_done',
    description: "For checkbox goals only — mark today done. Increments the streak by 1 if yesterday was also done; resets to 1 otherwise. Idempotent within the same day. Use when Curtis says 'I plunged today', 'lifted today', 'did the morning routine', etc.",
    input_schema: {
      type: 'object',
      properties: { goal_id: { type: 'string' } },
      required: ['goal_id'],
    },
  },
  {
    name: 'mark_goal_fail',
    description: "For restraint goals only — log a fail and reset the streak to 0 today. Use when Curtis says 'I drank tonight', 'I caved', 'broke the streak', etc. Be matter-of-fact about it; resetting is part of the system, not a judgement.",
    input_schema: {
      type: 'object',
      properties: {
        goal_id: { type: 'string' },
        note: { type: 'string', description: 'optional context — what triggered the slip' },
      },
      required: ['goal_id'],
    },
  },
  {
    name: 'set_task_status',
    description: "Mark a routine task as done/skipped/not_started for a given date.",
    input_schema: {
      type: 'object',
      properties: {
        routine_task_id: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD; defaults to today NZ' },
        status: { type: 'string', enum: ['not_started','done','skipped'] },
        note: { type: 'string' },
      },
      required: ['routine_task_id', 'status'],
    },
  },
  {
    name: 'create_routine_suggestion',
    description: "Propose a new daily/weekly habit. Creates a PENDING row — Curtis must approve it in Settings before it becomes a real routine task. Don't ask permission to call this; just call it whenever you have a concrete habit suggestion.",
    input_schema: {
      type: 'object',
      properties: {
        suggestion: { type: 'string', description: 'concrete habit' },
        reason: { type: 'string', description: 'why, citing what was discussed' },
      },
      required: ['suggestion'],
    },
  },
  {
    name: 'create_business_task',
    description: 'Create a new business task. Use when Curtis decides during the conversation that something needs to happen.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        objective: { type: 'string' },
        assigned_to: { type: 'string' },
        priority: { type: 'integer', minimum: 1, maximum: 5 },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['title'],
    },
  },
  {
    name: 'remember',
    description: "Save a long-term memory fact about Curtis. Call this when you learn something durable that should persist across future conversations: a value, a relationship, a recurring pattern, a meaningful preference, an ongoing struggle, an aspiration. Don't store ephemeral one-day moods. Examples of GOOD facts: 'trains 4x/week, prefers morning lifts', 'wife is Linda, runs PP ops with him', 'has chronically poor sleep when stressed about cashflow'. Examples of BAD facts (do not store): 'felt tired today', 'had a stressful meeting'.",
    input_schema: {
      type: 'object',
      properties: {
        fact: { type: 'string' },
        topic: { type: 'string', description: 'optional cluster: training, business, family, sleep, finance, etc.' },
        importance: { type: 'integer', minimum: 1, maximum: 5, description: 'default 3' },
      },
      required: ['fact'],
    },
  },
  {
    name: 'archive_memory_fact',
    description: 'Mark a memory fact as outdated. Use when the user contradicts or supersedes something in memory.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'get_calendar_events',
    description: "Fetch upcoming calendar events from Curtis's connected Google Calendar. Use when he asks about his schedule, what's coming up, when he's free, or when planning tomorrow.",
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'ISO timestamp (default: now)' },
        to: { type: 'string', description: 'ISO timestamp (default: end of NZ day + 36h buffer)' },
      },
    },
  },
  {
    name: 'get_whoop_today',
    description: "Fetch yesterday's Whoop metrics (recovery score 0-100, HRV, resting HR, strain, sleep performance, sleep hours, sleep efficiency). Use when discussing physical state, recovery, sleep, or training readiness.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_whoop_recent',
    description: "Fetch recent Whoop metrics for trend analysis. Use to spot patterns in recovery / sleep / strain.",
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 90, description: 'default 14' },
      },
    },
  },
];

// ── Helpers ──
function nzToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' });
  return fmt.format(new Date());
}

function clip(text, max = 4000) {
  if (typeof text !== 'string') text = JSON.stringify(text);
  return text.length > max ? text.slice(0, max) + '…[truncated]' : text;
}

// ── Tool execution ──
// Each handler receives (input, ctx) where ctx = { userId, messageId? }.
// Returns a JSON-serializable object that becomes the tool_result content.
async function execute(name, input, ctx) {
  const { userId } = ctx;
  switch (name) {
    case 'get_recent_diary_entries': {
      const limit = Math.min(Math.max(input?.limit || 5, 1), 30);
      const rows = await sbSelect(
        'diary_entries',
        `user_id=eq.${userId}&order=date.desc&limit=${limit}&select=date,ai_summary,eighty_twenty,personal_bad,bottlenecks,growth_opportunities,physical_reflection,mental_reflection,spiritual_reflection`
      );
      return { entries: rows };
    }
    case 'get_diary_entry': {
      if (!input?.date) return { error: 'date required' };
      const rows = await sbSelect(
        'diary_entries',
        `user_id=eq.${userId}&date=eq.${input.date}&select=*&limit=1`
      );
      return { entry: rows?.[0] || null };
    }
    case 'get_goals': {
      const status = input?.status || 'active';
      const filter = status === 'all' ? '' : `&status=eq.${status}`;
      const rows = await sbSelect(
        'goals',
        `user_id=eq.${userId}${filter}&order=updated_at.desc&select=id,name,category,current_value,start_value,target_value,unit,direction,status,updated_at`
      );
      return { goals: rows };
    }
    case 'get_today_routine': {
      const date = input?.date || nzToday();
      const tasks = await sbSelect('routine_tasks', `user_id=eq.${userId}&active=eq.true&select=*`);
      const logs = await sbSelect('daily_task_logs', `user_id=eq.${userId}&date=eq.${date}&select=*`);
      const logByTask = Object.fromEntries(logs.map((l) => [l.routine_task_id, l]));
      return { date, tasks: tasks.map((t) => ({ ...t, log: logByTask[t.id] || null })) };
    }
    case 'get_task_completion_pattern': {
      const days = Math.min(Math.max(input?.days || 14, 1), 90);
      const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
      const logs = await sbSelect(
        'daily_task_logs',
        `user_id=eq.${userId}&date=gte.${since}&select=routine_task_id,status,date`
      );
      const tasks = await sbSelect('routine_tasks', `user_id=eq.${userId}&select=id,title`);
      const titleById = Object.fromEntries(tasks.map((t) => [t.id, t.title]));
      const counts = {};
      for (const l of logs) {
        const k = titleById[l.routine_task_id] || l.routine_task_id;
        counts[k] = counts[k] || { done: 0, skipped: 0, not_started: 0 };
        counts[k][l.status] = (counts[k][l.status] || 0) + 1;
      }
      return { days, counts };
    }
    case 'get_business_tasks': {
      const filter = input?.status ? `&status=eq.${input.status}` : '';
      const rows = await sbSelect('business_tasks', `user_id=eq.${userId}${filter}&order=priority.asc,due_date.asc.nullslast&select=*`);
      return { tasks: rows };
    }
    case 'get_ninety_day_goals': {
      const goals = await sbSelect('ninety_day_goals', `user_id=eq.${userId}&status=eq.active&select=*`);
      const out = [];
      for (const g of goals) {
        const milestones = await sbSelect('monthly_milestones', `ninety_day_goal_id=eq.${g.id}&order=month_number.asc&select=month_number,title,target,status`);
        const actions = await sbSelect('weekly_actions', `ninety_day_goal_id=eq.${g.id}&order=week_number.asc&select=week_number,title,status`);
        out.push({ ...g, milestones, actions });
      }
      return { goals: out };
    }
    case 'get_pending_suggestions': {
      const rows = await sbSelect('routine_suggestions', `user_id=eq.${userId}&status=eq.pending&order=created_at.desc&select=id,suggestion,reason,source_type,created_at`);
      return { suggestions: rows };
    }
    case 'get_memory_facts': {
      const topicFilter = input?.topic ? `&topic=eq.${encodeURIComponent(input.topic)}` : '';
      const limit = Math.min(input?.limit || 100, 200);
      const rows = await sbSelect(
        'ckf_memory_facts',
        `user_id=eq.${userId}&archived=eq.false${topicFilter}&order=importance.desc,created_at.desc&limit=${limit}&select=id,fact,topic,importance,created_at`
      );
      return { facts: rows };
    }
    case 'get_weekly_summary': {
      if (!input?.week_start) return { error: 'week_start required' };
      const rows = await sbSelect('weekly_summaries', `user_id=eq.${userId}&week_start=eq.${input.week_start}&select=*&limit=1`);
      return { summary: rows?.[0] || null };
    }

    case 'save_diary_entry': {
      const date = input?.date || nzToday();
      const allowed = [
        'personal_good','personal_bad','wasted_time','time_saving_opportunities',
        'eighty_twenty','simplify_tomorrow','social_reflection','personal_lessons',
        'physical_reflection','mental_reflection','spiritual_reflection','growth_opportunities',
        'tomorrow_personal_tasks',
        'business_wins','business_losses','business_activity','business_lessons',
        'tomorrow_business_tasks','marketing_objectives','delegation_notes','bottlenecks','change_tomorrow',
        'unfiltered',
      ];
      const patch = {};
      for (const k of allowed) if (input[k] !== undefined) patch[k] = input[k];
      // Normalise tomorrow_*_tasks shape: ensure each item has done: null
      for (const k of ['tomorrow_personal_tasks','tomorrow_business_tasks']) {
        if (Array.isArray(patch[k])) {
          patch[k] = patch[k].map((t) => typeof t === 'string' ? { task: t, done: null } : { task: t.task, done: t.done ?? null });
        }
      }
      const existing = await sbSelect('diary_entries', `user_id=eq.${userId}&date=eq.${date}&select=id&limit=1`);
      let row;
      if (existing?.[0]) {
        const updated = await sbUpdate('diary_entries', `id=eq.${existing[0].id}`, patch);
        row = updated?.[0];
      } else {
        row = await sbInsert('diary_entries', { user_id: userId, date, ...patch });
      }
      return { saved: true, date, id: row?.id };
    }
    case 'log_goal_value': {
      if (!input?.goal_id || input?.value == null) return { error: 'goal_id and value required' };
      const log = await sbInsert('goal_logs', { goal_id: input.goal_id, user_id: userId, value: input.value, note: input.note || null });
      await sbUpdate('goals', `id=eq.${input.goal_id}&user_id=eq.${userId}`, { current_value: input.value });
      return { logged: true, log_id: log?.id, new_value: input.value };
    }
    case 'create_goal': {
      if (!input?.name || !input?.category) return { error: 'name and category required' };
      const type = input.goal_type || 'numeric';
      const today = nzToday();

      if (type === 'checkbox') {
        const goal = await sbInsert('goals', {
          user_id: userId,
          name: input.name, category: input.category, goal_type: 'checkbox',
          current_value: 0, start_value: 0,
          target_value: input.target_value ?? null,
          unit: input.unit || 'days',
          direction: 'higher_better',
          last_completed_at: null,
        });
        return { created: true, goal };
      }
      if (type === 'restraint') {
        const goal = await sbInsert('goals', {
          user_id: userId,
          name: input.name, category: input.category, goal_type: 'restraint',
          current_value: 0, start_value: 0,
          target_value: input.target_value ?? null,
          unit: input.unit || 'days',
          direction: 'higher_better',
          streak_started_at: today,
        });
        return { created: true, goal };
      }
      const start = input.start_value ?? input.current_value ?? null;
      const goal = await sbInsert('goals', {
        user_id: userId,
        name: input.name, category: input.category, goal_type: 'numeric',
        current_value: input.current_value ?? start,
        start_value: start,
        target_value: input.target_value ?? null,
        unit: input.unit || null,
        direction: input.direction || 'higher_better',
      });
      if (input.current_value != null || start != null) {
        const v = input.current_value ?? start;
        await sbInsert('goal_logs', { goal_id: goal.id, user_id: userId, value: v, note: 'initial' });
      }
      return { created: true, goal };
    }
    case 'mark_goal_done': {
      if (!input?.goal_id) return { error: 'goal_id required' };
      const g = (await sbSelect('goals', `id=eq.${input.goal_id}&user_id=eq.${userId}&select=*&limit=1`))?.[0];
      if (!g) return { error: 'goal not found' };
      if (g.goal_type !== 'checkbox') return { error: 'mark_goal_done is for checkbox goals only' };
      const today = nzToday();
      if (g.last_completed_at === today) return { already_done_today: true, current_value: g.current_value };
      const fromYesterday = g.last_completed_at && (
        new Date(today + 'T00:00:00Z') - new Date(g.last_completed_at + 'T00:00:00Z') === 86400000
      );
      const newStreak = fromYesterday ? (Number(g.current_value) || 0) + 1 : 1;
      await sbUpdate('goals', `id=eq.${g.id}&user_id=eq.${userId}`, {
        current_value: newStreak, last_completed_at: today,
      });
      await sbInsert('goal_logs', { goal_id: g.id, user_id: userId, value: newStreak, note: 'checkbox tick' });
      return { marked: true, current_value: newStreak };
    }
    case 'mark_goal_fail': {
      if (!input?.goal_id) return { error: 'goal_id required' };
      const g = (await sbSelect('goals', `id=eq.${input.goal_id}&user_id=eq.${userId}&select=*&limit=1`))?.[0];
      if (!g) return { error: 'goal not found' };
      if (g.goal_type !== 'restraint') return { error: 'mark_goal_fail is for restraint goals only' };
      const today = nzToday();
      await sbUpdate('goals', `id=eq.${g.id}&user_id=eq.${userId}`, {
        current_value: 0, streak_started_at: today,
      });
      await sbInsert('goal_logs', { goal_id: g.id, user_id: userId, value: 0, note: input.note || 'fail — streak reset' });
      return { reset: true, streak_started_at: today };
    }
    case 'update_goal': {
      if (!input?.id) return { error: 'id required' };
      const patch = {};
      for (const k of ['name','category','target_value','start_value','unit','direction']) {
        if (input[k] !== undefined) patch[k] = input[k];
      }
      if (Object.keys(patch).length === 0) return { error: 'no fields to update' };
      const rows = await sbUpdate('goals', `id=eq.${input.id}&user_id=eq.${userId}`, patch);
      return { updated: true, goal: rows?.[0] };
    }
    case 'archive_goal': {
      if (!input?.id) return { error: 'id required' };
      const rows = await sbUpdate('goals', `id=eq.${input.id}&user_id=eq.${userId}`, { status: 'archived' });
      return { archived: true, goal: rows?.[0] };
    }
    case 'set_task_status': {
      if (!input?.routine_task_id || !input?.status) return { error: 'routine_task_id and status required' };
      const date = input.date || nzToday();
      const existing = await sbSelect(
        'daily_task_logs',
        `user_id=eq.${userId}&routine_task_id=eq.${input.routine_task_id}&date=eq.${date}&select=id&limit=1`
      );
      const completedAt = input.status === 'done' ? new Date().toISOString() : null;
      if (existing?.[0]) {
        await sbUpdate('daily_task_logs', `id=eq.${existing[0].id}`, {
          status: input.status, note: input.note ?? null, completed_at: completedAt,
        });
      } else {
        await sbInsert('daily_task_logs', {
          user_id: userId, routine_task_id: input.routine_task_id, date,
          status: input.status, note: input.note || null, completed_at: completedAt,
        });
      }
      return { set: true, date };
    }
    case 'create_routine_suggestion': {
      if (!input?.suggestion) return { error: 'suggestion required' };
      const row = await sbInsert('routine_suggestions', {
        user_id: userId, source_type: 'diary',
        suggestion: input.suggestion, reason: input.reason || null,
      });
      return { created: true, id: row?.id, status: 'pending' };
    }
    case 'create_business_task': {
      if (!input?.title) return { error: 'title required' };
      const row = await sbInsert('business_tasks', {
        user_id: userId,
        title: input.title,
        description: input.description || null,
        objective: input.objective || null,
        assigned_to: input.assigned_to || null,
        priority: input.priority ?? 3,
        due_date: input.due_date || null,
      });
      return { created: true, id: row?.id };
    }
    case 'remember': {
      if (!input?.fact) return { error: 'fact required' };
      const row = await sbInsert('ckf_memory_facts', {
        user_id: userId,
        fact: input.fact,
        topic: input.topic || null,
        importance: input.importance ?? 3,
        source_message_id: ctx.messageId || null,
      });
      return { remembered: true, id: row?.id };
    }
    case 'archive_memory_fact': {
      if (!input?.id) return { error: 'id required' };
      await sbUpdate('ckf_memory_facts', `id=eq.${input.id}&user_id=eq.${userId}`, { archived: true });
      return { archived: true };
    }

    case 'get_calendar_events': {
      const { getValidIntegration } = require('./ckf-oauth.js');
      const integration = await getValidIntegration(userId, 'google_calendar');
      if (!integration) return { not_connected: true, message: 'Google Calendar not connected' };
      const now = new Date();
      const from = input?.from || now.toISOString();
      const to = input?.to || new Date(now.getTime() + 36 * 3600e3).toISOString();
      const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
      url.searchParams.set('timeMin', from);
      url.searchParams.set('timeMax', to);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('maxResults', '25');
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${integration.access_token}` } });
      if (!res.ok) return { error: `Google Calendar ${res.status}` };
      const j = await res.json();
      const events = (j.items || [])
        .filter((e) => e.status !== 'cancelled')
        .map((e) => ({
          summary: e.summary || '(no title)',
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          location: e.location || null,
          all_day: !!e.start?.date && !e.start?.dateTime,
        }));
      return { events, from, to };
    }

    case 'get_whoop_today': {
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' });
      const today = fmt.format(new Date());
      const yesterday = new Date(today + 'T00:00:00Z');
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yStr = yesterday.toISOString().slice(0, 10);
      const rows = await sbSelect(
        'whoop_metrics',
        `user_id=eq.${userId}&date=eq.${yStr}&select=*&limit=1`
      );
      if (!rows?.[0]) return { not_synced_yet: true, date: yStr };
      const m = rows[0];
      delete m.raw;
      return { metrics: m };
    }

    case 'get_whoop_recent': {
      const days = Math.min(Math.max(input?.days || 14, 1), 90);
      const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
      const rows = await sbSelect(
        'whoop_metrics',
        `user_id=eq.${userId}&date=gte.${since}&order=date.desc&limit=${days}&select=date,recovery_score,hrv_rmssd_ms,resting_heart_rate,strain,sleep_performance,sleep_hours,sleep_efficiency`
      );
      return { days, metrics: rows };
    }

    default:
      return { error: `unknown tool ${name}` };
  }
}

module.exports = { TOOLS, execute, clip, nzToday };
