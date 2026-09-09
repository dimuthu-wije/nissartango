/**
 * nissartango-build-notifier — email when a Workers build FAILS.
 *
 * This is the component the rebuild poller's entire safety story rests on.
 * The poller's failure mode is: a build fails, drift persists, the cooldown
 * quietly retries at 30 -> 60 -> 120 -> 240 -> 360 minutes, and none of it is
 * visible from outside because the previous deployment keeps serving a
 * correct-looking site. The loop is designed to be quiet when nothing is
 * wrong, which means it is also quiet when everything is wrong.
 *
 * WHERE THE EVENTS COME FROM. Workers Builds "event subscriptions" publish
 * build lifecycle events to a Queue; this Worker is that queue's consumer.
 * The payload shape below is Cloudflare's documented one, not a guess:
 *
 *   type     cf.workersBuilds.worker.build.{started,succeeded,failed,canceled}
 *   source   { type, workerName }
 *   payload  { buildUuid, status, buildOutcome, createdAt, initializingAt,
 *              runningAt, stoppedAt, buildTriggerMetadata: { branch,
 *              commitHash, commitMessage, author, buildCommand, repoName, … } }
 *   metadata { accountId, eventSubscriptionId, eventSchemaVersion, eventTimestamp }
 *
 * HOW IT SENDS. Cloudflare Email Routing's send_email binding. No third party,
 * no API key to rotate or leak, and nothing to be terminated underneath us --
 * which is what happened to MailChannels' free Workers endpoint on 31 August
 * 2024. A notifier built on that now posts into a void.
 *
 * FAILURES ONLY. With the poller running every ten minutes, green mail would
 * train the reader to filter the channel, and a filtered channel is the same
 * as no channel on the day it matters.
 *
 * ITS OWN FAILURE IS NOT SILENT. A send that throws is NOT acked: the message
 * retries, the invocation is marked failed so it appears in observability, and
 * after max_retries the message lands in the dead-letter queue rather than
 * disappearing. console.error alone -- the previous draft's only handling --
 * is indistinguishable from success.
 */

const FAILED = 'cf.workersBuilds.worker.build.failed';

/** ISO timestamps -> "1m 03s", or null when either end is missing. */
export function duration(from, to) {
  const a = Date.parse(from ?? ''), b = Date.parse(to ?? '');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  const s = Math.round((b - a) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** The email for one failed-build event. Pure, so it is testable without a network. */
export function composeFailureEmail(ev, env) {
  const p = ev?.payload ?? {};
  const m = p.buildTriggerMetadata ?? {};
  const worker = ev?.source?.workerName ?? 'unknown worker';
  const subjectLine = (m.commitMessage ?? '').split('\n')[0].slice(0, 80);
  const took = duration(p.runningAt ?? p.createdAt, p.stoppedAt);

  const lines = [
    `Build FAILED for ${worker}.`,
    '',
    `  branch     ${m.branch ?? '—'}`,
    `  commit     ${(m.commitHash ?? '').slice(0, 12) || '—'}${subjectLine ? `  ${subjectLine}` : ''}`,
    `  author     ${m.author ?? '—'}`,
    `  repo       ${m.repoName ?? '—'}`,
    `  trigger    ${m.buildTriggerSource ?? '—'}`,
    `  command    ${m.buildCommand ?? '—'}`,
    took ? `  ran for    ${took}` : null,
    `  build id   ${p.buildUuid ?? '—'}`,
    `  outcome    ${p.buildOutcome ?? p.status ?? '—'}`,
    '',
    'The previous deployment is still serving. That is correct, and it is also',
    'why this failure is invisible from the outside — the site looks fine.',
    '',
    'What is now true until this is fixed:',
    '  * content changes are NOT reaching the site',
    '  * the ten-minute poller sees drift it cannot clear, and backs off',
    '    30 -> 60 -> 120 -> 240 -> 360 minutes between attempts',
    '',
    'Logs: Cloudflare dashboard -> Workers & Pages -> ' + worker + ' -> Builds,',
    `and find build ${p.buildUuid ?? ''}`.trimEnd(),
  ].filter((l) => l !== null);

  return {
    to: env.NOTIFY_TO,
    from: env.NOTIFY_FROM,
    subject: `[nissartango] build FAILED on ${m.branch ?? '?'}${subjectLine ? ` — ${subjectLine}` : ''}`,
    text: lines.join('\n') + '\n',
  };
}

export default {
  async queue(batch, env, _ctx) {
    let firstError = null;

    for (const msg of batch.messages) {
      const ev = msg.body;

      // Everything that is not a failure is acknowledged and dropped. Acking
      // matters: an un-acked message retries, and retrying a successful build
      // forever would be a slow way to spend the free-tier queue allowance.
      if (ev?.type !== FAILED) {
        console.log(`ignoring ${ev?.type ?? 'a message with no type'}`);
        msg.ack();
        continue;
      }

      try {
        await env.EMAIL.send(composeFailureEmail(ev, env));
        console.log(`notified: build ${ev.payload?.buildUuid} on ${ev.payload?.buildTriggerMetadata?.branch}`);
        msg.ack();
      } catch (err) {
        // Deliberately NOT acked. `.code` is set for E_SENDER_NOT_VERIFIED,
        // E_RECIPIENT_NOT_ALLOWED, E_RATE_LIMIT_EXCEEDED and friends -- the
        // first two are configuration errors that will never succeed on retry,
        // so they need to reach a human via the dead-letter queue rather than
        // spin. Retrying is still right: this Worker cannot tell a permanent
        // misconfiguration from a transient one, and dropping is worse.
        console.error(`SEND FAILED (${err?.code ?? 'no code'}): ${err?.message ?? err}`);
        msg.retry();
        firstError ??= err;
      }
    }

    // Throwing marks the invocation failed, which is what makes it visible in
    // observability and alertable. Without this, a notifier that can no longer
    // send looks exactly like one with nothing to say.
    if (firstError) throw firstError;
  },
};
