/**
 * biz-agents/_index.js — server-side registry of every biz competency agent.
 *
 * Each entry exports:
 *   slug          — string, matches the URL slug + frontend registry
 *   name          — display name
 *   model?        — Anthropic model id, defaults to claude-haiku-4-5
 *   max_tokens?   — output cap, defaults 800
 *   system_prompt — string, the agent's persona + instructions
 *   tools         — array of tool names from _lib/ckf-tools.js TOOLS
 *
 * Sub-agent files live alongside this index and are imported below. New
 * agents = drop a file in this folder + add it to AGENTS.
 */
const brandVoice         = require('./brand-voice.js');
const creativeDirector   = require('./creative-director.js');
const conceptStrategist  = require('./concept-strategist.js');
const customerVoice      = require('./customer-voice.js');
const customerRep        = require('./customer-rep.js');
const audience           = require('./audience.js');
const campaignPlanner    = require('./campaign-planner.js');
const copywriter         = require('./copywriter.js');
const voiceoverStudio    = require('./voiceover-studio.js');
const captionGenerator   = require('./caption-generator.js');
const imageStudio        = require('./image-studio.js');
const brollDirector      = require('./broll-director.js');
const videoStudio        = require('./video-studio.js');
const productVideo       = require('./product-video.js');
const productPage        = require('./product-page.js');
const labelDesigner      = require('./label-designer.js');
const emailWriter        = require('./email-writer.js');
const influencerBrief    = require('./influencer-brief.js');

const AGENTS = [
  brandVoice, creativeDirector, conceptStrategist, customerVoice, customerRep, audience, campaignPlanner,
  copywriter, voiceoverStudio, captionGenerator, imageStudio, brollDirector, videoStudio,
  productVideo, productPage, labelDesigner, emailWriter, influencerBrief,
];

const BY_SLUG = Object.fromEntries(AGENTS.map((a) => [a.slug, a]));

function getAgent(slug) { return BY_SLUG[slug] || null; }

function listAgents() {
  return AGENTS.map((a) => ({ slug: a.slug, name: a.name }));
}

module.exports = { AGENTS, getAgent, listAgents };
