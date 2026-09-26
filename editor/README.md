# nissartango-editor

The editor origin. As of 2026-09-23: a PKCE sign-in form with session refresh,
a magic-link callback, an approval queue that can approve, reject and clear
review flags, a create/edit form that can also cancel a single date of a
repeating event, and an organizer form. It is usable end to end — sign in,
compose, edit, approve, publish.

**It is in French**, as of 2026-09-23 — labels, hints, validation messages,
errors thrown from `auth.js` and `api.js`, and the sentence beside the consent
box at `/organizer/`, which was the point: that sentence is what makes
publishing a contact detail an informed choice rather than a recorded one.

Code comments stay in English, deliberately. They explain the database to
whoever is editing the file, they quote constraint and policy names verbatim,
and they are the same language as `AGENTS.md` and every commit message.

**Database enum values are never translated.** `status`, `type`, `recurrence`
and `event_exceptions.kind` go to Postgres as they are; only the word on screen
is French, through a label map in each file with a fallback to the raw value —
so an enum member added to the database and not to the map shows something true
rather than nothing. The recurrence wording matches `RECURRENCE_LABELS` in
`src/lib/occurrences.js`, so the editor and the public site describe the same
event the same way.

## Why it exists now, ahead of any editor UI

Supabase Auth's Site URL for production was set to
`https://editor.nissartango.fr` on 2026-09-19, while that hostname did not
exist. `site_url` is also the fallback for any `redirect_to` that is not
allow-listed, and `http://localhost:3000` was dropped from the allow-list in the
same change — so for about an hour every magic link the production project
issued landed on NXDOMAIN, with nothing behind it.

**Deployed 2026-09-19 ~11:05Z, which fixed it**, because the route in
`wrangler.jsonc` IS the DNS record. Nothing in the Supabase dashboard had to
change.

## Deploy

    npm run deploy:editor

`custom_domain: true` in `wrangler.jsonc` makes wrangler provision the DNS
record and the TLS certificate, exactly as it did for `nissartango.fr` and
`www.nissartango.fr`.

**Do not hand-add an `A` or `CNAME` for `editor` in the Cloudflare dashboard.**
Workers custom domains are managed from the config, and a manual record
conflicts with the one wrangler creates. A Supabase *custom domain* is a
different feature entirely and is the wrong tool here — it would make this
hostname serve the Supabase API, so magic links would land on an API endpoint
with no application on it.

### Verify from outside, not from the deploy output

    dig +short @1.1.1.1 editor.nissartango.fr      # expect an answer, not empty
    curl -sS -o /dev/null -w '%{http_code}\n' https://editor.nissartango.fr/

Then read the live Auth configuration back without sending an email — GoTrue
redirects an *invalid* token to `redirect_to` when that target is allow-listed
and to `site_url` when it is not, so one unauthenticated GET reveals both:

    curl -sI --max-redirs 0 \
      "$SUPABASE_URL/auth/v1/verify?token=probe-invalid&type=magiclink&redirect_to=https%3A%2F%2Fexample.com%2Fnope"

The `location:` header names `site_url`. See `supabase/PROJECT_SETUP.md`.

## Running it against dev

    ./scripts/seed-dev-editor.sh --help     # once, the first time
    npm run dev:editor                      # http://localhost:3000

Until 2026-09-23 `config.js` hard-coded production, so every exercise of the
editor — every sign-in, every form, every moderation decision made while trying
something out — happened against the live agenda. There was no other way to run
it.

**The ORIGIN picks the project**, and nothing else can:

    https://editor.nissartango.fr   ->  production   eqcgeqzzuzcwrflwasjo
    http://localhost:3000           ->  dev          hjsekipqryfuwdkhxuks
    anything else                   ->  dev

Not an environment variable, because this deployment has no build step to
substitute one into. Not a toggle, because a query parameter or a stored flag
could be set by the page, and the whole point is that the production origin
cannot be pointed anywhere else. The origin is the one input the page does not
control. `editor/public/target.js` holds it; `tests/editor-config.test.js`
asserts that no hostname but the exact production host resolves to production.

