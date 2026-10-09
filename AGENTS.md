## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)



## What this is

A French-language agenda for social dance across Nice and the Côte d'Azur —
classes, practicas, milongas, stages, demos, festivals. Covers both my own
events and other organizers'. Roughly 200 events a year expected. I'm the sole
maintainer.

**Tango-first but not tango-only**, confirmed 2026-10-01. Bachata, kizomba and
danse corse are on the agenda on purpose. This line said "an agenda for tango"
until then, and the schema still assumes it: `event_type` is entirely tango
vocabulary, so a Corsican dance evening is currently stored as a `milonga` and
the page shows a reader the badge **Milonga**. Format and dance style are two
axes and there is only one column; see Outstanding.

Live at **https://nissartango.fr**

## Stack

| Layer | Choice |
|---|---|
| Framework | Astro 7.2.4, static output. `@astrojs/cloudflare` is a dependency but is **not** configured in `astro.config.mjs` — checked 2026-09-19. The build is plain static and the adapter is unused; it is presumably being kept for the editor deployment. |
| Host | Cloudflare Workers with static assets |
| Repo | GitHub `dimuthu-wije/nissartango`, auto-deploys on push to `main` |
| CMS | None. Content lives in Supabase; the site builds from `data/snapshot.<ref>.json`. Sveltia was removed and `/admin/` 404s. |
| Domain | OVH registrar, Cloudflare DNS |
| Local | macOS, Node 22 via nvm, project at `~/dev/nissartango` |

## Content model

Three collections, defined in `src/content.config.ts`, all built from the
snapshot. The field names are the database's, in snake_case. Checked against the
schema 2026-09-19; the camelCase list that used to be here was the markdown era
and matched nothing in the code.

**`events`** — `db_id`, `slug`, `legacy_slugs` (array), `title`, `formats`
(array), `starts_at`, `duration_minutes`, `timezone`, `recurrence`
(none/weekly/biweekly/monthly), `recurrence_end`, `location_name`,
`location_address`, `location_postal_code`, `city`, `organizer_id`, `teachers`
(array), `price_full`, `price_member`, `price_note`, `payment_methods` (array),
`signup_url`, `image_path`, `image_file`, `body`, `cancelled_at`,
`cancellation_note`, `created_at`, `updated_at`

**`formats`, not `type`.** There was a single `type` enum column
(cours/practica/milonga/stage/demo/festival) until 2026-10-01, when it was
replaced by a text[] of the same slugs plus `soiree`, and then dropped
(`20261001120000`, `20261001140000`). Two reasons, and the first is the one
that forced it: an evening is often a class AND then dancing, and one value
cannot say both — production encodes it in a title, "Milonga précédée d'une
practica", which nothing can filter on. The second is that every enum label was
tango vocabulary while the agenda is tango-FIRST, not tango-only, so a Corsican
dance evening was stored as a `milonga` and its page said so.

The dance STYLE is deliberately not a column: it is in the title of every such
event, and a `dance` field earns its keep only once something filters on it.

`formats` is `not null`, constrained by `events_formats_known` (containment, not
an enum — see the comment in `20260930120000`) and bounded at three. The labels
live in `src/lib/format.js`, copied verbatim to `editor/public/format.js`, with
`tests/format.test.js` reading the migrations to keep the list and the CHECK in
step. That test exists because they diverged: `soiree` was legal in the CHECK
and not in the enum, and since the editor wrote `formats[0]` into `type`, the
first use of the feature failed.

**`organizers`** — `db_id`, `name`, `slug`, `website`, `instagram`, `facebook`,
`tiktok`, `created_at`, `updated_at`, `contact_email`, `contact_phone`.

**There is still no `email` and no `phone` here, and `contact_*` is not them.**
The private pair is absent from the public view as well as from this schema, and
that absence is the boundary keeping organizer contact details out of a public
build and a public repo. They exist in production and in the private
`nissartango-backups` repo, nowhere else. This file previously listed both as
organizer fields, which described the boundary backwards.

`contact_email` and `contact_phone` are a different fact, added 2026-09-22
(`20260922120000_organizer_public_contact.sql`): what an organizer **chose to
publish**, rather than how I reach them. They are public on purpose, rendered on
the event page, and the database refuses to hold either without a consent
timestamp beside it — `contact_email_consent_at` / `contact_phone_consent_at`,
which are themselves private and are NOT in the view. A form that forgets the
"published publicly, permanently" checkbox cannot write the column.

They exist because their absence was causing the leak the build warns about:
with nowhere sanctioned to put a phone number, it goes in an event's `body`.
`verify-build.mjs` still notices a contact detail in free text, but the warning
now means "check they meant to, and tell them about the field" rather than
"this is about to enter git forever", which stopped being true when
`data/snapshot.json` left the index on 2026-09-17.

**`exceptions`** — `event_id`, `occurrence_date`, `kind` (cancelled/moved),
`note`, `moved_starts_at`

## Key files

```
astro.config.mjs              site URL + i18n (fr default, en prefixed)
wrangler.jsonc                workers_dev false, preview_urls true, custom domains
src/content.config.ts         all three collection schemas, built from the snapshot
src/lib/occurrences.js        expand() / upcoming() / nextDate() / RECURRENCE_LABELS
src/lib/content.ts            loadAgenda() / socialLinks() / priceSummary() / formatters
src/lib/snapshot-path.mjs     which snapshot file a build reads, keyed by project ref
src/lib/redirects.mjs         public/_redirects, generated from events.legacy_slugs
scripts/db-push.sh            migrations to a HOSTED project, naming the ref first
src/data/site.ts              SITE_ORGANIZER_ID
src/data/nav.ts               the navigation, in one array
src/styles/fonts.css          @font-face, GENERATED by scripts/make-fonts.mjs
src/styles/tokens.css         THE design values, light + dark. The only place
                              a colour or a size may be written down; copied
                              verbatim to editor/public/tokens.css
src/styles/base.css           element defaults and the page shell
src/layouts/Layout.astro      shell markup and OG tags; imports the two above
src/pages/index.astro         agenda listing
src/pages/archives/index.astro  past events, grouped by year
src/pages/evenements/[slug].astro      event detail
src/pages/build-info.json.ts  the deploy's own receipt: ref, commit, counts
scripts/fetch-content.mjs     fetches Supabase -> snapshot
```

Every path above was confirmed to exist on 2026-09-19. The list previously named
`src/lib/events.ts` and `src/pages/evenements/[...slug].astro`; neither has ever
existed under those names in this layout, and `src/content.config.ts` was listed
twice.

