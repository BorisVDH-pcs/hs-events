-- Fix admin_reset_password: "function gen_salt(unknown) does not exist".
--
-- On hosted Supabase, pgcrypto lives in the `extensions` schema, not `public`
-- (0001_init's `create extension if not exists "pgcrypto"` is a no-op there
-- because the extension is already installed). The function was pinned to
-- `search_path = public`, so crypt()/gen_salt() were never found and every
-- reset failed -- the whole RPC rolled back, so no password changed and no
-- log row was written.
--
-- Adding `extensions` to the pinned path resolves both calls without widening
-- anything else; the body is otherwise unchanged from 20260913180000.

create or replace function admin_reset_password(p_profile_id uuid, p_new_password text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_target_name text;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if length(p_new_password) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  select display_name into v_target_name from profiles where id = p_profile_id;
  if v_target_name is null then raise exception 'Player not found'; end if;

  update auth.users
     set encrypted_password = crypt(p_new_password, gen_salt('bf'))
   where id = p_profile_id;

  insert into admin_password_resets (admin_id, target_id, target_display_name)
  values (auth.uid(), p_profile_id, v_target_name);
end;
$$;

revoke execute on function admin_reset_password(uuid, text) from public, anon;
grant  execute on function admin_reset_password(uuid, text) to authenticated;
