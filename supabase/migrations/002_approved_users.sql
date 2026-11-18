-- =============================================================================
-- Migration 002: approved-users list (run once in Supabase → SQL Editor)
--
-- For a project that already ran the first version of supabase/schema.sql.
-- (A new project can just run the current supabase/schema.sql instead.)
--
-- Before: any @netcore.ai account could read/write its own SOFs.
-- After:  only admins + approved Account Executives can read/write SOFs.
--         Other @netcore.ai accounts can still sign in (to see "Request Access")
--         but get no data. SOFs they saved earlier stay in the table; admins still see them.
-- =============================================================================

begin;

-- 1. Who is approved, and who may sign in
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

-- 2. Row Level Security: approved users only (admins still see everything)
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

-- 3. Sign-up hook: let any @netcore.ai account in (to reach "Request Access")
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

-- 4. Remove the old, broader check
drop function if exists public.is_allowed_email(text);

commit;

-- Check: should list the 4 policies
-- select policyname, cmd from pg_policies where tablename = 'saved_sofs';
