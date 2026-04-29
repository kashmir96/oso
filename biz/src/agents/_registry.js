/**
 * Agent registry for oso/biz — currently ONE agent only.
 *
 * Other agent files in netlify/functions/_lib/biz-agents/ stay
 * unregistered until we re-introduce them.
 */

export const GROUPS = [
  { id: 'create', label: 'Create' },
];

export const AGENTS = [
  {
    slug: 'scripting',
    name: 'Scripting',
    group: 'create',
    icon: '📝',
    blurb: 'Script writer + (optional) timeline + voiceover + b-roll + video.',
    quickPoints: [
      "Walk you through brief → strategy → outline → hooks → draft as editable cards",
      "Pull context from a landing URL you paste (just drop the link)",
      "Critique the draft for brand register + locked decisions before you ship",
      "After approval, ask if you want a full timeline (VO + B-roll stills + Veo video clips)",
      "Capture what you tweak so the next script generation learns from your taste",
    ],
  },
];

export function findAgent(slug) {
  return AGENTS.find((a) => a.slug === slug) || null;
}

export function agentsInGroup(groupId) {
  return AGENTS.filter((a) => a.group === groupId);
}
