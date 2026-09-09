/**
 * The notifier, exercised without Cloudflare.
 *
 * The event fixtures below are Cloudflare's DOCUMENTED payloads, copied from
 * the Workers Builds event-subscriptions reference rather than invented. The
 * previous draft of this notifier guessed the shape; a notifier that reads the
 * wrong field sends a blank email, or none, and nobody finds out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { composeFailureEmail, duration } from '../src/index.mjs';

const FAILED_EVENT = {
  type: 'cf.workersBuilds.worker.build.failed',
  source: { type: 'workersBuilds.worker', workerName: 'nissartango' },
  payload: {
    buildUuid: 'build-12345678-90ab-cdef-1234-567890abcdef',
    status: 'failed',
    buildOutcome: 'failure',
    createdAt: '2025-05-01T02:48:57.132Z',
    initializingAt: '2025-05-01T02:48:58.132Z',
    runningAt: '2025-05-01T02:48:59.132Z',
    stoppedAt: '2025-05-01T02:50:00.132Z',
    buildTriggerMetadata: {
      buildTriggerSource: 'push_event', branch: 'main',
      commitHash: 'abc123def456', commitMessage: 'Fix bug in authentication',
      author: 'developer@example.com', buildCommand: 'npm run build',
      deployCommand: 'wrangler deploy', rootDirectory: '/',
      repoName: 'nissartango', providerAccountName: 'dimuthu-wije', providerType: 'github',
    },
  },
  metadata: { accountId: 'f9f7…', eventSubscriptionId: '1830…', eventSchemaVersion: 1,
              eventTimestamp: '2025-05-01T02:48:57.132Z' },
};
const ok = (type) => ({ ...FAILED_EVENT, type,
  payload: { ...FAILED_EVENT.payload, status: 'success', buildOutcome: 'success' } });

const ENV = { NOTIFY_TO: 'dimuthu.wije@outlook.com', NOTIFY_FROM: 'builds@nissartango.fr' };

function fakeBatch(events, { sendImpl } = {}) {
  const sent = [];
  const messages = events.map((body) => ({
    body, acked: false, retried: false,
    ack() { this.acked = true; }, retry() { this.retried = true; },
  }));
  const env = { ...ENV, EMAIL: { async send(m) { sent.push(m); if (sendImpl) return sendImpl(m); } } };
  return { batch: { messages }, env, sent, messages };
}

// --- composition -----------------------------------------------------------

test('the email reads the documented fields, not invented ones', () => {
  const m = composeFailureEmail(FAILED_EVENT, ENV);
  assert.equal(m.to, 'dimuthu.wije@outlook.com');
  assert.equal(m.from, 'builds@nissartango.fr');
  assert.match(m.subject, /^\[nissartango\] build FAILED on main — Fix bug in authentication$/);
  for (const needle of ['main', 'abc123def456', 'developer@example.com',
                        'build-12345678-90ab-cdef-1234-567890abcdef', 'npm run build', 'failure']) {
    assert.ok(m.text.includes(needle), `body should mention ${needle}`);
  }
});

test('the body says what is now true, not just that something broke', () => {
  const m = composeFailureEmail(FAILED_EVENT, ENV);
  assert.match(m.text, /previous deployment is still serving/);
  assert.match(m.text, /content changes are NOT reaching the site/);
  assert.match(m.text, /30 -> 60 -> 120 -> 240 -> 360/);
});

test('a build with missing metadata still produces a sendable email', () => {
  const m = composeFailureEmail({ type: 'x', payload: {} }, ENV);
  assert.ok(m.subject.length > 0);
  assert.ok(m.text.includes('—'), 'missing fields render as a dash rather than undefined');
  assert.ok(!m.text.includes('undefined'));
});

test('duration formats, and refuses nonsense rather than inventing a number', () => {
  assert.equal(duration('2025-05-01T02:48:59.132Z', '2025-05-01T02:50:00.132Z'), '1m 01s');
  assert.equal(duration('2025-05-01T02:48:59.132Z', '2025-05-01T02:49:12.132Z'), '13s');
  assert.equal(duration(undefined, '2025-05-01T02:50:00.132Z'), null);
  assert.equal(duration('2025-05-01T02:50:00.132Z', '2025-05-01T02:48:00.132Z'), null);
});

// --- the queue handler -----------------------------------------------------

test('a failed build sends exactly one email and acks', async () => {
  const { batch, env, sent, messages } = fakeBatch([FAILED_EVENT]);
  await worker.queue(batch, env, {});
  assert.equal(sent.length, 1);
  assert.equal(messages[0].acked, true);
  assert.equal(messages[0].retried, false);
});

test('SUCCESS sends nothing — green mail would train the reader to filter', async () => {
  const { batch, env, sent, messages } = fakeBatch([ok('cf.workersBuilds.worker.build.succeeded')]);
  await worker.queue(batch, env, {});
  assert.equal(sent.length, 0);
  assert.equal(messages[0].acked, true, 'and it is acked, not left to retry forever');
});

test('started and canceled send nothing, and are acked', async () => {
  for (const t of ['cf.workersBuilds.worker.build.started', 'cf.workersBuilds.worker.build.canceled']) {
    const { batch, env, sent, messages } = fakeBatch([ok(t)]);
    await worker.queue(batch, env, {});
    assert.equal(sent.length, 0, `${t} must not email`);
    assert.equal(messages[0].acked, true, `${t} must be acked`);
  }
});

test('a malformed message is acked rather than poisoning the queue', async () => {
  const { batch, env, sent, messages } = fakeBatch([null, { nope: true }]);
  await worker.queue(batch, env, {});
  assert.equal(sent.length, 0);
  assert.ok(messages.every((m) => m.acked));
});

// --- the part the previous draft got wrong ---------------------------------

test('a failed send is NOT acked, IS retried, and THROWS', async () => {
  const err = Object.assign(new Error('recipient not allowed'), { code: 'E_RECIPIENT_NOT_ALLOWED' });
  const { batch, env, messages } = fakeBatch([FAILED_EVENT], { sendImpl: () => { throw err; } });
  await assert.rejects(() => worker.queue(batch, env, {}), /recipient not allowed/);
  assert.equal(messages[0].acked, false, 'acking a failed send loses the notification silently');
  assert.equal(messages[0].retried, true);
});

test('a rate-limited send retries rather than being dropped', async () => {
  const err = Object.assign(new Error('slow down'), { code: 'E_RATE_LIMIT_EXCEEDED' });
  const { batch, env, messages } = fakeBatch([FAILED_EVENT], { sendImpl: () => { throw err; } });
  await assert.rejects(() => worker.queue(batch, env, {}));
  assert.equal(messages[0].retried, true);
});

test('the binding is pinned to one recipient in wrangler.jsonc', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(cfg.send_email[0].destination_address, 'dimuthu.wije@outlook.com',
    'destination_address pins the binding at the platform level, so a bug here cannot mail anyone else');
  assert.equal(cfg.queues.consumers[0].dead_letter_queue, 'nissartango-build-events-dlq',
    'without a DLQ a permanently-failing send is discarded after the last retry');
  assert.equal(cfg.queues.consumers[0].max_batch_size, 1);
});
