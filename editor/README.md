# nissartango-editor

The editor origin. Today it is two static pages that receive a magic link and
say what came back. It is **not** the editor yet.

## Why it exists now, ahead of any editor UI

Supabase Auth's Site URL for production was set to
`https://editor.nissartango.fr` on 2026-09-19, while that hostname did not
exist. `site_url` is also the fallback for any `redirect_to` that is not
allow-listed, and `http://localhost:3000` was dropped from the allow-list in the
same change — so every magic link the production project issues currently lands
on NXDOMAIN, with nothing behind it.

Deploying this fixes that, because **the route below is the DNS record**.

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

## Deliberate constraints

**No third-party script, and a CSP that enforces it.** `public/_headers` sets
`script-src 'self'` with no `'unsafe-inline'`, which is why neither page has an
inline `<script>` and `session.js` self-initialises. Any script loaded on the
callback page can read `location.hash`, which is to say it can read an access
token. `supabase-js` from a CDN is the ordinary choice and the wrong one for
the single page in this project that handles a credential.

**`connect-src` is `'self'` and that is not an oversight.** Nothing here calls
Supabase yet. When the editor does, that line must gain the project origin as a
visible edit someone can question — not a wildcard added in advance.

**No `main` in `wrangler.jsonc`.** Static assets only, so there is no
server-side code path that could hold a key. The editor will talk to Supabase
from the browser, with the publishable key and the caller's own JWT, which is
what keeps RLS the enforcement rather than something a Worker has to remember.

**A separate deployment from `nissartango`.** The public site keeps having no
authentication surface at all: a bug here cannot take the agenda down, and
nothing here can widen what `anon` reads.

## Not done here

- No editor UI, no reads, no writes.
- No session persistence. The token is read, displayed as claims, and the
  fragment is cleared from the address bar. Nothing is stored.
- **Custom SMTP is still a hard blocker for anyone but the org owner.** The
  built-in email service sends only to Supabase organization team members and
  refuses everyone else with "Email address not authorized". See
  `supabase/PROJECT_SETUP.md`.
