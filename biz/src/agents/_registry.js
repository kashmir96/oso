/**
 * Agent registry for oso/biz.
 *
 * Single source of truth for:
 *   - the sidebar list (slug + name + group + icon)
 *   - the route table (each agent gets /:slug)
 *   - which agent the chat shell talks to (slug -> backend system prompt + tools)
 *
 * Backend has a mirror at netlify/functions/_lib/biz-agents/_index.js with
 * the system prompts + tool subsets. Frontend keeps just the metadata + a
 * lazy-loaded page component (most agents = the generic AgentChat shell;
 * specialised ones can ship a custom page).
 */

// Group ordering controls sidebar group order.
export const GROUPS = [
  { id: 'plan',    label: 'Plan' },
  { id: 'create',  label: 'Create' },
  { id: 'finish',  label: 'Finish' },
];

export const AGENTS = [
  // ── Plan ──
  { slug: 'brand-voice',        name: 'Brand Voice Guardian',  group: 'plan',   icon: '🛡',  blurb: 'Brand seed, locked decisions, register anti-patterns. Other agents read from this.' },
  { slug: 'creative-director',  name: 'Creative Director',     group: 'plan',   icon: '🎯',  blurb: 'Brief → strategy → angle. Picks the cut.' },
  { slug: 'concept-strategist', name: 'Concept Strategist',    group: 'plan',   icon: '🧭',  blurb: 'Brand-level concepts above individual ads.' },
  { slug: 'customer-voice',     name: 'Customer Voice',        group: 'plan',   icon: '👂',  blurb: 'Reviews, pain points, social proof. Verbatim extraction.' },
  { slug: 'customer-rep',       name: 'Customer Rep',          group: 'plan',   icon: '🎧',  blurb: 'Intercom + email + reviews hub. Pre-answer questions; surface trends + product ideas.' },
  { slug: 'audience',           name: 'Audience Segmenter',    group: 'plan',   icon: '🎯',  blurb: 'Define + maintain audience cohorts.' },
  { slug: 'campaign-planner',   name: 'Campaign Planner',      group: 'plan',   icon: '📅',  blurb: 'What ships when, by funnel stage.' },

  // ── Create ──
  { slug: 'copywriter',         name: 'Copywriter',            group: 'create', icon: '✍',   blurb: 'Ad copy, hooks, full scripts.' },
  { slug: 'voiceover-studio',   name: 'Voiceover Studio',      group: 'create', icon: '🎙',  blurb: 'ElevenLabs voiceover from script.' },
  { slug: 'caption-generator',  name: 'Caption Generator',     group: 'create', icon: '💬',  blurb: 'SRT + VTT captions from VO.' },
  { slug: 'image-studio',       name: 'Image Studio',          group: 'create', icon: '🖼',   blurb: 'Text-to-image + seeded variations.' },
  { slug: 'broll-director',     name: 'B-roll Director',       group: 'create', icon: '🎞',  blurb: 'Script broll_shots → AI image batch.' },
  { slug: 'video-studio',       name: 'Video Studio',          group: 'create', icon: '🎬',  blurb: 'Veo text-to-video.' },
  { slug: 'product-video',      name: 'Product Video',         group: 'create', icon: '📦',  blurb: 'Veo seeded with product photos.' },
  { slug: 'product-page',       name: 'Product Page Designer', group: 'create', icon: '📄',  blurb: 'primebroth landing pages.' },
  { slug: 'label-designer',     name: 'Label Designer',        group: 'create', icon: '🏷',  blurb: 'Front-of-pack briefs + image gen.' },
  { slug: 'email-writer',       name: 'Email Sequence Writer', group: 'create', icon: '✉',   blurb: 'Welcome / cart / lapsed / post-purchase.' },
  { slug: 'influencer-brief',   name: 'Influencer Briefs',     group: 'create', icon: '🤝',  blurb: 'Outreach + creator brief packs.' },

  // ── Finish (operations + lifecycle) ──
  { slug: 'kanban',             name: 'Production Kanban',     group: 'finish', icon: '📋',  blurb: 'Your assistant\'s board: To do / In progress / Needs approval / Done.' },
];

export function findAgent(slug) {
  return AGENTS.find((a) => a.slug === slug) || null;
}

export function agentsInGroup(groupId) {
  return AGENTS.filter((a) => a.group === groupId);
}
