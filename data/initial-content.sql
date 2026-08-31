-- ============================================================================
-- initial-content.sql -- your four real events, ported from the markdown.
--
-- NOT a migration. Migrations are schema; this is content, and it is run ONCE
-- by hand against whichever project the public site builds from:
--
--     Dashboard -> SQL Editor -> paste -> Run
--
-- Safe to run twice: every insert is ON CONFLICT DO NOTHING.
--
-- WHY THE SLUGS ARE SPELLED OUT: they carry over from the Sveltia era, and the
-- date prefix does not match the event date (Sveltia generated the slug on the
-- day the file was created, not the day of the event). The insert trigger only
-- generates a slug when none is supplied, so passing them keeps the shape the
-- old site had. This is the case the "generated once, then frozen" rule exists
-- for.
--
-- ONE EXCEPTION, taken deliberately: the Casita milonga's slug had accents,
-- which made its URL percent-encoded everywhere it appeared. Those URLs were
-- never public on the old site, so nothing was owed stability, and it is
-- folded here to the ASCII form slugify() would have produced. Existing
-- projects are brought into line by data/fold-accented-slugs.sql, and
-- public/_redirects 301s the old path. Both were needed because the accented
-- page WAS live and indexable for the hour between deploy and decision.
--
-- Decisions taken while porting, so nobody has to re-derive them later:
--   * El Gato Tanguero becomes an organizer in its own right; Pierre Gabrielli
--     is not recorded, which loses what the markdown's free-text field said.
--     If he wants a login, that is a second organizer row and an events update.
--   * The Bicilonga is ported as the one-off it was recorded as, not as the
--     summer series the body describes. Next summer is a new event, new slug.
--   * The Amarras end time is read as midnight at the END of the evening: the
--     markdown said endDate 2026-08-26T00:00, which precedes its own 20:30
--     start. 210 minutes.
-- ============================================================================

-- --- organizers -------------------------------------------------------------
-- The first two come straight from src/content/organizers/. The third does not
-- exist yet: the Amarras milonga's markdown had a free-text organizer field,
-- "El Gato Tanguero, et Pierre Gabrielli", and organizer_id is now a real
-- foreign key, so it needs a row of its own.
insert into public.organizers (name, slug, website) values
  ('Nissartango',      'nissartango',      'https://tango-guinguette.com/'),
  ('Rosa Gervasi',     'rosa-gervasi',     null),
  ('El Gato Tanguero', 'el-gato-tanguero', null)
on conflict (slug) do nothing;

-- --- events -----------------------------------------------------------------
insert into public.events (
  slug, title, type, starts_at, duration_minutes, timezone,
  recurrence, recurrence_end,
  location_name, location_address, city,
  organizer_id, teachers,
  price_full, price_note, body, status
)
select v.slug, v.title, v.type::public.event_type, v.starts_at, v.duration_minutes,
       'Europe/Paris', v.recurrence::public.recurrence_type, v.recurrence_end,
       v.location_name, v.location_address, 'Nice',
       o.id, v.teachers, v.price_full, v.price_note, v.body, 'approved'
from (values

  -- Bicilonga. The body says "tous les mardis, juillet et août", but the
  -- markdown carried no recurrence and the season is over, so it is ported as
  -- the one-off it was recorded as: a page and a search result, never an
  -- agenda row again. Next summer's run is a new event with its own slug.
  ('2026-08-23-bicilonga',
   'Bicilonga', 'milonga',
   timestamptz '2026-08-25 18:30+02', 240,
   'none', null::date,
   'Place Garibaldi', null, array['Dim'],
   null::numeric, 'Au chapeau',
   E'Tango argentin en plein air, tous les mardis, juillet et août, sous les arcades de la mythique place Garibaldi. La Bicilonga se charge de tout pour le confort des tangueros et tangueras ❤\n\nInitiation pour débutant de 18h30 à 19h\n\nParticipation au chapeau 🙏',
   'nissartango'),

  -- El Gato Tanguero. The markdown said endDate 2026-08-26T00:00, which is
  -- before the 20:30 start -- they meant midnight at the END of the evening.
  -- Ported as 210 minutes (20:30 -> 00:00). "Les Amarras" as the venue name is
  -- taken from the title; the street address is the markdown's location field.
  ('2026-08-23-milonga-el-gato-tanguero-aux-amarras',
   'MILONGA "El Gato Tanguero" aux Amarras', 'milonga',
   timestamptz '2026-08-26 20:30+02', 210,
   'none', null,
   'Les Amarras', '2 rue La Bruyère', array[]::text[],
   10.00, E'8 € pour ceux qui viennent avec leur propre verre non jetable',
   E'===> Milonga de 20h30 à Minuit avec auberge espagnole.\n\n📌 Le prix de l''entrée sera réduit à 8€ pour ceux qui viennent avec leur propre verre "non jetable" (écologie🍀) !!!',
   'el-gato-tanguero'),

  -- Jeudi c'est permis. Weekly until 26 November -- which means this series
  -- crosses the 25 October changeover, so it is the real-world case the DST
  -- tests were written for: 20:00 stays 20:00 on both sides.
  ('2026-08-24-milonga-precedee-d-une-practica-jeudi-c-est-permis-a-la-casita',
   E'MILONGA précédée d''une Pràctica "Jeudi c''est permis !" à la Casita', 'milonga',
   timestamptz '2026-08-27 20:00+02', 180,
   'weekly', date '2026-11-26',
   'La Casita del Tango', null, array[]::text[],
   10.00, null,
   null,
   'rosa-gervasi'),

  ('2026-09-01-practica-mardi',
   'Practica du mardi', 'practica',
   timestamptz '2026-09-01 20:00+02', null,
   'none', null,
   'Salle à confirmer', null, array[]::text[],
   10.00, null,
   'Practica hebdomadaire, tous niveaux. Bienvenue à tous.',
   'nissartango')

) as v(slug, title, type, starts_at, duration_minutes,
       recurrence, recurrence_end,
       location_name, location_address, teachers,
       price_full, price_note, body, organizer_slug)
join public.organizers o on o.slug = v.organizer_slug
on conflict (slug) do nothing;

-- --- the one exception ------------------------------------------------------
-- The markdown listed `exceptions: [2026-10-22]` with no reason. The reason is
-- optional, but an empty one is a missed chance: a reader seeing the week
-- greyed out with no explanation learns nothing. Fill it in if you know why.
insert into public.event_exceptions (event_id, occurrence_date, kind, note)
select id, date '2026-10-22', 'cancelled', null   -- a reason here would show
                                                 -- on the agenda; optional
  from public.events
 where slug = '2026-08-24-milonga-precedee-d-une-practica-jeudi-c-est-permis-a-la-casita'
on conflict do nothing;

-- --- what you should see ----------------------------------------------------
select e.slug,
       to_char(e.starts_at at time zone e.timezone, 'YYYY-MM-DD HH24:MI') as starts_local,
       e.recurrence,
       e.status,
       o.name as organizer,
       (select count(*) from public.event_exceptions x where x.event_id = e.id) as exceptions
  from public.events e
  join public.organizers o on o.id = e.organizer_id
 order by e.starts_at;
