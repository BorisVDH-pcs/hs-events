-- Undo 20261003150000_admin_act_as_team.sql: organisers can no longer act
-- for a team. "View as team" (read only) keeps working.
--
-- Run in the Supabase SQL editor. All or nothing. Afterwards the site's
-- "Act for <team>" button still shows, but every action it allows is refused
-- by the server again ("not on a team"), so also revert the commit that added
-- it, or set ACTING_ENABLED to false in web/src/lib/viewOnly.js.
--
-- Leaves the migration recorded in supabase_migrations.schema_migrations, so
-- `supabase db push` does not run it again. To retire it for good, add a new
-- migration with this file's body instead.

begin;

-- my_team_in_game exactly as before (0024).
create or replace function my_team_in_game(p_game_id uuid)
returns uuid
language sql
stable security definer
set search_path to 'public'
as $function$
  select tm.team_id
    from team_members tm
    join teams te on te.id = tm.team_id
   where tm.profile_id = auth.uid()
     and te.game_id = p_game_id
   order by te.name
   limit 1;
$function$;

revoke execute on function my_team_in_game(uuid) from public, anon;
grant  execute on function my_team_in_game(uuid) to authenticated;

-- fire_tile and add_evidence: the membership check back as it was.
do $swap$
declare
  v_fn   text;
  v_def  text;
  v_n    int;
  v_from constant text := 'not acting_for_team\(v_claim\.team_id\)';
begin
  foreach v_fn in array array['fire_tile(uuid)',
                              'add_evidence(uuid, text, text, uuid, integer)'] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    select count(*) into v_n from regexp_matches(v_def, v_from, 'g');
    if v_n <> 1 then
      raise exception '% has % acting checks, expected 1 -- nothing changed', v_fn, v_n;
    end if;
    execute regexp_replace(v_def, v_from,
      E'not exists (select 1 from team_members\n                  where team_id = v_claim.team_id and profile_id = auth.uid())');
  end loop;
end
$swap$;

-- Uploads: own team's folder only, as before.
drop policy if exists evidence_objects_write on storage.objects;
create policy evidence_objects_write on storage.objects
  for insert with check (
    bucket_id = 'evidence'
    and (storage.foldername(name))[2] in (select t::text from my_team_ids() t)
  );

drop policy if exists pet_jar_objects_write on storage.objects;
create policy pet_jar_objects_write on storage.objects
  for insert with check (
    bucket_id = 'pet-jar'
    and (storage.foldername(name))[2] in (select t::text from my_team_ids() t)
  );

drop function if exists acting_for_team(uuid);
drop function if exists acting_as_team();

commit;
