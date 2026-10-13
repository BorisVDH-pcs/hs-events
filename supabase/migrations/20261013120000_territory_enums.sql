-- The enum values the Territory mode needs (20261013120100).
--
-- Separate migration because a new enum value cannot be used in the same
-- transaction that adds it (same reason as 20261001120000 for bingo and
-- 20261002120000 for snakes).
--
--   game_mode 'territory'      -- the fourth game: Risk on the OSRS world map.
--                                 Teams start on a home place and take places
--                                 linked to their land by finishing their task.
--   event_type 'tile_captured' -- a team took a place, free or from a rival.
--                                 `payload.from_team_id` says which.
--   event_type 'tile_attacked' -- the first screenshot landed on a place another
--                                 team holds, so its owner knows it is coming.
--   event_type 'tile_dropped'  -- a team gave up on a place it had open.
--
-- tile_captured and tile_attacked are public: the map is open, so who holds
-- what, and who is going for it, is no secret. tile_dropped is the team's own
-- business and joins the team-private list in 20261013120100.

alter type game_mode  add value if not exists 'territory';
alter type event_type add value if not exists 'tile_captured';
alter type event_type add value if not exists 'tile_attacked';
alter type event_type add value if not exists 'tile_dropped';