### Handovers and briefings — `docs/`

**Read the highest-numbered one before starting.** It records what a stage of
work established and the corrections it owed: which instruments lied, which
confident claim turned out not to describe this project, and why something is
the way it is when the code alone does not say.

    docs/DESIGN.md            the design system: the palette with every
                              contrast ratio MEASURED, the type scale, the
                              spacing and shape language, and an explicit
                              list of what was NOT taken from the reference.
                              In English, like the rest of docs/ and unlike
                              the two guides -- it is a build document, not
                              an operating one.
    docs/GUIDE-admin.md       what only the admin can do, and where each thing
                              lives: the queue's three buttons and which one
                              removes a live event, inviting somebody, creating
                              an organizer (SQL only, by design), the deploy
                              order when a migration and the editor change
                              together, and how to confirm any of it worked.
                              Companion to editor/public/aide/, which is the
                              same thing for an organizer. BOTH ARE IN FRENCH,
                              unlike the rest of docs/: a handover is for
                              whoever takes the code over, an operating guide is
                              for the person who runs this, and he reads French.
    docs/HANDOVER-stage6.md   the editor arc, e22ca1d..3522615
    docs/HANDOVER-stage5.md   auth blocking facts, production as of 2026-09-19
    docs/BRIEFING-stage5.md   WHY the schema is shaped this way -- the views as
                              the column whitelist, user_roles vs a JWT claim,
                              and why the editor is a separate deployment
    docs/DRAFT-free-text-section.md
                              SUPERSEDED. The authority is
                              supabase/PROJECT_SETUP.md:989. Kept for one
                              measurement recorded nowhere else: build 9597906f,
                              which proved verify:build had never run on a deploy

The briefing is the one to read before designing anything that touches
`events_public`, `user_roles`, or the editor's deployment shape; its §1-§3 have
not aged.

All three carry a preface listing what has been superseded. **Read that box
before the body** — and read what it says is still current, which is the half a
reader is likeliest to discount once part of a document is marked stale.

All three were written into `Claude outputs/` first, which is **gitignored**
(`.gitignore:79`), and all three were moved here on 2026-09-22. A stage 5.1
handover was pasted into a session and never written down anywhere, so nothing
records what it said.

`Claude outputs/` remains ignored and is the right place for working output —
it is empty as of 2026-09-22. A handover is not working output, and neither is
the evidence behind a decision.

Two sessions in a row searched for these, read an empty result as "none exist",
and were wrong in both directions — first that there were none, then that the
ignored ones were tracked. Hence the explicit path above.

**Write the next one into `docs/` and commit it in the same breath.** The repo
is PUBLIC, which is a constraint on what a handover may contain, not a reason to
leave it out of git: nothing in one should need a secret to be useful.

## Decisions made, and why

- **Astro over Next.js/plain HTML** — zero JS by default, good SEO, shared
  layouts without a React runtime.
- **French-first, English deferred.** English will cover UI chrome and a few
  practical pages only. Per-event translation was deliberately dropped: 200
  events a year of translation maintenance for near-zero value, since dates,
  venues and prices are already comprehensible and tango titles are proper nouns.
- **Date-prefixed slugs** (`2026-09-01-practica-mardi`). Locked in — links are
  shared publicly, so changing this breaks them.
- **Recurrence expands at build time.** One file generates many agenda rows but
  a single detail page describing the series. Per-occurrence pages were rejected
  as thin duplicate content.
- **Social handles, not URLs.** Store `nissartango`, build the link in template.
- **Contact info on the organizer, not the event** — avoids the same handle
  being typed (and mistyped) across dozens of events.
- **Email and phone never reach the build.** Not "deliberately not rendered",
  which is what this line used to say: they are excluded from the public view,
  so the build never receives them and no template mistake can leak them.
- **The agenda is two sections: news and furniture.** Decided 2026-10-03.
  `sections()` in `src/lib/occurrences.js` splits the upcoming occurrences into
  `stream` -- one-off events, plus the dates a regular does NOT behave normally
  -- and `regulars`, one entry per series.

  Measured before: a single weekly milonga occupied EIGHT consecutive rows,
  identical but for the date, with two events in the database. At ~200 events a
  year and half a dozen weekly regulars that is several hundred near-identical
  rows between a reader and the thing that is actually unusual. A weekly
  practica is furniture; a festival on 14 November is news; one chronological
  list buries the news under the furniture.

  THE CANCELLATION LANDING IN THE STREAM IS THE POINT, not a side effect.
  "Pas de milonga à la Casita ce jeudi" is the most useful line the agenda can
  carry about a regular, and it used to sit among seven identical rows saying
  the opposite. Collapsing the series makes an exception the ONLY time that
  event appears chronologically, so it cannot be missed.

  `sections()` takes the occurrences `partition()` already produced rather than
  expanding again: two expansions of the same events could disagree about which
  dates exist, and not disagreeing is why `partition()` exists at all.

  Honest limitation, visible today: with two events in the database, "À venir"
  contains ONLY a cancellation, so the first thing a visitor reads is something
  that is not happening. That inverts as soon as there are real one-off events.
  Judge the balance again at twenty, not at two.

- **One duration per event, and leaving it empty is an answer.** Decided
  2026-10-02. `duration_minutes` is a single column, so a multi-day workshop
  whose Saturday runs three hours and whose Sunday runs two cannot be described
  by it — and an exception's `moved_starts_at` moves a *start*, not a length.
  The sanctioned shape for that case is to leave the field empty and put the
  schedule in the description: the page then says only when it starts, and no
  `endDate` is published at all, which beats publishing an end nobody chose.

  Per-occurrence durations were designed and NOT built. The honest version is
  `event_occurrences(event_id, starts_at, duration_minutes)` replacing
  `extra_dates` — each date with its own start and length. It was declined for
  now on cost, which is the sixth-table cost `20260930120000` sets out plus a
  FOURTH view inside `content_checksum`, which the poller and `build-info.json`
  both read. Revisit when a second real multi-day event has genuinely differing
  days; one case is not enough to know whether per-day *starts*, breaks or two
  sessions a day are wanted too.

  Rejected on the way: putting the duration on `event_exceptions`. Its
  constraint is `(kind = 'moved') = (moved_starts_at is not null)`, so a day
  changing only in length would have to be filed as "moved" to the time it was
  always at — and the page then labels it **déplacée** and emits
  `previousStartDate`, publishing a claim that something was rescheduled when
  it wasn't. A different Sunday schedule is also not an *exception*; it is the
  schedule, and it does not belong in a section called Exceptions.

