/**
 * Agent registry for oso/biz.
 *
 * Slim by design — Curtis was overwhelmed by 18 agents. Down to 3 focused
 * surfaces. Other agent files still exist in the backend (unregistered) so
 * we can re-enable them quickly when Curtis wants more.
 */

export const GROUPS = [
  { id: 'create',  label: 'Create' },
];

export const AGENTS = [
  {
    slug: 'script-writer',
    name: 'Script + Video',
    group: 'create',
    icon: '🎬',
    blurb: 'Script + timeline + voiceover + captions + B-roll stills + video. One agent end-to-end.',
  },
  {
    slug: 'ads-copy',
    name: 'Ads Copy',
    group: 'create',
    icon: '✍',
    blurb: 'Ad text generator: 4-6 headline+body+CTA variants from a brief. Critique + ship.',
  },
  {
    slug: 'image-studio',
    name: 'Image Generator',
    group: 'create',
    icon: '🖼',
    blurb: 'Generate images from text or seed off an existing photo for variations.',
  },
];

export function findAgent(slug) {
  return AGENTS.find((a) => a.slug === slug) || null;
}

export function agentsInGroup(groupId) {
  return AGENTS.filter((a) => a.group === groupId);
}