Unrecognised hosts — a preview deployment, say — go to dev deliberately.
Sending them to production would make every preview a production test; sending
them to dev means the CSP in `_headers`, whose `connect-src` names production
and only production, blocks them visibly in the console instead.

**Port 3000 is not a preference.** Dev's Supabase Site URL is
`http://localhost:3000`, still the scaffold default, measured with the
`/auth/v1/verify` probe below. `site_url` is also the fallback for any
`redirect_to` that is not allow-listed, so a dev magic link lands on port 3000
whatever the server does. Serving elsewhere means links arrive at a closed port.

**A banner names the project whenever it is not production**, with the REF and
not just the name — the two project names are backwards, and a name is exactly
what has misled people here before. Production shows nothing: a missing badge
is noticed, a green one is not.

### Dev was empty, so there was nothing to sign in as

Measured 2026-09-23: `auth.users=0 user_roles=0 organizers=0 members=0
events=0`. A dev editor you cannot sign into is not an improvement on no dev
editor, so `scripts/seed-dev-editor.sh` fills in what is not content — an
admin, an organizer you own, and three events chosen so the queue is neither
empty nor uniform (pending, approved-and-flagged, rejected).

It will not create the `auth.users` row. That is GoTrue's, and writing one by
hand means guessing which columns are load-bearing this release; a malformed
row breaks sign-in in a way that looks like a configuration problem. Create it
in the dashboard once — Authentication → Users → Add user, Auto Confirm on —
and the script finds it by email.

It refuses to run against production, reading the ref out of the CONNECTION
STRING rather than the argument, for the same reason `db-push.sh` does. It also
accepts a local-stack URL, which is how the SQL in it was actually exercised
before it was ever pointed at a hosted project — and that immediately caught
two bugs: a uuid containing `v`, which is not a hex digit, and a second run
failing because `organizer_members_keep_an_owner()` fires on UPDATE and asks
only whether OLD.role was owner, so re-setting the sole owner to owner reads as
removing the last one.

## What the pages do

`public/session.js` reads the URL fragment, which is where GoTrue puts both the
success and the failure:

    #access_token=…&refresh_token=…&expires_in=3600&type=magiclink
    #error=access_denied&error_code=otp_expired&error_description=…

**Both `/` and `/auth/callback` run it.** `site_url` has no path and nothing
sets an explicit `redirect_to` yet, so a link with no destination lands on `/`.
`/auth/callback` exists because it is explicitly allow-listed and should not be
a URL that 404s, and because the future editor needs a destination to name.

### What it proves, and what it does not

A green result means the token was **issued and delivered to this browser** —
the one thing this project had never shown end to end. It does **not** mean the
token is valid: the signature is not verified here and cannot be. PostgREST
decides that on every request, and that is the only opinion that counts.

The access token is deliberately **not displayed**. It is a bearer credential,
anything on screen can be photographed or pasted, and pasting one has already
cost this project a session revocation. The decoded claims answer "who signed
in"; the raw token answers nothing a person needs to read.

`error_code=otp_expired` covers three different things without distinguishing
them: an expired link, an **already-consumed** link, and a malformed token. A
link opened twice reports the same error as one left overnight.

### The single-use token loses a race with the browser. Measured 2026-09-19.

A link requested at 11:08:59Z and clicked well inside its hour showed
`otp_expired` on screen. The database said the opposite:

    recovery_sent_at   11:08:59.393   the request
    last_sign_in_at    11:13:18.721   a sign-in SUCCEEDED
    auth.sessions      1 row, user_agent Chrome/151 macOS, French residential IP

So the token **was** redeemed, once, successfully — and the click the person
actually made was the *second* use of it. Both requests carried the same user
agent and the same IP, which is what makes this so hard to see: the successful
consumer looks exactly like the person, because it was their own browser
preloading the link before they clicked it.

Do not read `otp_expired` as "expired". Check `last_sign_in_at` and
`auth.sessions` first. If a session exists, the flow worked and the display is
the only thing that failed.

