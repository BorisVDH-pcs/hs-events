-- Close two admin RPCs to signed-out callers.
--
-- 20260913104751_drop_tile_tags dropped and recreated admin_autofill_board and
-- admin_list_library. A function created in `public` picks up Supabase's
-- default privileges -- EXECUTE for PUBLIC and anon -- and that migration only
-- added the grant to `authenticated`, without the
-- `revoke ... from public, anon` every other admin function carries. The
-- security advisor flagged both (lint 0028) on 2026-10-01.
--
-- Nothing leaked: both are security definer functions whose first line is
-- `if not is_admin() then raise exception`, and is_admin() is false without a
-- session. This puts them back behind the same grant as the rest of the admin
-- API, so the guard is the grant and the check, not the check alone.
--
-- Grants only; the function bodies are untouched.

revoke execute on function admin_autofill_board(uuid) from public, anon;
revoke execute on function admin_list_library()      from public, anon;

grant execute on function admin_autofill_board(uuid) to authenticated;
grant execute on function admin_list_library()      to authenticated;
