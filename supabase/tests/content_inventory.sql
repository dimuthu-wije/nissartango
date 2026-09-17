-- ============================================================================
-- supabase/tests/content_inventory.sql
--
-- A per-table inventory of the five base tables in public: row count, a
-- whole-row digest, and a COLUMN SIGNATURE digest.
--
-- Used by scripts/compare-projects.sh to answer one question: after a restore,
-- does dev hold exactly what production holds? The "IDENTICAL" line that
-- script prints is the acceptance artifact for the backup, so everything in
-- here exists to make that line hard to produce by accident.
--
-- READ-ONLY. No DDL, no writes. Wrapped in a transaction that ROLLS BACK, so
-- it is structurally incapable of changing anything and needs no rehearsal on
-- dev before being pointed at production -- unlike api_settings.sql, which is
-- read-only but does its work as DDL inside a rolled-back transaction.
--
-- ----------------------------------------------------------------------------
-- FOUR DECISIONS, each of which has a way of being quietly undone
-- ----------------------------------------------------------------------------
--
-- 1. BASE TABLES, NOT THE _public VIEWS.
--    content_checksum already hashes the three views and is the right tool for
--    its job -- "does the deployed site match what a build would fetch now".
--    It is the wrong tool here. The views filter `status = 'approved'`, so a
--    view-based inventory would report a perfect match while every pending and
--    rejected row was missing from the backup. Those rows are precisely the
--    content the committed snapshot never protected, and the reason a backup
--    is being built at all.
--
--    MEASURED 2026-09-17: there are none. All four production events are
--    approved, and no pending or rejected row has ever existed. So today a
--    view-based inventory and this one would cover identical data, and this
--    decision has ZERO instances behind it -- exactly like the FK-to-auth.users
--    machinery in restore-content.sql.
--
--    IT STAYS ANYWAY, and the reason is the same: the first organizer
--    submission creates a pending row, that is what stage 5 is for, and a
--    backup that silently omits it would be discovered at the moment it was
--    needed. What the measurement changes is the honesty of the claim, not the
--    choice -- and the limit it implies belongs in the acceptance: F1 proving
--    IDENTICAL proves four approved rows round-trip. It proves nothing about a
--    pending row, because there is not one to prove it with.
--
-- 2. TIMEZONE PINNED TO UTC.
--    `t::text` renders a whole row, and a timestamptz inside it renders in the
--    SESSION's TimeZone. content_checksum's header documents this and is right
--    to leave it alone: its two readers are identical by construction and it
--    only ever compares with itself. This file has a different problem. It is
--    read by two psql sessions against two different hosted projects, and if
--    their server defaults differ, every digest differs for a reason that is
--    not content. `set local timezone` removes the variable rather than
--    reasoning about it. Do not delete this line because "they are both UTC
--    anyway" -- that is an assumption, and this file exists to not need one.
--
-- 3. COLUMN SIGNATURE ORDERED BY ordinal_position, NOT BY NAME.
--    The signature is an md5 over (column_name, data_type/udt_name,
--    is_nullable) per table. Ordering by ordinal_position rather than
--    alphabetically is deliberate: `t::text` renders columns IN TABLE ORDER,
--    so two schemas with identical columns in different order produce
--    different rows_md5. Sorted by name, cols_md5 would match and the row
--    digest mismatch would be undiagnostic -- which is the failure this column
--    was added to prevent.
--
--    data_type alone returns 'USER-DEFINED' for every enum, so event_status
--    becoming something else would not show. udt_name carries the enum's name,
--    hence both. Note the limit: this notices a column changing TYPE, and does
--    not notice an enum gaining or losing a LABEL. If that becomes load-
--    bearing, hash pg_enum separately rather than widening this.
--
-- 4. ORDER BY ... COLLATE "C".
--    Table and column ordering is pinned to byte order so that two projects
--    with different default collations cannot produce the same rows in a
--    different sequence and diff as DIFFERENT. Same reasoning as the timezone.
--
--    Section 2 casts `c.table_name::text` before collating. information_schema
--    .table_name is the domain sql_identifier over `name`, and `name` only
--    became collatable in PG12. It would very probably work uncast on a current
--    Supabase project -- but "very probably" is the thing this file exists not
--    to depend on, and a cast to text costs nothing and removes the question.
--    Section 1 needs no cast: it orders a text literal.
--
-- ----------------------------------------------------------------------------
-- MEASURED, 2026-09-17 -- why the row digest is not optional
-- ----------------------------------------------------------------------------
--
-- The first standalone run of this file against both projects found:
--
--     tbl                n_rows   dev vs prod
--     event_exceptions        1   rows_md5 DIFFERS
--     events                  4   rows_md5 DIFFERS
--     organizer_members       0   both d41d8cd9... = md5(''), the empty-table path
--     organizers              3   rows_md5 IDENTICAL
--     user_roles              0   both d41d8cd9... = md5(''), the empty-table path
--
-- Identical counts on all five tables. TWO of the three non-trivial digests
-- differed. Someone had run data/initial-content.sql against dev, so dev held
-- content that looks like production's and is not production's.
--
-- A counts-only inventory would have reported those two databases as agreeing
-- BEFORE ANY RESTORE HAD RUN. The whole-row digest is the only thing that
-- separated them. This paragraph replaces the argument that used to be here,
-- and the difference matters: the digest is now justified by a case that
-- actually occurred rather than by one that was imagined.
--
-- TWO READING NOTES, because the first draft of this paragraph got them wrong
-- by working from a summary instead of the output:
--
--   * d41d8cd98f00b204e9800998ecf8427e is md5 of the empty string. Two tables
--     showing it are two EMPTY tables, not two tables that agree. Do not read
--     a matching digest on a 0-row table as evidence of anything.
--
--   * organizers matched exactly -- 3 rows, same digest -- which is not
--     possible from two independent runs of the seed, since id defaults to
--     gen_random_uuid() and created_at/updated_at to now(). Those rows were
--     copied between the projects by some path, not seeded twice.
--
-- All five cols_md5 matched, so schema parity between the projects is measured
-- rather than inferred from the migration list.
--
-- ----------------------------------------------------------------------------
-- TWO FACTS THIS FILE DEPENDS ON
-- ----------------------------------------------------------------------------
--
-- * No migration uses `force row level security`, so the table-owning role
--   bypasses RLS and these counts are the real counts. If FORCE is ever added,
--   this file starts reporting policy-filtered counts and a truncated backup
--   will read as complete. Re-check that before trusting it after any RLS
--   change.
--
-- * The five tables below are the COMPLETE set of base tables created in
--   public across all eight migrations. The list is hard-coded rather than
--   discovered from pg_class on purpose: a table appearing in public that no
--   migration created is a finding, and a self-updating inventory would
--   silently absorb it instead of failing to mention it. If a stage-5
--   migration adds a base table, it is added here in the same commit.
--
-- ----------------------------------------------------------------------------
-- Run standalone:
--     psql -X -q -A -F'|' --pset=footer=off --pset=pager=off -v ON_ERROR_STOP=1 \
--          -f supabase/tests/content_inventory.sql "$PROD_DB_URL"
--
--     --pset=pager=off is required: footer=off does not disable the pager, so
--     without it this output opens in less and the run appears to hang.
--     compare-projects.sh is unaffected because it redirects to a file.
--
-- Compare two projects:
--     ./scripts/compare-projects.sh supabase/tests/content_inventory.sql \
--          "$DEV_DB_URL" "$PROD_DB_URL"
-- ----------------------------------------------------------------------------

