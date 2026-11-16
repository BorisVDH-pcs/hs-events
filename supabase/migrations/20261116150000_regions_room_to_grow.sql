-- Region Bingo: room for as many tasks per region as an organiser wants.
--
-- The first cut (20261116120100) cut the 10x10 card into the eleven regions,
-- nine squares each, so a region could never hold more than nine tasks and
-- square 100 belonged to none. Organisers build a region game on the map now,
-- region by region (BoardBuilder -> RegionBuilderMap), and want more than nine.
--
-- So every region gets a block of a hundred squares of its own, in
-- territory_regions.sort order: Misthalin owns squares 1-100, Asgarnia
-- 101-200, ... Varlamore 1001-1100. A square is still (row - 1) * 10 + col,
-- ten to a row, so a region game's rows run to 110 while its columns stay at
-- 10. Nothing else about a tile changes; its region is still read off its
-- square, now in blocks of a hundred.
--
-- What changes:
--   1. tiles already on a region game move from the nine-square layout to
--      the hundred-square one (same region, same order);
--   2. regions_region_at / regions_totals / regions_team_regions read blocks
--      of a hundred, and regions_start_problem only refuses a square past
--      Varlamore's last;
--   3. admin_set_tile and admin_swap_tiles accept rows up to 110 on a region
--      game (columns still to 10);
--   4. the random deal deals nothing onto a region game -- its rows 1-10 are
--      all Misthalin now -- and the builder no longer offers it there;
--   5. saved boards remember whether they are a region board, and a region
--      board only loads into a region game (and a card only into a card).