- **The page shows a time SPAN, not just a start.** `duration_minutes` had
  exactly one use in the whole site until 2026-10-02 — schema.org's `endDate` —
  so it was public to machines and invisible to readers. The Mauro et Sol
  workshop's markup said three one-hour sessions for 120 € while the page said
  only "à 18:00": wrong only where nobody looks. `src/lib/span.js` renders
  "de 18:00 à 21:00", or "de 21:00 à 01:00 (le lendemain)" when it crosses local
  midnight — decided by comparing local date keys, not clock faces, so 23:30 +
  20 min and 23:50 + 20 min are told apart. The agenda listing deliberately
  still shows a start time only; 44 rows each carrying a span is density nobody
  asked for.

- **Media lives in Supabase Storage and is pulled into `src/assets/events` at
  build time.** Proven end to end on 2026-09-26; before that these lines said
  media "would go in `public/uploads/events`, not `src/assets`", which was the
  markdown-era plan and had been superseded without the note being updated. It
  is what made `image_path` look unbuilt when it was finished.

  The actual pipeline:

      events.image_path  <organizer_id>/<event_id>/<filename> in the PRIVATE
                         event-images bucket (20260828190200_storage.sql)
      fetch-content.mjs  downloads each referenced object with the ANON key,
                         via the bucket's read policy, into src/assets/events/
                         named flatten(image_path)
      events.image_file  that flattened filename, set by fetch-content
      [slug].astro       import.meta.glob over src/assets/events, rendered
                         through Astro's <Image>

  `src/assets` and not `public/uploads` precisely BECAUSE Astro processes and
  hashes it: the flyer comes out as a hashed WebP with a srcset. Measured with
  a real 600x400 PNG — one upload, one download, `<img srcset>` with 400w and
  600w WebP, and **no `supabase.co` anywhere in the built HTML**.

## Gotchas learned the hard way

1. **Blank optional fields arrive as `""`, not as absent.** Zod's `.optional()`
   rejects empty strings, which fails the build. All optional fields use
   `z.preprocess` helpers (`optionalString`, `optionalUrl`, `optionalDate`)
   that convert `""` to `undefined`. Written for Sveltia; still true of anything
   that submits an empty form field, so it stays.
2. **THE SVELTIA SECTIONS OF THIS FILE WERE STALE AND ARE STRUCK.**
   `public/admin/config.yml` does not exist and `https://nissartango.fr/admin/`
   404s. Every collection is built from the snapshot via `snapshotLoader` in
   `src/content.config.ts`, and `fetch-content.mjs` never writes to
   `src/content/`. Six tracked files under `src/content/events/` and
   `src/content/organizers/` were dead Sveltia-era content that nothing loaded
   and that had drifted from the database — the tracked
   `2026-09-01-practica-mardi.md` said `location: "Salle à confirmer"` and
   `price: "10€"` where the snapshot's row said neither. The drift was measured
   2026-09-17; the files were deleted in `b8abc2b`, committed 2026-09-19.

   That strike was incomplete when it was written. Five further CMS references
   survived elsewhere in this file — the media decision above, gotchas 3 and 4,
   and two Outstanding items — and were corrected on 2026-09-19. A fix that
   lands in one place and declares the file done is the recurring failure in
   this project; grep the whole file before claiming a section is struck.
3. **A failed build doesn't take the site down.** Cloudflare keeps the last good
   deployment, so a broken build leaves the site looking perfectly correct while
   content changes stop reaching it.

   **Broken deploys are no longer silent.** `workers/build-notifier/` emails on
   build failure, and only on failure. It has actually delivered: two emails for
   builds `f5116ffa` and `8c421f1c` on 2026-09-14, and no email for the success
   that followed — recorded in `workers/cron/OPERATIONS.md`.

   But an absence of mail is not proof of health: a Worker that stops running
   triggers no builds and so emits no events, which looks identical. To confirm
   a deploy positively, require that `built_at` has MOVED:

       curl -s "https://nissartango.fr/build-info.json?t=$(date +%s)"

   A stale cache can only return an older `built_at`, never a newer one, so a
   move is conclusive while a non-move is ambiguous. See
   `workers/build-notifier/README.md` for why that asymmetry is the whole test.

   **That file is PRETTY-PRINTED** — `JSON.stringify(body, null, 2)` — so every
   field reads `"commit": "..."` with a space after the colon. A grep for
   `'"commit":"'` matches nothing and yields an empty string, which in a polling
   loop is indistinguishable from "the site returned nothing" and from "not
   deployed yet". That cost three false alarms on 2026-09-26. Parse it (`jq`,
   `python3 -m json.tool`) or strip whitespace first; do not pattern-match
   compact JSON against it.
4. **Always `git pull` before working.** The reason is no longer the CMS —
   nothing commits to GitHub on its own now. Content lives in Supabase and
   reaches the site through the poller's deploy hook, which produces a
   deployment and no commit. The reason now is that this project is worked from
   more than one session: on 2026-09-19 a session was briefed that HEAD was
   `aa57a14` and found `main` already one commit past it, pushed and deployed.
5. **`workers_dev` is false.** `nissartango.fr` is the only production URL. The
   `*.workers.dev` address no longer resolves.
6. **Astro 7 is past Claude's training cutoff.** Verify Astro API details against
   current docs rather than assuming; the running dev server is more
   authoritative than recalled syntax. The `loader:` property on collections and
   the `@astrojs/cloudflare/entrypoints/server` main path are both current-form.
7. **Run `npm run build` locally before every push.** Faster than reading
   Cloudflare build logs.
8. **`supabase db push` targets whatever is LINKED, and that is production.**
   `supabase/.temp/project-ref` read `eqcgeqzzuzcwrflwasjo` on 2026-09-19, so
   intending "try it on dev first" and typing the obvious command would have
   migrated production and reported success. The project names are backwards
   too, so nothing on screen would have contradicted you. Use
   `./scripts/db-push.sh dev|prod`, which pushes by `--db-url` and prints the
   ref — read out of the connection string, not out of the argument — before it
   touches anything.
