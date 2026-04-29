/**
 * biz-agents/_index.js — server-side registry of every biz agent.
 *
 * Currently registered: ONE agent (scripting). Other files in this folder
 * stay unregistered. Re-enable any of them by adding the require + AGENTS
 * entry below.
 */
const scripting = require('./script-writer.js');   // slug: 'scripting'

const AGENTS = [scripting];
const BY_SLUG = Object.fromEntries(AGENTS.map((a) => [a.slug, a]));

function getAgent(slug) { return BY_SLUG[slug] || null; }
function listAgents() { return AGENTS.map((a) => ({ slug: a.slug, name: a.name })); }

module.exports = { AGENTS, getAgent, listAgents };
