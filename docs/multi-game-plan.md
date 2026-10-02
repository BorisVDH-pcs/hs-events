# Multiple game modes

Battleships was built as the only game. This branch (`feat/game-modes`) makes it
one mode of several on the same Supabase project and site, and adds the second
mode, **Bingo**.

## What every mode shares

Nothing here was copied per mode:

- **Accounts and roles.** Profiles, admins, teams, team members, captains.
- **Tiles.** The catalogue, the board builder, saved boards, completion rules,
  `claim_is_complete()`, and the five rules in `tileProgress.js`.
- **Evidence.** `add_evidence`, the uploader, storage paths
  (`{game}/{team}/{claim}/{uuid}`), the review log, and revoke with its dry-run
  preview.
- **The feed.** `game_events`, realtime, Discord relay, team-private events.
- **The console.** Games, Configure, Track, Accounts.

## How the mode is decided

`games.mode` (`game_mode` enum, default `'battleships'`) is the one switch.

- **Database.** Functions that behave differently branch on `mode`. Battleships
  keeps its body word for word, and bingo gets its own branch. Functions that
  only make sense in one mode refuse the other: `claim_tile`/`fire_tile`
  refuse bingo, and `bingo_open_tile`/`admin_add_team` refuse battleships.
- **Player screen.** `App.jsx` checks `game.mode` and renders either the
  battleships board or `components/bingo/BingoGame.jsx`.
- **Console.** `Admin.jsx` picks the step hints, setup checklist, start rules,
  reset dialog and Track pane per mode. The board builder takes its size from
  `game.grid_size`.

The default keeps old clients safe: a front-end that has never heard of modes
still creates and plays battleships games.

## Bingo, in the database

Two migrations:

1. `20261001120000_game_mode_enums.sql` adds `claim_status 'completed'` and the
   `tile_completed` and `game_ended` event types. These live in a separate file
   because Postgres cannot use a new enum value in the transaction that adds it.
2. `20261001120100_bingo_mode.sql` contains everything else.

Decisions worth knowing before changing it:

- **Claims still exist, just invisibly.** Evidence, progress and the storage path
  all hang off a `tile_claims` row, so `bingo_open_tile` creates one the first
  time a team submits to a tile. It emits no event, and the player never sees a
  lock-in.
- **`completed` is a status, not a shot.** A finished bingo tile is
  `status = 'completed'` with `fired_by`/`fired_at` set and `result` null.
- **The card stays hidden until the start.** `tiles_for_me` only opens a bingo
  card when the game is `active` or `finished`.
- **The timer is enforced by refusal.** There is no pg_cron. `add_evidence` and
  `bingo_open_tile` refuse anything after `ends_at`. `bingo_settle` records the
  end, and any client calls it when its countdown hits zero. It is idempotent.
- **One function ends a game.** `finish_bingo` handles a full card, the timer
  and the organiser alike, and chooses the winner with the same ordering
  `bingo_standings` shows: most tiles, then earliest last completion, then slot.
- **Positions keep the 10-column numbering.** `tiles.position` is generated as
  `(row-1)*10+col`, so a bingo card is capped at 10×10 and `coordLabel` works
  unchanged. Code that draws a card loops over `grid_size` and uses
  `cardCells(size)`. Don't assume positions run 1…n².
- **Revoking works on a finished game.** Un-completing a tile reopens a game won
  on a full card, unless the timer has also passed. Otherwise the winner is
  picked again from the standings.

## Adding another mode

1. Add the value to `game_mode` in its own migration, like the enum file above.
2. Create the game in `admin_new_game`, start it in `start_game`, and add a
   `discord_line` case for any new event type.
3. Branch every shared RPC the mode changes. Refuse the ones it must not use.
4. Add `components/<mode>/`, route it in `App.jsx`, and add its checklist and
   hints in `Admin.jsx`.
5. Add an entry to `MODES` in the New game form.

## Status

- Front-end: built, self-tests passing, and checked visually in the harness
  (`/preview-bingo.html`, `/preview-snakes.html`).
- **Migrations: applied to the live project** (High Society Events), bingo and
  Snakes and Ladders both.
- **Smoke tests: both pass against the live project** (run 2026-10-02):
  `scripts/bingo-smoke-test.sql` 48/48 and `scripts/snakes-smoke-test.sql`
  88/88. Both roll everything back, so nothing they create is kept.

## Later

- **Line bonus.** Rows and columns only, no diagonals. The standings already
  carry `completed_tile_ids`, so this is scoring, not schema.
- **Repo rename.** Once bingo has merged, rename the repo and move the
  battleships and shared components into their own folders. Keep the
  `@players.hs-battleships.invalid` sign-in domain: changing it would orphan
  every existing account.