9. **A dry run and a real push look almost the same on screen.** Both name the
   same migration and both end `Finished supabase db push.` Measured
   2026-10-01, pushing `20260930120000_payment_methods.sql` to production:

       dry run  {"upToDate":false,"dryRun":true, "migrations":[...],"message":"Finished supabase db push."}
       real     {"upToDate":false,"dryRun":false,"migrations":[...],"message":"Finished supabase db push."}

   One field differs. The line above it differs too — `Would push these
   migrations:` against `Applying migration ...` — but it scrolls away, and the
   habit is to read the last line. On 2026-10-01 this migration was reported
   as applied to production twice before it had been — the second time with
   `--dry-run` still on the command line — and both times the database said
   otherwise.

   **`Applying migration <file>...` is the only line that means it happened**,
   and `"dryRun":false` is the only field.

   So do not take the push's own word for it. Two readings that do not depend
   on it:

       supabase migration list --db-url "$PROD_DB_URL"
           -> {"local":"20260930120000","remote":"20260930120000", ...}
              `"remote":""` is local-only, whatever the push said.

       curl "$SUPABASE_URL/rest/v1/events_public?select=<new column>&limit=1"
           -> 200, with the column

   **The API alone is not sufficient.** PostgREST caches the schema, so
   `column ... does not exist` means either "not applied" or "applied, cache
   not reloaded yet" — one answer for two states, which is the shape this file
   calls an instrument that lies quietly. The migration history is read from
   the table and does not pass through PostgREST, so the two together settle
   what neither settles alone.

   Column-level grants are worth a third look, because this schema uses them as
   the whitelist: the column existing and the editor being allowed to write it
   are separate facts, and a migration can land one without the other.

   Finally, a schema change reaching a public view moves `content_checksum`
   even though no content changed — the digest is over each row's full text.
   Counts unchanged and digest moved is the signature; the poller rebuilds
   within ten minutes on it.
10. **`public/_redirects` is generated and gitignored.** It comes from
   `events.legacy_slugs` via `scripts/fetch-content.mjs` on every build. Do not
   edit it and do not commit it: the copy on disk is output. It was hand-written
   until 2026-09-19, when it turned out that rejecting the one event it pointed
   at would have failed `verify-build.mjs` check 7 and frozen the site.

## Outstanding

**Unverified from the last round:**
- ~~Confirm no stray `image=` text renders on event pages~~ — **DONE
  2026-09-26.** Zero occurrences of `image=` in the visible text of a page that
  actually HAS an image, which is the only state in which it could have failed.
- ~~Decide what `image_path` / `image_file` resolve to~~ — **ANSWERED
  2026-09-26**, and the answer was "they already resolve": Supabase Storage →
  `src/assets/events` → Astro. See the media decision above. The open question
  was never the design; it was that the design had been built and the note not
  updated.
- ~~Confirm organizer social links render on event detail~~ — **DONE
  2026-10-01**, and it had been unverifiABLE rather than unverified: no
  organizer held a handle, so there was nothing for the template to render and
  no outcome that distinguished "works" from "silently drops it". Measured in
  the built page once Nissartango had all three:

      Site       https://tango-guinguette.com/
      Instagram  https://instagram.com/bicilonga
      Facebook   https://facebook.com/bicilonga
      TikTok     https://tiktok.com/@bicilonga

  TikTok's `@` is in the prefix `socialLinks()` builds and NOT in the stored
  handle, which is the one asymmetry among the three and the one a copied
  profile URL gets wrong.

  Filling those three fields is also what found the next item: every one of
  them was first filled with a URL, and the refusal said the same thing three
  times.

**Next up:**
1. ~~Add ~10 real events~~ — **DONE 2026-10-01**, 11 events by 3 organizers,
   entered through the editor rather than directly in Supabase. The friction it
   was meant to surface is what the 2026-09-26..10-01 editor commits fixed.

   Still open from it: **Bicilonga is `recurrence: none`** where it should be
   `weekly` + `recurrence_end`, and **Milonga de Cécile is typed `demo`** — a
   weekly demonstration running to 31 December reads as a slip for `milonga`.

   What the 11 do NOT cover, which is where to spend the next few rather than
   on volume: no `monthly` or `biweekly` series, no `festival`, no `signup_url`
   on any of the 11, 10 of 11 in Nice, and **no organizer with a social handle**
   — which is why "confirm organizer social links render" below is not merely
   unverified, it is unverifiable until one exists.
2. ~~One column holds two axes: format and dance style.~~ — **DONE
   2026-10-01.** `formats text[]` replaced `type`, `soiree` was added, and the
   old column and its enum are dropped. See the Content model above for what it
   is now and why.

   Three things that migration taught, kept because each cost something:

   - `create or replace view` cannot drop a column, and a RECREATED view in
     `public` is subject to Supabase's default ALL grant to anon. events_public
     is auto-updatable and runs `security_invoker = false` by design, so a
     recreate that omits the `revoke all` hands anon INSERT through a view that
     bypasses RLS. `20261001140000` does the revoke; `rls_tests.sql` proves the
     result (`anon cannot write through events_public -> refused`).
   - `events_flag_review()` compares the content columns BY NAME in plpgsql, so
     dropping one leaves a trigger that raises `record "new" has no field
     "type"` on the next edit. Found by the local suite's seed insert failing,
     not by reading. Fixing it also revealed that `payment_methods` had never
     been added to that comparison since 2026-09-30 — so changing how an event
     may be paid for did not flag it for review.
   - `supabase/seed.sql` and the four files in `supabase/tests/` insert events
     by column name too. 18 literals and 17 column references, in four files.
     A column is not dropped until everything that writes it is found.
3. Convert `organizer` city/name free-text drift to selects once real values exist
4. ~~Past-event archive~~ — **DONE 2026-09-26.** `/archives/`, grouped by year,
   newest first.

   This line said past events "vanish entirely". They did not: their pages were
   built, live and in the sitemap. What vanished was any route TO them — four
   of five event pages were linked from nowhere, reachable only from a search
   result or a saved link. Worth the distinction, because it changed the fix
   from "keep the pages" to "list them".

   The agenda and the archive are now complementary BY CONSTRUCTION —
   `partition()` in `src/lib/occurrences.js` defines archived as "produced no
   listed occurrence", so no event can fall between them. `verify-build.mjs`
   check 8b fails the build if any event page is unreachable from either.
5. Month grouping and FORMAT filtering (needed around 30-40 events). `formats`
   is an array, so a filter matches on ANY of an event's formats — a class
   followed by dancing belongs under both Cours and Soirée.
