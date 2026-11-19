-- =============================================================================
-- SOF Engine: Supabase schema
-- Run once in Supabase → SQL Editor (safe to re-run).
--
-- Access rules (enforced in the database, not just the app):
--   • Admins (all SOFs):   ankitrihal@gmail.com, ankit.rihal@netcore.ai  (is_admin_email below)
--   • Any verified @netcore.ai account: automatic access, own SOFs only. No allowlist.
--       (Country locks for the ID / PH teams live in the app, src/lib/access.ts)
--   • Unverified emails and every other account read and write nothing; the sign-up hook
--     (section 5) stops non-Netcore accounts from being created at all.
-- To change admins, edit is_admin_email() and is_admin() and re-run this file.
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

-- Exactly name@netcore.ai (trimmed, any case). Not subdomains, not look-alikes.
create or replace function public.is_netcore_email(email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(email, ''))) ~ '^[^@[:space:]]+@netcore\.ai$';
$$;

-- Admin logins (ankitrihal@gmail.com is the one non-Netcore account allowed in).
create or replace function public.is_admin_email(email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(email, ''))) in ('ankitrihal@gmail.com', 'ankit.rihal@netcore.ai');
$$;

-- Who may sign in at all: any @netcore.ai account plus the admins (used by the sign-up hook).
create or replace function public.can_sign_in(email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.is_netcore_email(email) or public.is_admin_email(email);
$$;

-- Has the signed-in user's email been verified? Read from Supabase's own user record
-- (auth.users), not from the login token's editable user_metadata.
create or replace function public.current_email_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;

-- May the signed-in user use the app (read/write their SOFs)? Netcore or admin, and verified.
create or replace function public.has_app_access()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.can_sign_in(public.current_email()) and public.current_email_verified();
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
    public.has_app_access()
    and (user_email = public.current_email() or public.is_admin())
  );

drop policy if exists saved_sofs_insert on public.saved_sofs;
create policy saved_sofs_insert on public.saved_sofs
  for insert to authenticated
  with check (
    public.has_app_access()
    and user_email = public.current_email()
  );

drop policy if exists saved_sofs_update on public.saved_sofs;
create policy saved_sofs_update on public.saved_sofs
  for update to authenticated
  using (
    public.has_app_access()
    and (user_email = public.current_email() or public.is_admin())
  )
  with check (
    public.has_app_access()
    and (user_email = public.current_email() or public.is_admin())
  );

drop policy if exists saved_sofs_delete on public.saved_sofs;
create policy saved_sofs_delete on public.saved_sofs
  for delete to authenticated
  using (
    public.has_app_access()
    and (user_email = public.current_email() or public.is_admin())
  );

-- ---------------------------------------------------------------------------
-- 5. (Recommended) Block non-Netcore accounts from being created at all
--    Supabase → Authentication → Hooks → "Before User Created" → Postgres function
--    → choose public.hook_restrict_signup. Any @netcore.ai account (and the admins) may sign
--    up. Without the hook, an outside Google account can still create a user record
--    (it can't read or write any data).
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
grant execute on function public.is_netcore_email(text) to supabase_auth_admin;
grant execute on function public.is_admin_email(text) to supabase_auth_admin;
revoke execute on function public.current_email_verified() from anon, public;
grant execute on function public.current_email_verified() to authenticated;
revoke execute on function public.hook_restrict_signup(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- 6. Clean-up of functions from earlier versions of this file. Runs last, after
--    the policies above stopped depending on them.
-- ---------------------------------------------------------------------------
drop function if exists public.is_allowed_email(text);
drop function if exists public.is_approved_email(text);
