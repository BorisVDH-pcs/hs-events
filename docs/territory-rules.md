# Territory — rules sheet

Agreed with Boris, 2026-10-13. A proposed fourth game mode on High Society
Events, next to Battleships, Bingo and Snakes and Ladders. Teams fight over the
real Old School RuneScape world, Risk-style. **Status: a real mode (Phase 2).**
The organiser picks it under New game in the console, and the server enforces
every rule below. The harness (`npm run preview:evidence`, port 5176:
`/preview-admin.html` and `/preview-territory.html`) still plays it with no
database, for trying out changes.

Decisions made by Boris are marked **(decided)**. Everything else is a default
I picked so it could be played. Each one is easy to change.

---

## 1. The map

- **The real OSRS world map**: the mainland, Great Kourend & Kebos (Zeah) and
  Varlamore, shown as the actual map image. **(decided)**
  - Map © Jagex Ltd. Render by Explv (explv.github.io). The credit is shown on
    the map.
- **Places, not squares.** There are 64 real places, each at its true spot on
  the map: Lumbridge, Varrock, Canifis, Rellekka, Prifddinas, Hosidius,
  Civitas illa Fortis and so on. **(decided)**
- **Each place is a piece of land**, Risk-style: the land nearest to it,
  coloured by the team that holds it. Press anywhere on that land to open the
  place. **(decided, 2026-10-13)**
  - The areas are generated from the map image by
    `web/scripts/territory-areas.mjs` into `web/public/territory/areas.json`.
    Run it again after moving or adding a place.
- **Links** join each place to its neighbours. There are 126 in total, of
  three kinds:
  - **Shared border**: two areas whose land touches are linked. No line is
    drawn, because the border is the link.
    - **Exception: the River Salve.** Misthalin, the desert and the Wilderness
      reach Morytania only at Paterdomus (Varrock – Canifis), as in the game.
  - **Boat**: a dashed arc, e.g. Port Sarim – Musa Point, Port Sarim – Port
    Piscarilius and Ardougne – Brimhaven.
  - **Travel or a pass**: a dashed arc, for other ways of getting around. Some
    examples:
    - the quetzal (Varrock – Civitas)
    - the gnome glider (Gnome Stronghold – Ape Atoll)
    - the Arandar pass (Ardougne – Prifddinas)

  All kinds count the same for the rules. Every link works both ways. Long
  routes are drawn faintly until you point at or press one of their ends.
- **Second ways in.** Five extra routes make sure no single place is the only
  way into part of the map, so a home there can't lock it **(2026-10-13)**:
  - Varrock – Al Kharid, the path north past the Al Kharid mine (so Lumbridge
    no longer guards the desert)
  - Port Phasmatys – Catherby, by charter ship (a second way into Morytania)
  - Brimhaven – Shilo Village, the Shilo cart
  - Ape Atoll – Tai Bwo Wannai, fairy ring CLR – CKR
  - Aldarin – Civitas, by quetzal

  The one exception is Rellekka, which is the only way to Neitiznot, Lunar Isle
  and Waterbirth Island, as in the game. It therefore can't be a home.
- **Regions**: the 11 Leagues areas. **(decided)**
  - Misthalin, Asgarnia, Kandarin, Fremennik Province, Wilderness, Morytania,
    Kharidian Desert, Karamja, Tirannwn, Kourend & Kebos, Varlamore.

## 2. Setting up a game (organiser)

- **Teams**: 2–6.
- **Build the roster from the sign-ups.** Players put their hand up on the
  event's own screen while it is being set up; Roster opens on who did and
  has every other account one press behind it. Signing up is not a condition
  of being picked — anyone can still be added by hand.
- **Homes**: the organiser picks each team's home on the Board tab.
  **(decided, 2026-10-13)**
  - A home has no task. The team holds it from the start, and **it can never be
    taken**.
  - **Every team can always reach every place.** No team can pass through
    another team's home, so homes that would cut any place off from any team
    are refused. The picker names what would be cut off and which homes are in
    the way, and the game can't start until it is fixed. The server checks this
    too, with the same message.
  - Until the organiser picks, the teams get the suggested homes in order:
    Lumbridge, Ardougne, Canifis, Hosidius, Civitas illa Fortis and Trollheim.
- **Tasks**: every other place gets one task. **A new game starts with no tasks**,
  and the organiser fills them in on the Board tab in one of three ways
  **(decided, 2026-10-13)**:
  - **At random**: deal from the tile catalogue, like a bingo card.
  - **From a template**: load a saved board, e.g. "OSRS themed", where the tasks
    fit their places (Barrows at Barrows, the Gauntlet at Prifddinas, Giant Mole
    at Falador).
  - **By hand**: click a place, then a tile.

  The three can be mixed: deal at random, then swap the tasks you don't like.
  - **How this works.** The task list is an 8×8 bingo card: the 64 places fill
    it exactly, region by region, and each square is labelled with its place.
    So dealing, shuffling, saving and loading boards all work unchanged. The
    homes' squares are skipped, and a template loaded onto a game leaves out
    that game's homes.
  - Tasks use the same five completion rules as bingo (`points`, `value`,
    `one_set`, `each_set`, `points_per_set`).