**PKCE was the fix, and it is now built** — `auth.js`, shipped 2026-09-19 and
working end to end at 14:47:10Z. In the implicit flow the link alone is the
credential, so anything that fetches it spends it. With PKCE the link carries a
`code` that is worthless without the verifier held in the browser that *started*
the sign-in.

**But read `auth.js` for what PKCE does NOT fix.** `/auth/v1/verify` is still
single-use whatever flow follows it, so a prefetch can still burn a link and a
person can still be shown `otp_expired`. What changed is that a fetcher can no
longer obtain a SESSION — at 11:13 a preload created a real one. Confidentiality,
not availability.

An earlier handover recorded link-scanner prefetch as "ruled out, not merely
doubted", on the strength of one link that worked. One success does not rule
out a race; it only means the race was won that time.

### `auth.audit_log_entries` is empty and has always been empty

Zero rows on production, ever — checked 2026-09-19 while trying to see the two
verify attempts above. Whatever it is for, it is not a record of what happened
here, and reasoning that reaches for it will find nothing and may read that
absence as "no events". Use `auth.sessions`, `auth.refresh_tokens` and the
timestamp columns on `auth.users` instead.

## Deliberate constraints

**No third-party script, and a CSP that enforces it.** `public/_headers` sets
`script-src 'self'` with no `'unsafe-inline'`, which is why neither page has an
inline `<script>` and `session.js` self-initialises. Any script loaded on the
callback page can read `location.hash`, which is to say it can read an access
token. `supabase-js` from a CDN is the ordinary choice and the wrong one for
the single page in this project that handles a credential.

**`connect-src` names ONE origin.** It was `'self'` until the sign-in form
needed `/auth/v1/otp`; the edit that added
`https://eqcgeqzzuzcwrflwasjo.supabase.co` is deliberately one ref spelled out,
not `https://*.supabase.co` — a wildcard would let a compromised script post an
access token to any project on the platform.

**No `main` in `wrangler.jsonc`.** Static assets only, so there is no
server-side code path that could hold a key. The editor will talk to Supabase
from the browser, with the publishable key and the caller's own JWT, which is
what keeps RLS the enforcement rather than something a Worker has to remember.

**A separate deployment from `nissartango`.** The public site keeps having no
authentication surface at all: a bug here cannot take the agenda down, and
nothing here can widen what `anon` reads.

## The approval queue — `/queue/`

Opened for the first time on 2026-09-19, and used the same day. Before that,
`user_roles` and `organizer_members` were empty on production, so `is_admin()`
was false for everyone and every admin policy was unreachable.

**The first moderation decisions this project has ever executed outside a test:**

    15:53:12   TEST — approbation   pending -> rejected, note "No need"
    15:53:23   MILONGA … Casita     needs_review true -> false (mark reviewed)

### Two things the first real use taught us

**1. The queue must not filter to `status = 'pending'` alone.** It does not, and
that turned out to matter immediately: the Casita event was `approved` AND
flagged `needs_review`, and had been sitting that way, unseen, for as long as
nobody could open the queue. A pending-only query would have hidden the one item
somebody had actually asked to have looked at again. `needs_review` is a
separate axis from `status`, not a finer grade of it.

**2. A moderation action can trigger a rebuild without changing anything
public.** Clearing that flag left `events_public` at four rows — the event was
approved before and after — and yet `content_checksum` moved from `f457b6a3…`
to `9973f564…`, and the poller republished.

The reason is that `updated_at` is a column IN `events_public`, and
`content_checksum` is an md5 over that view's rows as text. So *touching* a
published row is indistinguishable from *changing* one. That is the same
property that made the `legacy_slugs` migration move the checksum twice, and it
is not a fault: the view's content genuinely changed, and a checksum that tried
to be cleverer would have to decide which columns "count", which is exactly the
judgement it exists to avoid. Expect a rebuild after any decision that touches a
published event.

### A correction, on the record

The `needs_review` flag was first attributed here to the `legacy_slugs`
backfill, on the strength of `updated_at` matching it to the second. That was
wrong, and reading the trigger refuted it: `events_flag_review` sets the flag
only when `old.status = 'approved' AND content_changed`, and `content_changed`
compares an explicit tuple of columns that does **not** include `legacy_slugs`.
The backfill bumped `updated_at` — `t40_events_set_updated_at` fires on any
update — and nothing else. The flag predated it, set by some earlier edit that
nothing now records; `auth.audit_log_entries` is empty and always has been.

