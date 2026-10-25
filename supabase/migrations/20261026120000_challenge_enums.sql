-- The enum values the Challenge mode needs (20261026120100).
--
-- Separate migration because a new enum value cannot be used in the same
-- transaction that adds it (same reason as 20261001120000 for bingo,
-- 20261002120000 for snakes and 20261013120000 for territory).
--
--   game_mode 'challenge'           -- the fifth game: a short event with no
--                                      board. A start, an end, one figure per
--                                      entrant and a ladder. The run of Clue,
--                                      Boss, Raid and Skill of the Week events,
--                                      and the larger monthly one, are all this
--                                      shape. docs/challenge-mode.md.
--   event_type 'challenge_declared' -- an entrant gave their own number, or an
--                                      organiser altered it. payload.altered_by
--                                      says which, so the feed can tell them
--                                      apart without a second event type.
--   event_type 'challenge_ended'    -- the event finished and the ladder is
--                                      final. payload carries the winner.
--
-- Joining emits nothing on purpose. With the whole clan opting in over a day it
-- would bury the feed, the same judgement that keeps bingo_open_tile silent.
--
-- Both are public events: a ladder everyone can see has nothing to hide, so
-- neither joins the team-private list.

alter type game_mode  add value if not exists 'challenge';
alter type event_type add value if not exists 'challenge_declared';
alter type event_type add value if not exists 'challenge_ended';
