-- =============================================================================
-- SOF Engine: Supabase schema
-- Run once in Supabase → SQL Editor (safe to re-run).
--
-- Access rules (enforced in the database, not just the app):
--   • Admins (all SOFs):         ankitrihal@gmail.com, ankit.rihal@netcore.ai
--   • Account Executives (own SOFs only):     the list in is_approved_email() below
--       Philippines: don.gonzales, yuvraj.bhattee · Indonesia: mohd.pakzad, prathamesh.borkar
--       (their country lock lives in the app, src/lib/access.ts)
--   • Other @netcore.ai accounts may sign in (the app shows them "Request Access"),
--     but read and write nothing.
--   • Any other account can't be created at all (sign-up hook, section 5).
-- To approve an Account Executive or change admins, edit section 1 and re-run this file.
-- Keep src/lib/access.ts in sync.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Access helpers
-- ---------------------------------------------------------------------------

-- Email of the signed-in user, from their Supabase login token (lower-case).
create or replace function public.current_email()
returns text
language sql
stable
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- Admins and approved Account Executives: the only users who can read or write SOFs.
create or replace function public.is_approved_email(email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(coalesce(email, '')) in (
    -- Admins
    'ankitrihal@gmail.com',
    'ankit.rihal@netcore.ai',
    -- Account Executives, Indonesia
    'mohd.pakzad@netcore.ai',
    'prathamesh.borkar@netcore.ai',
    -- Account Executives, Philippines
    'don.gonzales@netcore.ai',
    'yuvraj.bhattee@netcore.ai'
  );
$$;

-- Who may sign in at all (approved or waiting for approval): any @netcore.ai
-- account plus the admins. Used only by the sign-up hook in section 5.
create or replace function public.can_sign_in(email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select right(lower(coalesce(email, '')), 11) = '@netcore.ai'
      or public.is_approved_email(email);
$$;

-- Who sees every SOF in the company.
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.current_email() in ('ankitrihal@gmail.com', 'ankit.rihal@netcore.ai');
$$;

-- ---------------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------------
create table if not exists public.saved_sofs (
  id           uuid primary key default gen_random_uuid(),
  user_email   text        not null default public.current_email(),
  client_name  text        not null,
  form_data    jsonb       not null,          -- exact React form state of the dashboard
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists saved_sofs_user_updated_idx on public.saved_sofs (user_email, updated_at desc);
create index if not exists saved_sofs_updated_idx      on public.saved_sofs (updated_at desc);

-- ---------------------------------------------------------------------------
-- 3. Integrity triggers
--    • user_email always comes from the login token (it can't be spoofed by the app)
--    • user_email and created_at never change after creation
--    • updated_at is set automatically on every update
-- ---------------------------------------------------------------------------
create or replace function public.saved_sofs_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.user_email := public.current_email();
    new.created_at := now();
    new.updated_at := now();
  else
    new.user_email := old.user_email;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists saved_sofs_before_write on public.saved_sofs;
create trigger saved_sofs_before_write
  before insert or update on public.saved_sofs
  for each row execute function public.saved_sofs_before_write();

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.saved_sofs enable row level security;

revoke all on public.saved_sofs from anon;
grant select, insert, update, delete on public.saved_sofs to authenticated;

drop policy if exists saved_sofs_select on public.saved_sofs;
create policy saved_sofs_select on public.saved_sofs
  for select to authenticated
  using (
    public.is_approved_email(public.current_email())
    and (user_email = public.current_email() or public.is_admin())
  );

drop policy if exists saved_sofs_insert on public.saved_sofs;
create policy saved_sofs_insert on public.saved_sofs
  for insert to authenticated
  with check (
    public.is_approved_email(public.current_email())
    and user_email = public.current_email()
  );

drop policy if exists saved_sofs_update on public.saved_sofs;
create policy saved_sofs_update on public.saved_sofs
  for update to authenticated
  using (
    public.is_approved_email(public.current_email())
    and (user_email = public.current_email() or public.is_admin())
  )
  with check (
    public.is_approved_email(public.current_email())
    and (user_email = public.current_email() or public.is_admin())
  );

drop policy if exists saved_sofs_delete on public.saved_sofs;
create policy saved_sofs_delete on public.saved_sofs
  for delete to authenticated
  using (
    public.is_approved_email(public.current_email())
    and (user_email = public.current_email() or public.is_admin())
  );

-- ---------------------------------------------------------------------------
-- 5. (Recommended) Block non-Netcore accounts from being created at all
--    Supabase → Authentication → Hooks → "Before User Created" → Postgres function
--    → choose public.hook_restrict_signup. Unapproved @netcore.ai accounts are still
--    let in so they can reach the "Request Access" screen. Without the hook, an outside
--    Google account can still create a user record (it can't read or write any data).
-- ---------------------------------------------------------------------------
create or replace function public.hook_restrict_signup(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if public.can_sign_in(event -> 'user' ->> 'email') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Unauthorized: Only Netcore accounts are allowed.'
    )
  );
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_restrict_signup(jsonb) to supabase_auth_admin;
grant execute on function public.can_sign_in(text) to supabase_auth_admin;
grant execute on function public.is_approved_email(text) to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- 6. Clean-up from the first version of this file
--    (is_allowed_email let any @netcore.ai account use the app). Runs last, after
--    the policies above stopped depending on it.
-- ---------------------------------------------------------------------------
drop function if exists public.is_allowed_email(text);