A timestamp that matches is a correlation. The trigger is the mechanism.

## The organizer form — `/organizer/`

Added 2026-09-23, closing the half of the free-text decision that was left open
when `contact_email` / `contact_phone` were created the day before: the columns
existed, the consent was enforced by CHECK, and nothing but SQL could fill them.

`/organizer/` lists what you belong to; `/organizer/?id=<uuid>` edits one.

**Two pairs of contact fields, kept apart on screen on purpose.** `email` and
`phone` are PRIVATE — readable by members here, absent from `organizers_public`,
never in a build. `contact_email` and `contact_phone` are PUBLIC and permanent.
They are labelled by what happens to them rather than by which column they are,
because a form that made the two pairs look alike would recreate the leak the
new columns exist to prevent.

**What the form cannot do, in each case because the database says so:**

- **No create.** `authenticated` holds no INSERT and no DELETE on
  `public.organizers` at all, so even the admin policy cannot be exercised from
  a user token. A "new organizer" button would 403 every time.
- **No slug editing.** `slug` is not in the UPDATE grant. It is in every link.
- **No saving unless you are an OWNER.** `organizers_owner_update` requires
  `is_owner(id)`, so an EDITOR can create events for an organizer and cannot
  rename it. The form asks `is_owner` and `is_admin` rather than trusting the
  role in the membership list it already has, and when it cannot save it
  disables every control and names the policy instead of failing at submit.

### A bug that only pressing the button could find

The consent check was written, unit-tested and wrong. `readForm()` nulls a
contact value whose box is unticked — that is its job — and validation was
reading *that output*, so it asked "is there an unconsented value here?" of an
object that could never contain one. The answer was always no.

Typing an address and pressing Save without ticking the box therefore **dropped
what was typed and reported "Saved."** Every unit test passed throughout: they
hand raw values straight to `validateOrganizer`, which is correct, and so never
touched the wiring between the two. Found in a throwaway harness that loaded
the real `organizer.js` against a stubbed `/api.js`; fixed by validating the
raw controls.

Worth keeping in mind for the next form: a pure function and its tests can both
be right while the thing on screen is wrong, and only using it shows that.

### `consent.js` exists for one silent mistake

Re-stamping `contact_*_consent_at` on every save satisfies the CHECK, shows the
right thing on screen, publishes the right address — and destroys the only fact
the column holds, which is *when* the person agreed. Nothing downstream can
complain, because nothing downstream knows what the date should have been.

It is a separate file for the same reason `pkce.js` and `expiry.js` are: no DOM,
so Node can test it. `tests/consent.test.js` pins all three cases, including the
withdrawal — value cleared, stamp KEPT — which the one-directional CHECK permits
deliberately.

## Signing out — `/auth/v1/logout`

Until 2026-09-23 the sign-out button emptied `localStorage` and nothing else:
the session row and its refresh token stayed live in the database until they
expired. It now revokes, with `scope=global` — every session this account has,
because the reason a person reaches for this control is usually "make this stop
being usable", and per-session would be the wrong answer at the moment it
mattered most.

**The browser is cleared whether or not the server accepts.** The obvious
ordering — revoke, and clear if it worked — reads as careful and is backwards:
when the request fails, the person is shown an error and left signed in on the
machine in front of them, and they close the laptop believing otherwise. So
`editor/public/signout.js` clears always and reports the two halves separately.
It is a separate file, with no DOM, so Node can test that; three tests in
`tests/signout.test.js` fail if the ordering is inverted.

**It does not invalidate the access token already issued, and the message says
so.** Measured against the local stack on 2026-09-23 rather than taken from the
docs:

    POST /auth/v1/logout?scope=global      204
    auth.sessions        1 -> 0
    auth.refresh_tokens  1 -> 0            deleted, not flagged
    the same access token, to PostgREST    200   <- still accepted
    refresh with that session              400

