// Vision-based meal analysis: feed an image (already uploaded to Storage) to
// Claude Sonnet 4 and get a calorie + ingredient estimate as JSON.
const Anthropic = require('@anthropic-ai/sdk');
const { logAnthropicUsage } = require('./ckf-usage.js');

const MODEL = 'claude-sonnet-4-20250514';

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  try { return JSON.parse(raw.trim()); } catch {}
  const start = Math.min(...['{', '['].map((c) => { const i = raw.indexOf(c); return i === -1 ? Infinity : i; }));
  if (!isFinite(start)) return null;
  try { return JSON.parse(raw.slice(start)); } catch {}
  return null;
}

const SYSTEM = `You estimate calories + macros + ingredients from food photos.

Be honest about uncertainty. If the dish is ambiguous, say so in the label and pick "low" confidence.
Estimate calories for the WHOLE plate as shown — don't average per-ingredient unless asked.
Macros are best-effort. Round calories to the nearest 10, macros to the nearest gram.
Respond ONLY with JSON matching the schema below.`;

const SCHEMA_HINT = `Schema:
{
  "label": "<short dish name, e.g. 'Steak, sweet potato, broccoli'>",
  "calories": <number, kcal for the whole plate>,
  "protein_g": <number>,
  "carbs_g": <number>,
  "fat_g": <number>,
  "ingredients": [
    { "item": "<name>", "portion": "<rough portion, e.g. '~200g', '1 cup'>" }
  ],
  "confidence": "low" | "medium" | "high"
}`;

async function estimateMealFromImage({ imageBase64, mimeType, hint }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userText = [
    'Estimate the calories + macros + ingredients of this meal.',
    hint ? `Context from the uploader: ${hint}` : null,
    SCHEMA_HINT,
  ].filter(Boolean).join('\n\n');

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: userText },
      ],
    }],
  });
  logAnthropicUsage({ action: 'meal_vision', model: MODEL, usage: res.usage });
  const text = res.content?.filter((b) => b.type === 'text').map((b) => b.text).join('\n') || '';
  const parsed = extractJson(text) || {};
  return {
    label: parsed.label || null,
    calories: typeof parsed.calories === 'number' ? parsed.calories : null,
    protein_g: typeof parsed.protein_g === 'number' ? parsed.protein_g : null,
    carbs_g: typeof parsed.carbs_g === 'number' ? parsed.carbs_g : null,
    fat_g: typeof parsed.fat_g === 'number' ? parsed.fat_g : null,
    ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
    confidence: ['low','medium','high'].includes(parsed.confidence) ? parsed.confidence : 'low',
    raw: parsed,
    usage: res.usage || null,
  };
}

module.exports = { estimateMealFromImage };
