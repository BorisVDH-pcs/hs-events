-- High Society Events -- "Act for a team" check that leaves nothing behind
--
-- Paste the whole file into the Supabase SQL editor and press Run. Run it after
-- any change to acting_as_team, acting_for_team, my_team_in_game, fire_tile,
-- add_evidence or the two upload policies (20261003150000_admin_act_as_team).
--
-- What it proves:
--   * Players are untouched. For every member, in every game, my_team_in_game
--     and tiles_for_me give the same answer with no header as with a forged
--     `x-act-as-team` header naming any other team.
--   * An organiser acts only for the team the header names, and only in that
--     team's game. No header, a malformed one or an unknown team: no team.
--   * fire_tile and add_evidence carry the new check, once, and not the old.
--   * An organiser acting for a team can really roll for it in a Snakes game;
--     without the header they are refused, and a player forging the header
--     still rolls for their own team.
--   * Uploads: an organiser may write into any team's folder, a player only
--     into their own.
--   * The two helpers cannot be called from the site.
--
-- Empty teams get a stand-in member (an existing account, borrowed) and every
-- Snakes game is set running for the run. All of it happens inside one
-- subtransaction that is always rolled back; the DO block at the end then
-- raises the report as an error, so the editor shows an ERROR, and the error
-- text IS the report. Look for FAIL.

create function pg_temp.aat_as(p_id uuid, p_header text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_id::text, true);
  perform set_config('request.headers',
                     case when p_header is null then '{}'
                          else json_build_object('x-act-as-team', p_header)::text end, true);
end $$;

create function pg_temp.aat_tiles(p_game uuid) returns jsonb
language sql as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb)
    from tiles_for_me(p_game) t;
$$;

create function pg_temp.aat_report() returns text
language plpgsql as $$
declare
  v_admin   uuid;
  v_report  text := '';
  v_fail    int := 0;
  v_pass    int := 0;
  r         record;
  g         record;
  t         record;
  v_spare   uuid[];
  v_used    int := 0;
  v_want    uuid;
  v_got     uuid;
  v_plain   jsonb;
  v_forged  jsonb;
  v_bool    boolean;
  v_err     text;
  v_n       int;
  v_header  text;
  v_snakes  record;
  v_other   uuid;
  v_player  uuid;
