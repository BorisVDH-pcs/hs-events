-- High Society Events -- "View as team" check that leaves nothing behind
--
-- Paste the whole file into the Supabase SQL editor and press Run. Run it after
-- any change to board_for_me, tiles_for_me / tiles_for_team, my_evidence /
-- evidence_for_team or admin_board_for_team.
--
-- What it proves: for every team in every game, the board an organiser gets
-- from admin_board_for_team() is the board a member of that team gets from
-- board_for_me() -- the same tiles, fleet, events, evidence, shots and
-- standings, key by key. Plus the refusals: a player cannot call it, it will
-- not mix up games, and the internal helpers cannot be called at all.
--
-- A team with nobody on it gets a stand-in member for the run (an existing
-- account, borrowed). Bingo and Snakes games are also checked as if running,
-- because their board opens up at Start. Like the other smoke tests, the one
-- DO block ALWAYS ends by raising an error, which rolls every change back:
-- the editor shows an ERROR, and the error text IS the report. Look for FAIL.

create function pg_temp.vat_as(p_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_id::text, true);
end $$;

-- Arrays compared as sets where the function builds them in no fixed order.
create function pg_temp.vat_norm(p jsonb) returns jsonb
language sql immutable as $$
  select case when jsonb_typeof(p) = 'array'
    then coalesce((select jsonb_agg(x order by x::text) from jsonb_array_elements(p) x), '[]'::jsonb)
    else p end;
$$;

do $check$
declare
  v_admin   uuid;
  v_report  text := '';
  v_fail    int := 0;
  v_pass    int := 0;
  v_pass_sides int := 0;
  r         record;
  v_member  uuid;
  v_role    team_role;
  v_player  jsonb;
  v_org     jsonb;
  v_key     text;
  v_round   text;
  v_err     text;
  v_spare   uuid[];
  v_used    int := 0;
