#!/usr/bin/env node
/**
 * Refuse to deploy the Worker with an unfilled placeholder in its config.
 *
 * A committed placeholder has already cost this project one broken deploy
 * (.wrangler/deploy/config.json, pointing at a path the build no longer
 * produced). A KV binding with a fake id is worse than that one: it deploys
 * cleanly and fails at 03:00, silently, as a rebuild that never fires.
 */
import { readFile } from 'node:fs/promises';

const raw = await readFile(new URL('../workers/cron/wrangler.jsonc', import.meta.url), 'utf8');
const ops = await readFile(new URL('../workers/cron/OPERATIONS.md', import.meta.url), 'utf8')
  .catch(() => '');

const problems = [];

// The preconditions this repo cannot check for itself, so a person records
// them instead. Deliberately NOT an environment flag: a flag you are told to
// pass is a keystroke, and this needs to be a decision made once and visible
// in a diff afterwards.
const unticked = [...ops.matchAll(/^- \[ \] \*\*(.+?)\*\*/gm)].map((m) => m[1]);
if (!ops) {
  problems.push('workers/cron/OPERATIONS.md is missing. It is the preconditions checklist.');
} else if (unticked.length) {
  problems.push(`Unticked in workers/cron/OPERATIONS.md:

${unticked.map((u) => `    - [ ] ${u}`).join('\n')}

Do the thing, write down what you did, change [ ] to [x]. The first of these
is build-failure notifications, and it is not paperwork: this Worker's failure
mode is a build that fails while the previous deployment keeps serving, which
is invisible from outside. The alert is the only thing that makes it visible.`);
}
if (raw.includes('PASTE_THE_KV_NAMESPACE_ID_HERE')) {
  problems.push(`The REBUILD_STATE namespace id is still a placeholder. Create it once:

    npx wrangler kv namespace create REBUILD_STATE

then paste the id it prints into workers/cron/wrangler.jsonc.`);
}
if (/sb_secret_|service_role/.test(raw)) {
  problems.push('wrangler.jsonc contains a secret key. Only the publishable key belongs in vars.');
}

if (problems.length) {
  console.error(`\n[cron] DEPLOY STOPPED\n\n${problems.join('\n\n')}\n`);
  process.exit(1);
}
console.log('[cron] config ok');
