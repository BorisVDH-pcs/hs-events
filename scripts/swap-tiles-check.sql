-- High Society Events -- "drag a tile to another square" check that leaves
-- nothing behind
--
-- Paste the whole file into the Supabase SQL editor and press Run. Run it after
-- any change to admin_swap_tiles (20261004140000_admin_swap_tiles.sql).
--
-- What it proves, on every game's real board (each one put back to setup for
-- the run):
--   * a swap trades exactly the two tiles -- same ids, so their drops and
--     catalogue links go with them -- and moves nothing else;
--   * a move onto an empty square leaves the first square empty;
--   * swapping back restores the board exactly;
--   * dropping a tile on its own square changes nothing.
-- And the refusals: a player, a signed-out visitor, a game that has started,
-- a square off the board, an empty square to move from, a locked-in tile.
--
-- All of it happens inside one subtransaction that is always rolled back; the
-- DO block at the end raises the report as an error, so the editor shows an
-- ERROR, and the error text IS the report. Look for FAIL.

create function pg_temp.swt_as(p_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_id::text, true);
end $$;

-- The whole board as (id, row, col), for before/after comparisons.
create function pg_temp.swt_layout(p_game uuid) returns jsonb
language sql as $$
  select coalesce(jsonb_object_agg(id::text, jsonb_build_array("row", col, position)), '{}'::jsonb)
    from tiles where game_id = p_game;
$$;

create function pg_temp.swt_report() returns text
language plpgsql as $$
declare
  v_admin  uuid;
  v_player uuid;
  v_report text := '';
  v_fail   int := 0;
  v_pass   int := 0;
  g        record;
  a        tiles%rowtype;
  b        tiles%rowtype;
  v_er     int;
  v_ec     int;
  v_before jsonb;
  v_after  jsonb;
  v_res    jsonb;
  v_err    text;
  v_opts   int;
  v_claimed tiles%rowtype;
