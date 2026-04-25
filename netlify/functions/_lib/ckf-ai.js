// CKF AI helper — wraps Anthropic SDK (already a dep at the repo root).
// Used for diary summary, weekly summary, and 90-day breakdowns.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-20250514';

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Try hard to extract JSON from a model response, even if it's wrapped in markdown.
function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  try { return JSON.parse(raw.trim()); } catch {}
  // Find first { or [ and last matching bracket.
  const start = Math.min(
    ...['{', '['].map((c) => { const i = raw.indexOf(c); return i === -1 ? Infinity : i; })
  );
  if (!isFinite(start)) return null;
  const candidate = raw.slice(start);
  try { return JSON.parse(candidate); } catch {}
  return null;
}

const SYSTEM_BASE =
  'You are the AI assistant inside Curtis Fairweather\'s personal "Second Brain" app. ' +
  'Curtis is a CMO and founder running Primal Pantry (tallow skincare) in Christchurch, NZ. ' +
  'He uses this app each evening to review the day and plan tomorrow.\n\n' +
  'Tone: calm, direct, peer-to-peer. No flattery, no fluff, no generic life-coach advice. ' +
  'Be specific to what he wrote. If something is ambiguous, say so. ' +
  'Reply ONLY with valid JSON exactly matching the schema requested. No prose outside the JSON.';

// ── Diary summary + tomorrow recommendations ──
async function summariseDiary({ entry, recentEntries }) {
  const recentBlock = (recentEntries || [])
    .slice(0, 5)
    .map((e) => `- ${e.date}: 80/20=${e.eighty_twenty || '—'}; bad=${e.personal_bad || '—'}; bottlenecks=${e.bottlenecks || '—'}`)
    .join('\n');

  const prompt = `Today's diary entry (${entry.date}):
- Good: ${entry.personal_good || '—'}
- Bad: ${entry.personal_bad || '—'}
- Wasted time: ${entry.wasted_time || '—'}
- Time-saving opportunities: ${entry.time_saving_opportunities || '—'}
- 80/20: ${entry.eighty_twenty || '—'}
- Simplify tomorrow: ${entry.simplify_tomorrow || '—'}
- Social: ${entry.social_reflection || '—'}
- Personal lessons: ${entry.personal_lessons || '—'}
- Physical (body/energy/sleep/training): ${entry.physical_reflection || '—'}
- Mental (focus/mood/load): ${entry.mental_reflection || '—'}
- Spiritual (purpose/alignment/presence): ${entry.spiritual_reflection || '—'}
- Growth opportunities (what I avoided / where I could grow): ${entry.growth_opportunities || '—'}
- Personal tasks for tomorrow: ${JSON.stringify(entry.tomorrow_personal_tasks || [])}

Business:
- Wins: ${entry.business_wins || '—'}
- Losses: ${entry.business_losses || '—'}
- Activity: ${entry.business_activity || '—'}
- Lessons: ${entry.business_lessons || '—'}
- Marketing: ${entry.marketing_objectives || '—'}
- Delegation: ${entry.delegation_notes || '—'}
- Bottlenecks: ${entry.bottlenecks || '—'}
- Change tomorrow: ${entry.change_tomorrow || '—'}
- Business tasks for tomorrow: ${JSON.stringify(entry.tomorrow_business_tasks || [])}

Recent context (last few entries):
${recentBlock || '(no prior entries)'}

Return JSON with this exact shape:
{
  "summary": "2–3 sentence honest read of the day across physical, mental, spiritual, and business lenses",
  "growth_read": "1–2 sentences on the most important growth opportunity surfaced today",
  "actions": {
    "tomorrow": ["concrete action #1", "concrete action #2", "..."],
    "week": ["concrete weekly action", "..."],
    "business": ["business priority", "..."],
    "personal": ["personal priority", "..."],
    "physical": ["physical action — training, sleep, food, energy", "..."],
    "mental": ["mental action — focus, recovery, attention", "..."],
    "spiritual": ["spiritual / values action", "..."],
    "cut": ["what to drop or stop", "..."],
    "double_down": ["what to do more of", "..."]
  },
  "routine_suggestions": [
    { "suggestion": "concrete new daily/weekly habit", "reason": "why, citing what he wrote" }
  ]
}

Rules: 3–5 items per actions array (physical/mental/spiritual may be 1–3); routine_suggestions: 1–3 items. No generic advice. Cite his actual words where possible.`;

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_BASE,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = res.content?.[0]?.text || '';
  const json = extractJson(text);
  if (!json) throw new Error('AI did not return valid JSON for diary summary');
  return json;
}

// ── Weekly summary from a week of entries + logs ──
async function summariseWeek({ weekStart, weekEnd, entries, taskLogs, goalLogs }) {
  const entryBlock = entries.map((e) =>
    `--- ${e.date}\n80/20: ${e.eighty_twenty || ''}\nBad: ${e.personal_bad || ''}\nBottlenecks: ${e.bottlenecks || ''}\nWasted: ${e.wasted_time || ''}\nLessons: ${e.personal_lessons || ''}`
  ).join('\n');

  const taskCounts = (taskLogs || []).reduce((acc, l) => {
    acc[l.status] = (acc[l.status] || 0) + 1; return acc;
  }, {});
  const goalDeltaBlock = (goalLogs || []).slice(0, 50).map((g) =>
    `${g.goal_name || g.goal_id}: ${g.value} on ${g.created_at?.slice(0, 10)}`
  ).join('; ');

  const prompt = `Weekly review for ${weekStart} → ${weekEnd}.

Diary entries:
${entryBlock || '(none)'}

Task completion counts: ${JSON.stringify(taskCounts)}
Goal updates: ${goalDeltaBlock || '(none)'}

Return JSON:
{
  "summary": "3–5 sentences",
  "wins": "the biggest wins, plain text",
  "losses": "the biggest losses",
  "bottlenecks": "patterns of repeated bottlenecks",
  "routine_suggestions": "concrete suggested changes for next week",
  "goal_progress_summary": { "<goal_name>": "short note on progress" },
  "business_summary": "what the business actually did this week",
  "personal_summary": "what changed personally"
}`;

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_BASE,
    messages: [{ role: 'user', content: prompt }],
  });
  return extractJson(res.content?.[0]?.text || '') || {};
}

// ── Break a 90-day goal into milestones, weekly actions, and routine suggestions ──
async function breakdownNinetyDay({ goal }) {
  const prompt = `90-day goal:
- Title: ${goal.title}
- Description: ${goal.description || '—'}
- Category: ${goal.category}
- Start: ${goal.start_date}, End: ${goal.end_date}
- Target outcome: ${goal.target_outcome || '—'}

Return JSON:
{
  "monthly_milestones": [
    { "month_number": 1, "title": "...", "target": "concrete measurable outcome by end of month 1" },
    { "month_number": 2, "title": "...", "target": "..." },
    { "month_number": 3, "title": "...", "target": "..." }
  ],
  "weekly_actions": [
    { "week_number": 1, "title": "...", "description": "..." }
    /* exactly 13 entries, week_number 1..13 */
  ],
  "daily_routine_suggestions": [
    { "suggestion": "daily habit that supports this goal", "reason": "why" }
    /* 1–3 entries */
  ]
}`;

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: SYSTEM_BASE,
    messages: [{ role: 'user', content: prompt }],
  });
  return extractJson(res.content?.[0]?.text || '') || {};
}

module.exports = { summariseDiary, summariseWeek, breakdownNinetyDay, MODEL };
