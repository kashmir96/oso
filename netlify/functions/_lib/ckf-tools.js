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
      },
    },
  },
  {
    name: 'log_goal_value',
    description: "Log a new value for an existing goal. Triggers an updated_at + history row for charting.",
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
      return { logged: true, log_id: log?.id };
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

    default:
      return { error: `unknown tool ${name}` };
  }
}

module.exports = { TOOLS, execute, clip, nzToday };
