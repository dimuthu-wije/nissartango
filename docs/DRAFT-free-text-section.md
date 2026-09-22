# DRAFT — the free-text decision, as first written

Drafted by the reviewer session, 2026-09-16, to replace a section then titled
"Decide this BEFORE building the form" in `supabase/PROJECT_SETUP.md`. Tracked
on 2026-09-22.

> **This is not the authority. `supabase/PROJECT_SETUP.md:989` is.**
>
> The draft was applied, and the live section has since been revised PAST it.
> Kept only because one measurement survives nowhere else — see below — and
> because how a decision was first argued is sometimes worth more than its
> final wording.
>
> **Two claims here are refuted by their own successor**, which says so in
> those words:
>
> - **"What is lost is that a fresh `git clone` no longer carries one."**
>   Nothing was lost. Measured 2026-09-17, the day the file left the index: the
>   committed `data/snapshot.json` was **eight days stale**. It only ever
>   updated when a human ran a LOCAL build and committed the result; CI rewrites
>   it and commits nothing. It read as a backup, was trusted as one, and was
>   not.
> - **"Until now a clean clone carried the snapshot, so a build could fall back
>   to it."** A normal build never did. `npm run build` is
>   `fetch-content.mjs && astro build`, which fetches fresh and overwrites the
>   file; it is read only by `--from-snapshot`, after something has already gone
>   wrong. The snapshot was the undo, not the prevention.
>
> Both are the same error: reasoning about what a file was FOR without measuring
> what it actually DID.
>
> **What survives only here.** Step 5's successor states the rule — the
> Cloudflare build command must be `npm run build && npm run verify:build` — but
> not the observation behind it. That is the last paragraph of this file:
> measured 2026-09-16 from the build log of **`9597906f`**, where the command
> was `npm run build` alone and neither `verifying` nor `build output verified`
> appears anywhere in the log. `git grep 9597906f` matches nothing else in this
> repo. It is the only record that the safeguard the section leaned on had never
> once fired in production.
>
> **The two "regardless" items, as of 2026-09-22.** The first is DONE in the
> schema: `contact_email` and `contact_phone` exist on `public.organizers`, are
> exposed through `organizers_public`, and render on the event page
> (`20260922120000_organizer_public_contact.sql`). The "published publicly,
> permanently" checkbox this draft asked for is enforced by the database rather
> than by a form — a consent timestamp is required by CHECK whenever a value is
> present — so the rule survives a form that forgets it. (`public.organizers`
> still has private `email` and `phone`; they never moved and are not these.)
>
> Two halves remain: **nothing but SQL can set them**, because the editor has no
> organizer form at all; and **nobody has been told, in French, what publishing
> means.** The column records that consent was given. Only the wording makes it
> informed, and that is the half that decides whether any of this was worth
> doing.

---

### DECIDED: `data/snapshot.json` stops being committed

Decided 2026-09-14, before the editor form existed, which is the only reason it
could be decided cheaply. Recorded here with the measurement, because the
measurement is what made one option available and it will not be available
again.

**The problem.** The editor area gives other people write access to a table
whose contents are committed to a **public** repository. No stage so far has
done that. Site content can be corrected; git history cannot. If an organizer
types their mobile number into an event's `body` — "renseignements au 06 …",
an entirely reasonable thing to write — it is world-readable from the moment
the next build commits `data/snapshot.json`, it stays in the history after any
correction, and **they will have no idea that happened.** They consented to a
public listing, not to a permanent public record.

**What was measured, 2026-09-14,** by fetching the repo unauthenticated rather
than by reading the generator and reasoning:

- `data/snapshot.json` is committed and does carry `body`, `price_note` and
  `location_address`. Non-empty today, e.g. `"Milonga de 20h30 à Minuit avec
  auberge espagnole"`, `"8 € pour ceux qui viennent avec leur propre verre non
  jetable"`, `2 rue La Bruyère`.
- **No phone number and no email address appears anywhere in the file, or in
  any commit of it.** The history is clean.

