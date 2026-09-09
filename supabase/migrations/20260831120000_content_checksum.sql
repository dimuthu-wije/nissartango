-- A checksum of exactly what the public build fetches.
--
-- The rebuild trigger is a reconciliation loop, not a notification: every ten
-- minutes a Worker compares this value against the one recorded in the last
-- deployment's /build-info.json and rebuilds on drift. Nothing is stored,
-- nothing is cleared, nothing acknowledges anything -- which is why no Worker
-- needs write access to this database.
--
-- Two decisions worth keeping:
--
-- 1. It is computed over the *_public VIEWS, not the base tables. The point of
--    the comparison is "does the deployed site match what a build would fetch
--    now", and the build fetches these three views with the anon key. Hashing
--    the base tables would answer a different question and would drift on
--    pending events that never reach the site.
--
-- 2. It hashes WHOLE ROWS, not id || updated_at. event_exceptions_public has
--    neither an id nor an updated_at, so that shape was not available for it
--    anyway -- but the whole-row form is also the stronger one: it notices a
--    column that changed without its updated_at being bumped, and it notices a
--    DELETE of any row, not only of the most recent one.
--
-- The ordering inside each string_agg is what makes this deterministic; without
-- it Postgres may aggregate in any order and the digest changes at random.
--
-- ONE CAVEAT, and it is expected behaviour rather than a bug. t::text renders
-- the whole row, and a timestamptz renders in the SESSION's TimeZone. So this
-- digest is only stable for a given TimeZone setting. Everything that compares
-- two of these values goes through PostgREST as the same role with the same
-- default -- the build reads it, the poller reads it, neither sends a
-- `Prefer: timezone=` header -- so they agree. A psql session or the SQL
-- editor may well print a DIFFERENT digest for identical content, because it
-- is a different session with a different TimeZone. Do not read that as drift,
-- and do not "fix" it by casting to text with an explicit zone: the value only
-- ever has to be comparable with itself, and the two readers that compare it
-- are identical by construction.

create view public.content_checksum as
  select
    md5(
      coalesce((select string_agg(t::text, E'\n' order by t.id)
                  from public.events_public t), '')
      || E'\x1e' ||
      coalesce((select string_agg(t::text, E'\n' order by t.id)
                  from public.organizers_public t), '')
      || E'\x1e' ||
      coalesce((select string_agg(t::text, E'\n' order by t.event_id, t.occurrence_date)
                  from public.event_exceptions_public t), '')
    ) as checksum,
    (select count(*) from public.events_public)           as n_events,
    (select count(*) from public.organizers_public)       as n_organizers,
    (select count(*) from public.event_exceptions_public) as n_exceptions;

comment on view public.content_checksum is
  'One row: md5 over every row of the three public views, plus their counts. '
  'Read by the rebuild poller and recorded in each deployment''s build-info.json.';

-- Readable by the same keys that read the views it summarises. It exposes no
-- row content -- a digest and three counts -- and it is a VIEW rather than an
-- RPC on purpose: execute privileges on functions are revoked from anon and
-- authenticated project-wide, and this does not need an exception carved out.
grant select on public.content_checksum to anon, authenticated;

notify pgrst, 'reload schema';
