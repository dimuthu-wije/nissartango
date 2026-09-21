# nissartango-editor

The editor origin. Today: a PKCE sign-in form, a magic-link callback, and an
approval queue that can approve, reject and clear review flags. There is still
no way to CREATE or EDIT an event, so it is not the whole editor yet.

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

## Not done here

All three bullets that used to be here were true when written on 2026-09-19 and
false by 2026-09-21. Replaced rather than amended, because a "not done" list
that lies is worse than none.

- **No way to CREATE or EDIT an event.** The queue decides on events; nothing
  composes them. Adding one still means the SQL editor. That is the next real
  piece of the editor.
- **No session refresh.** A session is stored in `localStorage` and lasts one
  hour, after which the queue says so and sends you back to sign in. The
  refresh token is kept but never used — `POST /auth/v1/token?grant_type=refresh_token`
  is maybe ten lines, and until it exists an hour of work ends with a sign-in.
- **No sign-out that actually revokes.** `signOutLocally()` clears this browser
  and says so; the session row and its refresh token stay live in the database
  until they expire. Real revocation is `POST /auth/v1/logout` with the access
  token in hand.
- **Dev has no editor.** `editor.nissartango.fr` points at production, and
  `config.js` hard-codes production's ref. There is no way to exercise this
  against `hjsekipqryfuwdkhxuks`, which means every test is a production test.

**Custom SMTP is no longer a blocker.** Solved 2026-09-21: Resend, sending as
`Nissartango <no-reply@nissartango.fr>`, proven by delivery to an address that
is not on the Supabase organization. See `supabase/PROJECT_SETUP.md`.