6. English pages (`/en/`) — UI and practical pages only
7. Event submission for other organizers, so I'm the editor rather than the
   data-entry clerk. **PARTLY DONE 2026-10-03**, and the part that was done is
   the part that was actually costing time.

   Measured first: the event form had worked all along — a member creates a
   `pending` event and the queue publishes it. The bottleneck was *becoming a
   member*, which cost three SQL statements and a dashboard lookup per person,
   because `organizer_members.user_id` references `auth.users` and PostgREST
   cannot see that schema. `20261003120000` adds two SECURITY DEFINER
   functions, and the organizer page grew a **Membres** section: an owner adds
   somebody by email, sees who is on the organizer, and removes them.

   Removal got no function: `authenticated` has had DELETE on
   `organizer_members` since the start under `members_owner_write`, and the
   listing supplies the uid.

   **The person must already have an ACCOUNT**, and they cannot make one
   themselves. This was written on 2026-10-03 as "they must have signed in
   once", which was wrong and was found the same day by rehearsing the flow:
   `requestLink()` in `editor/public/auth.js` sends `create_user: false`, so
   asking for a magic link with an unknown address returns

       Signups not allowed for otp

   That is OUR code and a deliberate one — its comment says a sign-up "is a
   decision with a moderation consequence… and it does not belong behind an
   email field on a page anyone can open". The project-level setting is not the
   cause: production reads `disable_signup: false`.

   So the flow is: **dashboard → Authentication → Users → Invite user**, then
   Membres → add by email. `NT006` is raised when the address has no account,
   so the editor can say so — but the fix for it is an invitation, not "sign in
   and try again".

   The pending-invite design was declined that morning in favour of "tell them
   to sign in first". That comparison was void: the alternative did not exist.
   Reopen it on its merits if onboarding ever happens more than a few times.

   **`myOrganizers()` answers "organizers I may create EVENTS for"**, and the
   organizer page uses the same list for "organizers I may administer". Those
   are different questions: an admin who is not a member of an organizer can
   edit it (`organizers_admin_all`) but will not see it listed, and must reach
   it by its `/organizer/?id=…` URL. Left that way on 2026-10-03, deliberately
   — the maintainer is a member of all three organizers, so it bites nobody,
   and splitting the two means a second query plus a role check for a case that
   does not exist yet. It became visible that day: the list used to be
   unfiltered and RLS's `or is_admin()` showed an admin every organizer through
   OTHER people's membership rows, which was also what made the same organizer
   appear once per member.

   STILL NOT BUILT, deliberately: self-serve organizer registration, and a
   public form needing no account. Both optimise a funnel with no traffic — no
   organizer other than me has used the editor. The cheap test is to onboard El
   Gato Tanguero and Rosa Gervasi with what exists; if they use it, build more,
   and if they would rather send a flyer by WhatsApp then the honest answer is
   that curation IS the product and the clerk work stays.

   Two things to re-read before reopening it. `wrangler.jsonc` deliberately has
   no `main`, so the public site has no runtime code path to Supabase and the
   editor is a **separate deployment** — a public form needs a service key and
   therefore a Worker. And `20261003120000`'s header explains why
   `add_organizer_member` is an email oracle and why that is bounded rather
   than removed; a public signup flow changes that calculus.
8. ~~Pin Node version~~ — **DONE 2026-09-26.** `.node-version` and `.nvmrc`
   both say `22.23.2`, `engines` is `>=22.12.0 <23`, and
   `tests/node-version.test.js` binds the three so they cannot drift.

   22.23.2 because Cloudflare's build image PREINSTALLS it (their build-image
   docs, checked 2026-09-26) while defaulting to 24.18.0 — so the pin costs no
   download and puts CI on the version this project is actually developed and
   tested on. Pinning to 24 would have meant shipping from a version nobody
   here had run a build on.

   `build-info.json` now reports `node`, which is the only way to confirm from
   outside that the pin took: a deploy still saying v24.18.0 means the file is
   not being read.
9. ~~Redirect `www` to the naked domain~~ — **DONE 2026-09-26**, with a
   Cloudflare **Redirect Rule**. Measured from outside:

       /                          301 -> https://nissartango.fr/
       /archives/                 301 -> https://nissartango.fr/archives/
       /evenements/<slug>/        301 -> https://nissartango.fr/evenements/<slug>/
       /?utm_source=flyer&x=1     301 -> https://nissartango.fr/?utm_source=flyer&x=1

   One hop to a 200, path and query preserved, and the naked domain still 200s.

   **`public/_redirects` cannot do this.** Cloudflare's static-asset redirects
   documentation lists "Domain-level redirects" as NOT supported and defines
   `source` as a file path. `_redirects` was the obvious first guess and was
   checked against the docs before anything was written, which is the only
   reason it was not tried and quietly left half-working.

   **A Redirect Rule fires even though `www` is still a Worker custom domain.**
   Recorded here as a CLAIM from Cloudflare's docs — requests handled by
   Workers "will not suppress actions from modern Rules features" — and then
   measured on this zone, which is what promotes it to a fact about this
   project. So `wrangler.jsonc` keeps both routes and www keeps resolving;
   nothing had to be removed.

   That ordering matters if it is ever revisited: wrangler provisioned www's
   DNS record, so deleting the route would take www from a working 301 to not
   resolving at all. Add or change the rule first; touch the route second, if
   ever.

   Re-check with:

       curl -sS -o /dev/null -D- --max-redirs 0 https://www.nissartango.fr/ \
         | tr -d '\r' | grep -i '^location'
10. Listings on tango aggregators + Google Business Profile — the site won't
   generate its own audience
