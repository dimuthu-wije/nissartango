-- ============================================================================
-- 20260922120000_organizer_public_contact.sql
--
-- A sanctioned place for an organizer's public contact details.
--
-- THE FAILURE THIS REMOVES. There is nowhere to put a phone number today, so
-- it goes in `body` -- "renseignements au 06 ..." is an entirely reasonable
-- thing for an organizer to type. `verify-build.mjs` then warns that a free
-- text field looks like a contact detail, which is a warning about a hole in
-- the schema dressed up as a warning about the content. The schema was
-- producing the failure mode the check exists to catch.
--
-- WHY NEW COLUMNS AND NOT `email` / `phone`. Those two are PRIVATE by
-- contract, and three independent guards assert their absence from the public
-- surface: `organizers_public` omits them, `grants_check.sql` check 8 fails if
-- they ever appear in it, and `prove-rls.sh` proves over HTTP that asking anon
-- for them 400s. Widening them would mean unwinding all three -- and they are
-- not the same fact anyway. `email` is how the site owner reaches an
-- organizer. `contact_email` is what that organizer chose to publish to the
-- world. One is a contact detail; the other is a publication.
--
-- CONSENT IS A COLUMN, NOT A CHECKBOX. The decision this implements asked for
-- "an explicit published publicly, permanently checkbox". A checkbox that
-- lives only in a form is a rule the database does not know, and this project
-- has a standing preference for the opposite: a mistake should deny, not
-- expose. So publication is expressible only WITH a recorded consent, enforced
-- by CHECK. A form that forgets the box cannot write the column.
--
-- A TIMESTAMP, NOT A BOOLEAN, because the consent being recorded is to
-- PERMANENT publication. `true` says somebody once ticked something. A
-- timestamp says when, which is the question actually asked afterwards -- and
-- it is the same reason `cancelled_at` is a timestamp rather than a flag,
-- except that here the value is genuinely read.
--
-- WHAT THIS DOES NOT DO. It does not tell anybody what publishing means. That
-- half is a sentence in French next to the field, and it is the half that
-- decides whether consent is real. The column records that it was given; only
-- the wording makes it informed.
--
-- THE CONTENT CHECKSUM CHANGES ONCE. `content_checksum` is an md5 over the
-- three public views, `organizers_public` included -- see
-- 20260831120000_content_checksum.sql:45. Appending two columns changes the
-- digest with no content change, so expect exactly one drift-triggered rebuild
-- from the poller. (Once, from this migration. A backfill that sets a value
-- would move it a second time; that was mispredicted as one for legacy_slugs
-- and is written down in PROJECT_SETUP.md.)
--
-- `supabase/ops/filter-content-dump.sh` NEEDS NO CHANGE, which was checked
-- rather than assumed. It parses column positions out of each COPY header by
-- NAME (`idx["email"]`) instead of hard-coding them, precisely so that adding
-- a column to organizers cannot redact the wrong one. `email` and `phone` go
-- on being redacted into dev; the two columns below deliberately survive,
-- because they are public content and a restored dev should carry them.
-- ============================================================================

alter table public.organizers
  add column contact_email text
      check (contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  add column contact_phone text
      check (btrim(contact_phone) <> ''),
  add column contact_email_consent_at timestamptz,
  add column contact_phone_consent_at timestamptz;

-- No shape constraint on the phone, deliberately, and for the same reason the
-- private `phone` has none: +33, 06 12 34 56 78 and a Swiss number are all
-- legitimate here. verify-build.mjs recognises a French number in order to
-- NOTICE one, which is a different job from deciding what may be stored.

comment on column public.organizers.contact_email is
  'PUBLIC. Exposed through organizers_public and rendered on the site. '
  'Distinct from organizers.email, which is private and stays private. '
  'Cannot be set without contact_email_consent_at.';
comment on column public.organizers.contact_phone is
  'PUBLIC. Exposed through organizers_public and rendered on the site. '
  'Distinct from organizers.phone, which is private and stays private. '
  'Cannot be set without contact_phone_consent_at.';
comment on column public.organizers.contact_email_consent_at is
  'When the organizer agreed that contact_email is published publicly and '
  'permanently. NOT exposed to anon: the consent is not itself content.';
comment on column public.organizers.contact_phone_consent_at is
  'When the organizer agreed that contact_phone is published publicly and '
  'permanently. NOT exposed to anon: the consent is not itself content.';

-- One direction only. A value requires a consent; a consent without a value is
-- harmless and is what remains after somebody withdraws a published detail --
-- forcing it to null as well would destroy the record that consent was once
-- given, which is the one thing worth keeping about a withdrawal.
alter table public.organizers
  add constraint organizers_contact_email_needs_consent
      check (contact_email is null or contact_email_consent_at is not null),
  add constraint organizers_contact_phone_needs_consent
      check (contact_phone is null or contact_phone_consent_at is not null);

-- ---------------------------------------------------------------------------
-- Column grants.
--
-- Appended to the existing UPDATE grant from 20260828190100_rls_policies.sql,
-- which already covers name/website/instagram/facebook/tiktok/email/phone. A
-- second `grant update (...)` ADDS columns rather than replacing the set.
--
-- The consent columns are writable by the same people who write the values,
-- because the form writes both in one statement and the CHECK above is what
-- makes that honest. INSERT stays ungranted: creating an organizer is still
-- the site owner's, exactly as before.
-- ---------------------------------------------------------------------------
grant update (contact_email, contact_phone,
              contact_email_consent_at, contact_phone_consent_at)
  on public.organizers to authenticated;

-- ---------------------------------------------------------------------------
-- The view the build reads.
--
-- `create or replace view` keeps the existing grants and the deliberate
-- `security_invoker = false`, and it permits APPENDING columns but not
-- reordering them -- so the list below is the original, verbatim, with the two
-- public columns added at the end. Do not tidy the order.
--
-- The consent timestamps are NOT here. They are a record of what an organizer
-- agreed to, not something the agenda publishes, and the narrower the public
-- view the less there is to get wrong.
-- ---------------------------------------------------------------------------
create or replace view public.organizers_public as
  select id, name, slug, website, instagram, facebook, tiktok,
         created_at, updated_at,
         contact_email, contact_phone
    from public.organizers;

notify pgrst, 'reload schema';
