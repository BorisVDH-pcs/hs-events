-- The enum values the bingo mode needs (20261001120100).
--
-- Separate migration because a new enum value cannot be used in the same
-- transaction that adds it.
--
--   claim_status 'completed' -- a bingo tile whose task is done. Battleships
--                              finishes a tile by FIRING it, which carries a
--                              hit/miss result; a bingo tile has no target to
--                              shoot at, so it gets a status of its own rather
--                              than a 'fired' row with a made-up result.
--   event_type 'tile_completed' -- the public "team X finished tile Y" line.
--   event_type 'game_ended'     -- a bingo game finishing: a full card, the
--                                  timer running out, or the organiser ending it.
--                                  'game_won' stays battleships-only, because its
--                                  text everywhere is "the enemy fleet is gone".

alter type claim_status add value if not exists 'completed';
alter type event_type   add value if not exists 'tile_completed';
alter type event_type   add value if not exists 'game_ended';