- **Region bonuses**: half the region's place count, rounded, with a minimum
  of 2. This makes bigger regions worth more: 4 for Kandarin and Kourend, 2 for
  Tirannwn, 3 for the rest. For now they are the same in every game; letting
  the organiser change them per game is not built yet.
- **Timer**: the organiser sets an end time, as in bingo.

## 3. Taking land

1. **Only next door.** A team may only start on a place that is linked to a
   place it holds, including its home. **(decided)** On the map these places
   glow gold.
2. **Two at a time.** A team can have at most **2 places in progress** at once.
   **(decided)** The first screenshot on a place opens it. The place panel
   explains plainly why a place can't be opened: not linked, already at 2,
   someone's home, and so on.
3. **Finish the task and it's yours.** Completing the task on a place you don't
   hold makes it yours. This works the same way for free land and for a
   rival's land. **(decided)**
4. **Stealing means redoing the task at the same target.** **(decided)**
   - The owner keeps the place until the attacker finishes.
   - The owner then loses it, along with any progress it had made there. Its old
     screenshots for that place are put aside (the organiser can still see
     them), so winning it back means doing the full task again.
5. **Under attack.** When an attacker's first screenshot lands on a rival's
   place, the owner sees that place pulse red. The feed also says "X is
   attacking Y".
6. **Links are checked only when a place is opened.** If you are already working
   on a place, it stays valid even if the land linking you to it is taken.
   **Places that get cut off stay yours.**
7. **Giving up.** "Give up this place" frees one of the 2 slots. The screenshots
   are kept, so picking the place up again later carries on where the team left
   off.
8. **Revoked screenshots.** If the organiser revokes a screenshot that a capture
   needed, the capture is undone. The place goes back to whoever held it before
   (or becomes free land), and the team that lost it has to open it again to
   retake it. If the game is already over, the winner is worked out again.

## 4. Scoring and winning

- **Score = places held + region bonuses**, counting the home place too.
  **(decided)** A team that holds every place in a region gets that region's
  bonus.
  - Example: Misthalin has 6 places and a bonus of 3, so a team that holds all
    of Misthalin, plus 3 more places elsewhere, scores 9 + 3 = 12.
- **The game ends when the timer runs out.** The highest score wins.
  **(decided)** The organiser can also end the game early (Configure → Game →
  End game now); the dialog names the team in the lead.
- **If no place changed hands**, nobody wins: every team still holds only its
  home.
- **Ties** go to the team whose last capture came earliest. That team reached
  the score first.

## 5. The feed

- "Lumby Lads captured Falador."
- "Hosidius Harvest took Port Sarim from Lumby Lads!"
- "Canifis Howlers is attacking Varrock, held by Lumby Lads."
- "Ardy Knights gave up on Catherby." (shown to that team only)
- "Time's up! Canifis Howlers wins with 6 points."
- "Time's up! No place changed hands, so nobody wins."

## 6. What's open

These questions are for after Boris has played it:

- Is 2 places at a time right, or should it be 1 or 3?
- Should region bonuses be bigger, so that going for a whole region is worth
  the risk?
- Should a place you just captured be protected for a short time?
- Is 64 places right for the clan's team sizes, or is it too many or too few?

## 7. How it is built

- **Migrations**: `20261013120000_territory_enums.sql` (the `territory` mode
  and its three event types, in their own file because of the Postgres enum
  rule) and `20261013120100_territory_mode.sql` (everything else).
- **The world** is in three read-only tables seeded from
  `web/src/lib/territoryWorld.js`: `territory_regions`, `territory_places`
  and `territory_links`. The self-test (`npm run test:territory`) fails if the
  two ever disagree.
- **Tasks** are tiles on an 8×8 card (`grid_size 8`), one square per place
  (`placePosition` in `lib/territory.js`). So the existing deal, preset and
  readiness RPCs needed only a "skip the homes" branch.
- **Homes** are `teams.home`, one per place per game.
- **Who holds what** is the capture log, `territory_captures`: a place belongs
  to its latest capture that has not been revoked, or else to the team whose
  home it is. Revoking evidence revokes the capture, which is why undoing one
  hands the place back.
- **A lost place**: the loser's claim is parked and its evidence moved to
  `territory_lost_evidence` (organisers only), so a retake starts from zero.
- **Shared RPCs** (`add_evidence`, `start_game`, `board_for_me`,
  `admin_end_game`, `admin_revoke_evidence`, `discord_line` and others) each
  got a territory branch on top of their latest version.
- **Tests**: `scripts/territory-smoke-test.sql` plays two games through in
  the SQL editor and rolls itself back; the error message it ends with is the
  report.
