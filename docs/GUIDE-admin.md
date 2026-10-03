# Running the agenda — the admin's guide

Written 2026-10-03, as the companion to `editor/public/aide/` (the organizer's
guide, in French, readable at editor.nissartango.fr/aide/). That one tells an
organizer what they can do. This one tells you what only you can do, and where
each thing actually lives.

In English, like the rest of `docs/`, because this is operational knowledge that
sits beside the handovers. The organizer guide is French because its readers
are.

---

## What "admin" is

Three different things decide what somebody can do, and they are often confused:

| | What it is | What it gives |
|---|---|---|
| **admin** | a row in `public.user_roles` with `role = 'admin'` | the moderation queue, and the right to administer **any** organizer |
| **owner** | `organizer_members.role = 'owner'` for one organizer | edit that organizer's record, manage its members |
| **editor** | `organizer_members.role = 'editor'` | create and edit that organizer's events |

They do not nest. Being an admin does **not** let you create an event — that
needs `is_member(organizer_id)`, and there is no admin insert policy. If you
want to add an event for somebody, add yourself as a member of their organizer
first (you may, because you are an admin).

Today: `dimuthu.wije@outlook.com` is the only admin, and is a member of all
three organizers.

---

## The daily job: the queue

**editor.nissartango.fr/queue/** — visible only to an admin. The link is hidden
from everyone else, so an organizer never lands on it.

**"Rien en attente" is the normal state.** The page is written to say that
plainly rather than look busy, because "nothing is waiting" and "you cannot see
anything" are different problems.

Three buttons, and the second one is the one to be careful with:

- **Approuver** — publishes it. It appears on the site at the next rebuild, at
  most ten minutes later.
- **Rejeter** — needs a reason, always. On a *pending* event this simply refuses
  it. On an event that is **already online**, the button says
  **"Rejeter (retirer du site)"** and asks you to confirm, because it takes the
  whole event off the agenda — every date, not just the change you were looking
  at. Nothing is deleted: approving it again puts it back.
- **Marquer comme revu** — "I have seen this change." Clears the flag, changes
  nothing else. This is what you want when an organizer edits a live event and
  the edit is fine.

That last distinction is the one that costs you if you get it wrong. An
organizer corrects a typo on Thursday's milonga; the event lands in your queue
flagged. **Rejeter** would remove the milonga from the site entirely.
**Marquer comme revu** is the right button.

An event edited by its organizer **stays online** while it waits for you. You
are reviewing a change that has already shipped, not gating it.

---

## Bringing somebody in

Two steps, and the first one is not in the editor.

**1. Create their account.** Supabase dashboard → **Authentication → Users →
Invite user** → their email. They receive an invitation.

This cannot be done from the editor, deliberately: `requestLink()` in
`editor/public/auth.js` sends `create_user: false`, so asking for a magic link
with an unknown address is refused. Its comment explains why — a sign-up is a
decision with a moderation consequence, and it does not belong behind an email
field on a page anyone can open.

**2. Attach them to an organizer.** Editor → Organisateur → the organizer →
**Membres** → add by email, as **Éditeur** or **Propriétaire**.

Give a real external organizer **Propriétaire** of their own record: they can
then edit their own name, links and contact details, and add their own helpers,
without coming through you. Keep **Éditeur** for somebody helping on a record
that is not theirs.

If you do step 2 before step 1, the form tells you so by name rather than
failing vaguely.

---

## Creating an organizer

**SQL only.** Nobody holds an `INSERT` grant on `public.organizers` — not even
an admin — which is deliberate and documented in `20260828190100`: *"Creating
and deleting organizers stays with you."*

Dashboard → **SQL Editor** (this is data, not schema; the CLI-only rule in
`AGENTS.md` is about migrations):

```sql
insert into public.organizers (name, slug)
values ('El Gato Tanguero', 'el-gato-tanguero')
returning id, name, slug;
```

The `slug` is permanent — it appears in every link to that organizer. Then add
their first member through the editor, as above.

---

## The two projects

```
eqcgeqzzuzcwrflwasjo   "dimuthu-wije's Project"   = PRODUCTION
hjsekipqryfuwdkhxuks   "nissartango-dev"          = dev
```

**The names are backwards.** Read the ref, never the name. Every script in this
repo prints the ref it is about to touch, before it touches it, for this reason.

---

## Changing things

| What | How |
|---|---|
| The site's code | `git push` — Cloudflare builds and deploys on push to `main` |
| The site's content | nothing: the poller notices within ten minutes and rebuilds |
| The editor | `npm run deploy:editor` |
| The database | `./scripts/db-push.sh prod --yes` |

**Order matters when a migration and the editor change together.** Apply the
migration first, then deploy the editor: the old editor does not use the new
column, but a new editor sending a column production lacks fails with a 400.

### The trap that has caught this project twice

`supabase db push --dry-run` and the real thing both end with
`Finished supabase db push.` and both name the same migration. The only
difference in the summary is a field:

```
dry run  {"upToDate":false,"dryRun":true, …,"message":"Finished supabase db push."}
real     {"upToDate":false,"dryRun":false,…,"message":"Finished supabase db push."}
```

**`Applying migration <file>...` is the only line that means it happened.**
Do not read the last line.

---

## Checking that something worked

Never take a deploy's own word for it. The receipt is served by the site:

```bash
curl -s "https://nissartango.fr/build-info.json?t=$(date +%s)" | python3 -m json.tool
```

`built_at` must have **moved forward**. That asymmetry is the whole test: a
stale cache can only ever hand you an *older* timestamp, never a newer one — so
a move is conclusive while a non-move proves nothing.

`checksum` should match what the database reports; when they differ, a rebuild
is simply owed.

For the editor, compare what Cloudflare actually serves with what you have
locally — and force revalidation, because its edge has served a stale asset
after a good deploy:

```bash
curl -sS -o /tmp/x.js -H 'Cache-Control: no-cache' https://editor.nissartango.fr/event.js
cmp /tmp/x.js editor/public/event.js && echo identical
```

---

## What you cannot do, and shouldn't work around

- **Delete a published event from the editor.** The policy refuses it because
  its permalink may have been shared. Cancel it instead — it stays online,
  struck through, with your reason, which is more use to a reader than a 404.
- **Publish on somebody's behalf by editing `status` in the form.** There is no
  status field; the insert policy requires `pending`. The queue publishes.
- **See an organizer you are not a member of in your list.** The list answers
  "organizers I may create events for". You can still open one by its URL:
  `/organizer/?id=<uuid>`.

You *can* do all of these with SQL as the owner, because RLS does not apply to
the table owner. That is the point at which you are working around your own
design — it is occasionally right (we merged three rows and deleted eight that
way on 2026-10-02), and it should feel deliberate rather than convenient.

---

## When something breaks

**A failed build does not take the site down.** Cloudflare keeps the last good
deployment, so the site looks perfectly correct while content changes stop
arriving. `workers/build-notifier/` emails you on failure, and only on failure.

An absence of mail is *not* proof of health — a worker that stops running emits
no events and looks identical. Confirm positively with `built_at`, above.

`npm run verify:build` runs fourteen structural checks and runs in CI, so a
change that breaks reachability, the sitemap, the social cards or the
JSON-LD/agenda agreement **fails the deploy** rather than shipping. On
2026-10-02 it caught an event page showing one date while the agenda listed
three.

---

## If you read one thing before changing anything

`AGENTS.md`, sections *Gotchas learned the hard way* and *Instruments that lie
quietly*. Most of what has gone wrong on this project was not a bug in the code
but a measurement that looked fine: a grep that could not match, a check that
asked the wrong question, a cache that answered for a server.
