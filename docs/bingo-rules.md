# Bingo — rules sheet

Written from the game as it stands, 2026-10-26. Bingo was the second mode on
High Society Events and the first to drop battleships' turn-taking: there is no
claiming, no order and no slot limit, so a team is only ever limited by what it
can actually get done. Its rules used to live in the README alone; this sheet is
where they live now.

---

## 1. The card

- **One square card, the same for every team** — 3×3 up to 10×10.
- **Any number of teams** play it at once, each with its own progress on that
  same card. Every team needs at least one player before the game can start.
- The card is **hidden until the organiser starts the game**, so nobody can work
  ahead of everyone else.

## 2. Playing

1. **Every tile is open from the start**, in any order. There is nothing to lock
   in and no limit on how many a team works at once — the one battleships rule
   that is deliberately switched off here.
2. **There is no claim step.** The first screenshot on a tile quietly opens it
   for that team, so players never see one.
3. **One point per completed tile.** Standings are live.
4. Anyone can look at another team's card to see **which** tiles it has
   finished. Their screenshots and their part-done progress stay private.

## 3. Completing a tile

Every tile carries one of the platform's five completion rules — `points`,
`value`, `one_set`, `each_set`, `points_per_set` — the same five battleships,
snakes and territory use. What each asks for, and how drops, repeat caps and
values in tenths of a million work, is in [v4-handover.md](v4-handover.md).

## 4. Ending, and winning

- The game ends when **a team fills the whole card**, or when the **end time**
  passes, whichever comes first.
- The end time is optional. Without one, the game runs until a card is full or
  the organiser presses *End game now*. The reason it ended is recorded either
  way: `full_card`, `time_up` or `admin`.
- **The most completed tiles wins.** A tie goes to the team that reached its
  total first. If nobody completed anything, nobody wins.

**There is no scheduler behind the end time.** From that moment the database
refuses every submission, which fixes the result then and there, whoever is or
is not watching. The first open page whose countdown reaches zero asks the
server to record it, and every page after that is a no-op. The same pattern runs
a challenge's clock.

## 5. Organiser controls

- Build the card: autofill, presets, shuffle, swap, clear a tile, or edit one
  mid-game.
- **Try a tile out** before anybody sees it: the counter moves exactly as a
  player's would, against no team.
- Take evidence back one screenshot at a time, with a dialog that says what will
  happen before it does it.
- End the game now, or reset it to preparation.

## 6. Not scored yet

**Line bonuses** — a full row or column — are not counted. The standings already
carry each team's completed tile ids, so adding them later needs no new table.

## 7. How it is built

- One migration, `20261001120100_bingo_mode.sql`, which is also where the second
  mode was carved out of the first: every rule that used to ask "is this bingo?"
  was turned round to ask "is this battleships?", so a new mode can never fall
  into battleships logic by default.
- Calls: `bingo_open_tile`, `bingo_settle`, `bingo_standings`.
- `scripts/bingo-smoke-test.sql` plays three small games through the real
  functions as throwaway accounts and rolls everything back.
- What stays secret, and how, is in [architecture.md](architecture.md): the
  whole card until the game starts, and every team's evidence from every other.