-- ============================================================
-- 0. The patch helper (pg_temp: gone when this migration's session ends)
-- ============================================================
create or replace function pg_temp.regions_patch(p_fn text, p_old text, p_new text)
returns void
language plpgsql as $$
declare
  v_def text;
  v_n   int;
begin
  v_def := replace(pg_get_functiondef(p_fn::regprocedure), E'\r', '');
  v_n   := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  if v_n <> 1 then
    raise exception 'regions patch: % matched % times, expected exactly once: %',
      p_fn, v_n, left(p_old, 120);
  end if;
  execute replace(v_def, p_old, p_new);
end;
$$;

-- ============================================================
-- 1. Move the tiles already placed
-- ============================================================
-- Square p of the old layout is task i = (p - 1) % 9 + 1 of region
-- k = (p - 1) / 9 + 1; it becomes square (k - 1) * 100 + i. Misthalin's squares
-- stay where they are and every other one lands past 100, where no tile can be
-- yet, so no two ever meet on the way. Square 100 (no region before) is left
-- where it is and simply becomes Misthalin's hundredth.
update tiles t
   set "row" = ((((t.position - 1) / 9) * 100 + (t.position - 1) % 9) / 10 + 1)::smallint,
       col   = ((((t.position - 1) / 9) * 100 + (t.position - 1) % 9) % 10 + 1)::smallint
  from games g
 where g.id = t.game_id
   and g.mode = 'regions'
   and t.position between 10 and 99;

-- ============================================================
-- 2. A region is a block of a hundred squares
-- ============================================================
select pg_temp.regions_patch('regions_region_at(integer)',
$o$p_position between 1 and 99 and r.sort = (p_position - 1) / 9 + 1$o$,
$n$p_position between 1 and 1100 and r.sort = (p_position - 1) / 100 + 1$n$);

select pg_temp.regions_patch('regions_totals(uuid)',
$o$t.position between (r.sort - 1) * 9 + 1 and r.sort * 9$o$,
$n$t.position between (r.sort - 1) * 100 + 1 and r.sort * 100$n$);

select pg_temp.regions_patch('regions_team_regions(uuid)',
$o$t.position between (tt.sort - 1) * 9 + 1 and tt.sort * 9$o$,
$n$t.position between (tt.sort - 1) * 100 + 1 and tt.sort * 100$n$);

select pg_temp.regions_patch('regions_start_problem(uuid)',
$o$  if exists (select 1 from tiles where game_id = p_game_id and position > 99) then
    return 'Square 100 belongs to no region — clear it first';$o$,
$n$  if exists (select 1 from tiles where game_id = p_game_id and position > 1100) then
    return 'A tile sits past Varlamore''s last square, in no region — clear it first';$n$);

-- ============================================================
-- 3. Room on the board: rows to 110 on a region game
-- ============================================================
select pg_temp.regions_patch('admin_set_tile(uuid,smallint,smallint,jsonb)',
$o$  if p_row < 1 or p_row > v_game.grid_size or p_col < 1 or p_col > v_game.grid_size then$o$,
$n$  -- Region Bingo: eleven regions of a hundred squares, ten to a row.
  if p_row < 1 or p_col < 1 or p_col > v_game.grid_size
     or p_row > (case when v_game.mode = 'regions' then 110 else v_game.grid_size end) then$n$);

select pg_temp.regions_patch('admin_swap_tiles(uuid,integer,integer,integer,integer)',
$o$     or greatest(p_from_row, p_from_col, p_to_row, p_to_col) > v_game.grid_size then$o$,
$n$     or greatest(p_from_col, p_to_col) > v_game.grid_size
     -- Region Bingo: eleven regions of a hundred squares, ten to a row.
     or greatest(p_from_row, p_to_row)
        > (case when v_game.mode = 'regions' then 110 else v_game.grid_size end) then$n$);

-- ============================================================
-- 4. No random deal onto a region game
-- ============================================================
-- The deal walks the card's hundred squares, which on a region game are all
-- Misthalin now. Tasks go in region by region instead; the builder does not
-- offer the deal there, and this makes sure it does nothing if called.
select pg_temp.regions_patch('admin_autofill_board(uuid)',
$o$       -- Region Bingo: square 100 belongs to no region.
       and not (v_game.mode = 'regions' and (r.n - 1) * 10 + c.n > 99)$o$,
$n$       -- Region Bingo: tasks go in region by region, never dealt.
       and v_game.mode <> 'regions'$n$);

-- ============================================================
-- 5. Saved boards know whether they are a region board
-- ============================================================
-- A region board's squares run to 1100, which laid on a 10x10 card would be
-- rows off the bottom of it; a card laid on a region game would pour all its
-- tasks into Misthalin. Boards saved before today are cards (the region mode
-- is hours old and stored nine-square boards anyway).
alter table board_presets add column if not exists regions boolean not null default false;

select pg_temp.regions_patch('admin_save_board_preset(uuid,text)',
$o$  insert into board_presets (name, grid_size, squares, created_by)
  values (left(v_name, 80), v_game.grid_size, v_squares, auth.uid())
  on conflict (tile_name_key(name)) do update set
    name       = excluded.name,
    grid_size  = excluded.grid_size,$o$,
$n$  insert into board_presets (name, grid_size, squares, created_by, regions)
  values (left(v_name, 80), v_game.grid_size, v_squares, auth.uid(), v_game.mode = 'regions')
  on conflict (tile_name_key(name)) do update set
    name       = excluded.name,
    grid_size  = excluded.grid_size,
    regions    = excluded.regions,$n$);

select pg_temp.regions_patch('admin_apply_board_preset(uuid,uuid)',
$o$  if v_preset.grid_size <> v_game.grid_size then$o$,
$n$  if v_preset.regions and v_game.mode <> 'regions' then
    raise exception 'That is a Region Bingo board — it only loads into a Region Bingo game';
  end if;
  if not v_preset.regions and v_game.mode = 'regions' then
    raise exception 'That board is a card, not a Region Bingo board — build a region game on its map';
  end if;

  if v_preset.grid_size <> v_game.grid_size then$n$);

-- The list says which kind each board is, so the builder offers only the
-- boards a game can load. A new column in the result means a new function.
drop function admin_list_board_presets();
create function admin_list_board_presets()
returns table (
  id uuid, name text, grid_size smallint, squares integer,
  created_at timestamptz, updated_at timestamptz, created_by_name text,
  regions boolean
)
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_moderator()) then raise exception 'Organisers only'; end if;
  return query
    select b.id, b.name, b.grid_size,
           jsonb_array_length(b.squares)::int,
           b.created_at, b.updated_at, p.display_name,
           b.regions
      from board_presets b
      left join profiles p on p.id = b.created_by
     order by b.updated_at desc;
end;
$$;

revoke execute on function admin_list_board_presets() from public, anon;
grant  execute on function admin_list_board_presets() to authenticated;
