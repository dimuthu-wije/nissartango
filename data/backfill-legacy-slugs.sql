-- ============================================================================
-- backfill-legacy-slugs.sql -- record the pre-fold slug as a legacy slug.
--
-- Run ONCE per project (dev AND prod), in the SQL Editor or via psql, AFTER
-- migration 20260919120000_legacy_slugs.sql. Idempotent: the WHERE clause
-- matches nothing on a second run.
--
-- NOT a migration. Migrations are schema; this is content.
--
-- WHY THIS EXISTS
--
-- data/fold-accented-slugs.sql rewrote one accented slug to its ASCII form.
-- The page was live and indexable in between, so the old path is treated as
-- possibly crawled and owes a 301. That 301 lived in a hand-written
-- public/_redirects; it now comes from this column, so that a withdrawn event
-- takes its redirects with it instead of leaving them pointing at a page the
-- build no longer emits.
--
-- WHY THE VALUE BELOW IS SAFE TO TYPE BY HAND
--
-- It cannot be derived: folding is one-way, so the current ASCII slug does not
-- tell you what the accented one was. It is therefore transcribed from the
-- public/_redirects rules this replaces.
--
-- But it is not trusted. The row is matched by `slug = slugify(legacy)` -- the
-- same function that did the folding -- so the typed string has to fold to a
-- slug that actually exists. Get one accent wrong and this updates ZERO rows
-- and says so, rather than writing a legacy slug that redirects from nowhere.
-- A hand-typed value that checks itself against the database is a different
-- thing from a hand-typed value.
-- ============================================================================

begin;

update public.events e
   set legacy_slugs = array_append(e.legacy_slugs, v.legacy)
  from (values
          ('2026-08-24-milonga-précédée-d-une-pràctica-jeudi-c-est-permis-à-la-casita')
       ) as v(legacy)
 where e.slug = public.slugify(v.legacy)
   and not (e.legacy_slugs @> array[v.legacy]);

commit;

-- EXPECTED after the first run: exactly one row, the Casita milonga, with one
-- legacy slug whose slugify() equals its current slug. On a second run the
-- UPDATE reports 0 and this still shows the same one row.
select slug,
       legacy_slugs,
       (select bool_and(public.slugify(s) = slug)
          from unnest(legacy_slugs) s) as every_legacy_folds_to_this_slug
  from public.events
 where legacy_slugs <> '{}'
 order by slug;

-- And the negative: nothing should claim a legacy slug that is some OTHER
-- event's live slug, which would redirect a real page away from itself.
select e.slug as claimed_by, s as legacy_slug
  from public.events e, unnest(e.legacy_slugs) s
 where exists (select 1 from public.events o where o.slug = s);