11. **The design system — all five stages done**, 2026-10-09. `docs/DESIGN.md` is
   the spec. `src/styles/tokens.css` is now the only place a design value may
   be written down, both deployments read the same copy of it, and
   `tests/design-tokens.test.js` refuses a literal colour outside a token
   definition, a font-size off the scale, and a `var(--x)` that nothing
   defines. That last one was not hypothetical: `--bad` and `--surface` were
   being used by pages and defined nowhere, so the archive's "Annulé"
   silently rendered in inherited ink.

   Reconciling the two palettes also turned up a live accessibility bug in
   the editor, unrelated to the refactor and older than it: `.btn-danger`
   set a white label over `--bad`, which flips to a light pink `#e79a9a` in
   dark mode — 2.21:1, on "Oui, supprimer définitivement", the one button
   with no undo. It now uses `--bad-fg`, which flips to ink at 8.17:1. Light
   mode is unchanged at 8.19:1.

   What is NOT done, in the order it will bite:

   - ~~The favicon and the social card still carry the old maroon.~~ **DONE
     2026-10-09.** Both generators now READ `design/brand/` instead of
     carrying their own copy of the mark and the accent, so the logo has one
     definition and regenerating after a change to it needs no edit in
     `scripts/`. `#a01b2e` no longer appears anywhere in this repo.

     The social card's brand lettering is now OUTLINES rather than <text>,
     which was not the plan but turned out to matter: measured the same day,
     librsvg draws text but does not honour `font-family` AT ALL — Times and
     Helvetica come back identical in metrics. So the named font stack the
     card had always carried was decorative, and the wordmark was being set
     in whatever the renderer happened to pick. The description line is
     still <text>, deliberately: it is prose, and og:description carries the
     same words to anything reading markup rather than pixels.

     Still untested: nothing asserts that the committed icons match
     `design/brand/`. The `rx="26"` the iOS icon depends on IS asserted, in
     `make-favicon.mjs` itself, because a silent no-op there produces a
     double-masked icon and no error.
   - ~~The editor's type is not on the scale.~~ **DONE 2026-10-09.** 26
     declarations across twelve distinct values between 0.72 and 1.35rem are
     now five tokens. `tests/design-tokens.test.js` covers BOTH deployments.

     **This entry used to say the conversion "moves its body from 13.6px to
     16px and relayouts five working pages", and that was simply wrong.** The
     editor's body has been 16px since it was written — `font: 16px/1.6` on
     line 46 of the original. 13.6px (0.85rem) was its most common OVERRIDE,
     not its body. The error made the job look more expensive than it was,
     which is the direction that keeps work from being done.

     One token is the editor's own: **`--text-ui`, 14px**, beside
     `--weight-ui`. The public ramp steps 11 → 16 → 19 because a reading page
     needs nothing between; a form of field labels, hints, inline errors and
     small buttons needs exactly that, and eleven of the editor's ad-hoc
     values lived there.

     Two exemptions, both reasoned rather than inherited:

       - **`em`** — `.guide code` is `0.9em` because monospace set at the same
         pixel size reads larger than the proportional text around it. That is
         a RATIO to its surroundings, not a point on a scale, and no rem token
         could express it.
       - **SVG presentation attributes.** The guide's diagram sets
         `font-size="11.5"` and friends as attributes, which have no colon and
         so escaped the rule entirely until this was looked at. They stay.
         An SVG with a viewBox scales as a whole, and text in USER UNITS
         scales with it; a rem value would stay fixed while the boxes and
         arrows shrank, and the labels would burst out of the shapes they
         label. What is asserted instead is that none of them carries a unit,
         because a unit is exactly what would pin one and break that.

     Its WEIGHT is settled, though, and differs from the site's on purpose.
     The editor sets its body in 400 via `--weight-ui`, declared in its own
     token block beside `--card`: one weight at every size is the reference's
     editorial signature and belongs on the public site, while in a dense form
     of labels, inputs and status chips it reads heavy. Declared there rather
     than by redefining `--weight`, because two values behind one name is the
     failure the shared file exists to end.

     Two things that only showed up by looking at the running editor:

       - it already had a `font-weight: 400` rule, and with only 500 and 600
         shipped the browser had been quietly rendering it in the 500 face.
         Setting the body to 400 without adding the face would have changed
         nothing at all.
       - its h1/h2 set no weight, so they inherited the browser's `bold` =
         700. Fine while it used a system font with a real 700, and silently
         not fine from the moment Inter was self-hosted without one — the
         browser matched 700 down to the 600 face. They now declare
         `--weight-strong`, which is a face that exists. Same pixels, no
         guessing.

     Inter 400 therefore ships to BOTH deployments: one generated fonts.css
     and one verbatim copy beats two that drift. Measured — the public site
     fetches only the 500; 400 and 600 stay `unloaded` there. 24KB of storage,
     zero bytes of transfer.
   - **The shell is 64rem and that is NOT a measured result.** With two events
     in the database the hairlines run ~200px past the longest title. Judge it
     at twenty rows, not at two — the same caveat as the two-section split.
   - **A cancellation has no tag element.** "Annulé" is plain ink body text
     now; the strikethrough and the dimming carry it. Dropping the red was
     deliberate (it sat one hue from the brand orange and the two muddied each
     other) but the result is quiet, and stage 4 — which touches markup —
     should give it its own element.
   - **Inter is not self-hosted. There is no `@font-face` in this repo at
     all**, so the stack falls through to Helvetica Neue, which is the face
     the reference actually specifies. It degrades to the right thing, but
     only on machines that have it.
   - ~~Stage 3, the shell.~~ **DONE.** The wordmark is INLINED SVG, not an
     `<img>`, because its two ink paths are `currentColor` while the ART keeps
     its literal orange — one file that follows light and dark with no second
     asset and no JavaScript, which an `<img>` cannot do. It is imported
     `?raw` from `design/brand/`, so the logo still has exactly one definition
     and the two generator scripts read the same file.

     Navigation exists for the first time: `src/data/nav.ts`, one array.
     Adding Blog is a line there. Entries carry a trailing slash because
     verify-build check 8 fails on an emitted URL that would 301 — the right
     way round. `isCurrent` is an EXACT match, not a prefix: an event page
     belongs to the agenda or to the archive depending on whether it has
     happened, the layout cannot know which, so no entry is marked on one.

     Prose styling (`.prose`) is defined for the blog and articles that are
     coming, and applied to organizer event descriptions today. HONEST LIMIT:
     both production bodies are plain paragraphs, so `p` is all that real
     content exercises.

   - ~~Stage 4, the agenda row.~~ **DONE**, and the way it was decided matters
     more than what was decided. With two events in the database the row could
     not be judged at all, so a synthetic sixteen-event agenda was generated
     into `data/snapshot.preview.json`, pointed at with `data/.snapshot-current`
     and rendered. `data/snapshot.json` was never written — proven by md5
     before and after — and both scratch files are gitignored and were deleted.
     Do this again rather than guess; it is the only way to see this listing
     until there is real volume.

     It immediately showed a defect nobody had named: **a three-day festival
     filled three byte-identical rows**, and a two-day workshop two. So
     `runs()` in `src/lib/occurrences.js` folds the dates of one non-recurring
     event into ONE row carrying a range, written by `dateRangeLabel()` in
     `src/lib/span.js` — "du samedi 14 au lundi 16 novembre 2026", shared month
     and year said once.

     This overturns half of a documented decision. `sections()`' comment said a
     multi-day workshop's dates are "few, and each is worth a row", and its
     test asserts every date reaches the stream. That test still passes and
     still means what it meant: every date IS news. How many ROWS they are owed
     turned out to be a different question, which is why `runs()` is a second
     function rather than an edit to `sections()` with its test rewritten to
     match.

     **An exceptional date of a SERIES is never folded.** It is in the stream
     for one reason — "pas de milonga à la Casita ce jeudi" — and two cancelled
     weeks collapsed into "du 22 au 29" would claim something nobody cancelled.
     Asserted.

     Also: a cancellation now has a tag element. **ANNULÉ** as a tracked
     uppercase stamp in ink, note muted beside it — marked by case rather than
     by colour, because the accent is already spent on the eyebrow two lines
     above and a second warm colour muddied against it.

     And the shell width is SETTLED at 64rem. At two rows the hairlines ran
     ~150px past the longest title and it looked sparse; at sixteen it reads
     correctly. The sparseness was an artifact of the sample, not the measure.

   - ~~Stage 5, the font.~~ **DONE.** Inter is self-hosted:
     `scripts/make-fonts.mjs` copies two 24KB woff2 files out of
     `@fontsource/inter` (a devDependency, SIL OFL, there only to refresh
     them) into `public/fonts/` AND `editor/public/fonts/`, and generates
     `fonts.css` for both. The editor needs its own copy because it sends
     `default-src 'self'` with no font-src, so a font from nissartango.fr
     would be blocked there — and the fix for that is a copy, not a widened
     policy.

     Only the 500 is preloaded. The 600 exists for `<strong>` in an
     organizer's prose and, having its own `@font-face`, is not fetched at all
     on a page without bold — verified in the browser rather than assumed
     (`Inter 500 loaded, Inter 600 unloaded`). That Inter is genuinely in use
     and not silently falling back was checked the same way: the same string
     measures 355px in Inter, 346px in the fallback stack and 311px in a
     family that does not exist.

     **The latin subset does not carry Ÿ (U+0178)**, which is in latin-ext.
     Accepted — it occurs in French essentially only in all-caps proper nouns
     — and asserted in BOTH directions, so that the day the subset changes,
     the comments claiming this get corrected rather than quietly becoming
     wrong.

     `tests/fonts.test.js` reads only committed files, never `node_modules`,
     so it means the same in CI where the devDependency may not be installed.
     A @font-face naming a missing file falls back silently with nothing
     logged anywhere; that test is the only thing that would notice.