begin
  begin -- everything below is rolled back at the end of this block
    select id into v_admin from profiles where is_admin order by id limit 1;
    if v_admin is null then
      raise exception 'STOPPED at setup: no organiser account to run as';
    end if;

    -- Stand-ins for empty teams: non-organiser accounts on no team in that game.
    select array_agg(p.id order by p.id) into v_spare from profiles p where not p.is_admin;
    for r in
      select te.id as team_id, te.game_id from teams te
       where not exists (select 1 from team_members tm where tm.team_id = te.id)
       order by te.game_id, te.name
    loop
      loop
        v_used := v_used + 1;
        exit when v_used > coalesce(array_length(v_spare, 1), 0);
        exit when not exists (
          select 1 from team_members tm join teams te on te.id = tm.team_id
           where tm.profile_id = v_spare[v_used] and te.game_id = r.game_id);
      end loop;
      if v_used > coalesce(array_length(v_spare, 1), 0) then
        v_fail := v_fail + 1;
        v_report := v_report || E'\nFAIL  setup: ran out of accounts to stand in';
        exit;
      end if;
      insert into team_members (team_id, profile_id, role) values (r.team_id, v_spare[v_used], 'member');
    end loop;

    update games set status = 'active' where mode = 'snakes' and status <> 'active';

    -- ---- players: a forged header changes nothing -------------------------
    v_n := 0;
    for r in select distinct tm.profile_id from team_members tm order by 1 loop
      for g in select id, name from games order by created_at loop
        select tm.team_id into v_want
          from team_members tm join teams te on te.id = tm.team_id
         where tm.profile_id = r.profile_id and te.game_id = g.id
         order by te.name limit 1;

        perform pg_temp.aat_as(r.profile_id, null);
        execute 'set local role authenticated';
        v_got := my_team_in_game(g.id);
        v_plain := pg_temp.aat_tiles(g.id);
        execute 'reset role';
        if v_got is distinct from v_want then
          v_fail := v_fail + 1;
          v_report := v_report || format(E'\nFAIL  %s in %s: my_team_in_game %s, expected %s',
                                         r.profile_id, g.name, v_got, v_want);
        end if;

        for t in select te.id from teams te where te.id is distinct from v_want loop
          perform pg_temp.aat_as(r.profile_id, t.id::text);
          execute 'set local role authenticated';
          v_got := my_team_in_game(g.id);
          v_forged := pg_temp.aat_tiles(g.id);
          execute 'reset role';
          if v_got is distinct from v_want or v_forged is distinct from v_plain then
            v_fail := v_fail + 1;
            v_report := v_report || format(E'\nFAIL  %s in %s forging team %s: got team %s (expected %s), tiles %s',
              r.profile_id, g.name, t.id, v_got, v_want,
              case when v_forged = v_plain then 'same' else 'DIFFERENT' end);
          else
            v_pass := v_pass + 1; v_n := v_n + 1;
          end if;
        end loop;
      end loop;
    end loop;
    v_report := v_report || format(E'\nPASS  %s forged headers from players changed nothing', v_n);

    -- ---- the organiser ------------------------------------------------------
    for g in select id, name from games order by created_at loop
      foreach v_header in array array[null, '', 'not-a-uuid', gen_random_uuid()::text,
                                      'x' || (select te.id::text from teams te limit 1)] loop
        perform pg_temp.aat_as(v_admin, v_header);
        execute 'set local role authenticated';
        v_got := my_team_in_game(g.id);
        execute 'reset role';
        if v_got is not null then
          v_fail := v_fail + 1;
          v_report := v_report || format(E'\nFAIL  organiser with header %L got team %s in %s',
                                         v_header, v_got, g.name);
        else
          v_pass := v_pass + 1;
        end if;
      end loop;

      for t in select te.id, te.name, te.game_id from teams te loop
        foreach v_header in array array[t.id::text, upper(t.id::text)] loop
          perform pg_temp.aat_as(v_admin, v_header);
          execute 'set local role authenticated';
          v_got := my_team_in_game(g.id);
          execute 'reset role';
          v_want := case when t.game_id = g.id then t.id end;
          if v_got is distinct from v_want then
            v_fail := v_fail + 1;
            v_report := v_report || format(E'\nFAIL  organiser acting for %s got %s in %s, expected %s',
                                           t.name, v_got, g.name, v_want);
          else
            v_pass := v_pass + 1;
          end if;
        end loop;
      end loop;
    end loop;
    v_report := v_report || E'\nPASS  organiser: only the named team, only in its own game (if no FAIL above)';

    -- acting_for_team, as its callers run it.
    select tm.team_id, tm.profile_id into r from team_members tm order by tm.team_id, tm.profile_id limit 1;
    select te.id into v_other from teams te where te.id <> r.team_id
       and not exists (select 1 from team_members tm where tm.team_id = te.id and tm.profile_id = r.profile_id)
     limit 1;
    for t in
      select * from (values
        (v_admin, r.team_id::text, r.team_id, true,  'organiser acting for the team'),
        (v_admin, r.team_id::text, v_other,   false, 'organiser acting for another team'),
        (v_admin, null,            r.team_id, false, 'organiser with no header'),
        (r.profile_id, null,       r.team_id, true,  'member, no header'),
        (r.profile_id, v_other::text, v_other, false, 'player forging another team'),
        (r.profile_id, v_other::text, r.team_id, true, 'player forging, own team')
      ) x(who, hdr, team, want, label)
    loop
      perform pg_temp.aat_as(t.who, t.hdr);
      v_bool := acting_for_team(t.team);
      if v_bool is distinct from t.want then
        v_fail := v_fail + 1;
        v_report := v_report || format(E'\nFAIL  acting_for_team, %s: %s', t.label, v_bool);
      else
        v_pass := v_pass + 1;
        v_report := v_report || format(E'\nPASS  acting_for_team, %s: %s', t.label, v_bool);
      end if;
    end loop;

    -- ---- fire_tile and add_evidence -----------------------------------------
    for t in select unnest(array['fire_tile(uuid)', 'add_evidence(uuid, text, text, uuid, integer)']) as fn loop
      select count(*) into v_n
        from regexp_matches(pg_get_functiondef(t.fn::regprocedure), 'not acting_for_team\(v_claim\.team_id\)', 'g');
      v_bool := pg_get_functiondef(t.fn::regprocedure) ~
        'not exists \(select 1 from team_members\s+where team_id = v_claim\.team_id and profile_id = auth\.uid\(\)\)';
      if v_n = 1 and not v_bool then
        v_pass := v_pass + 1;
        v_report := v_report || format(E'\nPASS  %s: the acting check, once, and not the old one', t.fn);
      else
        v_fail := v_fail + 1;
        v_report := v_report || format(E'\nFAIL  %s: %s acting checks, old check still there: %s', t.fn, v_n, v_bool);
      end if;
    end loop;

    -- ---- a real roll --------------------------------------------------------
    select g2.id as game_id, g2.name,
           (select te.id from teams te where te.game_id = g2.id order by te.name limit 1) as team_a,
           (select te.id from teams te where te.game_id = g2.id order by te.name offset 1 limit 1) as team_b
      into v_snakes
      from games g2 where g2.mode = 'snakes' order by g2.created_at desc limit 1;

    if v_snakes.game_id is null then
      v_report := v_report || E'\nSKIP  no Snakes game to roll in';
    else
      -- The organiser, with no header: refused.
      begin
        perform pg_temp.aat_as(v_admin, null);
        execute 'set local role authenticated';
        perform snakes_roll(v_snakes.game_id);
        execute 'reset role';
        v_fail := v_fail + 1; v_report := v_report || E'\nFAIL  an organiser rolled with no header';
      exception when others then
        get stacked diagnostics v_err = message_text;
        execute 'reset role';
        v_pass := v_pass + 1; v_report := v_report || E'\nPASS  organiser, no header, roll refused: ' || v_err;
      end;

      -- The organiser acting for team A: the roll is A's.
      select count(*) into v_n from game_events where team_id = v_snakes.team_a;
      begin
        perform pg_temp.aat_as(v_admin, v_snakes.team_a::text);
        execute 'set local role authenticated';
        perform snakes_roll(v_snakes.game_id);
        execute 'reset role';
        if (select count(*) from game_events where team_id = v_snakes.team_a) > v_n then
          v_pass := v_pass + 1;
          v_report := v_report || format(E'\nPASS  organiser acting for a team rolled for it in %s', v_snakes.name);
        else
          v_fail := v_fail + 1;
          v_report := v_report || E'\nFAIL  organiser roll went through but left no event for the team';
        end if;
      exception when others then
        get stacked diagnostics v_err = message_text;
        execute 'reset role';
        -- A game rule (a tile to finish first, say) means the roll got as far
        -- as the team's own turn, which is what is being proved.
        if v_err like 'You are not a member%' then
          v_fail := v_fail + 1; v_report := v_report || E'\nFAIL  organiser acting could not roll: ' || v_err;
        else
          v_pass := v_pass + 1;
          v_report := v_report || E'\nPASS  organiser acting reached the team''s own turn (game rule: ' || v_err || ')';
        end if;
      end;

      -- A member of team B forging team A: the roll is still B's.
      select tm.profile_id into v_player from team_members tm
       where tm.team_id = v_snakes.team_b order by tm.profile_id limit 1;
      select count(*) into v_n from game_events where team_id = v_snakes.team_a;
      begin
        perform pg_temp.aat_as(v_player, v_snakes.team_a::text);
        execute 'set local role authenticated';
        perform snakes_roll(v_snakes.game_id);
        execute 'reset role';
        if (select count(*) from game_events where team_id = v_snakes.team_a) = v_n then
          v_pass := v_pass + 1; v_report := v_report || E'\nPASS  a player forging the header rolled for their own team';
        else
          v_fail := v_fail + 1; v_report := v_report || E'\nFAIL  a player forging the header moved the other team';
        end if;
      exception when others then
        get stacked diagnostics v_err = message_text;
        execute 'reset role';
        v_fail := v_fail + 1; v_report := v_report || E'\nFAIL  a player could not roll for their own team: ' || v_err;
      end;
    end if;

    -- ---- uploads --------------------------------------------------------------
    select tm.team_id, tm.profile_id, te.game_id into r
      from team_members tm join teams te on te.id = tm.team_id order by tm.team_id, tm.profile_id limit 1;
    select te.id into v_other from teams te where te.id <> r.team_id
       and not exists (select 1 from team_members tm where tm.team_id = te.id and tm.profile_id = r.profile_id)
     limit 1;
    for t in
      select * from (values
        ('evidence', v_admin,      v_other,   true,  'organiser, any team'),
        ('pet-jar',  v_admin,      v_other,   true,  'organiser, any team'),
        ('evidence', r.profile_id, r.team_id, true,  'player, own team'),
        ('pet-jar',  r.profile_id, r.team_id, true,  'player, own team'),
        ('evidence', r.profile_id, v_other,   false, 'player, another team'),
        ('pet-jar',  r.profile_id, v_other,   false, 'player, another team')
      ) x(bucket, who, team, want, label)
    loop
      begin
        perform pg_temp.aat_as(t.who, null);
        execute 'set local role authenticated';
        insert into storage.objects (bucket_id, name, owner_id)
        values (t.bucket, format('%s/%s/act-as-check-%s.png', r.game_id, t.team, gen_random_uuid()), t.who::text);
        execute 'reset role';
        v_bool := true;
      exception when insufficient_privilege then
        execute 'reset role';
        v_bool := false;
      when others then
        get stacked diagnostics v_err = message_text;
        execute 'reset role';
        v_bool := null;
      end;
      if v_bool is not distinct from t.want then
        v_pass := v_pass + 1;
        v_report := v_report || format(E'\nPASS  upload to %s, %s: %s', t.bucket, t.label,
                                       case when v_bool then 'allowed' else 'refused' end);
      else
        v_fail := v_fail + 1;
        v_report := v_report || format(E'\nFAIL  upload to %s, %s: %s', t.bucket, t.label,
                                       coalesce(v_bool::text, 'error: ' || v_err));
      end if;
    end loop;

    -- ---- the helpers are internal ---------------------------------------------
    begin
      perform pg_temp.aat_as(v_admin, r.team_id::text);
      execute 'set local role authenticated';
      perform acting_as_team();
      execute 'reset role';
      v_fail := v_fail + 1; v_report := v_report || E'\nFAIL  acting_as_team can be called from the site';
    exception when insufficient_privilege then
      execute 'reset role';
      v_pass := v_pass + 1; v_report := v_report || E'\nPASS  acting_as_team cannot be called from the site';
    end;
    begin
      perform pg_temp.aat_as(v_admin, r.team_id::text);
      execute 'set local role authenticated';
      perform acting_for_team(r.team_id);
      execute 'reset role';
      v_fail := v_fail + 1; v_report := v_report || E'\nFAIL  acting_for_team can be called from the site';
    exception when insufficient_privilege then
      execute 'reset role';
      v_pass := v_pass + 1; v_report := v_report || E'\nPASS  acting_for_team cannot be called from the site';
    end;
    if has_function_privilege('authenticated', 'my_team_in_game(uuid)', 'execute')
       and not has_function_privilege('anon', 'my_team_in_game(uuid)', 'execute') then
      v_pass := v_pass + 1; v_report := v_report || E'\nPASS  my_team_in_game grants unchanged';
    else
      v_fail := v_fail + 1; v_report := v_report || E'\nFAIL  my_team_in_game grants changed';
    end if;

    raise exception using message = format(
      E'ACT-AS-TEAM CHECK: %s passed, %s failed (rolled back, nothing kept)%s', v_pass, v_fail, v_report);
  exception when others then
    get stacked diagnostics v_err = message_text;
    return v_err;
  end;
end $$;

do $check$
begin
  raise exception '%', pg_temp.aat_report();
end
$check$;
