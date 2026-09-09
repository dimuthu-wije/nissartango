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
const deferrals = [];

// The preconditions this repo cannot check for itself, so a person records
// them instead. Deliberately NOT an environment flag: a flag you are told to
// pass is a keystroke, and this needs to be a decision made once and visible
// in a diff afterwards.
//
// A box is one of three states:
//
//   - [ ]  not done          -> refuses the deploy
//   - [x]  done              -> passes silently
//   - [!]  DEFERRED          -> passes, and shouts about it on every deploy
//
// The deferral exists because "not yet" is sometimes the correct engineering
// answer and pretending otherwise just teaches people to tick boxes. But a
// deferral that looks like a pass is worse than no gate at all, so it costs
// something: three required fields, and an expiry.
// A sentinel rather than `$` in the lookahead: with the /m flag `$` matches
// end-of-LINE, so a lazy body would match nothing and every box would look
// empty — which is exactly what it did, and it failed in the safe direction
// (refusing a valid deferral) only by luck.
const boxes = [...(ops + '\n## __END__\n').matchAll(
  /^- \[([ x!])\] \*\*(.+?)\*\*([\s\S]*?)(?=\n- \[|\n## )/gm)]
  .map(([, state, title, body]) => ({ state, title, body }));

if (!ops) {
  problems.push('workers/cron/OPERATIONS.md is missing. It is the preconditions checklist.');
} else if (!boxes.length) {
  problems.push('workers/cron/OPERATIONS.md has no checklist boxes — it cannot be gating anything.');
} else {
  const unticked = boxes.filter((b) => b.state === ' ');
  if (unticked.length) {
    problems.push(`Unticked in workers/cron/OPERATIONS.md:

${unticked.map((u) => `    - [ ] ${u.title}`).join('\n')}

Do the thing, write down what you did, change [ ] to [x]. If it is genuinely
not going to be done yet, defer it explicitly with [!] rather than ticking it —
the format is documented at the top of that file.`);
  }

  // --- deferrals ----------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const field = (body, name) =>
    (body.match(new RegExp(`^\\s*${name}:\\s*(.+?)\\s*$`, 'm')) ?? [])[1];

  for (const b of boxes.filter((x) => x.state === '!')) {
    const deferred = field(b.body, 'deferred');
    const compensating = field(b.body, 'compensating');
    const review = field(b.body, 'review');
    const iso = /^\d{4}-\d{2}-\d{2}$/;

    const missing = [
      !iso.test(deferred ?? '') && 'deferred: YYYY-MM-DD',
      !compensating && 'compensating: <the control running INSTEAD>',
      !iso.test(review ?? '') && 'review: YYYY-MM-DD',
    ].filter(Boolean);

    if (missing.length) {
      problems.push(`"${b.title}" is deferred with [!] but the record is incomplete.

Missing or malformed:
${missing.map((m) => `    ${m}`).join('\n')}

A deferral without a compensating control is not a deferral, it is an untick
with better handwriting. Fill them in or set the box back to [ ].`);
      continue;
    }

    if (review < today) {
      problems.push(`"${b.title}" was deferred on ${deferred} for review by ${review}.

That date has passed (today is ${today}).

This is the point of the review date: a deferral that never expires is a
decision nobody revisits. Either do the thing and tick the box, or extend the
date deliberately — as a visible edit to OPERATIONS.md, which is a diff someone
can question.`);
      continue;
    }

    deferrals.push({ ...b, deferred, compensating, review });
  }
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

if (deferrals.length) {
  const bar = '='.repeat(72);
  console.log(`\n${bar}`);
  console.log(`DEPLOYING WITH ${deferrals.length} PRECONDITION(S) DEFERRED — NOT SATISFIED`);
  console.log(bar);
  for (const d of deferrals) {
    console.log(`\n  ${d.title}`);
    console.log(`    deferred on   ${d.deferred}`);
    console.log(`    instead:      ${d.compensating}`);
    console.log(`    review by     ${d.review}`);
  }
  console.log(`\n  These are gaps, not decisions that went away. If the compensating`);
  console.log(`  control above is not actually running, stop and fix that first —`);
  console.log(`  nothing here can check it for you.`);
  console.log(`${bar}\n`);
}

console.log('[cron] config ok');
