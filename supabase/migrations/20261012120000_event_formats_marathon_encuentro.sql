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
-- THE ORDER OF DEPLOYMENT IS THE REVERSE OF THE USUAL ONE, and AGENTS.md's rule
-- does not cover this case. Adding a column means migrate first, deploy second,
-- because the old code simply ignores the new column. REMOVING an allowed VALUE
-- is the other way round: the moment this lands, an editor still offering a
-- "Démonstration" checkbox produces a save the database refuses, and the person
-- sees a 400. So deploy the editor FIRST, then apply this.
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