## How I'd like to work

Be objective and disagree with me when I'm wrong. Point out design problems
before writing code. I'll paste build logs and file contents; tell me exactly
what to change rather than having me experiment.

### Never write a file you have not read in this session

Twice an agent working from a cloud container appended to `.gitignore` using a
copy that did not exist on its side, and shipped a file containing only the
appended block — deleting the rules that keep `.env`, `dist/` and
`node_modules/` out of git. Neither time was it forgetfulness. Both times the
agent could not see this repo's copy and wrote anyway.

So: **no whole-file write to a path whose current contents you have not read in
this session.** "I know what's in it" is the failure, not the fix.

For an addition to a file you cannot read — `.gitignore`, `.env`, anything
outside a connected folder — hand me the lines to paste. When you *can* read
it, edit in place where it lives (a `python` read-modify-write over the real
file) rather than shipping a whole file over it, and show me the diff.

This matters most for files whose job is to prevent something. A clobbered
`.gitignore` looks like nothing until a secret is committed.

**And verify after writing, not only read before.** A third incident had a
different cause and the same shape: a test created a zero-byte
`supabase/tests/grants_check.sql` in the agent's container because an `mv` that
was meant to stash the real file failed silently — `2>/dev/null` on a file that
was never there — and the `touch` after it created an empty one. Nothing was
overwritten and nothing was assumed; a command just did not do what it looked
like it did.

So after any file operation — write, move, delete, unpack, patch — check the
result: does the file exist, is it a plausible size, does it still contain the
markers it should. `wc -c`, `wc -l`, a `grep` for a known line. Ten seconds,
and it is the only thing that catches a silent failure in the middle of a
pipeline. `set -e` does not help when the failure is `2>/dev/null`.

**None of this is why `.env` is safe.** Rules describe intentions; the control
is `.githooks/pre-commit`, which refuses any commit that stages a `.env`, that
carries a secret key shape, or — the check aimed squarely at the two incidents
above — that is made while `.gitignore` has stopped ignoring `.env`. Read
`.githooks/README.md`. If you are working in a fresh clone, `npm install` wires
it up; `npm run hooks:install` does it on demand.

### Measure platform claims against this project before recording them

Twice a confident, well-sourced, general claim about Supabase turned out not to
describe these projects:

- *"The fail-closed default landed for new projects on 30 May 2026, and both
  projects were created on 28 August, therefore both are fail-closed."*
  Dev was fail-open on all three settings, with `anon=arwdDxtm` — insert,
  update and delete — on every new table.
- *"`create event trigger` requires superuser, and the migration role is not
  one, therefore automatic RLS cannot be versioned."*
  The migration role created and dropped one on both projects, and
  production's `ensure_rls` is owned by `postgres`.

Both claims were true of something. Neither was true here. A release note tells
you what a default **was**; documentation tells you what the platform
**usually** does. Neither is evidence about the project in front of you.

So: **a platform claim gets measured against this project before it is written
down as a fact about it** — and where the measurement is cheap, the probe goes
in `supabase/tests/` so the next person measures instead of inheriting my
conclusion. `can_a_migration_install_automatic_rls` exists because the second
claim above was wrong; it now answers the question per project, for good.

Where a claim cannot be measured, record it as a claim, with its source and the
date, not as a property of the project.

### Instruments that lie quietly

Measuring only beats remembering when the instrument is honest. Four here were
not. Each is worse than an error, because each returns a plausible answer and
nothing looks wrong:

- **A caching web proxy** served day-stale pages for 36 hours and manufactured
  the appearance of a poller outage that had not happened. Distinct
  cache-busting URLs did not defeat it — it was not keying on the full URL. The
  asymmetry is the defence: a stale cache can only ever return an OLDER
  `built_at`, never a newer one. Demand that it has MOVED, and never read a
  non-move as proof of anything.
