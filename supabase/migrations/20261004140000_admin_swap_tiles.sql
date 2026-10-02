-- Board builder: drag a tile onto another square.
--
-- Until now, changing where a tile sits meant replacing it: pick the square,
-- find the tile in the catalogue again, place it, then do the same for the
-- square it came from. admin_swap_tiles does it in one step: the tile on
-- `from` goes to `to`, and whatever was on `to` goes back to `from`. An empty
-- `to` is a plain move. Every mode, because a square is a square.
--
-- The rows themselves move, so each tile takes everything with it: its id, its
-- drops (tile_options), its catalogue link and use count. position is generated
-- from row and col, so it follows. A Snakes board's snakes and ladders do not
-- move: they belong to square numbers, not to tiles.
--
-- Only before the game starts, like clearing a square. Mid-game a square's
-- place is part of the game: a battleship sits on coordinates, a bingo line is
-- made of squares, a snakes team has opened the square it stands on.
--
-- One statement each, in one transaction, rows locked: a dropped connection
-- or a second organiser cannot leave half a swap behind. The unique
-- (game, row, col) is checked row by row, so the moving tile is parked off the
-- board for the middle step -- the same trick admin_shuffle_board uses.
--
-- To undo: scripts/rollback-admin-swap-tiles.sql.

create or replace function admin_swap_tiles(
  p_game_id  uuid,
  p_from_row int, p_from_col int,
  p_to_row   int, p_to_col   int
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_game games%rowtype;
  v_from tiles%rowtype;
  v_to   tiles%rowtype;
begin
  if not is_admin() then raise exception 'Admins only'; end if;

  select * into v_game from games where id = p_game_id for update;
  if not found then raise exception 'No such game'; end if;

  if v_game.status not in ('setup', 'placement') then
    raise exception 'Tiles can only be moved before the game starts — it is %', v_game.status;
  end if;

  if least(p_from_row, p_from_col, p_to_row, p_to_col) < 1
     or greatest(p_from_row, p_from_col, p_to_row, p_to_col) > v_game.grid_size then
    raise exception 'Both squares must be on the %x% board', v_game.grid_size, v_game.grid_size;
  end if;

  select * into v_from from tiles
   where game_id = p_game_id and "row" = p_from_row and col = p_from_col
   for update;
  if not found then raise exception 'There is no tile on that square to move'; end if;

  if p_from_row = p_to_row and p_from_col = p_to_col then
    return jsonb_build_object('moved', v_from.name, 'swapped', null, 'changed', false);
  end if;

  select * into v_to from tiles
   where game_id = p_game_id and "row" = p_to_row and col = p_to_col
   for update;

  -- Cannot exist before the start, but a claim is what makes a square's place
  -- matter, so it is checked rather than assumed.
  if exists (select 1 from tile_claims where tile_id in (v_from.id, v_to.id)) then
    raise exception 'A team has already locked one of these squares in';
  end if;

  -- Park the moving tile off the board, put the other one in its place, then
  -- land the moving tile.
  update tiles set "row" = ("row" + 100)::smallint where id = v_from.id;
  if v_to.id is not null then
    update tiles set "row" = p_from_row::smallint, col = p_from_col::smallint where id = v_to.id;
  end if;
  update tiles set "row" = p_to_row::smallint, col = p_to_col::smallint where id = v_from.id;

  return jsonb_build_object('moved', v_from.name, 'swapped', v_to.name, 'changed', true);
end;
$function$;

revoke execute on function admin_swap_tiles(uuid, int, int, int, int) from public, anon;
grant  execute on function admin_swap_tiles(uuid, int, int, int, int) to authenticated;
