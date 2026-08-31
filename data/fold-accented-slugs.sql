-- ============================================================================
-- fold-accented-slugs.sql -- rewrite any accented slug to its ASCII form.
--
-- Run ONCE per project (dev AND prod), in the SQL Editor. Idempotent: the
-- WHERE clause matches nothing on a second run.
--
-- WHY THIS EXISTS AT ALL
--
-- One slug came in from the Sveltia era with its accents intact, so its URL
-- was percent-encoded everywhere it appeared:
--
--   /evenements/2026-08-24-milonga-pr%C3%A9c%C3%A9d%C3%A9e-d-une-...
--
-- Correct, and ugly in a share. Since those URLs were never public on the old
-- site, stability is not owed to anything, so they get folded once, now, while
-- there is exactly one. public.slugify() folds accents, so nothing created
-- from here on can reproduce this.
--
-- WHY IT NEEDS THE ESCAPE HATCH
--
-- events.slug is immutable by trigger — that is the point of it. Changing one
-- is meant to be deliberate and visible, which is what `set local` provides:
-- it dies with the transaction, so the hatch cannot be left open, and this
-- file is the record of the one time it was used.
--
-- The site ships a 301 in public/_redirects covering the old path. Keep it:
-- the page was live and indexable between the deploy and this change.
-- ============================================================================

begin;

-- Deliberate, transaction-scoped, and gone at commit.
set local app.allow_slug_change = 'on';

-- Derived, not typed: slugify() is the same function the insert trigger uses,
-- so the new slug is by construction what the database would have generated.
update public.events
   set slug = public.slugify(slug)
 where slug <> public.slugify(slug);

commit;

-- Should be zero rows on any project this has been run against.
select slug, public.slugify(slug) as would_become
  from public.events
 where slug <> public.slugify(slug);

-- And the record of what is now live.
select slug, to_char(starts_at at time zone timezone, 'YYYY-MM-DD HH24:MI') as starts_local
  from public.events
 order by starts_at;
