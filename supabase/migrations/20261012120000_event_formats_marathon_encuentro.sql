-- Marathon and encuentro join the format list; demo leaves it.
--
-- WHY. The list was the tango-school vocabulary of a single organizer: a
-- demonstration is a thing that happens INSIDE an event rather than a kind of
-- event somebody travels to. A marathon and an encuentro are the opposite --
-- weekend-long gatherings with their own name, their own audience and their own
-- reason to be on an agenda for the Côte d'Azur, where people come from Italy
-- for exactly those.
--
-- SAFE TO REMOVE `demo`, measured against production on 2026-10-12 rather than
-- assumed: zero rows have it in `formats`. And this migration does not need to
-- trust that measurement -- `add constraint` VALIDATES existing rows, so if one
-- did have it, this fails loudly instead of leaving a table whose contents its
-- own CHECK forbids.
--
-- THERE IS NO CLEAN DEPLOYMENT ORDER, and an earlier version of this comment
-- claimed there was. AGENTS.md's rule -- migrate first, deploy second -- covers
-- ADDING a column, where the old code simply ignores it. This statement does two
-- things at once, and they want opposite orders:
--
--     migration first   an editor still offering "Démonstration" writes `demo`,
--                       the new CHECK refuses it, the person sees a 400
--     editor first      the new editor offers Marathon and Encuentro, the OLD
--                       CHECK refuses them, the person sees a 400
--
-- So pick either and run the two back to back; the window is seconds and the
-- maintainer is the only account that has ever signed in. The split-safe version
-- -- add the two new values, deploy, then drop `demo` in a third step -- is
-- three deployments to protect a user who does not exist, and is the right
-- answer only once somebody else is relying on the editor.
--
-- Editor first is the arbitrary choice made here, on the thin grounds that
-- `demo` is a value nobody should be picking anyway while marathon and encuentro
-- are the ones somebody might reach for immediately.
--
-- The public site is not exposed either way: formatsOf() in src/lib/format.js
-- keeps a slug it does not recognise and renders it as itself, so an event
-- marked `marathon` reads "marathon" rather than vanishing, even on a build
-- that predates the label.

alter table public.events
  drop constraint events_formats_known;

alter table public.events
  add constraint events_formats_known
  check (formats <@ array['cours', 'practica', 'milonga', 'stage',
                          'festival', 'marathon', 'encuentro',
                          'soiree']::text[]);