- **Cloudflare's edge served a stale editor asset to a `cmp` that was checking
  the deploy.** 2026-10-01: `npm run deploy:editor` uploaded four files;
  fetching them back, two matched local and two were the PREVIOUS version,
  missing every new marker. The deploy was fine. `?t=<epoch>` did not defeat it
  — the asset is keyed by path, so the query string changed nothing — and the
  response said `cf-cache-status: HIT` with `cache-control: max-age=0,
  must-revalidate`, which is a cache claiming freshness it had not checked.
  Re-fetching with `-H 'Cache-Control: no-cache' -H 'Pragma: no-cache'` forced
  revalidation and all four then matched byte for byte.

  So **verify a deploy with revalidation headers, not a cache-busting query**,
  and treat "the served file differs" as a claim about the cache until it
  survives a no-cache fetch. The failure direction is the same as the proxy
  above: a cache can only hand you something OLDER, so a mismatch is ambiguous
  while a match is conclusive.
- **A FUSE mount reported every file as mode 600**, whatever its real
  permissions — `README.md` read 600 too. `.env` was reported safe and was
  actually 644. A permission read through a bridge is fabricated by the bridge.
- **`git grep -E` has no `\b`.** It is POSIX ERE. A pattern using one matches
  nothing, and inside an alternation it returns the *other* branch's hits, which
  reads as a clean and complete result. Measured 2026-09-19 on this repo:
  `-E '\bCMS\b'` found **0** in AGENTS.md; `-P '\bCMS\b'` found **4**. Use `-P`,
  or `-F` for a literal.
- **`${PIPESTATUS[0]}` is a bash-ism and yields empty in zsh** — it is
  `$pipestatus[1]`, 1-indexed. Worse, `cmd | tail` makes `$?` report *tail's*
  status, so a failing command reads as `exit=0`. This corrupted three separate
  measurements in one sitting, including both staleness guards being recorded as
  silent when each had correctly exited 1. **Capture exit codes without a pipe.**

The shape they share: a confident answer from a layer nobody was thinking about.
When a result is surprising, suspect the instrument before the system.

### Never paste a token or a connection string into a chat

An admin access token was pasted on 2026-09-19. Its session was revoked with
`POST /auth/v1/logout?scope=global` (204), verified by SQL: `auth.sessions` and
`auth.refresh_tokens` both went to zero — by DELETION, not by a `revoked` flag,
which is what GoTrue actually does. A prediction of `refresh_revoked = 1` was
wrong; `refresh_live = 0` was the number that mattered.

**The access token itself could not be revoked.** PostgREST validates signature
and expiry and consults no session table, so an issued JWT is live until its
`exp` regardless of what happens to the session. The only other lever is
rotating the signing key, which invalidates every token at once. Revoking a
session closes refresh, not the hour already granted.

There is no "Sign out user" control in Authentication → Users — the menu offers
Remove MFA factors, Ban user and Delete user. The logout API is the route.

**`supabase projects api-keys` prints legacy `service_role` JWTs in full.** It
masks the newer `sb_secret_…` key (printing a short prefix then dots) and does NOT mask the
legacy JWT-format `anon` and `service_role` keys, which are printed complete.
On 2026-09-23 that put dev's `service_role` JWT into a chat transcript while
fetching dev's *publishable* key, which is public and was the only part wanted.

Two things made it worse than it had to be:

- the output is **one single JSON line**, so `| grep publishable` matched the
  whole thing. A line-oriented filter over line-oriented output is an
  assumption, and this command breaks it.
- the masking is inconsistent between key formats, so seeing one key masked is
  no evidence that the others are.

If you need a publishable key, take it from the dashboard, or pipe through `jq`
selecting exactly that key — never a grep. If this command has already been
run, treat that project's legacy keys as burned and disable them (Settings →
API Keys → Legacy keys).

## Supabase

Schema lives in `supabase/migrations/` and is applied with the CLI, never
through the dashboard or an MCP connector. As of the first `db push` to the
hosted project those files are history: **append new migrations, never edit an
applied one.**

Project settings that live in the dashboard and do NOT travel with this repo
are written down in **`supabase/PROJECT_SETUP.md`** — read it before pushing to
any project. Short version: Data API on, automatically-expose-new-tables off,
automatic RLS on. A mistake should deny, not expose.

That file also says **which project is which**, and the names mislead:
`eqcgeqzzuzcwrflwasjo` ("dimuthu-wije's Project") is production and holds
everything; `hjsekipqryfuwdkhxuks` ("nissartango-dev") is dev. **Read the ref,
never the name.**

Dev is real, not a placeholder. Measured 2026-09-17: the same eight migrations
as production, with an identical column signature on all five base tables. It is
referenced by `.env.example`, `scripts/check-db.sh`, `PROJECT_SETUP.md`, this
file, and the ops files in the backup deliverable. It is empty of *content* by
policy — truncated before each restore rehearsal and again after — which is not
the same as unused.

Dev is also deliberately fail-open on `automatic_rls`: production's `ensure_rls`
event trigger is not installed there on purpose, so a migration that forgets
`enable row level security` fails visibly instead of being silently corrected.
**Do not "fix" that** — it is what makes dev the canary for a defective
migration.

What is still missing is a dev/prod split in **operation**: production remains
the only project holding content, still live, still restored by hand. This
section previously said dev was "empty and referenced nowhere" and that there
was "no dev/prod separation"; both were false when measured on 2026-09-17, and
`PROJECT_SETUP.md` was corrected then while this file was not.

Check the ref before you push.

`editor/public/aide/` is the organizer's guide — the only prose page in the
editor, readable signed OUT, because somebody who cannot sign in is exactly who
needs it. It repeats the form's field labels, its option lists and its error
messages, so **it drifts the moment a label changes and nothing will tell you**.
Every label in it was read out of `event.js` and `organizer.js` rather than
recalled, on 2026-10-03; do the same when you change one. Its flow diagram is
inline SVG using the stylesheet's own variables, so it follows the light/dark
switch and its words stay selectable.

The editor can now be run against dev instead of production:

```
./scripts/seed-dev-editor.sh --help   # once: dev is empty of users too
npm run dev:editor                    # http://localhost:3000 -> dev
```

The ORIGIN picks the project (`editor/public/target.js`), so
`editor.nissartango.fr` is production and everything else is dev — there is no
flag to get wrong, and `tests/editor-config.test.js` asserts no other hostname
can reach production. Port 3000 is dev's `site_url`, not a preference. Until
2026-09-23 the editor hard-coded production, so every time anyone ran it they
were editing the live agenda.

Verification:

```
./scripts/test-schema.sh          # 117 in-database assertions, local only
./scripts/create-test-users.sh    # test accounts (local only, deletes/recreates)
./scripts/prove-rls.sh            # 42 HTTP proofs with the anon key
```

`supabase/tests/grants_check.sql` is read-only and safe against any project,
including production — it is the half of the suite that the local stack cannot
answer honestly.