begin
  begin -- everything below is rolled back at the end of this block
    select id into v_admin from profiles where is_admin order by id limit 1;
    select id into v_player from profiles where not is_admin order by id limit 1;
    if v_admin is null or v_player is null then
      raise exception 'STOPPED at setup: need an organiser and a player account';
    end if;

    for g in select id, name, mode, status as was_status, grid_size from games order by created_at loop
      update games set status = 'setup' where id = g.id;

      -- Two tiles nobody has locked in, and an empty square, if the board has them.
      select t.* into a from tiles t
       where t.game_id = g.id and not exists (select 1 from tile_claims c where c.tile_id = t.id)
       order by t.position limit 1;
      select t.* into b from tiles t
       where t.game_id = g.id and t.id <> a.id
         and not exists (select 1 from tile_claims c where c.tile_id = t.id)
       order by t.position desc limit 1;
      if a.id is null or b.id is null then
        v_report := v_report || format(E'\nSKIP  %s: fewer than two unclaimed tiles', g.name);
        continue;
      end if;

      v_before := pg_temp.swt_layout(g.id);
      select count(*) into v_opts from tile_options where tile_id in (a.id, b.id);

      -- Swap.
      perform pg_temp.swt_as(v_admin);
      execute 'set local role authenticated';
      v_res := admin_swap_tiles(g.id, a."row", a.col, b."row", b.col);
      execute 'reset role';
      v_after := pg_temp.swt_layout(g.id);

      if (v_after -> a.id::text) = jsonb_build_array(b."row", b.col, b.position)
         and (v_after -> b.id::text) = jsonb_build_array(a."row", a.col, a.position)
         and (v_after - a.id::text - b.id::text) = (v_before - a.id::text - b.id::text)
         and (select count(*) from tile_options where tile_id in (a.id, b.id)) = v_opts
         and v_res ->> 'moved' = a.name and v_res ->> 'swapped' = b.name then
        v_pass := v_pass + 1;
        v_report := v_report || format(E'\nPASS  %s (%s): %s and %s swapped, nothing else moved',
                                       g.name, g.mode, a.position, b.position);
      else
        v_fail := v_fail + 1;
        v_report := v_report || format(E'\nFAIL  %s: swap of %s and %s gave %s', g.name, a.position, b.position, v_res);
      end if;

      -- Swap back: the board is exactly as it was.
      perform pg_temp.swt_as(v_admin);
      execute 'set local role authenticated';
      perform admin_swap_tiles(g.id, b."row", b.col, a."row", a.col);
      execute 'reset role';
      if pg_temp.swt_layout(g.id) = v_before then
        v_pass := v_pass + 1;
        v_report := v_report || format(E'\nPASS  %s: swapping back restores the board', g.name);
      else
        v_fail := v_fail + 1;
        v_report := v_report || format(E'\nFAIL  %s: swapping back did not restore the board', g.name);
      end if;

      -- Same square: nothing.
      perform pg_temp.swt_as(v_admin);
      execute 'set local role authenticated';
      v_res := admin_swap_tiles(g.id, a."row", a.col, a."row", a.col);
      execute 'reset role';
      if (v_res ->> 'changed')::boolean = false and pg_temp.swt_layout(g.id) = v_before then
        v_pass := v_pass + 1;
      else
        v_fail := v_fail + 1;
        v_report := v_report || format(E'\nFAIL  %s: dropping a tile on its own square changed something', g.name);
      end if;

      -- Onto an empty square.
      select r.r, c.c into v_er, v_ec
        from generate_series(1, g.grid_size) r(r), generate_series(1, g.grid_size) c(c)
       where not exists (select 1 from tiles t where t.game_id = g.id and t."row" = r.r and t.col = c.c)
       order by r.r, c.c limit 1;
      if v_er is null then
        v_report := v_report || format(E'\nSKIP  %s: no empty square to move onto', g.name);
      else
        perform pg_temp.swt_as(v_admin);
        execute 'set local role authenticated';
        v_res := admin_swap_tiles(g.id, a."row", a.col, v_er, v_ec);
        execute 'reset role';
        if exists (select 1 from tiles where id = a.id and "row" = v_er and col = v_ec)
           and not exists (select 1 from tiles where game_id = g.id and "row" = a."row" and col = a.col)
           and v_res -> 'swapped' = 'null'::jsonb
           and (select count(*) from tiles where game_id = g.id) = (select count(*) from jsonb_object_keys(v_before)) then
          v_pass := v_pass + 1;
          v_report := v_report || format(E'\nPASS  %s: a move onto an empty square leaves the first one empty', g.name);
        else
          v_fail := v_fail + 1;
          v_report := v_report || format(E'\nFAIL  %s: move onto an empty square gave %s', g.name, v_res);
        end if;
        -- And back again, for the refusals below.
        perform pg_temp.swt_as(v_admin);
        execute 'set local role authenticated';
        perform admin_swap_tiles(g.id, v_er, v_ec, a."row", a.col);
        execute 'reset role';
      end if;

      -- Refusals on this board.
      for v_err in
        select unnest(array['player', 'off board', 'empty source', 'started'])
      loop
        declare
          v_msg text;
          v_want text;
        begin
          v_want := case v_err
            when 'player' then 'Admins only'
            when 'off board' then 'Both squares must be on the'
            when 'empty source' then 'There is no tile on that square'
            when 'started' then 'Tiles can only be moved before the game starts' end;
          if v_err = 'empty source' and v_er is null then continue; end if;
          if v_err = 'started' then update games set status = 'active' where id = g.id; end if;
          begin
            perform pg_temp.swt_as(case when v_err = 'player' then v_player else v_admin end);
            execute 'set local role authenticated';
            if v_err = 'off board' then
              perform admin_swap_tiles(g.id, a."row", a.col, g.grid_size + 1, 1);
            elsif v_err = 'empty source' then
              perform admin_swap_tiles(g.id, v_er, v_ec, a."row", a.col);
            else
              perform admin_swap_tiles(g.id, a."row", a.col, b."row", b.col);
            end if;
            execute 'reset role';
            v_fail := v_fail + 1;
            v_report := v_report || format(E'\nFAIL  %s: %s was let through', g.name, v_err);
          exception when others then
            get stacked diagnostics v_msg = message_text;
            execute 'reset role';
            if v_msg like v_want || '%' then
              v_pass := v_pass + 1;
            else
              v_fail := v_fail + 1;
              v_report := v_report || format(E'\nFAIL  %s: %s gave the wrong error: %s', g.name, v_err, v_msg);
            end if;
          end;
          if v_err = 'started' then update games set status = 'setup' where id = g.id; end if;
        end;
      end loop;
      if pg_temp.swt_layout(g.id) = v_before then
        v_pass := v_pass + 1;
        v_report := v_report || format(E'\nPASS  %s: refused for a player, off the board, from an empty square, once started -- board untouched', g.name);
      else
        v_fail := v_fail + 1;
        v_report := v_report || format(E'\nFAIL  %s: a refused swap moved something', g.name);
      end if;

      -- A locked-in tile, where the board has one.
      select t.* into v_claimed from tiles t
       where t.game_id = g.id and exists (select 1 from tile_claims c where c.tile_id = t.id)
       limit 1;
      if v_claimed.id is not null then
        begin
          perform pg_temp.swt_as(v_admin);
          execute 'set local role authenticated';
          perform admin_swap_tiles(g.id, v_claimed."row", v_claimed.col, a."row", a.col);
          execute 'reset role';
          v_fail := v_fail + 1;
          v_report := v_report || format(E'\nFAIL  %s: a locked-in tile was moved', g.name);
        exception when others then
          get stacked diagnostics v_err = message_text;
          execute 'reset role';
          if v_err like 'A team has already locked%' then
            v_pass := v_pass + 1;
            v_report := v_report || format(E'\nPASS  %s: a locked-in tile is refused', g.name);
          else
            v_fail := v_fail + 1;
            v_report := v_report || format(E'\nFAIL  %s: locked-in tile gave the wrong error: %s', g.name, v_err);
          end if;
        end;
      end if;

    end loop;

    -- Signed out.
    begin
      execute 'set local role anon';
      perform admin_swap_tiles(gen_random_uuid(), 1, 1, 1, 2);
      execute 'reset role';
      v_fail := v_fail + 1; v_report := v_report || E'\nFAIL  a signed-out visitor can call admin_swap_tiles';
    exception when insufficient_privilege then
      execute 'reset role';
      v_pass := v_pass + 1; v_report := v_report || E'\nPASS  a signed-out visitor cannot call it';
    end;

    raise exception using message = format(
      E'SWAP-TILES CHECK: %s passed, %s failed (rolled back, nothing kept)%s', v_pass, v_fail, v_report);
  exception when others then
    get stacked diagnostics v_err = message_text;
    return v_err;
  end;
end $$;

do $check$
begin
  raise exception '%', pg_temp.swt_report();
end
$check$;
