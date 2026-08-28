-- ============================================================================
-- seed.sql -- local development fixtures. Applied by `supabase db reset`.
--
-- Deliberately does NOT create auth users. Hand-rolling rows in auth.users
-- means hashing passwords the way whichever gotrue version you are running
-- expects, and the column set moves between versions -- a seed that works
-- today breaks on your next `supabase start`. The two test accounts are signed
-- up through the API instead, by ./scripts/create-test-users.sh (see the note
-- at the bottom of this file).
-- ============================================================================

insert into public.organizers (id, name, slug, instagram, email, phone) values
  ('0a000000-0000-0000-0000-0000000000aa', 'Nissartango', 'nissartango',
   'nissartango', 'contact@nissartango.fr', '+33 6 12 34 56 78'),
  ('0b000000-0000-0000-0000-0000000000bb', 'Rosa Gervasi', 'rosa-gervasi',
   'rosagervasi', 'rosa@example.org', '+33 6 98 76 54 32')
on conflict (id) do nothing;

insert into public.events
  (id, title, type, starts_at, duration_minutes, location_name, location_address,
   location_postal_code, city, organizer_id, teachers, price_full, price_member,
   price_note, body, status)
values
  ('e0000000-0000-0000-0000-00000000000a', 'Milonga de la Casita', 'milonga',
   timestamptz '2026-09-10 21:00+02', 240, 'La Casita', '12 rue Barla', '06300', 'Nice',
   '0a000000-0000-0000-0000-0000000000aa', array['Dim'], 12.00, 10.00,
   '12€ / 10€ adhérent', 'Milonga mensuelle, DJ invité.', 'approved'),

  ('e0000000-0000-0000-0000-00000000000b', 'Practica du mardi', 'practica',
   timestamptz '2026-09-01 20:00+02', 120, 'Salle Garibaldi', 'Place Garibaldi',
   '06300', 'Nice', '0a000000-0000-0000-0000-0000000000aa', array[]::text[],
   null, null, 'Participation libre', 'Practica hebdomadaire, tous niveaux.', 'approved'),

  ('e0000000-0000-0000-0000-00000000000c', 'Stage Rosa Gervasi', 'stage',
   timestamptz '2026-09-12 14:00+02', 180, 'Studio Tango Nice', '5 avenue Malausséna',
   '06000', 'Nice', '0b000000-0000-0000-0000-0000000000bb', array['Rosa Gervasi'],
   45.00, null, null, 'Stage de milonga, niveau intermédiaire.', 'pending')
on conflict (id) do nothing;

-- A weekly series that crosses midnight, so the DST/occurrence-date behaviour
-- is exercised by simply running the site rather than only by the test suite.
insert into public.events
  (id, title, type, starts_at, duration_minutes, recurrence, recurrence_end,
   location_name, city, organizer_id, price_note, status)
values
  ('e0000000-0000-0000-0000-00000000000e', 'Milonga de minuit', 'milonga',
   timestamptz '2026-09-02 00:30+02', 180, 'weekly', date '2026-12-30',
   'Les Amarras', 'Nice', '0a000000-0000-0000-0000-0000000000aa',
   'Au chapeau', 'approved')
on conflict (id) do nothing;

insert into public.event_exceptions (event_id, occurrence_date, note) values
  ('e0000000-0000-0000-0000-00000000000e', date '2026-11-04',
   'Pas de milonga cette nuit (salle réservée)')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Test accounts: run ./scripts/create-test-users.sh after `supabase db reset`.
--
-- It signs up bob@example.org (owner of Nissartango) and dave@example.org
-- (admin) against the local stack and wires them into organizer_members and
-- user_roles. Both of those tables are unreachable from any user token by
-- design, so that wiring is postgres-side work -- which is the design working,
-- not a gap in it.
--
-- The script reads API_URL / ANON_KEY / DB_URL from `supabase status` itself.
-- Nothing you need to run has a credential placeholder in it, deliberately:
-- an anon key pasted as literal '...' makes every request 401, which is
-- indistinguishable from a policy refusal unless the proof script checks.
-- ---------------------------------------------------------------------------
