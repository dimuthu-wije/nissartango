-- ============================================================================
-- 20260828181100_organizers.sql
-- organizers, organizer_members, user_roles.
-- Every table ends locked: RLS on, zero policies, privileges revoked.
-- Stage 2 opens exactly the doors we want open.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- organizers
-- Social columns hold HANDLES ('nissartango'), never URLs. The check
-- constraints enforce that, so a pasted profile URL is rejected at write time
-- instead of producing https://instagram.com/https://instagram.com/nissartango
-- in the template.
-- email and phone are PRIVATE. They live here; anon never gets to read this
-- table. Stage 2 exposes the public columns through a view.
-- ---------------------------------------------------------------------------
create table public.organizers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  website     text check (website ~ '^https?://'),
  instagram   text check (instagram ~ '^[A-Za-z0-9._]{1,40}$'),
  facebook    text check (facebook  ~ '^[A-Za-z0-9._-]{1,60}$'),
  tiktok      text check (tiktok    ~ '^[A-Za-z0-9._]{1,40}$'),
  email       text check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone       text check (btrim(phone) <> ''),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.organizers.instagram is 'Handle only, e.g. nissartango. The link is built in the template.';
comment on column public.organizers.email is 'PRIVATE. Never exposed to anon; see organizers_public in stage 2.';
comment on column public.organizers.phone is 'PRIVATE. Never exposed to anon; see organizers_public in stage 2.';

create trigger t40_organizers_set_updated_at
  before update on public.organizers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- organizer_members
-- Ownership is by ORGANIZER, not by individual user. This join table is the
-- edit boundary the whole migration exists for: two people can run one
-- organizer, and handing an organizer over is an insert plus a delete here,
-- not a rewrite of every row's created_by.
-- ---------------------------------------------------------------------------
create table public.organizer_members (
  organizer_id uuid not null references public.organizers (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         public.member_role not null default 'editor',
  created_at   timestamptz not null default now(),
  primary key (organizer_id, user_id)
);

-- The primary key indexes (organizer_id, user_id) in that order, which serves
-- "who belongs to this organizer". Every RLS check runs the other direction --
-- "which organizers does this user belong to" -- so it needs its own index.
create index organizer_members_user_id_idx
  on public.organizer_members (user_id);

-- ---------------------------------------------------------------------------
-- user_roles
-- Site-wide roles (today: admin). Deliberately a TABLE, not a JWT claim: a
-- claim is minted at login, so revoking admin would not take effect until the
-- token expired, and any client can decode -- and a malicious one can attempt
-- to forge -- what it carries. A table is checked on every statement.
-- ---------------------------------------------------------------------------
create table public.user_roles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ---------------------------------------------------------------------------
-- Lock everything down.
--
-- Two independent mechanisms, and you want both:
--   RLS   -- row visibility. Enabled with no policies = nothing matches = deny.
--   GRANT -- table-level privilege. Supabase's default privileges hand anon
--            and authenticated full CRUD on new tables in public, so a table
--            where someone later forgets `enable row level security` is wide
--            open on the REST API. Revoking is the belt to RLS's braces.
-- ---------------------------------------------------------------------------
alter table public.organizers        enable row level security;
alter table public.organizer_members enable row level security;
alter table public.user_roles        enable row level security;

revoke all on table public.organizers        from anon, authenticated;
revoke all on table public.organizer_members from anon, authenticated;
revoke all on table public.user_roles        from anon, authenticated;
