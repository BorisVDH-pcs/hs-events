-- An organiser can act for a team, from that team's own screen.
--
-- "View as team" (20261003140000) opened any team's screen read only. This
-- lets an organiser switch it to acting: the buttons then really work for that
-- team -- roll, claim, fire, open a tile, upload, spend a preview.
--
-- Accepted risk (Boris, 2026-10-02): an organiser account can now play for any
-- team, so a compromised organiser login could too. Organisers could already
-- move, punish, complete and revoke for any team from the console; this adds
-- the team's own buttons to that.
--
-- How the team is named: the site sends an `x-act-as-team: <team id>` header
-- on its requests while acting (web/src/lib/supabase.js), and PostgREST hands
-- every request's headers to Postgres as `request.headers`. acting_as_team()
-- reads it, and answers only for an organiser. For anybody else it is null,
-- whatever they send, so a player cannot use it to act for another team.
--
-- Where it is honoured: everywhere a player action works out "my team".
--
--   * my_team_in_game(game) -- the team named in the header, if the caller is
--     an organiser and that team is in this game; otherwise exactly as before.
--     That covers claim_tile, bingo_open_tile, snakes_roll,
--     snakes_spend_rollback, snakes_open_tile, spend_pet_jar and
--     submit_pet_jar.
--   * fire_tile and add_evidence check membership themselves. Their one
--     check changes from "a member of the claim's team" to
--     acting_for_team(claim's team): a member, or the organiser acting for it.
--     Only that check changes. The rest of each function is taken from the
--     live definition, so nothing else in them can drift.
--   * The two upload buckets: an organiser may write into any team's folder.
--
-- Honest records: everything done this way is stored and announced under the
-- organiser's own name (claimed_by, fired_by, uploaded_by, the Discord lines),
-- never a player's.
--
-- To undo all of this: scripts/rollback-admin-act-as-team.sql.

-- ---- the header, for organisers only ----------------------------------------

create or replace function acting_as_team()
returns uuid
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v text;
begin
  -- Absent outside PostgREST (the SQL editor, triggers, cron): no header, null.
  begin
    v := current_setting('request.headers', true)::json ->> 'x-act-as-team';
  exception when others then
    return null;
  end;
  if v is null
     or v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  if not is_admin() then
    return null;
  end if;
  return v::uuid;
end;
$function$;

-- Internal: reached only through the functions below, as their owner.
revoke execute on function acting_as_team() from public, anon, authenticated;

-- A member of the team, or the organiser acting for it. Never null: callers
-- write `if not acting_for_team(...) then raise`, and `not null` would let
-- anybody through.
create or replace function acting_for_team(p_team_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (select 1 from team_members
                  where team_id = p_team_id and profile_id = auth.uid())
      or coalesce(p_team_id = acting_as_team(), false);
$function$;

revoke execute on function acting_for_team(uuid) from public, anon, authenticated;

-- ---- my_team_in_game ----------------------------------------------------------

create or replace function my_team_in_game(p_game_id uuid)
returns uuid
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(
    -- The team an organiser is acting for, if it is in this game.
    (select te.id from teams te
      where te.id = acting_as_team() and te.game_id = p_game_id),
    -- Otherwise unchanged since 0024.
    (select tm.team_id
       from team_members tm
       join teams te on te.id = tm.team_id
      where tm.profile_id = auth.uid()
        and te.game_id = p_game_id
      order by te.name
      limit 1));
$function$;

revoke execute on function my_team_in_game(uuid) from public, anon;
grant  execute on function my_team_in_game(uuid) to authenticated;

-- ---- fire_tile and add_evidence: one check each -------------------------------

do $swap$
declare
  v_fn   text;
  v_def  text;
  v_n    int;
  v_from constant text :=
    'not exists \(select 1 from team_members\s+where team_id = v_claim\.team_id and profile_id = auth\.uid\(\)\)';
begin
  foreach v_fn in array array['fire_tile(uuid)',
                              'add_evidence(uuid, text, text, uuid, integer)'] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    select count(*) into v_n from regexp_matches(v_def, v_from, 'g');
    if v_n <> 1 then
      raise exception '% has % copies of the membership check, expected 1 -- not changed', v_fn, v_n;
    end if;
    -- create or replace keeps the function's grants.
    execute regexp_replace(v_def, v_from, 'not acting_for_team(v_claim.team_id)');
  end loop;
end
$swap$;

-- ---- uploads ---------------------------------------------------------------

drop policy if exists evidence_objects_write on storage.objects;
create policy evidence_objects_write on storage.objects
  for insert with check (
    bucket_id = 'evidence'
    and (is_admin()
         or (storage.foldername(name))[2] in (select t::text from my_team_ids() t))
  );

drop policy if exists pet_jar_objects_write on storage.objects;
create policy pet_jar_objects_write on storage.objects
  for insert with check (
    bucket_id = 'pet-jar'
    and (is_admin()
         or (storage.foldername(name))[2] in (select t::text from my_team_ids() t))
  );
