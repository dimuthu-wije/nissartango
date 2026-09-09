/**
 * The reconciliation loop, exercised without Cloudflare.
 *   npm test
 *
 * These are not ceremony: every failure mode here is silent by nature. A
 * keep-alive that quietly stops working looks exactly like one that works,
 * right up until the project pauses and has to be resumed by hand. A cooldown
 * that quietly stops working looks exactly like one that works, right up
 * until the month's build minutes are gone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {
  readDatabaseChecksum, readDeployedChecksum, triggerRebuild,
  cooldownVerdict, projectRef, DAILY_CRON, POLL_CRON,
} from '../src/index.mjs';

const HOOK = 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/abc';

const jsonRes = (body, status = 200) => ({
  ok: status < 400, status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const DB_ROW = { checksum: 'aaaa', n_events: 4, n_organizers: 3, n_exceptions: 1 };
const REF = 'example';   // matches SUPABASE_URL below

/** A KV namespace that lives in a Map, and remembers what it was asked. */
function fakeKV(initial = null) {
  const store = new Map();
  if (initial) store.set('rebuild:last', JSON.stringify(initial));
  return {
    puts: [],
    async get(k) { const v = store.get(k); return v ? JSON.parse(v) : null; },
    async put(k, v) { store.set(k, v); this.puts.push(JSON.parse(v)); },
  };
}

/**
 * Stub global fetch, since scheduled() calls it directly -- which is the
 * point: these tests exercise the handler the platform actually invokes, not
 * a hand-wired version of it.
 */
function withFetch(handlers, fn) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', init });
    for (const [match, res] of handlers) {
      if (String(url).includes(match)) return typeof res === 'function' ? res() : res;
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return (async () => {
    try { return await fn(calls); } finally { globalThis.fetch = real; }
  })();
}

const env = (over = {}) => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_test',
  SITE_URL: 'https://nissartango.fr',
  DEPLOY_HOOK_URL: HOOK,
  REBUILD_STATE: fakeKV(),
  ...over,
});

const hookPosts = (calls) => calls.filter((c) => c.url.startsWith(HOOK));

// --- the two reads ---------------------------------------------------------

test('the database read uses the public view and the public key', async () => {
  await withFetch([['content_checksum', jsonRes([DB_ROW])]], async (calls) => {
    const row = await readDatabaseChecksum(env());
    assert.equal(row.checksum, 'aaaa');
    assert.match(calls[0].url, /\/rest\/v1\/content_checksum\?select=\*$/);
    assert.equal(calls[0].init.headers.apikey, 'sb_publishable_test');
  });
});

test('a database read with no checksum is an error, not a null comparison', async () => {
  await withFetch([['content_checksum', jsonRes([{}])]], async () => {
    await assert.rejects(() => readDatabaseChecksum(env()), /no checksum/);
  });
});

test('build-info.json is fetched uncacheably', async () => {
  await withFetch([['build-info.json', jsonRes({ checksum: 'bbbb' })]], async (calls) => {
    const live = await readDeployedChecksum(env());
    assert.equal(live.checksum, 'bbbb');
    assert.equal(calls[0].init.cache, 'no-store');
    assert.match(calls[0].url, /build-info\.json\?t=\d+/);
  });
});

test('a missing build-info.json reads as drift, not as a crash', async () => {
  await withFetch([['build-info.json', jsonRes({}, 404)]], async () => {
    const live = await readDeployedChecksum(env());
    assert.equal(live.checksum, null);
    assert.match(live.reason, /404/);
  });
});

// --- the policy, in isolation ---------------------------------------------

test('a new checksum fires immediately, however recent the last trigger', () => {
  const v = cooldownVerdict({ at: Date.now() - 1000, checksum: 'old', attempts: 3 }, 'new', Date.now());
  assert.equal(v.fire, true);
  assert.equal(v.attempts, 1);
});