So revoking closes the refresh path, not the hour already granted. PostgREST
validates signature and expiry and consults no session table. The only lever
that shuts that window is rotating the signing key, which invalidates every
token for every user at once.

One module handles the button on all four pages. It used to be the same
listener copied four times, which is how three of them would have gone on
clearing `localStorage` and calling it done.

## The flyer — uploading to Storage

`image_path` was a free-text box whose hint said "Rien ne les sert encore",
which had stopped being true long before anyone noticed. The pipeline was
finished: a private `event-images` bucket, `fetch-content.mjs` downloading each
referenced object with the anon key, Astro optimising it into a hashed WebP
with a srcset. Nothing had ever put a path in the column, so nothing had ever
run it.

Proven end to end on 2026-09-26 against the local stack — upload, anon read
(byte-identical), download into `src/assets/events/`, `<img srcset>` with 400w
and 600w WebP, and no `supabase.co` anywhere in the built HTML.

**The path is computed, never typed.** The bucket's write policy is

    is_member(uuid_or_null((storage.foldername(name))[1]))

so the first segment must be an organizer you belong to. A typed path could be
refused by RLS for a reason nothing on screen explained, and a correct one
needed two uuids nobody has memorised. `image.js` builds
`<organizer_id>/<event_id>/<filename>` from the event in hand.

**Edit mode only**, for the same reason the exceptions section is: the path
contains the event's id, and a new event has none until the database assigns
one. Create mode says that rather than offering a picker that could only fail.

**The upload does not write the row.** It fills the field; you still press
save. An upload that succeeded with an unsaved row leaves an unreferenced
object, which is recoverable — a row pointing at an object that failed to
upload is a broken image on the site.

Uploads use `x-upsert`, so replacing a flyer under the same filename replaces
the object and `image_path` does not change. A *different* filename leaves the
old object in the bucket: deleting it would mean destroying a file the saved
row may still point at, and an orphan in a private 5 MB-per-object bucket is
the cheaper mistake.

### Two things the filename rules exist for

`fetch-content.mjs` names the local file `flatten(image_path)`, replacing every
`[^a-zA-Z0-9._-]` run with a dash. So `safeName()` keeps uploads already
flatten-safe — otherwise two objects differing only in characters flattening
collapses would land on one local file and one would silently win.

Both of its rules came from a failing test, not from foresight:

- **Accents are folded, not stripped.** `"Affiche Été 2026.PNG"` became
  `"affiche-t-2026.png"` — the É and é vanished and took the word with them.
  NFD-decomposing first lets the letter survive and removes only the combining
  mark. These are French flyers.
- **Dot names are refused.** `"..."` produced `".."`, a filename that names the
  parent directory. Now `"flyer"`.

## Not done here

This list has now gone stale TWICE. The three bullets originally here were true
on 2026-09-19 and false by 2026-09-21; the four that replaced them were true on
2026-09-21 and two were false by 2026-09-22 — create/edit shipped in `73e3880`
and session refresh in `a250a7a`, and neither commit came back to this file.

That is the project's recurring failure in miniature: a fix lands in one place
and the prose describing its absence survives somewhere else. **When something
here stops being true, delete the bullet in the same commit that makes it
false.** A "not done" list that lies is worse than none.

- ~~**No sign-out that actually revokes.**~~ Closed 2026-09-23 — see "Signing
  out" above. What remains true, and always will: signing out cannot invalidate
  the access token already issued. Only rotating the project's signing key can,
  and that invalidates every token for every user at once.
- ~~**Dev has no editor.**~~ Closed 2026-09-23 — see "Running it against dev"
  above. What is still true: **dev has no CSP.** `_headers` is Cloudflare
  configuration and a local static server does not send it, so a Content
  Security Policy mistake will not show up at localhost. Check that against a
  deployed preview, not against `npm run dev:editor`.

**Custom SMTP is no longer a blocker.** Solved 2026-09-21: Resend, sending as
`Nissartango <no-reply@nissartango.fr>`, proven by delivery to an address that
is not on the Supabase organization. See `supabase/PROJECT_SETUP.md`.