That second line is the whole decision. Omitting free text from the snapshot
costs a build change while the history is clean and is worth nothing once it is
not, because what you would be protecting is by then already addressable in
GitHub's object store, in every fork and in every cache. The window was open on
14 September 2026. It does not reopen.

**The decision.** Stop committing `data/snapshot.json`. Not "omit the three
long-form fields" — see below for why that turned out to be a half-measure.

**Order of operations. This is the part that can go wrong.**

1. **Build the private backup and prove a restore — not a dump.** Until a
   backup has been restored into `hjsekipqryfuwdkhxuks` and diffed against
   production, it does not exist. A `pg_dump` that has never been read back is
   the poller that passed 35 tests without having polled. Do not touch
   `.gitignore` before a restore has produced a diff.
2. **Then** `git rm --cached data/snapshot.json` and add it to `.gitignore`
   alongside `data/snapshot.*.json`.
3. **No history rewrite.** The committed snapshot is clean — measured, not
   assumed — so there is nothing to un-publish, and a rewrite would destroy the
   "27 commits, verified by fetching it unauthenticated" baseline for no gain.
   That the decision arrived in time is precisely what makes surgery
   unnecessary.
4. **Keep the path and the filename.** `src/lib/snapshot-path.mjs`,
   `--from-snapshot` and `data/production-ref` need no change: the file is
   simply untracked, and the backup restores to the same place. What is lost is
   that a fresh `git clone` no longer carries one, so the backup must be
   **fetchable by whoever is on call**, not merely archived somewhere.
5. **Decide what a build does when Supabase is unreachable.** Until now a clean
   clone carried the snapshot, so a build could fall back to it. After this it
   cannot. The build must **fail loudly and leave the previous deployment
   live** rather than publish an empty agenda. Confirm that, do not assume it.

**Why "omit only the risky fields" was rejected.** That option named `body`,
`price_note` and `location_address`. The event row also carries `title`,
`location_name`, `teachers`, `signup_url` and `cancellation_note`, all
organizer-typed strings. A phone number in `title`, or in `cancellation_note`
("annulé, appelez-moi"), lands in git with all three named fields excluded. The
option closed three of eight doors, and once you count the other five it
collapses into this decision anyway.

**The deadline is not "before the form is built".** `events_public` filters on
`status = 'approved'`, so pending and rejected submissions never reach the
snapshot and never reach git. A human approval already sits between an
organizer typing and anything being committed. The real deadline is **before
the first organizer-submitted event is approved.** Approving a listing is not
auditing it for a phone number, so this is a deadline and not a reprieve.

**Two things that should happen regardless of the above.**

- Add `contact_email` and `contact_phone` to the organizer schema, each with an
  explicit "published publicly, permanently" checkbox. Today there is nowhere
  sanctioned to put a phone number, which is exactly what drives it into `body`.
  The schema is currently producing the failure mode the warning is meant to
  catch.
- Tell organizers plainly, in French, at sign-up and under the free-text
  fields, what is published. Cheap, and it is the difference between them
  knowing and not.

**What `npm run verify:build`'s contact-detail check is for afterwards.** It no
longer guards git. Its remaining job is to tell you that an organizer published
a contact detail, so you can check they meant to. Widen it from
`['body', 'price_note', 'location_address']` to all eight organizer-typed
fields and rewrite its message, which currently points at this section for a
reason that will no longer apply.

**That check has never run on a deploy.** Measured 2026-09-16 from the
Cloudflare build log of build `9597906f`: the build command is `npm run build`,
and neither `verifying` nor `build output verified` appears anywhere in the log.
`npm run build` is `fetch-content.mjs && astro build`; `verify:build` is a
separate script that only ever ran on a laptop. So the warning this section
described as a safeguard has never fired in production, and neither has the
rest of `verify-build.mjs` — including the two checks that exist for failures
only CI can produce. Widening the field list is worth nothing until the
Cloudflare build command is `npm run build && npm run verify:build`. Do that
first. (Not `npm run check`: it pulls in `check:db`, which needs a `DB_URL` the
build box does not have.)
