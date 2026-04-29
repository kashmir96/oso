/**
 * biz-agents/_index.js — server-side registry of every biz competency agent.
 *
 * Slimmed from 18 to 3 active agents (script-writer, ads-copy, image-studio)
 * — the rest live in this folder unregistered so we can re-enable them
 * quickly.
 */
const scriptWriter   = require('./script-writer.js');
const adsCopy        = require('./ads-copy.js');
const imageStudio    = require('./image-studio.js');

const AGENTS = [scriptWriter, adsCopy, imageStudio];

const BY_SLUG = Object.fromEntries(AGENTS.map((a) => [a.slug, a]));

function getAgent(slug) { return BY_SLUG[slug] || null; }
function listAgents() { return AGENTS.map((a) => ({ slug: a.slug, name: a.name })); }

module.exports = { AGENTS, getAgent, listAgents };
