-- =============================================================================
-- 003_netcore_domain_access.sql
-- Run once in Supabase → SQL Editor on a project set up with schema.sql / 002 (safe to re-run).
--
-- Before: only the emails listed in is_approved_email() could read/write SOFs; other
--         @netcore.ai accounts saw "Request Access".
-- After:  any verified @netcore.ai account can use the app (own SOFs only), no allowlist.
--         Admins (ankitrihal@gmail.com, ankit.rihal@netcore.ai) still see and delete every SOF.
--         Unverified emails and non-Netcore accounts still read and write nothing.
-- =============================================================================

-- 1. Access helpers
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

-- 2. Row Level Security: allowlist → verified Netcore domain
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

-- 3. Sign-up hook permissions (the hook itself is unchanged; can_sign_in now uses the new helpers)
grant usage on schema public to supabase_auth_admin;
grant execute on function public.can_sign_in(text) to supabase_auth_admin;
grant execute on function public.is_netcore_email(text) to supabase_auth_admin;
grant execute on function public.is_admin_email(text) to supabase_auth_admin;
revoke execute on function public.current_email_verified() from anon, public;
grant execute on function public.current_email_verified() to authenticated;

-- 4. The old allowlist function is no longer used by any policy
drop function if exists public.is_approved_email(text);