begin
  select id into v_admin from profiles where is_admin order by id limit 1;
  if v_admin is null then
    raise exception 'STOPPED at setup: no organiser account to run as';
  end if;

  -- Stand-ins for empty teams: non-organiser accounts on no team in that game.
  select array_agg(p.id order by p.id) into v_spare
    from profiles p where not p.is_admin;

  for r in
    select t.id as team_id, t.game_id
      from teams t
     where not exists (select 1 from team_members tm where tm.team_id = t.id)
     order by t.game_id, t.name
  loop
    loop
      v_used := v_used + 1;
      exit when v_used > coalesce(array_length(v_spare, 1), 0);
      exit when not exists (
        select 1 from team_members tm join teams te on te.id = tm.team_id
         where tm.profile_id = v_spare[v_used] and te.game_id = r.game_id);
    end loop;
    if v_used > coalesce(array_length(v_spare, 1), 0) then
      v_report := v_report || E'\nFAIL  setup: ran out of accounts to stand in';
      v_fail := v_fail + 1;
      exit;
    end if;
    insert into team_members (team_id, profile_id, role)
    values (r.team_id, v_spare[v_used], 'member');
  end loop;

  -- Two rounds: as the games stand, then with Bingo and Snakes running.
  foreach v_round in array array['as they are', 'bingo and snakes running'] loop
    if v_round = 'bingo and snakes running' then
      update games set status = 'active' where mode <> 'battleships' and status <> 'active';
    end if;

    -- Every member, captains and members alike. A player rostered on both
    -- sides of one game is left out: board_for_me deliberately blends what
    -- such a player sees (see 0024), so there is no one team to match.
    for r in
      select g.id as game_id, g.name as game_name, g.status, t.id as team_id, t.name as team_name,
             tm.profile_id, tm.role
        from team_members tm join teams t on t.id = tm.team_id join games g on g.id = t.game_id
       where (v_round = 'as they are' or g.mode <> 'battleships')
         and not exists (
           select 1 from team_members tm2 join teams te2 on te2.id = tm2.team_id
            where tm2.profile_id = tm.profile_id and te2.game_id = g.id and tm2.team_id <> t.id)
       order by g.created_at, t.name, tm.profile_id
    loop
      v_member := r.profile_id;
      v_role := r.role;

      perform pg_temp.vat_as(v_member);
      execute 'set local role authenticated';
      v_player := board_for_me(r.game_id);
      execute 'reset role';

      perform pg_temp.vat_as(v_admin);
      execute 'set local role authenticated';
      v_org := admin_board_for_team(r.game_id, r.team_id, v_role);
      execute 'reset role';

      for v_key in select jsonb_object_keys(v_player) union select jsonb_object_keys(v_org) loop
        if v_key = 'memberships' then
          if not (v_player -> 'memberships') @> (v_org -> 'memberships')
             or jsonb_array_length(v_org -> 'memberships') <> 1 then
            v_fail := v_fail + 1;
            v_report := v_report || format(E'\nFAIL  %s / %s (%s, %s): memberships %s vs %s',
              r.game_name, r.team_name, r.status, v_round, v_player -> 'memberships', v_org -> 'memberships');
          end if;
        elsif pg_temp.vat_norm(v_player -> v_key) is distinct from pg_temp.vat_norm(v_org -> v_key) then
          v_fail := v_fail + 1;
          v_report := v_report || format(E'\nFAIL  %s / %s (%s, %s) as %s: "%s" differs -- player %s, organiser %s',
            r.game_name, r.team_name, r.status, v_round, v_member, v_key,
            left(coalesce((v_player -> v_key)::text, 'null'), 300),
            left(coalesce((v_org -> v_key)::text, 'null'), 300));
        else
          v_pass := v_pass + 1;
        end if;
      end loop;
      v_pass_sides := v_pass_sides + 1;
    end loop;
  end loop;

  -- Refusals.
  select tm.profile_id, t.id, t.game_id into r
    from team_members tm join teams t on t.id = tm.team_id limit 1;

  begin
    perform pg_temp.vat_as(r.profile_id);
    execute 'set local role authenticated';
    perform admin_board_for_team(r.game_id, r.id, 'member');
    execute 'reset role';
    v_fail := v_fail + 1; v_report := v_report || E'\nFAIL  a player was let into admin_board_for_team';
  exception when others then
    get stacked diagnostics v_err = message_text;
    execute 'reset role';
    if v_err like 'Only an organiser%' then v_pass := v_pass + 1; v_report := v_report || E'\nPASS  a player is refused: ' || v_err;
    else v_fail := v_fail + 1; v_report := v_report || E'\nFAIL  a player got the wrong error: ' || v_err; end if;
  end;

  begin
    perform pg_temp.vat_as(v_admin);
    execute 'set local role authenticated';
    perform admin_board_for_team(
      (select g.id from games g where g.id <> r.game_id limit 1), r.id, 'member');
    execute 'reset role';
    v_fail := v_fail + 1; v_report := v_report || E'\nFAIL  a team was shown under another game';
  exception when others then
    get stacked diagnostics v_err = message_text;
    execute 'reset role';
    if v_err like 'That team is not in this game%' then v_pass := v_pass + 1; v_report := v_report || E'\nPASS  a team under the wrong game is refused';
    else v_fail := v_fail + 1; v_report := v_report || E'\nFAIL  wrong game gave the wrong error: ' || v_err; end if;
  end;

  begin
    perform pg_temp.vat_as(v_admin);
    execute 'set local role authenticated';
    perform * from tiles_for_team(r.game_id, r.id);
    execute 'reset role';
    v_fail := v_fail + 1; v_report := v_report || E'\nFAIL  tiles_for_team can be called directly';
  exception when insufficient_privilege then
    execute 'reset role';
    v_pass := v_pass + 1; v_report := v_report || E'\nPASS  tiles_for_team cannot be called directly';
  end;

  begin
    perform pg_temp.vat_as(v_admin);
    execute 'set local role authenticated';
    perform * from evidence_for_team(r.game_id, r.id);
    execute 'reset role';
    v_fail := v_fail + 1; v_report := v_report || E'\nFAIL  evidence_for_team can be called directly';
  exception when insufficient_privilege then
    execute 'reset role';
    v_pass := v_pass + 1; v_report := v_report || E'\nPASS  evidence_for_team cannot be called directly';
  end;

  begin
    execute 'set local role anon';
    perform admin_board_for_team(r.game_id, r.id, 'member');
    execute 'reset role';
    v_fail := v_fail + 1; v_report := v_report || E'\nFAIL  a signed-out visitor can call admin_board_for_team';
  exception when insufficient_privilege then
    execute 'reset role';
    v_pass := v_pass + 1; v_report := v_report || E'\nPASS  a signed-out visitor cannot call it';
  end;

  raise exception E'VIEW-AS-TEAM CHECK: % passed, % failed, % member boards compared (rolled back, nothing kept)%',
    v_pass, v_fail, v_pass_sides, v_report;
end
$check$;