test('the same checksum still drifting waits, then backs off further', () => {
  const now = Date.now();
  const min = (n) => n * 60_000;

  // First repeat: 30 minutes.
  assert.equal(cooldownVerdict({ at: now - min(29), checksum: 'a', attempts: 1 }, 'a', now).fire, false);
  const second = cooldownVerdict({ at: now - min(31), checksum: 'a', attempts: 1 }, 'a', now);
  assert.equal(second.fire, true);
  assert.equal(second.attempts, 2);

  // Second repeat: 60, not 30.
  assert.equal(cooldownVerdict({ at: now - min(31), checksum: 'a', attempts: 2 }, 'a', now).fire, false);
  assert.equal(cooldownVerdict({ at: now - min(61), checksum: 'a', attempts: 2 }, 'a', now).fire, true);

  // And it caps rather than growing without bound.
  assert.equal(cooldownVerdict({ at: now - min(361), checksum: 'a', attempts: 99 }, 'a', now).fire, true);
  assert.equal(cooldownVerdict({ at: now - min(359), checksum: 'a', attempts: 99 }, 'a', now).fire, false);
});

test('no memory at all means fire — a lost KV costs one build, not silence', () => {
  assert.equal(cooldownVerdict(null, 'a', Date.now()).fire, true);
});

// --- the loop --------------------------------------------------------------

test('no drift: the database is read, nothing is deployed', async () => {
  await withFetch([
    ['content_checksum', jsonRes([DB_ROW])],
    ['build-info.json', jsonRes({ checksum: 'aaaa', project_ref: REF })],
  ], async (calls) => {
    await worker.scheduled({ cron: POLL_CRON }, env(), {});
    assert.equal(hookPosts(calls).length, 0);
    assert.ok(calls.some((c) => c.url.includes('content_checksum')), 'keep-alive still ran');
  });
});

test('drift: the deploy hook is POSTed and the attempt is recorded', async () => {
  const kv = fakeKV();
  await withFetch([
    ['content_checksum', jsonRes([DB_ROW])],
    ['build-info.json', jsonRes({ checksum: 'stale', project_ref: REF })],
    [HOOK, jsonRes({ success: true, result: { build_uuid: 'b1' } })],
  ], async (calls) => {
    await worker.scheduled({ cron: POLL_CRON }, env({ REBUILD_STATE: kv }), {});
    assert.equal(hookPosts(calls).length, 1);
    assert.equal(hookPosts(calls)[0].method, 'POST');
    assert.equal(kv.puts.at(-1).checksum, 'aaaa');
    assert.equal(kv.puts.at(-1).attempts, 1);
  });
});

test('a failing build does not re-fire every ten minutes', async () => {
  const kv = fakeKV({ at: Date.now() - 60_000, checksum: 'aaaa', attempts: 1 });
  await withFetch([
    ['content_checksum', jsonRes([DB_ROW])],
    ['build-info.json', jsonRes({ checksum: 'stale', project_ref: REF })],
    [HOOK, jsonRes({ success: true, result: { build_uuid: 'b2' } })],
  ], async (calls) => {
    await worker.scheduled({ cron: POLL_CRON }, env({ REBUILD_STATE: kv }), {});
    assert.equal(hookPosts(calls).length, 0, 'held off by the cooldown');
    assert.equal(kv.puts.length, 0);
  });
});

test('but new content published during that cooldown is not made to wait', async () => {
  const kv = fakeKV({ at: Date.now() - 60_000, checksum: 'aaaa', attempts: 3 });
  await withFetch([
    ['content_checksum', jsonRes([{ ...DB_ROW, checksum: 'cccc' }])],
    ['build-info.json', jsonRes({ checksum: 'aaaa', project_ref: REF })],
    [HOOK, jsonRes({ success: true, result: { build_uuid: 'b3' } })],
  ], async (calls) => {
    await worker.scheduled({ cron: POLL_CRON }, env({ REBUILD_STATE: kv }), {});
    assert.equal(hookPosts(calls).length, 1);
    assert.equal(kv.puts.at(-1).attempts, 1, 'the backoff resets with the checksum');
  });
});

test('the daily rebuild ignores both the drift check and the cooldown', async () => {
  const kv = fakeKV({ at: Date.now(), checksum: 'aaaa', attempts: 5 });
  await withFetch([
    ['content_checksum', jsonRes([DB_ROW])],
    [HOOK, jsonRes({ success: true, result: { build_uuid: 'b4' } })],
  ], async (calls) => {
    await worker.scheduled({ cron: DAILY_CRON }, env({ REBUILD_STATE: kv }), {});
    assert.equal(hookPosts(calls).length, 1);
    assert.ok(!calls.some((c) => c.url.includes('build-info.json')), 'no drift check needed');
  });
});

