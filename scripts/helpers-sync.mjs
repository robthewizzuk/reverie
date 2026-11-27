// Sets up Reverie's helpers on your Anthropic account, or brings them up to date: the one helper agent and the one
// environment its sandboxes run in (both defined in server/helper-agent.js). Safe to run again and again: it finds what
// it made before (by its metadata) and updates it in place, which only makes a new version when something changed.
// The Worker never creates these itself; it only starts sessions on them.
//
//   ANTHROPIC_API_KEY=... node scripts/helpers-sync.mjs            prints the two ids to put in .env.local
//   ... node scripts/helpers-sync.mjs --github-output             (the deploy workflow) writes them to $GITHUB_OUTPUT
import { appendFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { HELPER_AGENT, HELPER_ENVIRONMENT, HELPER_APP } from '../server/helper-agent.js';

if (!process.env.ANTHROPIC_API_KEY) { console.error('Set ANTHROPIC_API_KEY first.'); process.exit(1); }
const client = new Anthropic();
const mine = x => x?.metadata?.app === HELPER_APP && !x.archived_at;

async function find(list) { for await (const x of list) if (mine(x)) return x; return null; }

let agent = await find(client.beta.agents.list({ limit: 100 }));
if (agent) {
  const was = agent.version;
  agent = await client.beta.agents.update(agent.id, { ...HELPER_AGENT, multiagent: null, version: agent.version });
  console.error(agent.version === was ? `Helper agent ${agent.id} is up to date (version ${agent.version}).` : `Updated the helper agent ${agent.id} to version ${agent.version}.`);
} else {
  agent = await client.beta.agents.create(HELPER_AGENT);
  console.error(`Made the helper agent ${agent.id}.`);
}

let env = await find(client.beta.environments.list({ limit: 100 }));
if (env) {
  env = await client.beta.environments.update(env.id, { description: HELPER_ENVIRONMENT.description, config: HELPER_ENVIRONMENT.config });
  console.error(`Helper environment ${env.id} is up to date.`);
} else {
  env = await client.beta.environments.create(HELPER_ENVIRONMENT);
  console.error(`Made the helper environment ${env.id}.`);
}

const lines = `REVERIE_HELPER_AGENT_ID=${agent.id}\nREVERIE_HELPER_ENV_ID=${env.id}\n`;
if (process.argv.includes('--github-output') && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.replace(/REVERIE_HELPER_(AGENT|ENV)_ID/g, (_, k) => k.toLowerCase()));
process.stdout.write(lines);
