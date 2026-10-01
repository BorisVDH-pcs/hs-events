-- The enum values the Snakes and Ladders mode needs (20261002120100).
--
-- Separate migration because a new enum value cannot be used in the same
-- transaction that adds it (same reason as 20261001120000 for bingo).
--
--   game_mode 'snakes'          -- the third game: teams race along a 100-tile
--                                  board, rolling a die after each finished tile.
--   event_type 'team_moved'      -- a team changed tile: a roll, a rollback, an
--                                  organiser's punishment or an organiser's move.
--                                  `payload.kind` says which, so one type covers
--                                  every way a marker moves on the board.
--   event_type 'rollback_gained' -- a team earned a rollback (first tile >= 40) or
--                                  an organiser gave or took some.
--   event_type 'tile_reopened'   -- an organiser undid a team's completion.
--
-- All three are public: the board is open, so where a team stands and what it
-- has finished is no secret from the other teams.

alter type game_mode  add value if not exists 'snakes';
alter type event_type add value if not exists 'team_moved';
alter type event_type add value if not exists 'rollback_gained';
alter type event_type add value if not exists 'tile_reopened';