test('an unreachable database fails loudly and deploys nothing', async () => {
  await withFetch([
    ['content_checksum', jsonRes({ message: 'paused' }, 503)],
  ], async (calls) => {
    await assert.rejects(() => worker.scheduled({ cron: POLL_CRON }, env(), {}));
    assert.equal(hookPosts(calls).length, 0);
  });
});

test('an unreachable database still lets the daily rebuild through', async () => {
  await withFetch([
    ['content_checksum', jsonRes({ message: 'paused' }, 503)],
    [HOOK, jsonRes({ success: true, result: { build_uuid: 'b5' } })],
  ], async (calls) => {
    await assert.rejects(() => worker.scheduled({ cron: DAILY_CRON }, env(), {}));
    assert.equal(hookPosts(calls).length, 1, 'attempted before the error was rethrown');
  });
});

test('an unreachable site reads as drift rather than skipping the check', async () => {
  await withFetch([
    ['content_checksum', jsonRes([DB_ROW])],
    ['build-info.json', () => { throw new Error('ENOTFOUND'); }],
    [HOOK, jsonRes({ success: true, result: { build_uuid: 'b6' } })],
  ], async (calls) => {
    await worker.scheduled({ cron: POLL_CRON }, env(), {});
    assert.equal(hookPosts(calls).length, 1);
  });
});

test('a deploy hook that refuses is an error, not a silent success', async () => {
  await withFetch([
    ['content_checksum', jsonRes([DB_ROW])],
    ['build-info.json', jsonRes({ checksum: 'stale', project_ref: REF })],
    [HOOK, jsonRes({ success: false, errors: ['nope'] })],
  ], async () => {
    await assert.rejects(() => worker.scheduled({ cron: POLL_CRON }, env(), {}), /deploy hook failed/);
  });
});

test('a missing DEPLOY_HOOK_URL says which command sets it', async () => {
  await withFetch([['content_checksum', jsonRes([DB_ROW])]], async () => {
    await assert.rejects(() => triggerRebuild(env({ DEPLOY_HOOK_URL: '' })), /wrangler secret put/);
  });
});


// --- the project-ref guard -------------------------------------------------

test('a project ref is read off the URL, local stacks included', () => {
  assert.equal(projectRef('https://eqcgeqzzuzcwrflwasjo.supabase.co'), 'eqcgeqzzuzcwrflwasjo');
  assert.equal(projectRef('http://127.0.0.1:54321'), 'local');
  assert.equal(projectRef('nonsense'), 'unknown');
});

test('a site built from another project stops the loop instead of driving it', async () => {
  await withFetch([
    ['content_checksum', jsonRes([DB_ROW])],
    ['build-info.json', jsonRes({ checksum: 'stale', project_ref: 'someotherproject' })],
    [HOOK, jsonRes({ success: true, result: { build_uuid: 'nope' } })],
  ], async (calls) => {
    await assert.rejects(
      () => worker.scheduled({ cron: POLL_CRON }, env(), {}),
      /project mismatch: this Worker reads example, but the deployed site was built from someotherproject/);
    assert.equal(hookPosts(calls).length, 0,
      'a mismatch must never fire the deploy hook — that is the permanent-drift burn');
  });
});

test('a build-info.json with no project_ref is tolerated, not treated as a mismatch', async () => {
  await withFetch([
    ['content_checksum', jsonRes([DB_ROW])],
    ['build-info.json', jsonRes({ checksum: 'stale' })],
    [HOOK, jsonRes({ success: true, result: { build_uuid: 'b7' } })],
  ], async (calls) => {
    await worker.scheduled({ cron: POLL_CRON }, env(), {});
    assert.equal(hookPosts(calls).length, 1, 'deployments predating the field still reconcile');
  });
});

test('the crons in the code match the crons in wrangler.jsonc', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const crons = [...raw.matchAll(/"((?:\*|\d)[^"]*\*[^"]*)"/g)].map((m) => m[1]);
  assert.ok(crons.includes(DAILY_CRON), `wrangler.jsonc is missing ${DAILY_CRON}`);
  assert.ok(crons.includes(POLL_CRON), `wrangler.jsonc is missing ${POLL_CRON}`);
});
