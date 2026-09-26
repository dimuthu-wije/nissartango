# nissartango.fr — handover, stage 6

Written 2026-09-22, at `3522615`. Everything below was measured in the session
that wrote it; where it was not, it says so.

Read `AGENTS.md` first — it is the standing description of the project and it is
current. This file covers only what changed after it, and what a fresh session
would otherwise have to rediscover by making the same mistakes.

---

## 1. Where this picks up

The previous handover is **`docs/HANDOVER-stage5.md`**, written by the reviewer
session on 2026-09-19 10:15Z at `e22ca1d`. Read it — its §7, "decided and
measured, do not re-litigate", is still load-bearing. It carries a preface
listing what has been superseded since, so read the box before the body.

Also here: **`docs/BRIEFING-stage5.md`**, which predates stage 5 and is the
clearest account in this repo of *why* the schema is shaped as it is — the
public views as the column whitelist, `user_roles` as a table rather than a JWT
claim, and why the editor had to be a separate deployment. Read it before
designing anything that touches those.

All three reached `docs/` on 2026-09-22 and none was there before. They had been
written into `Claude outputs/`, which is **gitignored** at `.gitignore:79` — so
the only record of how this project got here lived on one disk, in a directory
git was told to ignore, and no clone had ever seen it.

A stage 5.1 handover never reached the disk at all. It was pasted into a session
and lived only in that chat, and nothing anywhere records what it said.

So: a handover in scrollback does not survive the session; a handover in an
ignored directory survives the session and not the machine. **Put the next one
in `docs/` and commit it in the same breath as writing it.**

The repository is PUBLIC, which is the constraint this has to respect rather
than a reason not to do it. Nothing in a handover should ever need a secret to
be useful — if one does, the secret is the thing to fix.

State at the time of writing:

    HEAD == origin/main == 3522615  "Editor: cancel a single DATE, and stop
                                     pretending cancelled_at is one"
    working tree clean, 0 ahead / 0 behind
    npm test -> 83 pass, 0 fail

---

## 2. What shipped since `e22ca1d`

Fourteen commits. The arc: `editor.nissartango.fr` did not resolve, and now it
is a working tool.

| Commit | What it closed |
|---|---|
| `ee05b41` `81a3b37` `207f0ea` `5e6ea63` `441f9b9` | `legacy_slugs`, the generated `_redirects`, `db-push.sh` |
| `12277c5` `a9d43ce` | PKCE sign-in, and a correction to what PKCE fixes |
| `f73438e` `c043897` | the approval queue, and its first real use |
| `198184e` | custom SMTP — the organizer blocker |
| `c8a53d0` | membership for all three organizers |
| `a250a7a` | session refresh |
| `73e3880` | the create/edit form |
| `3522615` | per-date cancellation |

### The `_redirects` landmine, since it was the least visible

`public/_redirects` was hand-written and tracked. It is now generated from
`events.legacy_slugs` by `scripts/fetch-content.mjs`, and gitignored.

This was not tidying. The hand-written file pointed at one event; **rejecting
that event in the queue would have failed `verify-build.mjs` check 7 and frozen
the site** — and the queue had just become usable, so that was about to become
reachable for the first time. The generated rules were proved byte-identical to
the hand-written ones before the old file was deleted.

---

## 3. The editor as it stands

A separate Workers deployment, static assets only, no `main`. It talks to
Supabase from the browser with the publishable key and the caller's own JWT, so
RLS is the enforcement rather than something a Worker has to remember.

    editor/public/                              (line counts as of 2026-09-23)
      config.js      20   URL + publishable key + redirect. Both values public by design.
      pkce.js        29   b64url / newVerifier / challengeFor. Pure. RFC 7636 vector.
      consent.js     45   what to send for a published contact detail. Pure.
      expiry.js      46   secondsLeft / isExpired / needsRefresh. Pure.
      zone.js       133   VERBATIM COPY of src/lib/zone.js.
      validate.js   146   mirrors the CHECK constraints on events AND organizers.
      queue.js      225   approve / reject / mark reviewed.
      session.js    238   sign-in form, callback, session display.
      auth.js       245   PKCE by hand, storage, refresh, local sign-out.
      api.js        275   PostgREST calls, the two WRITABLE lists, one 401-retry.
      organizer.js  380   organizer form: the two contact pairs and the consent.
      event.js      555   create + edit form, exceptions section.

    Four of those are pure and have no DOM, which is the whole reason Node can
    test them: pkce, consent, expiry, validate. That split is deliberate and is
    where a new piece of fiddly logic should go.

Deploy with `npm run deploy:editor`. `custom_domain: true` in
`editor/wrangler.jsonc` **is the DNS record** — do not hand-add an `A` or
`CNAME` for `editor` in the dashboard.

