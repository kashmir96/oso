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
    description: "Log a value for a goal. Pass for_date to backdate (default today NZ). For daily/weekly/monthly goals with sum/count aggregate, multiple logs accumulate within the window — log each meal's calories separately, not a manual running total.",
    input_schema: {
      type: 'object',
      properties: {
        goal_id: { type: 'string', description: 'UUID of the goal' },
        value: { type: 'number' },
        note: { type: 'string' },
        for_date: { type: 'string', description: 'YYYY-MM-DD; the day this measurement is FOR. Defaults to today NZ.' },
      },
      required: ['goal_id', 'value'],
    },
  },
  {
    name: 'create_goal',
    description: `Create a new goal. Pick the type AND timeframe by what Curtis described.

TYPE:
- 'numeric' (default) — measured value (body weight, calories, revenue).
- 'checkbox' — daily yes/no habit; streak counts up. Tap-to-tick.
- 'restraint' — auto-ticks daily until a fail is logged.

TIMEFRAME (numeric only — when running value resets):
- 'lifetime' (default) — never resets (body weight, savings).
- 'daily' — resets at midnight NZ. Calories, water, screen time.
- 'weekly' — resets Monday NZ.
- 'monthly' — resets on the 1st NZ.

AGGREGATE (numeric only — how multiple logs combine in window):
- 'last' (default) — most recent log wins (body weight).
- 'sum' — adds values (calories per day).
- 'count' — number of logs (lifts per week).
- 'avg' — average.

Examples:
- "Track calories, target 2200/day": type=numeric, timeframe=daily, aggregate=sum, target_value=2200, unit='cal', direction=lower_better.
- "Body weight, target 80kg": timeframe=lifetime, aggregate=last, unit='kg'.
- "4 lifts per week": timeframe=weekly, aggregate=count, target_value=4.

Don't create vague goals. For numeric, ask one question if target is missing.`,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        category: { type: 'string', enum: ['personal','health','business','social','finance','marketing','other'] },
        goal_type: { type: 'string', enum: ['numeric','checkbox','restraint'], description: 'default numeric' },
        timeframe: { type: 'string', enum: ['lifetime','daily','weekly','monthly'], description: 'numeric only; default lifetime' },
        aggregate: { type: 'string', enum: ['last','sum','count','avg'], description: 'numeric only; default last' },
        current_value: { type: 'number', description: 'numeric only — starting reading; defaults to start_value' },
        start_value: { type: 'number', description: 'numeric only' },
        target_value: { type: 'number', description: 'numeric — target value; checkbox/restraint — optional streak target in days' },
        unit: { type: 'string', description: 'e.g. kg, %, $, cal, sessions' },
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
    name: 'link_goal_to_whoop',
    description: "Link a goal so its current_value is auto-synced from Whoop daily. Use when Curtis says 'pull this from Whoop' or the goal is something Whoop measures (sleep, recovery, HRV, RHR, strain). Immediately seeds the goal with the most recent metric. After linking, manual log_goal_value calls on this goal will be refused.",
    input_schema: {
      type: 'object',
      properties: {
        goal_id: { type: 'string' },
        field: {
          type: 'string',
          enum: ['recovery_score', 'hrv_rmssd_ms', 'resting_heart_rate', 'strain', 'sleep_performance', 'sleep_hours', 'sleep_efficiency'],
          description: 'Which Whoop metric drives this goal',
        },
      },
      required: ['goal_id', 'field'],
    },
  },
  {
    name: 'unlink_goal_data_source',
    description: "Detach a goal from its external data source. After unlinking, manual log_goal_value works again.",
    input_schema: {
      type: 'object',
      properties: { goal_id: { type: 'string' } },
      required: ['goal_id'],
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
    name: 'create_errand',
    description: "Create a quick to-do — errand or 'job'. Use whenever Curtis says he needs to remember something concrete: buy X, pick up Y, follow up with Z, ship Bel's order. Set category='business' for work tasks (these surface as 'Jobs' on the Business tab); otherwise 'personal'/'health'/etc. (these surface as 'Errands' on Home). If he mentions a time, set remind_at — that fires a modal on app open AND optionally an SMS.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string', enum: ['personal','health','business','social','finance','marketing','other'], description: "default 'personal'" },
        due_date: { type: 'string', description: 'YYYY-MM-DD — calendar-style due day' },
        remind_at: { type: 'string', description: "ISO timestamp — exact moment to fire the reminder. E.g. '2026-04-26T18:30:00+13:00'" },
        sms_remind: { type: 'boolean', description: 'when remind_at fires, also send SMS to Curtis. Default false.' },
        priority: { type: 'integer', minimum: 1, maximum: 5 },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_errands',
    description: "Read errands. Filter by status ('open'/'done'/'cancelled') and/or category. Use to answer 'what do I need to do today / this week' or to check work jobs.",
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open','done','cancelled'] },
        category: { type: 'string', description: "single category, or 'business' / 'not_business'" },
      },
    },
  },
  {
    name: 'update_errand',
    description: "Update an errand — title, description, due_date, remind_at, sms_remind, priority, category. Updating remind_at clears the previous shown_at + sms_sent_at so the new time fires fresh.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string', enum: ['personal','health','business','social','finance','marketing','other'] },
        due_date: { type: 'string' },
        remind_at: { type: 'string' },
        sms_remind: { type: 'boolean' },
        priority: { type: 'integer' },
      },
      required: ['id'],
    },
  },
  {
    name: 'complete_errand',
    description: "Mark an errand done.",
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'delete_errand',
    description: "Delete an errand.",
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'create_routine_task',
    description: "Create a new recurring routine task that shows up on the Today list. Use when Curtis adds a new habit or daily action to his routine. Recurrence: 'daily' (default), 'weekly', or a CSV of weekday codes like 'mon,wed,fri'.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string', enum: ['personal','health','business','social','finance','marketing','other'] },
        recurrence_rule: { type: 'string', description: "default 'daily'" },
        priority: { type: 'integer', minimum: 1, maximum: 5, description: 'default 3' },
        estimated_minutes: { type: 'integer' },
        linked_goal_id: { type: 'string', description: 'optional UUID of a goal this task supports' },
        assigned_to: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_routine_task',
    description: "Update fields on a routine task — title, recurrence, priority, estimated_minutes, active. Use when Curtis tweaks a habit (different days, different priority).",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string', enum: ['personal','health','business','social','finance','marketing','other'] },
        recurrence_rule: { type: 'string' },
        priority: { type: 'integer' },
        estimated_minutes: { type: 'integer' },
        linked_goal_id: { type: 'string' },
        assigned_to: { type: 'string' },
        active: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_routine_task',
    description: "Permanently delete a routine task. Use when Curtis has clearly retired a habit. Prefer setting active=false via update_routine_task if he might restart.",
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'create_business_task',
    description: "Default tool for capturing anything Curtis says he needs to do for the business. Take whatever he says and save it immediately — DO NOT ask follow-up questions. The title can just be his words verbatim. Description, objective, priority, due_date are optional — leave them blank if he didn't volunteer them. Use this UNLESS he uses the word \"project\" — then use create_business_project instead.",
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
    name: 'create_business_project',
    description: "Use this INSTEAD OF create_business_task whenever Curtis uses the word \"project\" in his message. A project is a multi-step bundle of work with progress toward a big outcome (it gets its own tasks underneath). Take what he says and create it immediately — no follow-up questions. Title can be his words verbatim. Target_date and description are optional.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        target_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['title'],
    },
  },
  {
    name: 'queue_website_improvement',
    description: "Queue a code change for the **PrimalPantry website** (primebroth repo) — the e-commerce site at primalpantry.co.nz. Use this when Curtis describes a change to the storefront, product pages, checkout, marketing pages, blog, etc. Triggers: 'website', 'primebroth', 'the storefront', 'product page', 'checkout', 'fix the homepage'. NOT for changes to this app (oso/ckf) — those use queue_system_update. Capture immediately, no questions. Title verbatim is fine.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'short imperative — "fix product variant selector on mobile"' },
        description: { type: 'string', description: 'optional context, why, constraints' },
        priority: { type: 'integer', minimum: 1, maximum: 5, description: 'default 3' },
      },
      required: ['title'],
    },
  },
  {
    name: 'queue_system_update',
    description: "Queue a code change for the **CKF / Second Brain app** (oso/ckf repo) — this very app Curtis is talking to. Use when he describes a change to the chat, dashboard, business page, settings, a tool the AI uses, etc. Triggers: 'system update', 'fix the chat', 'in the dashboard', 'in this app', 'claude code update', 'the second brain', 'the ckf app'. NOT for storefront changes — those use queue_website_improvement. Capture immediately, no questions.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'short imperative — "make the business chat scroll properly"' },
        description: { type: 'string', description: 'optional context, why, constraints' },
        priority: { type: 'integer', minimum: 1, maximum: 5, description: 'default 3' },
      },
      required: ['title'],
    },
  },
  {
    name: 'search_everything',
    description: "Search across Curtis's whole CKF dataset (diary entries, memory facts, swipefile, goals, errands, meals, business tasks, prior chat messages). Use this whenever he asks to find / look up / search for something — 'what did I write about X', 'find that note about Y', 'pull up the diary where I mentioned Z'. Returns grouped hits per source.",
    input_schema: {
      type: 'object',
      properties: {
        q:         { type: 'string', description: 'search query — case-insensitive substring match' },
        limit_per: { type: 'integer', minimum: 1, maximum: 25, description: 'default 8, max 25 hits per source' },
      },
      required: ['q'],
    },
  },
  {
    name: 'get_recent_meals',
    description: "Fetch Curtis's recent meals (with AI calorie/macro estimates). Use when he asks to 'show meals', 'what did I eat', 'pull up my meals', or wants a calorie summary. Default: last 7 days.",
    input_schema: {
      type: 'object',
      properties: {
        days:  { type: 'integer', minimum: 1, maximum: 90, description: 'default 7' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'default 30' },
      },
    },
  },
  {
    name: 'add_swipefile_note',
    description: "Save a note to Curtis's swipefile (his trusted-source knowledge base — books, frameworks, taglines, observations he wants the AI to reference later). ONLY call this in swipefile-capture mode (triggered by 'go into swipefile mode' / 'swipefile mode'). In capture mode, EVERY user message gets one call to this tool with the message verbatim as source_text — no triage, no filtering. Outside capture mode, only call when the user explicitly asks to save something to the swipefile.",
    input_schema: {
      type: 'object',
      properties: {
        source_text:    { type: 'string', description: "Curtis's message verbatim, or the snippet he wants saved" },
        title:          { type: 'string', description: "optional short title; if absent, derive from the first ~60 chars of source_text" },
        why_it_matters: { type: 'string', description: "optional — only if Curtis volunteered why" },
        author:         { type: 'string', description: "optional — original source's author if Curtis named one" },
        category:       { type: 'string', enum: ['personal','health','business','social','finance','marketing','other'], description: "default depends on chat scope (personal/business)" },
        tags:           { type: 'array', items: { type: 'string' }, description: "optional — any tags he mentioned" },
        importance:     { type: 'integer', minimum: 1, maximum: 5, description: 'default 3' },
      },
      required: ['source_text'],
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
    name: 'search_swipefile',
    description: "Search Curtis's curated knowledge base (books, articles, talks, notes, images he's saved). Use this PROACTIVELY whenever a question maps to ideas he might have already saved — e.g. mentions of an author or framework, business strategy questions, training principles, philosophical themes. Reference the source title + author when you cite from it. Prefer his swipefile over generic knowledge.",
    input_schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'keywords, names, or phrases' },
        limit: { type: 'integer', minimum: 1, maximum: 30 },
      },
      required: ['q'],
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
    name: 'get_meals',
    description: "Fetch Curtis's recent meal log entries (image + AI calorie/macro estimate, with manual overrides if he edited them). Use to discuss eating patterns, total day calories, what he ate around a workout, or to compare against his calorie goal.",
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 30, description: 'how many days back; default 3' },
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

  // ─── Marketing creative pipeline (chat-driven Creative agent) ─────────────
  // One tool, action-dispatched, drives the entire flow:
  //   intake_brief -> run_strategy -> (run_variants_ad | run_outline ->
  //   run_hooks -> run_draft) -> run_critique (auto-repair x2) -> approve
  //   -> generate_voiceover -> submit_to_assistant.
  // Single tool keeps Curtis's tool list compact + lets the AI think about
  // pipeline state in one place.
  {
    name: 'creative_pipeline',
    description: "Drive the chat-conversational creative pipeline. ONLY use in business chat when Curtis says 'marketing mode' / 'let's make an ad' / 'create an ad' / similar. Walk him conversationally through the steps below; ONE question per turn, batch where natural. Don't enumerate the steps to him — just go.\n\nLATENCY GUARDRAIL: each pipeline stage is a separate Anthropic call (~5-15s). NEVER call this tool more than ONCE per turn, and NEVER combine it with another tool call in the same response. Wait for the result, reply, then let Curtis prompt the next step. Bunching tool calls causes 504 timeouts.\n\nFLOW:\n1. Ask creative_type (ad / video_script) + objective + audience + format + KPI + constraints. When you have ENOUGH (objective + audience + creative_type minimum), call action='intake_brief'.\n2. Call action='run_strategy'. Summarise the angle in 1-2 sentences. Ask: 'sound right or want a different angle?' If reroll, call run_strategy again.\n3a. For ads: call action='run_variants_ad'. Show 3-4 variants in compact form (just headline + axis). Ask which (1/2/3/4). Call action='pick_variant'.\n3b. For video: call action='run_outline'. Read back beats briefly. Then action='run_hooks' -> show hook variants -> action='pick_hook'. Then action='run_draft'.\n4. Call action='run_critique' (auto-repairs up to 2x silently). If verdict=ship, present the final piece. If verdict=replace, tell Curtis the angle isn't landing and offer to start fresh from strategy. If verdict=repair-cap-hit, surface the rationale and let Curtis decide.\n5. Once Curtis says 'looks good' / 'approve' / 'ship it' -- call action='approve' with a brief approval_reason from his words.\n6. Ask: 'Generate voiceover?' (only if creative has a script body). On yes: action='generate_voiceover'. Give him the public_url to copy.\n7. Ask: 'Proceed to Assistant?' On yes: action='submit_to_assistant'. Tell him: 'Done. It's in the production queue at /business/marketing/assistant.' Reply with the detail_url so he can open it.\n\nGENERAL: keep replies short (1-3 sentences). Don't dump full JSON. Cite specifics (angle name, scores) but in your own words. If a stage errors, surface the specific error in one line and ask if he wants to retry.",
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'intake_brief','run_strategy','run_variants_ad','pick_variant',
            'run_outline','run_hooks','pick_hook','run_draft',
            'run_critique','approve','generate_voiceover','submit_to_assistant',
          ],
        },
        creative_id: { type: 'string', description: 'required for every action after intake_brief' },
        // intake_brief
        creative_type: { type: 'string', enum: ['ad','video_script'] },
        brief: {
          type: 'object',
          properties: {
            objective:          { type: 'string' },
            audience:           { type: 'string' },
            kpi_target:         { type: 'object' },
            platform:           { type: 'string', description: 'meta / google / tiktok / youtube / shorts' },
            format:             { type: 'string', description: 'static / video / carousel / reel' },
            length_or_duration: { type: 'string' },
            constraints:        { type: 'array', items: { type: 'string' } },
          },
        },
        // pick_variant / pick_hook
        idx: { type: 'integer', minimum: 1, maximum: 6 },
        // approve
        approval_reason:   { type: 'string', description: 'short note from Curtis about why he approved (his words)' },
        feedback_analysis: { type: 'object', description: 'optional structured feedback' },
      },
      required: ['action'],
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
      // Refuse if the goal is auto-linked to an external source — otherwise the
      // next sync would overwrite the manual log and confuse history.
      const g = (await sbSelect('goals', `id=eq.${input.goal_id}&user_id=eq.${userId}&select=data_source,data_source_field,name&limit=1`))?.[0];
      if (g && g.data_source && g.data_source !== 'manual') {
        return { error: `Goal "${g.name}" is auto-synced from ${g.data_source}${g.data_source_field ? ` (${g.data_source_field})` : ''}. Unlink first if you want to log manually.` };
      }
      const log = await sbInsert('goal_logs', { goal_id: input.goal_id, user_id: userId, value: input.value, note: input.note || null });
      await sbUpdate('goals', `id=eq.${input.goal_id}&user_id=eq.${userId}`, { current_value: input.value });
      return { logged: true, log_id: log?.id, new_value: input.value };
    }
    case 'create_goal': {
      if (!input?.name) return { error: 'name required' };
      // Default category by chat scope so a goal created in business chat lands
      // in business and vice versa. Only kick in if the model didn't pass one.
      let category = input.category;
      if (!category) category = ctx?.scope === 'business' ? 'business' : 'personal';
      input = { ...input, category };
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
    case 'link_goal_to_whoop': {
      if (!input?.goal_id || !input?.field) return { error: 'goal_id and field required' };
      const ALLOWED = ['recovery_score','hrv_rmssd_ms','resting_heart_rate','strain','sleep_performance','sleep_hours','sleep_efficiency'];
      if (!ALLOWED.includes(input.field)) return { error: `bad field; pick one of ${ALLOWED.join(', ')}` };
      // Verify the goal exists and belongs to this user
      const g = (await sbSelect('goals', `id=eq.${input.goal_id}&user_id=eq.${userId}&select=*&limit=1`))?.[0];
      if (!g) return { error: 'goal not found' };
      await sbUpdate('goals', `id=eq.${g.id}&user_id=eq.${userId}`, {
        data_source: 'whoop',
        data_source_field: input.field,
      });
      // Immediate seed: pull the most recent whoop_metrics row and update current_value
      const recent = await sbSelect(
        'whoop_metrics',
        `user_id=eq.${userId}&order=date.desc&limit=1&select=date,${input.field}`
      );
      const v = recent?.[0]?.[input.field];
      if (v != null) {
        await sbUpdate('goals', `id=eq.${g.id}&user_id=eq.${userId}`, { current_value: Number(v) });
        await sbInsert('goal_logs', {
          goal_id: g.id, user_id: userId, value: Number(v),
          note: `whoop ${input.field} (initial link)`,
        });
        return { linked: true, field: input.field, seeded_with: Number(v), as_of: recent[0].date };
      }
      return { linked: true, field: input.field, seeded_with: null, note: 'No Whoop data yet — value will populate on next sync' };
    }
    case 'unlink_goal_data_source': {
      if (!input?.goal_id) return { error: 'goal_id required' };
      const rows = await sbUpdate('goals', `id=eq.${input.goal_id}&user_id=eq.${userId}`, {
        data_source: 'manual', data_source_field: null,
      });
      return { unlinked: true, goal: rows?.[0] };
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
      return { created: true, id: row?.id, kind: 'task' };
    }
    case 'create_business_project': {
      if (!input?.title) return { error: 'title required' };
      // Try the projects table; if the column or table is missing (migration
      // not applied yet), fall back to a regular business_task so nothing is lost.
      try {
        const row = await sbInsert('business_projects', {
          user_id: userId,
          title: input.title,
          description: input.description || null,
          target_date: input.target_date || null,
        });
        return { created: true, id: row?.id, kind: 'project' };
      } catch (e) {
        const fallback = await sbInsert('business_tasks', {
          user_id: userId,
          title: input.title,
          description: input.description || null,
        });
        return {
          created: true,
          id: fallback?.id,
          kind: 'task',
          fallback_reason: 'business_projects table missing — saved as task instead. Apply supabase-business-projects.sql to enable projects.',
        };
      }
    }
    case 'search_everything': {
      const q = (input?.q || '').trim();
      if (!q) return { error: 'q required' };
      const limit = Math.min(input?.limit_per || 8, 25);
      const safe = encodeURIComponent(`*${q.replace(/[%*]/g, '')}*`);
      const f = `user_id=eq.${userId}`;
      const safe2 = (cols) => cols.split(',').map((c) => `${c}.ilike.${safe}`).join(',');
      const [diary, memory, swipe, goals, errands, meals, biz, messages] = await Promise.all([
        sbSelect('diary_entries',
          `${f}&or=(${safe2('personal_good,personal_bad,eighty_twenty,growth_opportunities,bottlenecks,unfiltered,ai_summary')})&order=date.desc&limit=${limit}&select=date,ai_summary,personal_bad,bottlenecks,unfiltered`
        ).catch(() => []),
        sbSelect('ckf_memory_facts',
          `${f}&archived=eq.false&fact.ilike.${safe}&order=importance.desc,created_at.desc&limit=${limit}&select=id,fact,topic,importance`
        ).catch(() => []),
        sbSelect('ckf_swipefile_items',
          `${f}&archived=eq.false&or=(${safe2('title,source_text,why_it_matters,author')})&order=importance.desc,created_at.desc&limit=${limit}&select=id,kind,title,why_it_matters,author,source_url,category`
        ).catch(() => []),
        sbSelect('goals',
          `${f}&name.ilike.${safe}&order=created_at.desc&limit=${limit}&select=id,name,category,goal_type,current_value,target_value,unit,status`
        ).catch(() => []),
        sbSelect('ckf_errands',
          `${f}&or=(${safe2('title,description')})&order=status.asc,created_at.desc&limit=${limit}&select=id,title,description,status,due_date`
        ).catch(() => []),
        sbSelect('ckf_meals',
          `${f}&or=(${safe2('ai_label,manual_label,notes')})&order=meal_date.desc&limit=${limit}&select=meal_date,ai_label,manual_label,ai_calories,manual_calories`
        ).catch(() => []),
        sbSelect('business_tasks',
          `${f}&or=(${safe2('title,description,objective')})&order=created_at.desc&limit=${limit}&select=id,title,description,status,due_date,priority`
        ).catch(() => []),
        sbSelect('ckf_messages',
          `${f}&content_text.ilike.${safe}&order=created_at.desc&limit=${limit}&select=id,conversation_id,role,content_text,created_at`
        ).catch(() => []),
      ]);
      return {
        q,
        results: { diary, memory, swipefile: swipe, goals, errands, meals, business_tasks: biz, messages },
      };
    }
    case 'get_recent_meals': {
      const days = Math.min(input?.days || 7, 90);
      const limit = Math.min(input?.limit || 30, 100);
      const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
      try {
        const rows = await sbSelect(
          'ckf_meals',
          `user_id=eq.${userId}&meal_date=gte.${since}&order=meal_date.desc,created_at.desc&limit=${limit}&select=id,meal_date,ai_label,manual_label,ai_calories,manual_calories,notes,image_url`
        );
        return { days, meals: rows };
      } catch (e) {
        return { error: `meals query failed: ${e.message}` };
      }
    }
    case 'add_swipefile_note': {
      if (!input?.source_text) return { error: 'source_text required' };
      const title = input.title
        || input.source_text.split('\n')[0].slice(0, 60)
        || 'Note';
      const tags = Array.isArray(input.tags) ? input.tags : [];
      // Tag everything captured this way so it's filterable later.
      if (!tags.includes('captured-from-chat')) tags.push('captured-from-chat');
      try {
        const row = await sbInsert('ckf_swipefile_items', {
          user_id:        userId,
          kind:           'note',
          title,
          source_text:    input.source_text,
          why_it_matters: input.why_it_matters || null,
          author:         input.author || null,
          category:       input.category || 'personal',
          tags,
          importance:     input.importance ?? 3,
        });
        return { saved: true, id: row?.id, kind: 'swipefile_note' };
      } catch (e) {
        return { error: `swipefile insert failed: ${e.message}` };
      }
    }
    case 'queue_website_improvement': {
      if (!input?.title) return { error: 'title required' };
      return queueRepoTask(userId, input, 'primebroth', 'website');
    }
    case 'queue_system_update': {
      if (!input?.title) return { error: 'title required' };
      return queueRepoTask(userId, input, 'oso-ckf', 'system');
    }
    case 'create_errand': {
      if (!input?.title) return { error: 'title required' };
      const row = await sbInsert('ckf_errands', {
        user_id: userId,
        title: input.title,
        description: input.description || null,
        category: input.category || 'personal',
        due_date: input.due_date || null,
        remind_at: input.remind_at || null,
        sms_remind: !!input.sms_remind,
        priority: input.priority ?? 3,
      });
      return { created: true, errand: row };
    }
    case 'list_errands': {
      const status = input?.status;
      const category = input?.category;
      let filter = `user_id=eq.${userId}`;
      if (status) filter += `&status=eq.${status}`;
      if (category === 'not_business') filter += `&category=neq.business`;
      else if (category) filter += `&category=eq.${encodeURIComponent(category)}`;
      const rows = await sbSelect('ckf_errands', `${filter}&order=status.asc,due_date.asc.nullslast,created_at.desc&limit=100&select=id,title,description,category,due_date,remind_at,sms_remind,priority,status,completed_at`);
      return { errands: rows };
    }
    case 'update_errand': {
      if (!input?.id) return { error: 'id required' };
      const patch = {};
      for (const k of ['title','description','category','due_date','remind_at','sms_remind','priority']) {
        if (input[k] !== undefined) patch[k] = input[k];
      }
      if (Object.keys(patch).length === 0) return { error: 'no fields to update' };
      if (Object.prototype.hasOwnProperty.call(patch, 'remind_at')) {
        patch.shown_at = null; patch.sms_sent_at = null;
      }
      const rows = await sbUpdate('ckf_errands', `id=eq.${input.id}&user_id=eq.${userId}`, patch);
      return { updated: true, errand: rows?.[0] };
    }
    case 'complete_errand': {
      if (!input?.id) return { error: 'id required' };
      const rows = await sbUpdate('ckf_errands', `id=eq.${input.id}&user_id=eq.${userId}`, {
        status: 'done', completed_at: new Date().toISOString(),
      });
      return { completed: true, errand: rows?.[0] };
    }
    case 'delete_errand': {
      if (!input?.id) return { error: 'id required' };
      const { sbDelete } = require('./ckf-sb.js');
      await sbDelete('ckf_errands', `id=eq.${input.id}&user_id=eq.${userId}`);
      return { deleted: true };
    }
    case 'create_routine_task': {
      if (!input?.title) return { error: 'title required' };
      const row = await sbInsert('routine_tasks', {
        user_id: userId,
        title: input.title,
        description: input.description || null,
        category: input.category || 'personal',
        linked_goal_id: input.linked_goal_id || null,
        recurrence_rule: input.recurrence_rule || 'daily',
        priority: input.priority ?? 3,
        estimated_minutes: input.estimated_minutes ?? null,
        assigned_to: input.assigned_to || null,
      });
      return { created: true, task: row };
    }
    case 'update_routine_task': {
      if (!input?.id) return { error: 'id required' };
      const patch = {};
      for (const k of ['title','description','category','recurrence_rule','priority','estimated_minutes','linked_goal_id','assigned_to','active']) {
        if (input[k] !== undefined) patch[k] = input[k];
      }
      if (Object.keys(patch).length === 0) return { error: 'no fields to update' };
      const rows = await sbUpdate('routine_tasks', `id=eq.${input.id}&user_id=eq.${userId}`, patch);
      return { updated: true, task: rows?.[0] };
    }
    case 'delete_routine_task': {
      if (!input?.id) return { error: 'id required' };
      const { sbDelete } = require('./ckf-sb.js');
      await sbDelete('routine_tasks', `id=eq.${input.id}&user_id=eq.${userId}`);
      return { deleted: true };
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

    case 'search_swipefile': {
      const q = (input?.q || '').trim();
      if (!q) return { items: [] };
      const limit = Math.min(input?.limit || 8, 30);
      const safe = encodeURIComponent(`*${q.replace(/[%*]/g, '')}*`);
      const rows = await sbSelect(
        'ckf_swipefile_items',
        `user_id=eq.${userId}&archived=eq.false&or=(title.ilike.${safe},source_text.ilike.${safe},why_it_matters.ilike.${safe})&order=importance.desc,created_at.desc&limit=${limit}&select=id,kind,title,source_url,why_it_matters,author,tags,importance,source_text`
      );
      return {
        items: (rows || []).map((r) => ({
          ...r,
          source_text: r.source_text ? r.source_text.slice(0, 800) : null,
        })),
      };
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

    case 'get_meals': {
      const days = Math.min(Math.max(input?.days || 3, 1), 30);
      const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
      const rows = await sbSelect(
        'ckf_meals',
        `user_id=eq.${userId}&meal_date=gte.${since}&order=meal_date.desc,created_at.desc&limit=50&select=id,meal_date,meal_type,ai_label,ai_calories,ai_protein_g,ai_carbs_g,ai_fat_g,manual_label,manual_calories,manual_protein_g,manual_carbs_g,manual_fat_g,notes,source`
      );
      // Resolve manual-overrides client-side for the model
      const meals = (rows || []).map((m) => ({
        id: m.id, meal_date: m.meal_date, meal_type: m.meal_type,
        label: m.manual_label ?? m.ai_label,
        calories: m.manual_calories ?? m.ai_calories,
        protein_g: m.manual_protein_g ?? m.ai_protein_g,
        carbs_g: m.manual_carbs_g ?? m.ai_carbs_g,
        fat_g: m.manual_fat_g ?? m.ai_fat_g,
        notes: m.notes,
        source: m.source,
      }));
      return { days, meals };
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

    case 'creative_pipeline': {
      const pipeline = require('./mktg-pipeline.js');
      const a = input?.action;
      // Helper: after a successful generation stage, insert a special
      // pipeline_card message into the conversation. The chat client renders
      // it as an editable card inline in the bubble stream. This is what
      // gives Curtis the "tweak the bubble + submit" UX without having the
      // AI manage the structured form (which it's bad at).
      const emitCard = async (stage, creative_id, payload) => {
        if (!ctx.conversationId) return;
        try {
          await sbInsert('ckf_messages', {
            conversation_id: ctx.conversationId,
            user_id:         userId,
            role:            'assistant',
            content_text:    null,
            content_blocks:  [{ type: 'pipeline_card', stage, creative_id, payload }],
          });
        } catch (e) {
          console.error('[creative_pipeline emitCard]', e);
        }
      };

      switch (a) {
        case 'intake_brief':
          return pipeline.intakeBrief({ userId, brief: input.brief || {}, creative_type: input.creative_type });

        case 'run_strategy': {
          const r = await pipeline.runStrategy({ user_id: userId, creative_id: input.creative_id });
          if (r?.ok) await emitCard('strategy', input.creative_id, {
            primary_angle: r.angle, audience_message_fit: r.audience_fit,
            exemplar_strength: r.exemplar_strength, flags: r.flags,
            citations_n: r.citations_n,
          });
          return r;
        }
        case 'run_variants_ad': {
          const r = await pipeline.runVariants({ user_id: userId, creative_id: input.creative_id });
          if (r?.ok) await emitCard('variants_ad', input.creative_id, { variants: r.variants });
          return r;
        }
        case 'pick_variant':
          return pipeline.pickVariant({ creative_id: input.creative_id, idx: input.idx });
        case 'run_outline': {
          const r = await pipeline.runOutline({ user_id: userId, creative_id: input.creative_id });
          if (r?.ok) await emitCard('outline', input.creative_id, {
            structure_template: r.structure, runtime: r.runtime,
            beats: r.beats, // already pre-formatted strings; widget will let user override
          });
          return r;
        }
        case 'run_hooks': {
          const r = await pipeline.runHooks({ user_id: userId, creative_id: input.creative_id });
          if (r?.ok) await emitCard('hooks', input.creative_id, { hooks: r.hooks });
          return r;
        }
        case 'pick_hook':
          return pipeline.pickHook({ creative_id: input.creative_id, idx: input.idx });
        case 'run_draft': {
          const r = await pipeline.runDraft({ user_id: userId, creative_id: input.creative_id });
          if (r?.ok) await emitCard('draft', input.creative_id, {
            full_script: r.full_script, word_count: r.word_count,
          });
          return r;
        }
        case 'run_critique': {
          const r = await pipeline.runCritiqueWithRepair({ user_id: userId, creative_id: input.creative_id });
          if (r?.ok) await emitCard('critique', input.creative_id, {
            verdict: r.verdict, scores: r.scores, rationale: r.rationale, repairs_used: r.repairs_used,
          });
          return r;
        }
        case 'approve':
          return pipeline.approveCreative({ creative_id: input.creative_id, approval_reason: input.approval_reason, feedback_analysis: input.feedback_analysis });
        case 'generate_voiceover':
          return pipeline.generateVoiceover({ user: ctx.user || { id: userId }, creative_id: input.creative_id });
        case 'submit_to_assistant':
          return pipeline.submitToAssistant({ creative_id: input.creative_id });
        default:
          return { error: `unknown creative_pipeline action: ${a}` };
      }
    }

    default:
      return { error: `unknown tool ${name}` };
  }
}

// Shared insert path for the two repo-targeted queue tools. Falls back to
// business_tasks if the website_tasks table or repo column is missing so
// nothing is lost mid-migration.
async function queueRepoTask(userId, input, repo, label) {
  try {
    const row = await sbInsert('website_tasks', {
      user_id: userId,
      title: input.title,
      description: input.description || null,
      priority: input.priority ?? 3,
      status: 'queued',
      repo,
    });
    return { queued: true, id: row?.id, kind: `${label}_task`, repo };
  } catch (e) {
    const fallback = await sbInsert('business_tasks', {
      user_id: userId,
      title: `[${label}] ${input.title}`,
      description: input.description || null,
      priority: input.priority ?? 3,
    });
    return {
      queued: true,
      id: fallback?.id,
      kind: 'task',
      fallback_reason: `website_tasks table or repo column missing — saved as business_task instead. Apply supabase-website-tasks.sql to enable the ${repo} queue.`,
    };
  }
}

module.exports = { TOOLS, execute, clip, nzToday };
