# Snakes and Ladders — rules sheet

Agreed with Boris, 2026-10-01. The third game mode on High Society Events,
next to Battleships and Bingo. The rules come from the clan's earlier
**Snakes & Rats** event (github.com/iftachShoham/HighSociety-Bingo), with
everything rat-related removed. Ladders are planned for later; the design below
leaves room for them.

Decisions made by Boris are marked **(decided)**.

---

## 1. Setting up a game (organiser)

- **Create** from the New game form, mode *Snakes and Ladders*: name, any number
  of teams (added before creating, like bingo), optional start time.
  **(decided)**
- **Board**: always 100 tiles, filled from the tile catalogue in the existing
  board builder. Every tile uses one of the platform's five completion rules
  (`points`, `value`, `one_set`, `each_set`, `points_per_set`), exactly as in
  bingo and battleships. **(decided)**
- **Snakes**: placed per game in the admin console, as *from → to* pairs
  (head → tail). **(decided)**
  - The head is higher than the tail, so a snake always goes down.
  - No snake on tile 1 or tile 100, and no two snakes share a head.
  - A tail may land on another snake's head (snakes chain, as before).
  - Stored as "jumps", so a ladder later is the same thing going *up*.
- **Teams and rosters** work as in bingo: every team needs at least one player
  before the game can start.

## 2. Moving

Teams start before tile 1 ("Start").

1. **Roll only after completing your tile.** Any player on the team may roll
   **(decided)**. The die is one d6, rolled server-side, and only once the
   current tile is complete. From Start there is nothing to
   complete, so the first roll is free.
2. **Overshoot bounces back.** Rolling past 100 counts the extra steps back
   down: on 98 a 5 lands on 97.
3. **Completed tiles are skipped automatically.** If the roll lands on a tile
   the team has already completed, it moves forward to the next tile it has
   not. **(decided — keep)**
4. **Long skip.** If the next six tiles are all completed by the team or are
   snake heads, the roll is replaced by a jump to the first open tile ahead.
5. **Snakes.** Landing on a head moves the team to the tail; the skip in rule 3
   then applies from the tail, and if that lands on another head the team slides
   again.
6. The tile the team ends on is its new task.

## 3. Completing a tile

Same flow as bingo: open the tile, upload screenshots, and the tile's
completion rule decides when it is done. Revoking evidence works as it does
today. Once complete, the team may roll again.

## 4. Rollbacks **(decided — keep)**

A rollback lets a team escape a tile it does not want to do.

- **Earned**: one automatically the first time the team completes a tile at 40
  or higher; organisers can award more (the old game used this for pet trades).
- **Spent** by any player on the team **(decided)**: the team moves *back*,
  more each time it uses one:
  - 1st rollback: 1–3 tiles
  - 2nd: one d6
  - 3rd and later: the higher of two d6
- After moving back, the forward skip past completed tiles applies (never past
  the tile the team came from), then snakes.

## 5. Winning **(decided)**

The first team to **complete tile 100** wins, and the game ends at once:
everyone else stops. Reaching 100 is not enough; its task has to be done.

## 6. Organiser controls

- **Punish**: send a team back one d6 (then skips and snakes apply, as for a
  rollback).
- **Move team** to a given tile.
- **Complete tile now** (early completion), and undo a completion.
- **Give rollback**.
- **End game now**, before anyone has finished: the team furthest along wins
  (highest tile, then most tiles completed, then whoever got there first). Behind
  a confirmation screen that names the team that will be declared the winner
  **(decided)**.
- Reset to preparation, as in bingo.

## 7. What players see

- The 100-tile board in the snake path, fully open: every tile's task is
  visible to everyone from the start, as in bingo **(decided)**. Snakes are drawn
  on it, with every team's marker.
- Their own current tile, its task, and the uploader.
- Dice roll, slide and skip animations, plus a feed line for each one.
- Discord messages: rolled, snake bite, skipped, completed, rollback earned or
  used, punished, moved, won.

## 8. Not carried over

- Everything rat-related: rat tiles, the victim wheel, the rat-matrix, the rat
  animation, and the "rats only on a direct landing" exceptions.
- The Google Sheet, Apps Script and Cloudflare Worker backend: the game runs on
  the platform's own database and website. **(decided)**


## 9. How it is built (database, step 2)

Migrations `20261002120000_snakes_enums.sql` and `20261002120100_snakes_mode.sql`.

- A third game mode, `snakes`, next to `battleships` and `bingo`. Every rule
  that used to ask "is this bingo?" now asks "is this battleships?", so the new
  mode can never fall into battleships logic.
- Where a team stands is on `teams` (`board_tile`, 0 = Start), with its
  rollbacks. Snakes are rows in `board_jumps` (head → tail); a ladder later is
  the same row going up.
- The die is rolled in the database, never in the browser.
- Player calls: `snakes_roll`, `snakes_spend_rollback`, `snakes_open_tile`
  (then the usual `add_evidence`).
- Organiser calls: `admin_set_snakes`, `admin_snakes_punish`,
  `admin_snakes_move`, `admin_snakes_give_rollback` (a negative amount takes
  some back), `admin_snakes_complete_tile`, `admin_snakes_uncomplete_tile`,
  `admin_snakes_end_game` (it is passed the winner the confirmation screen
  showed; if the standings changed in between, it refuses).
- `scripts/snakes-smoke-test.sql` plays two games end to end with fixed dice
  and rolls everything back.

Small calls made while building, open to change:

- A rollback can be spent at any time once the team has left Start, also when
  its current tile is already done.
- The first rollback's "1–3" is a d6 folded onto 1–3 (1 and 4 → 1, and so on),
  so every result is equally likely.
- The organiser's Move cannot put a team on a snake head (as in the old game),
  and does no skipping or snakes: the team lands exactly where it is put.
- Snakes can only be changed before the game starts.
- A team added mid-game starts at Start.
- Undoing a completion keeps the rollback it may have earned.
- Withdrawing evidence from a tile the organiser completed early does not
  reopen it; "Undo completion" does.
