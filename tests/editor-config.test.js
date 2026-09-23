/**
 * Run with:  npm test
 *
 * Which Supabase project the editor talks to is decided by the origin it was
 * served from. That is a safety property, not a convenience, so it is asserted
 * rather than described:
 *
 *   - the production origin resolves to production and CANNOT resolve to
 *     anything else
 *   - everything that is not the production origin resolves to dev, including
 *     hostnames nobody anticipated
 *
 * The second half is the one that matters in practice. Before 2026-09-23 the
 * editor hard-coded production, so every time anybody ran it — to try a form,
 * to check a fix — they were editing the live agenda. There was no other way
 * to run it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { targetFor, projectFor, PROJECTS, PROD_HOST } from '../editor/public/target.js';

test('the production origin is production', () => {
  assert.equal(targetFor(PROD_HOST), 'prod');
  assert.equal(projectFor(PROD_HOST).ref, 'eqcgeqzzuzcwrflwasjo');
});

test('the production origin is production whatever the case', () => {
  // A browser lowercases location.hostname, but this function is also called
  // from tests and scripts where nothing guarantees that.
  for (const h of ['EDITOR.NISSARTANGO.FR', 'Editor.Nissartango.Fr']) {
    assert.equal(targetFor(h), 'prod', h);
  }
});

test('local addresses are dev', () => {
  for (const h of ['localhost', '127.0.0.1', '[::1]', '0.0.0.0', 'editor.localhost']) {
    assert.equal(targetFor(h), 'dev', h);
  }
});

test('anything unrecognised is dev, never production', () => {
  // Preview deployments (preview_urls: true) are served from hostnames nobody
  // listed. Sending them to production would make every preview a production
  // test. Sending them to dev means the CSP in _headers — connect-src names
  // production and only production — blocks them visibly instead.
  for (const h of [
    'nissartango-editor.workers.dev',
    'some-preview.nissartango-editor.workers.dev',
    'editor.nissartango.fr.evil.example',   // suffix attack
    'xeditor.nissartango.fr',               // prefix attack
    'nissartango.fr',                       // the PUBLIC site, not the editor
    '', null, undefined,
  ]) {
    assert.equal(targetFor(h), 'dev', String(h));
  }
});

test('no hostname reaches production except the exact production host', () => {
  // The property stated once, over a sweep, rather than per case: if this ever
  // returns 'prod' for something else, the origin has stopped being the thing
  // that decides.
  const others = [
    PROD_HOST + '.', PROD_HOST + ':443', ' ' + PROD_HOST, PROD_HOST + '/',
    'www.' + PROD_HOST, 'a' + PROD_HOST,
  ];
  for (const h of others) assert.equal(targetFor(h), 'dev', h);
});

test('the two projects are actually different projects', () => {
  // Guards the copy-paste that would make "dev" a second name for production —
  // which would look entirely correct on screen.
  assert.notEqual(PROJECTS.dev.ref, PROJECTS.prod.ref);
  assert.notEqual(PROJECTS.dev.url, PROJECTS.prod.url);
  assert.notEqual(PROJECTS.dev.anonKey, PROJECTS.prod.anonKey);
  for (const p of Object.values(PROJECTS)) {
    assert.ok(p.url.includes(p.ref), `${p.name}: url and ref disagree`);
    assert.match(p.anonKey, /^sb_publishable_/, `${p.name}: not a publishable key`);
  }
});

test('no secret-shaped credential is in the editor config', () => {
  // A publishable key is public by design. A secret one bypasses RLS, and this
  // file is served to every browser that opens the editor.
  //
  // These match credential SHAPES, not words. The first version matched the
  // bare strings and failed on target.js's own comment saying such a key must
  // never appear there — a check that fires on the warning against the thing
  // is a check that will be deleted the first time it is inconvenient.
  const src = readFileSync(new URL('../editor/public/target.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /sb_secret_[A-Za-z0-9_-]{8,}/, 'a secret key is in target.js');
  assert.doesNotMatch(src, /eyJ[A-Za-z0-9_-]{20,}\./, 'a JWT is in target.js');
  assert.doesNotMatch(src, /postgres(ql)?:\/\/\S/, 'a connection string is in target.js');
});

test("production's key matches the one the cron worker uses", () => {
  // config.js used to claim it "is generated from" workers/cron/wrangler.jsonc
  // "so there is one source of truth rather than two that can drift". There
  // has never been such a generator: they are two hand-copied literals. This
  // is the check that makes the claim true — the drift it warned about now
  // fails a test instead of going unnoticed.
  const wrangler = readFileSync(
    new URL('../workers/cron/wrangler.jsonc', import.meta.url), 'utf8');
  const m = wrangler.match(/"SUPABASE_ANON_KEY"\s*:\s*"([^"]+)"/);
  assert.ok(m, 'no SUPABASE_ANON_KEY in workers/cron/wrangler.jsonc');
  assert.equal(PROJECTS.prod.anonKey, m[1],
    'the editor and the cron worker disagree about production’s publishable key');
});

test("dev's redirect names the port dev's site_url actually uses", () => {
  // Dev's Site URL is http://localhost:3000, still the scaffold default,
  // measured with the /auth/v1/verify probe. Serving the dev editor on any
  // other port means magic links land nowhere.
  assert.match(PROJECTS.dev.redirectTo, /^http:\/\/localhost:3000\//);
});
