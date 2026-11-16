# Region Bingo — rules sheet

Agreed with Boris, 2026-11-16, from an idea raised in the clan Discord. A
proposed new game mode on High Society Events, next to Battleships, Bingo,
Snakes & Ladders, Territory and Challenge. **Status: rules agreed, nothing
built yet.** "Region Bingo" is a working name.

**In one line:** every OSRS region holds its own pool of tasks. Score enough
points in a region and you unlock another one of your choice. Most points wins.

How it differs from the modes we already have:

- **Bingo** has one card with every tile open from the start, one point each.
  Here tiles are worth different points, and most of the map starts locked.
- **Territory** has teams fighting over places and stealing them from each
  other. Here no team can touch another team's progress. The map shows where a
  team has been, not what it holds.

Decisions made by Boris are marked **(decided)**. Everything else is a default
picked so the game can be played. Each one is easy to change.

---

## 1. The map

- **The real OSRS world map**, the same one Territory uses. **(decided)**
- **All 11 Leagues regions are in play, each one outlined on the map.**
  **(decided)** Misthalin, Asgarnia, Kandarin, Fremennik Provinces,
  Wilderness, Morytania, Kharidian Desert, Karamja, Tirannwn, Kourend & Kebos
  and Varlamore.
- For each team, a region is **locked**, **open** or **complete**.
- A locked region shows only its name and outline: no tiles, no tile count, no
  points.
- Territory's places, links and homes are not used.

## 2. Setting up a game (organiser)

- **Teams**: any number, as in bingo. Every team needs a captain, because the
  captain picks the first region.
- **Build the roster from the sign-ups**, as in every other mode.
- **Tiles**: every region gets its own pool of tiles. Pools can be different
  sizes: the Wilderness might hold 6, a bigger region more. **(decided)**
  - Tiles use the platform's five completion rules (`points`, `value`,
    `one_set`, `each_set`, `points_per_set`).
- **Points per tile**: the organiser sets them. Harder tiles are worth more.
  **(decided)**
- **The unlock threshold, x%**: the organiser sets it for each game.
  **(decided)**
- **Timer**: an end time, as in bingo.
- **At most 100 tiles per game**, across all regions. Every mode numbers its
  tiles on a 10×10 grid. With all 11 regions that is about 9 per region on
  average.

## 3. Playing

### The first region

1. When the game starts, every region is locked for every team.
2. **The team's captain picks its first region, after the game has started.**
   **(decided)** Until then the team can't do anything.
3. If a captain isn't around, the organiser can pick for the team with *act as
   team*.

### Tiles

4. A team can work any tile in any region it has open, in any order, as many at
   once as it likes. There is no claim step: the first screenshot opens a tile,
   as in bingo.
5. **Tiles in a region a team hasn't opened are hidden from that team.**
   **(decided)**
6. Every team plays the same tiles with its own progress. No team can take,
   lock or block a tile for another.
7. A tile scores its points when it is completed. Part-done tiles score
   nothing.

### Unlocking a region

8. A region is **complete** for a team when that team has at least **x% of the
   region's total points**. Uneven numbers round up: 50% of 15 points is 8.
   **(decided)**
9. **Each completed region earns one pick.** **(decided)** A team can keep a
   pick and spend it later.
10. **Anyone on the team** can spend a pick, on **any region they choose**. It
    doesn't have to be next door: there are no bridges or links. **(decided)**
11. **Picking always asks for confirmation first**, naming the region, so a
    region can't be picked by accident. **(decided)**
12. **An opened region stays open.** Its unfinished tiles keep counting.
    **(decided)**
13. Once all 11 regions are open, a completed region earns nothing more.

### Revoked screenshots

14. Revoking a screenshot undoes the tile and its points, as in every mode.
15. If that drops a region below x%, the region is no longer complete. **The
    region it opened stays open.** **(decided)**
16. A region earns its pick only once per game. If a revoke drops it below x%
    before the pick is spent, the pick is taken back until the region gets
    there again.

## 4. Scoring and winning

- **Score = the points of every completed tile, across all regions.**
  **(decided)**
- **No bonus for completing a region, for now.** **(decided)** This may be
  added later.
- **The game ends when the end time passes**, or when the organiser ends it.
  Finishing every tile doesn't end it early.
- **The highest score wins.** A tie goes to the team that reached its score
  first. If nobody scored, nobody wins.

## 5. The feed

Tile names stay hidden from teams that haven't opened that region, in the feed
and on Discord too.

- "Lumby Lads picked Misthalin as their first region."
- "Lumby Lads completed Barrows chest: +5 points." (to teams that have opened
  that region)
- "Lumby Lads completed a tile in Morytania." (to everyone else)
- "Lumby Lads completed Misthalin and can pick a new region."
- "Lumby Lads opened Karamja."
- "Time's up! Lumby Lads wins with 42 points."

## 6. For later

- A bonus for completing a region.
- After playing it once: is the organiser's x% about right, and are 11 regions
  too many for the clan's team sizes?

## 7. How it could be built (not started)

Following "Adding another mode" in [multi-game-plan.md](multi-game-plan.md):

- **Mode**: a new `game_mode` value in its own migration, as every mode has.
- **The map**: Territory's map image and its region outlines in
  `web/public/territory/areas.json`, which already holds all 11.
- **Tiles**: each tile on the board needs its **region** and its **points**.
  Territory's trick (one fixed square per place) doesn't fit pools of
  different sizes, so the region has to be stored on the tile.
- **Opened regions**: a log of which team opened which region, when and by whom.
  Picks are worked out from that log and the completed regions.
- **Rules in the database**, as everywhere else: `add_evidence` refuses a tile
  in a region the team hasn't opened, a new pick RPC checks the team has a pick
  to spend, and `tiles_for_me` hides tiles in unopened regions.
- **From Bingo**: own progress with no claim step (`bingo_open_tile`), the timer
  and `bingo_settle`, and how the winner is chosen.
- **Tests**: a smoke test like `scripts/territory-smoke-test.sql`. Migrations
  reach the live database when they are merged to `main`, so run them on a
  spare Supabase project first.
