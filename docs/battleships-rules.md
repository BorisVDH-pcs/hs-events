# Battleships — rules sheet

Written from the game as it stands, 2026-10-26. Battleships is the oldest mode
here: it began as the clan's spreadsheet event (see
[how-the-spreadsheet-worked.md](how-the-spreadsheet-worked.md)) and these are
the V4 rules Boris settled on when it moved onto this platform. They used to be
spread between the README and `handover.md`; this sheet is where they live now.

---

## 1. The board

- **Two teams**, each with a fleet of its own.
- **One grid of tasks, shared by both teams** — 10×10 by default, and anything
  from 3 to 26 a side. D4 hides the same task for everyone; what differs is
  whose ship is under it.
- Squares are named letter-then-number, so the fourth column of the fourth row
  is D4.

## 2. The fleet

- Five hulls by default: a **Man o' War** of 5 squares, a **Galleon** of 4, two
  **Frigates** of 3 and a **Cutter** of 2. The fleet is a per-game setting, so
  an organiser can run a different one.
- **Ships may not touch, not even at a corner.** Every hull has a clear ring
  around it. The browser refuses a bad placement so nobody has to wait for the
  server to say no, and the server then checks the whole fleet again anyway.
- A captain places the fleet before the match. **Placement freezes the moment
  the match starts** — for players, captains and organisers alike, enforced by a
  trigger on the table rather than by the screen.

## 3. Firing

1. **There is no turn order.** A team fires again the moment it has a free slot.
2. **Picking a square is the move.** Claiming it reveals that square's task to
   the team that claimed it. There are no unlock questions.
3. **Two squares at a time, per team** (a per-game setting, two by default). A
   further claim is refused.
4. **Completing the task fires the shot**, and it is a hit or a miss depending
   only on whether an enemy hull sits under that square.
5. **A hull sinks when every one of its squares is hit.** The squares around it
   are then marked as misses automatically, costing nobody a claim: the no-touch
   rule means there can be no ship there, so the rule itself has already told
   the shooting team as much.
6. **The first team to sink the whole enemy fleet wins.**

## 4. Completing a task

Every square carries one of the platform's five completion rules — `points`,
`value`, `one_set`, `each_set`, `points_per_set` — the same five bingo, snakes
and territory use. What each asks for, and how drops, repeat caps and values in
tenths of a million work, is in [v4-handover.md](v4-handover.md).

Screenshots go up against the claimed square, and the rule decides when there is
enough. The shot resolves at that moment.

## 5. The pet jar

A smaller submission alongside the proof: a pet or jar screenshot earns the team
**one preview**. A preview is spent on a square the team has not claimed and
shows that square's task — never whether a ship is under it, and nothing about
the enemy fleet. An organiser can take a submission back, and the credit, or the
preview it was spent on, goes with it.

## 6. What stays secret

Two things must never reach the other team: **where the enemy's ships are**, and
**what is on the squares that team has not claimed**. Both are kept by the
database rather than by the screen. Unclaimed squares are blanked out in the
view the app is allowed to read, and the public event feed never carries a
task's name or icon — the grid is shared, so naming one would give it away on
the reader's own board.

## 7. Organiser controls

- **Build the roster from the sign-ups.** Players put their hand up on the
  event's own screen while it is being set up; Roster opens on who did and
  has every other account one press behind it. Signing up is not a condition
  of being picked — anyone can still be added by hand.
- Build the board: autofill, presets, shuffle, swap, clear a square, or edit one
  mid-match.
- **Try a square out** before anybody sees it: the counter moves exactly as a
  player's would, against no team.
- Place or reopen a fleet, and look at where the ships are.
- Take evidence back one screenshot at a time. That can undo a sinking or reopen
  a finished match, so the dialog says what will happen before it does it. The
  other team is told only *that* a shot was withdrawn, never which square.
- Release a claim a team is stuck on.
- Adjust a team's points — with a reason, because the reason is the audit trail.
- End the match early, or reset it to preparation.

## 8. How it is built

- `0001_init.sql` and `0002_rpc.sql` to begin with; the no-touch check and admin
  placement in `0006`, restored in `0017` after `0016` dropped them; sinking
  derived from the hit cells instead of a stored count in `0026`; the automatic
  ring in `20260912000000_reveal_ring_around_sunk_ships.sql`.
- Player calls: `place_fleet`, `claim_tile`, `add_evidence`, `fire_tile`,
  `submit_pet_jar`, `spend_pet_jar`.
- Both secrets are Row Level Security, with the `tiles_for_me` view as the only
  way in. See [architecture.md](architecture.md), and `handover.md` for the
  traps met along the way.