begin;

set local timezone = 'UTC';

-- ---------------------------------------------------------------------------
-- SECTION 1 -- one row per base table.
-- Ordering inside each string_agg is by PRIMARY KEY, which is what makes the
-- digest deterministic. Without it Postgres may aggregate in any order and the
-- value changes at random between runs of the same unchanged data.
-- ---------------------------------------------------------------------------

select * from (

  select
    'event_exceptions' as tbl,
    (select count(*) from public.event_exceptions) as n_rows,
    md5(coalesce((select string_agg(t::text, E'\n' order by t.event_id, t.occurrence_date)
                    from public.event_exceptions t), '')) as rows_md5,
    md5(coalesce((select string_agg(c.column_name || ':' || c.data_type || '/' || c.udt_name || ':' || c.is_nullable,
                                    E'\n' order by c.ordinal_position)
                    from information_schema.columns c
                   where c.table_schema = 'public'
                     and c.table_name = 'event_exceptions'), '')) as cols_md5

  union all select
    'events',
    (select count(*) from public.events),
    md5(coalesce((select string_agg(t::text, E'\n' order by t.id)
                    from public.events t), '')),
    md5(coalesce((select string_agg(c.column_name || ':' || c.data_type || '/' || c.udt_name || ':' || c.is_nullable,
                                    E'\n' order by c.ordinal_position)
                    from information_schema.columns c
                   where c.table_schema = 'public'
                     and c.table_name = 'events'), ''))

  union all select
    'organizer_members',
    (select count(*) from public.organizer_members),
    md5(coalesce((select string_agg(t::text, E'\n' order by t.organizer_id, t.user_id)
                    from public.organizer_members t), '')),
    md5(coalesce((select string_agg(c.column_name || ':' || c.data_type || '/' || c.udt_name || ':' || c.is_nullable,
                                    E'\n' order by c.ordinal_position)
                    from information_schema.columns c
                   where c.table_schema = 'public'
                     and c.table_name = 'organizer_members'), ''))

  union all select
    'organizers',
    (select count(*) from public.organizers),
    md5(coalesce((select string_agg(t::text, E'\n' order by t.id)
                    from public.organizers t), '')),
    md5(coalesce((select string_agg(c.column_name || ':' || c.data_type || '/' || c.udt_name || ':' || c.is_nullable,
                                    E'\n' order by c.ordinal_position)
                    from information_schema.columns c
                   where c.table_schema = 'public'
                     and c.table_name = 'organizers'), ''))

  union all select
    'user_roles',
    (select count(*) from public.user_roles),
    md5(coalesce((select string_agg(t::text, E'\n' order by t.user_id, t.role)
                    from public.user_roles t), '')),
    md5(coalesce((select string_agg(c.column_name || ':' || c.data_type || '/' || c.udt_name || ':' || c.is_nullable,
                                    E'\n' order by c.ordinal_position)
                    from information_schema.columns c
                   where c.table_schema = 'public'
                     and c.table_name = 'user_roles'), ''))

) inventory
order by inventory.tbl collate "C";

-- ---------------------------------------------------------------------------
-- SECTION 2 -- the column signature, spelled out.
--
-- Section 1's cols_md5 says THAT the schemas differ. This says WHICH column.
-- On two matching projects these lines are identical and contribute nothing to
-- the diff, so the cost is only a longer paste on success -- which is the
-- right trade against inferring a schema drift from a hash.
-- ---------------------------------------------------------------------------

select
    c.table_name,
    c.ordinal_position,
    c.column_name,
    c.data_type,
    c.udt_name,
    c.is_nullable
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name in ('event_exceptions', 'events', 'organizer_members',
                        'organizers', 'user_roles')
 order by c.table_name::text collate "C", c.ordinal_position;

rollback;
