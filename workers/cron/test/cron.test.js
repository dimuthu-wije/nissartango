/**
 * The scheduled handler, exercised without Cloudflare.
 *   npm run test:cron
 *
 * These are not ceremony: the failure modes here are silent by nature. A
 * keep-alive that quietly stops working looks exactly like one that works,
 * right up until the project pauses and has to be resumed by hand.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { keepAlive, triggerRebuild } from '../src/index.mjs';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_test',
  DEPLOY_HOOK_URL: 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/abc',
};

const jsonRes = (body, status = 200) => ({
  ok: status < 400, status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function recorder(handlers) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {} });
    for (const [match, res] of handlers) if (url.includes(match)) return res;
    throw new Error(`unexpected fetch: ${url}`);
  };
  f.calls = calls;
  return f;
}

test('keep-alive reads the public view with the public key', async () => {
  const f = recorder([['events_public', jsonRes([{ id: 'x' }])]]);
  const r = await keepAlive(ENV, f);
  assert.equal(r.ok, true);
  assert.match(f.calls[0].url, /\/rest\/v1\/events_public\?select=id&limit=1$/);
  assert.equal(f.calls[0].headers.apikey, 'sb_publishable_test');
  assert.equal(f.calls[0].method, 'GET', 'a read, nothing more');
});

test('keep-alive throws loudly rather than passing silently', async () => {
  const f = recorder([['events_public', jsonRes({ message: 'no' }, 401)]]);
  await assert.rejects(() => keepAlive(ENV, f), /keep-alive failed: 401/);
});

test('the deploy hook is POSTed with no auth header', async () => {
  const f = recorder([['deploy_hooks', jsonRes({ success: true, result: { build_uuid: 'b1' } })]]);
  const r = await triggerRebuild(ENV, f);
  assert.equal(r.build, 'b1');
  assert.equal(f.calls[0].method, 'POST');
  assert.deepEqual(f.calls[0].headers, {}, 'the id in the URL is the credential');
});

test('a build already in flight is reported, not treated as an error', async () => {
  const f = recorder([['deploy_hooks',
    jsonRes({ success: true, result: { build_uuid: 'b1', already_exists: true } })]]);
  const r = await triggerRebuild(ENV, f);
  assert.equal(r.alreadyRunning, true);
});

test('a missing deploy hook secret is named, not shrugged off', async () => {
  await assert.rejects(() => triggerRebuild({ ...ENV, DEPLOY_HOOK_URL: undefined }, recorder([])),
    /DEPLOY_HOOK_URL is not set/);
});

// --- the scheduled handler, which is where the wiring can go wrong ----------
function stubGlobalFetch(handlers) {
  const f = recorder(handlers);
  const original = globalThis.fetch;
  globalThis.fetch = f;
  return { f, restore: () => { globalThis.fetch = original; } };
}

test('the 03:15 cron keeps alive AND rebuilds', async () => {
  const { f, restore } = stubGlobalFetch([
    ['events_public', jsonRes([{ id: 'x' }])],
    ['deploy_hooks', jsonRes({ success: true, result: { build_uuid: 'b1' } })],
  ]);
  await worker.scheduled({ cron: '15 3 * * *' }, ENV, {});
  restore();
  assert.deepEqual(f.calls.map((c) => c.method), ['GET', 'POST']);
});

test('the 09:15 cron only keeps alive', async () => {
  const { f, restore } = stubGlobalFetch([['events_public', jsonRes([{ id: 'x' }])]]);
  await worker.scheduled({ cron: '15 9 * * *' }, ENV, {});
  restore();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, 'GET');
});

test('a failing deploy hook does NOT skip the keep-alive', async () => {
  const { f, restore } = stubGlobalFetch([
    ['events_public', jsonRes([{ id: 'x' }])],
    ['deploy_hooks', jsonRes({ success: false }, 500)],
  ]);
  await assert.rejects(() => worker.scheduled({ cron: '15 3 * * *' }, ENV, {}));
  restore();
  assert.equal(f.calls[0].url.includes('events_public'), true,
    'the keep-alive ran first and completed');
});

test('a failing keep-alive does NOT skip the rebuild', async () => {
  const { f, restore } = stubGlobalFetch([
    ['events_public', jsonRes({ message: 'down' }, 503)],
    ['deploy_hooks', jsonRes({ success: true, result: { build_uuid: 'b1' } })],
  ]);
  await assert.rejects(() => worker.scheduled({ cron: '15 3 * * *' }, ENV, {}));
  restore();
  assert.equal(f.calls.length, 2, 'both jobs were attempted');
  assert.equal(f.calls[1].method, 'POST');
});

test('the cron strings in the code match wrangler.jsonc', async () => {
  const { readFile } = await import('node:fs/promises');
  const cfg = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const src = await readFile(new URL('../src/index.mjs', import.meta.url), 'utf8');
  for (const cron of ['15 3 * * *', '15 9 * * *']) {
    assert.ok(cfg.includes(`"${cron}"`), `wrangler.jsonc is missing ${cron}`);
    assert.ok(src.includes(`'${cron}'`), `index.mjs is missing ${cron}`);
  }
});