Verified live on 2026-09-22: `/`, `/queue/`, `/event/` all 200, and the deployed
`event.js` is byte-identical to the local file (22,292 bytes, `diff` empty).
Checking a route immediately after a deploy can return 404 from asset
propagation lag rather than a real fault; recheck before believing it.

### Three pure modules, and why they are split out

`pkce.js`, `expiry.js` and `validate.js` exist as separate files because
`auth.js` needs `localStorage`, `fetch` and absolute-path imports, and none of
that is necessary to answer the questions those three answer. Splitting them
means Node can test them. That is the whole reason, and it is why the test suite
covers the editor at all.

`expiry.js` in particular exists for one bug with two faces: `expires_at` is a
UNIX timestamp in **seconds** and `Date.now()` is **milliseconds**. Forget the
`*1000` and every session looks long expired, so the editor refreshes on every
request. Divide instead and nothing ever expires, so the first sign of trouble
is a 401 nothing was expecting. Both are one character and neither is visible on
screen.

### `zone.js` is a copy, and `tests/zone-copy.test.js` is the reason that is tolerable

The editor has no build step and cannot import across the repo. So
`editor/public/zone.js` is a verbatim copy of `src/lib/zone.js`. A copy is a
liability: the original changes, the copy does not, and the two quietly
disagree.

`tests/zone-copy.test.js` imports **both** and asserts they agree — including on
the two nights a year when timezone arithmetic is visible. **If it fails, do not
edit `editor/public/zone.js` by hand. Copy the original over it again**, header
comment included.

---

## 4. Production state, measured 2026-09-22 03:15Z

Straight from the deploy's own receipt, which is the honest instrument:

```json
{
  "project_ref": "eqcgeqzzuzcwrflwasjo",
  "commit": "3522615b8fb0f9f7a19afe4c2680c3763f04ffb1",
  "checksum": "3dcec48f2c47859bd958881c970a4913",
  "counts": { "events": 5, "organizers": 3, "exceptions": 1 },
  "built_at": "2026-09-22T03:15:35.015Z"
}
```

To confirm a deploy, require that `built_at` has **moved**:

```bash
curl -s "https://nissartango.fr/build-info.json?t=$(date +%s)"
```

A stale cache can only return an older `built_at`, never a newer one. A move is
conclusive; a non-move proves nothing.

The one exception is the Casita event's `2026-10-22`, cancelled. It was in the
database before the editor could show it.

---

## 5. Two cancellations, kept straight

This is the single thing most likely to be got wrong again, because the form
itself got it wrong for two days.

| | |
|---|---|
| `events.cancelled_at` | the **whole event**, forever. `src/pages/evenements/[slug].astro` only ever asks `Boolean(e.cancelled_at)` — **the hour is read by nothing.** It is a lifecycle flag that happens to be stored as a timestamp. |
| `event_exceptions.occurrence_date` | **one occurrence**, a `DATE` column with no time at all. Kinds: `cancelled`, `moved`. |

So `cancelled_at` is a **checkbox** in the form. Ticking stamps `now()`,
unticking nulls it, and re-saving an already-cancelled event preserves the
original stamp rather than rewriting when it happened.

Cancelling one date is the exceptions section, edit mode only — an exception is
keyed by `(event_id, occurrence_date)`, so the event has to exist first.

Cancelled dates still **appear** on the site, marked. *"Pas de practica le 15
août"* tells a reader more than a week that silently is not there.

---

## 6. Deliberately not done

Kept honest rather than aspirational. Each of these is a decision or a known
gap, not an oversight.

- ~~**No sign-out that revokes.**~~ **Closed 2026-09-23.** `POST
  /auth/v1/logout?scope=global`, with the browser cleared whether or not the
  server accepts — the reverse ordering leaves someone signed in on the machine
  in front of them while telling them it failed. Measured: sessions and refresh
  tokens go to zero, and the access token already issued is still accepted by
  PostgREST, which is why the message says so.
- ~~**Dev has no editor.**~~ **Closed 2026-09-23.** The ORIGIN now picks the
  project (`editor/public/target.js`): `editor.nissartango.fr` is production
  and everything else, localhost included, is dev. `npm run dev:editor` serves
  on port 3000 — the port is not a preference, it is dev's `site_url` — and
  `./scripts/seed-dev-editor.sh` fills dev with an admin, an organizer and a
  queue. A banner names the project whenever it is not production.
- ~~**`no-reply@nissartango.fr` does not receive.**~~ **Closed 2026-09-26** — an
  Email Routing rule forwards it to the same inbox as `dmarc@`. The reasoning,
  including why a bounce is not obviously the wrong answer, is in
  `supabase/PROJECT_SETUP.md`. The mail DNS was re-read afterwards and is
  undisturbed; delivery itself is confirmed by replying to a magic link, not
  from here.
