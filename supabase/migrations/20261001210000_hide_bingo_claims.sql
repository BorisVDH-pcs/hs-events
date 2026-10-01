-- HS_Battleships — a bingo team's progress is its own business
--
-- Found by scripts/bingo-smoke-test.sql: a Blue player could read Red's rows in
-- `tile_claims`. 0001's `claims_read` lets every caller read every claim, and
-- the bingo migration never narrowed it.
--
-- In bingo a claim row is made the moment a team opens a tile to upload, so the
-- table says which tiles a team is working on, and who, long before anything is
-- finished. The website never reads the table -- everything goes through
-- definer RPCs -- so this was only open to someone querying the API by hand,
-- but the rule for bingo is that progress is not visible to other teams.
--
-- What stays public, deliberately: a FINISHED tile, through the `tile_completed`
-- event and `bingo_standings`.
--
-- Battleships keeps exactly what it had. `ship_status` is a security_invoker
-- view that counts the opponent's shots on your own fleet from this table, so
-- narrowing it there would quietly stop ships from sinking on screen.
--
-- Two policies rather than one, because `my_team_ids()` and `is_admin()` are not
-- granted to anon (0003, 0006): a single policy naming them would make an
-- anonymous read of the table fail outright instead of returning the
-- battleships rows it always has.

drop policy if exists claims_read on tile_claims;

-- Signed in: every battleships claim, as before; a bingo claim only for the
-- team that owns it, and for organisers.
create policy claims_read on tile_claims
  for select to authenticated
  using (
    not exists (
      select 1 from teams t join games g on g.id = t.game_id
       where t.id = tile_claims.team_id and g.mode = 'bingo'
    )
    or team_id in (select my_team_ids())
    or is_admin()
  );

-- Not signed in: battleships claims only, as before.
create policy claims_read_anon on tile_claims
  for select to anon
  using (
    not exists (
      select 1 from teams t join games g on g.id = t.game_id
       where t.id = tile_claims.team_id and g.mode = 'bingo'
    )
  );
