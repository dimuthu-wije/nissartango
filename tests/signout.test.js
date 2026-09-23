/**
 * Run with:  npm test
 *
 * These exist for one ordering mistake with a very quiet failure.
 *
 * The obvious way to write a revoking sign-out is: call the server, and clear
 * the browser if it worked. That reads as careful and is the wrong way round.
 * When the request fails -- offline, expired token, Supabase having a moment --
 * the person is shown an error and left signed in on the machine in front of
 * them. They close the laptop believing they signed out.
 *
 * So: clear ALWAYS, report the two halves separately, and never say "signed
 * out" unqualified when the server refused.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  logoutPath, performSignOut, signOutMessage, SCOPES,
} from '../editor/public/signout.js';

const ok = async () => ({ skipped: false });
const boom = async () => { throw new Error('network is down'); };

test('the browser is cleared when the server accepts', async () => {
  let cleared = false;
  const r = await performSignOut(ok, () => { cleared = true; });
  assert.equal(cleared, true);
  assert.deepEqual(r, { revoked: true, cleared: true });
});

test('the browser is cleared when the server REFUSES — the whole point', async () => {
  let cleared = false;
  const r = await performSignOut(boom, () => { cleared = true; });
  assert.equal(cleared, true, 'a failed revocation must not leave a usable session here');
  assert.equal(r.revoked, false);
  assert.match(r.reason, /network is down/);
});

test('a failure to clear is reported, not swallowed', async () => {
  // If clearing throws — storage disabled, quota, a private window — the
  // caller has to hear it. A `finally` that hid this would report a sign-out
  // that happened in neither place.
  const r = await performSignOut(ok, () => { throw new Error('storage disabled'); });
  assert.equal(r.revoked, true);
  assert.equal(r.cleared, false);
  assert.match(r.reason, /storage disabled/);
});

test('both failing is reported as both failing', async () => {
  const r = await performSignOut(boom, () => { throw new Error('storage disabled'); });
  assert.equal(r.revoked, false);
  assert.equal(r.cleared, false);
  assert.match(r.reason, /network is down/);
  assert.match(r.reason, /storage disabled/);
});

test('clearing happens even though revoking threw first', async () => {
  // Order matters: revoke needs the token that clearing destroys, so clearing
  // cannot come first. This pins the sequence rather than just the outcome.
  const calls = [];
  await performSignOut(
    async () => { calls.push('revoke'); throw new Error('x'); },
    () => { calls.push('clear'); },
  );
  assert.deepEqual(calls, ['revoke', 'clear']);
});

test('scope defaults to global, and an unknown scope is refused loudly', () => {
  assert.equal(logoutPath(), 'logout?scope=global');
  assert.equal(logoutPath('global'), 'logout?scope=global');
  assert.equal(logoutPath('local'), 'logout?scope=local');
  // A typo must not silently become "local" — that would revoke one session
  // while the person believes they revoked all of them.
  assert.throws(() => logoutPath('globals'), /unknown sign-out scope/);
  assert.throws(() => logoutPath('all'), /unknown sign-out scope/);
  assert.deepEqual(Object.keys(SCOPES).sort(), ['global', 'local']);
});

test('the message never claims more than happened', () => {
  const success = signOutMessage({ revoked: true, cleared: true });
  // Even the happy path has to name the limit: the access token already issued
  // stays valid to its exp, because PostgREST consults no session table.
  assert.match(success, /révoquée/);
  assert.match(success, /heure/, 'the happy path must still name the token window');

  const failed = signOutMessage({ revoked: false, cleared: true, reason: 'HTTP 500' });
  assert.match(failed, /PAS pu être révoquée/);
  assert.match(failed, /HTTP 500/);
  assert.doesNotMatch(failed, /^Déconnecté\./,
    'must not open with a bare "signed out" when the server refused');

  const halfway = signOutMessage({ revoked: true, cleared: false, reason: 'storage disabled' });
  assert.match(halfway, /navigateur/);

  const neither = signOutMessage({ revoked: false, cleared: false, reason: 'offline' });
  assert.match(neither, /Échec/);
  assert.match(neither, /offline/);
});

test('every message is a sentence a person can act on', () => {
  for (const outcome of [
    { revoked: true, cleared: true },
    { revoked: false, cleared: true, reason: 'x' },
    { revoked: true, cleared: false, reason: 'x' },
    { revoked: false, cleared: false, reason: 'x' },
  ]) {
    const m = signOutMessage(outcome);
    assert.ok(m.length > 30, `too terse: ${m}`);
    assert.match(m, /[.!]$/, `not a sentence: ${m}`);
  }
});