- **Email OTP Expiration is unread on both projects.** Never checked in the
  dashboard, on either.
- **`image_path` / `image_file` resolve to nothing.** `public/uploads/` does not
  exist and nothing serves `/uploads/events/...`. `image_path` is in `WRITABLE`,
  so the form can store a path that leads nowhere. Open design question.
- **Node version unpinned.** Cloudflare builds on 24.18.0; `engines` says
  `>=22.12.0`; local is 22.
- **The watchdog lives outside the repo.** Nothing here describes or deploys it.
- **Deliverable 1b, storage object sync**, is untouched.

---

## 7. The tests, and the line they cannot cross

`npm test` → **83 pass**. `TZ=UTC` is set by the script deliberately; real local
time in a test is a coin toss you run on every commit.

    tests/redirects.test.js    the generator against hand-written rules
    tests/pkce.test.js         RFC 7636 appendix B vector
    tests/expiry.test.js       seconds-vs-milliseconds, both directions
    tests/zone-copy.test.js    original vs copy, across both changeovers
    tests/validate.test.js     the mirror's boundaries
    tests/occurrences.test.js  recurrence expansion
    workers/*/test/*.test.js   cron + notifier

**`validate.js` duplicates constraints that live in Postgres, and nothing in
Node can prove the database agrees.** The tests prove the mirror behaves as
documented; the constraint names in `validate.js` comments are what let a person
check the pair by eye. If a save is refused by the database and the form did not
catch it, that is the mirror drifting, and the fix goes in both places.

---

## 8. Corrections this session owes, on record

Kept because the pattern matters more than the individual errors. **Every one of
these is the same mistake: reading a null, an absence, or a coincidence as a
fact.**

1. **Claimed `authenticated` had no INSERT/UPDATE on `events`.** They are
   **column-level** grants — 21 columns each. The query was against
   `information_schema.role_table_grants`, which shows table-level grants only,
   so a real permission read as no permission. Corrected in `c8a53d0` and in
   `api.js`'s header.
2. **Attributed the `needs_review` flag to the `legacy_slugs` backfill**, on the
   strength of `updated_at` matching to the second. Reading the trigger refuted
   it: `events_flag_review` fires only when `old.status = 'approved' AND
   content_changed`, and that tuple does not include `legacy_slugs`. A timestamp
   that matches is a correlation; the trigger is the mechanism.
3. **Predicted the content checksum would move once.** It moved twice — once for
   the migration, once for the backfill. Corrected in `PROJECT_SETUP.md`, not in
   the applied migration.
4. **Overclaimed PKCE.** It buys confidentiality, not availability:
   `/auth/v1/verify` is still single-use, so a prefetch can still burn a link.
   Corrected in `auth.js` and `a9d43ce`.
5. **Claimed both staleness guards "have only ever been silent"** — read their
   absence from a CI log as evidence they had never fired. Both were then fired
   deliberately; both exit 1 correctly. `OPERATIONS.md` corrected.
6. **Claimed this repo had no handover document, then "corrected" that into a
   worse answer.** The first claim came from a glob of the repo root only, whose
   empty result was read as absence. The correction — that `Claude
   outputs/HANDOVER-stage5.md` was tracked — was read off `find`, which reports
   the filesystem and says nothing about git. `git ls-files` had already
   returned empty in the same session and that emptiness was not noticed.
   `Claude outputs/` is gitignored. **The original answer was closer to right
   than the correction**, and both were made while writing the list of errors of
   exactly this shape. An absence is evidence only once you know what the
   instrument reports when the thing IS there.

Two instruments were added to the list in `AGENTS.md` during this stretch:
`git grep -E` has no `\b` (POSIX ERE — use `-P` or `-F`), and `${PIPESTATUS[0]}`
is a bash-ism that yields empty in zsh, where `cmd | tail` also makes `$?`
report *tail's* status. The second corrupted three measurements in one sitting.
**Capture exit codes without a pipe.**

---

## 9. Where to pick up

Nothing is in flight. The editor is usable end to end: sign in, create, edit,
cancel a date, approve, publish.

The next items in `AGENTS.md` are public-site work — past-event archive, month
grouping and type filtering, `/en/` pages — and they touch none of the auth or
RLS knowledge above. That is a clean seam for a fresh session.

Both of the editor items that were named here as mattering most landed on
2026-09-23: dev/prod separation, and a revoking sign-out. What is left in the
editor is smaller — see "Not done here" in `editor/README.md`, which is kept
honest deliberately.

The method that made all of this work is in `AGENTS.md` — state the expected
output before running a command, paste raw output rather than summaries, treat a
passing test as proof of nothing until something outside the system agrees, and
when a fix lands in one file, grep the whole set.
