-- Region Bingo, part 1: the enum values. docs/region-bingo-rules.md.
--
-- In their own file because Postgres cannot use an enum value in the
-- transaction that adds it, the same reason as 20261013120000_territory_enums.

alter type game_mode  add value if not exists 'regions';

-- A team opened a region: its first (picked by the captain) or one paid for by
-- a completed region. Public: the map shows where every team has been.
alter type event_type add value if not exists 'region_opened';

-- A team reached the game's x% in a region, so it has a pick to spend. Public.
alter type event_type add value if not exists 'region_completed';
