# hs-events RuneLite plugin: work so far

Started 2026-11-20 from `docs/runelite-plugin-plan.md`. Everything in this
folder is new and stands apart from the website: no existing file in the repo
was edited, nothing here is built or deployed with the site, and nothing was
applied to the live Supabase project.

The two `.sql` files in `server/` are drafts. They are kept out of
`supabase/migrations` so that `db-push.yml` cannot apply them. They only
become migrations when they are moved there on purpose.

## What is here

| Path | What | State |
|---|---|---|
| `server/001_plugin_tokens.sql` | Plugin tokens, `drop_key`, `plugin_as`, `plugin_whoami` | Tested offline, and on a local Supabase stack |
| `server/002_plugin_drops.sql` | Evidence `source` and `detail`, the intake log, `plugin_watchlist`, `plugin_match`, `plugin_open`, `plugin_submit` | Tested offline against the real rules, and on a local Supabase stack |
| `server/intake/dink.mjs` | Reads a Dink notification; makes the dedupe key | Tested; checked against Dink's source, not yet against a real client |
| `server/intake/handle.mjs` | What happens to one notification: match, open, store, submit | Tested end to end, offline |
| `server/intake/shrink.mjs` | Makes a screenshot over 3 MB smaller: halves a PNG until it fits. No library, only what the runtime has | Tested offline and in the edge runtime |
| `server/intake/index.ts` | The Edge Function shell around `handle.mjs` | Tested on the local stack; not deployed anywhere |
| `server/test/replay.mjs` | Replays all 129 migrations into an in-memory Postgres, with stand-ins for what Supabase provides | Works; the repo's own Region Bingo smoke test passes on it, 76 of 76 |
| `server/test/*.test.mjs` | Three test files, 154 checks, run by `npm test` | All pass |
| `server/test/png.mjs`, `fixtures/` | A PNG writer and reader for the tests only, and one small PNG written by Java's ImageIO | |
| `server/local/` | A local Supabase stack: `config.toml`, and `prepare.mjs`, which copies the migrations, the two drafts and the intake function into it | Works with Supabase CLI 2.122.0 and Docker |
| `server/test/stack.test.mjs` | 56 checks against that stack, the Edge Function included, run by `npm run test:stack` | All pass |
| `plugin/.../core/` | `DropKey` and `WatchList`: the matching rule in plain Java | Tested, 16 checks |
| `plugin/.../HsEvents*.java`, build files | The RuneLite plugin skeleton | **Never compiled** |

## What the tests prove

Against a replay of every migration, so `tiles_for_team`, `regions_open_tile`
and `add_evidence` are the real ones:

- **A token is the player, for one request.** `plugin_as` makes `auth.uid()`
  the token's owner for one transaction, so the existing functions apply their
  own rules. None of them was rewritten.
- **The second secret holds.** A team's watch list has the drops of the
  regions it has opened and nothing else: no tile name, no drop. A drop for a
  locked tile gets the same answer, word for word, as a drop for a tile that
  does not exist.
- **A drop counts as an upload does.** One evidence row, by that player, for
  their team, with the points taken from the option. The tile completes by its
  own rule, and the usual feed lines are written.
- **The plugin cannot choose.** The item's name must match the option's label;
  a drop two tiles want is an "ask"; another team's tile, another player's
  in-game name and a path under another team are all refused.
- **Sent twice, counted once**, and the second screenshot is not kept.
- **An upload from the site is unchanged**: source `web`, no detail.
- **Time up is still time up**: `add_evidence` refuses, and the plugin has no
  way round it.
- **Grants.** A signed-in player can call no token function; the service role
  can call exactly five; nobody can call `plugin_as`.
- **Dink's route, end to end**: a loot notification in the documented shape
  goes in, an evidence row and one stored screenshot come out. Storage being
  down becomes a retry; a rule saying no does not.
- **One drop, one piece of evidence, even when Dink reports it twice.** A
  collection log or clue notification for a drop that also came as loot is
  ignored.
- **Names as the game spells them.** A name sent with the game's
  non-breaking space is the player's own name, both in the parser and in
  `plugin_rsn_ok`.
- **Nobody else's name is kept.** The raid party Dink lists with a raid's
  loot never reaches the evidence row.
- **A screenshot over 3 MB is made smaller, not lost.** See "Screenshots over
  3 MB" below.

## Screenshots over 3 MB

The bucket takes 3 MB. Dink sends up to 8,000,000 bytes, as a PNG; only above
that does it make a JPEG itself. A sample of 16,479 RuneLite screenshots from
one client, taken the way Dink takes them, ran at 0.4 to 1.1 bytes a pixel.
By that estimate a 1080p screenshot always fits, a 1440p one goes over 3 MB
now and then, and a 4K one usually does.

`shrink.mjs` halves the width and height of such a PNG until it fits: a 4K
screenshot becomes 1920 x 1080. It uses no image library, only the runtime's
own zlib and plain loops, so no third-party code runs beside the service-role
key and nothing had to be downloaded. It reads only what Dink sends: an 8-bit
RGB or RGBA PNG, not interlaced, at most 3840 x 2400 pixels. Anything else
over 3 MB is ignored as before, and the player hands that drop in on the site.

- **The cost was measured where it counts.** Supabase allows 2 seconds of CPU
  and 256 MB per request, and the CLI's local runtime enforces the same.
  There, the worst case, 3840 x 2400 at 7.2 MB, became 1920 x 1200 at 1.7 MB in
  258 to 332 ms, end to end through the function. A first version took up to
  1.1 s; nearly all of it was compressing, so rows are now left unfiltered,
  which compresses three times faster for a slightly bigger file.
- **It is the same picture.** Every pixel is the average of its 2 x 2 block,
  checked against a separate PNG reader, against Pillow's own downscale, and
  on a PNG written by Java's ImageIO, as Dink writes them. A screenshot's
  alpha, always opaque, is left out.
- **Only for a drop that will count.** The header is read first; the picture
  is only decoded once the database says one open tile wants the drop. Junk
  and a locked tile's drop cost nothing.
- **The evidence says so**: `resized_from`, for example `3840x2400`. The log
  line has the sizes and the time taken.
- **A retry is still a retry.** The dedupe key is made from the screenshot as
  Dink sent it.
- **Anything it cannot read gives up, never guesses**: not a PNG, interlaced,
  16-bit, a palette, broken or cut-short data, data that unpacks to more than
  its header says, or more pixels than were measured.

A player can also avoid it: Dink's "Screenshot Scale" setting (Advanced,
default 100%) shrinks every screenshot before it is sent. On a 4K screen, 50%
keeps it under 3 MB.

## What the local stack proves

`stack.test.mjs` runs against the Supabase CLI's own local stack, which is the
same software a hosted project runs: Postgres 17.11, PostgREST 16.5, Storage
1.84.19, Auth 2.197.0, edge runtime 1.77.8 (Deno 2). It is not the live
project and never touches it. Tested 2026-11-21, 56 of 56.

- **The migrations apply on real Supabase.** All 129, then the two drafts, by
  the CLI itself, with no errors.
- **The game is built the site's way.** Users are made through Auth, sign in
  with a password, add their in-game names and pick regions through PostgREST
  with their own sign-in. Only making the organiser an admin is done in SQL,
  as on the live project.
- **A token is the player for one request, and only that one.** The question
  the offline tests could not answer was whether `plugin_as` behaves under
  PostgREST, which sets the caller for every request itself. It does. Inside
  the request `auth.uid()` is the token's owner. On the next request it is the
  service role again. That was tried 24 times in a row, and PostgREST served
  all 24 on one connection, so a leak would have shown. To be sure the check
  can see a leak, a probe that set the caller for the whole connection was
  tried once by hand: it leaked into 24 of 24 later requests. `plugin_as`
  leaks into none.
- **The act-as-team header does not reach a token.** The same header that
  makes an organiser's own sign-in act as Red gives an organiser's token an
  empty watch list.
- **Only the service role gets in.** Anyone signed in, and anyone not signed
  in, is refused by `plugin_whoami` and `plugin_watchlist`. Nobody can call
  `plugin_as`, not even the service role.
- **The second secret holds through PostgREST.** Each team's watch list has
  its opened region and nothing of the other's. A drop for a locked tile and
  a drop for a tile that does not exist get the same HTTP status, error code,
  message, details and hint.
- **A drop goes all the way in.** `plugin_open` gives the folder, a real PNG is
  uploaded into the `evidence` bucket with the service role, and
  `plugin_submit` makes one evidence row: by that player, for their team,
  source `dink`, with what was reported. The tile completes by its own rule,
  and the file is in Storage where the row says. Sent twice, counted once.
- **The bucket's limits are what item 4 has to live with.** Storage refuses
  3,145,728 + 1 bytes (`EntityTooLarge`) and a GIF (`InvalidMimeType`), even
  from the service role, and takes exactly 3,145,728 bytes.
- **The site is unchanged.** A player still uploads into their own team's
  folder and not into another's (refused by row-level security). Evidence
  added from the site is still source `web`, with no detail.
- **Revoking works.** A revoked token, and a token nobody was given, get the
  same refusal and can hand nothing in.

The Edge Function, called the way Dink calls it: a multipart request built as
Dink's HTTP library writes it, `payload_json` with no content type and a
`file` part named `lootImage.png`, to `/functions/v1/intake/dink?t=<token>`,
with no sign-in.

- **It runs.** `index.ts` reads the request, and supabase-js reaches the
  database and Storage with the service role the runtime hands it. No secret
  had to be set.
- **A drop goes in.** Blue's loot, sent with the game's non-breaking space in
  the name, is answered `200 {"ok":true}` and becomes one evidence row by that
  player, source `dink`, with the name as the site spells it, the world and
  the item id. The screenshot in Storage is the one that was sent, byte for
  byte.
- **Dink's retry is safe.** The same request again is answered the same, makes
  no second row, and the second copy of the screenshot is removed, so Blue's
  folder holds one file.
- **The reply keeps the second secret.** Red's drop for a tile in Blue's
  region, a drop of junk, and an item no tile has all get exactly
  `200 {"ok":true}`. Nothing is handed in for Red.
- **The other answers.** An unknown token is `401`, a body that is not JSON
  is `400`, anything but a POST to `/dink` is `404`, all `{"ok":false}`. A
  collection-log notification for a drop already counted is ignored.
- **The log says what happened and nothing more.** One line per request with
  its outcome, and never a token.
- **The worst screenshot fits in the runtime.** A 7.2 MB, 3840 x 2400 PNG is
  handed in, kept at 1920 x 1200 and 1.7 MB, pixel for pixel the expected
  half-size picture, with `resized_from` on its evidence.

## What they do not prove

- **A hosted Supabase project.** The local stack runs the same software, but
  the live project's settings, its Postgres version and its limits were not
  compared, by design. The Edge Function has not been deployed.
- **A real Dink message.** `dink.mjs` was checked field by field against
  Dink's `docs/json-examples.md` and against the Java classes that write the
  JSON (commit `ae769ad`, 2026-11-19). It has still never read a notification
  sent by a client.
- **A hosted CPU.** The shrinking was timed on this machine's CPU, under the
  same limits a hosted project has. A hosted CPU may be slower; the worst
  case uses about a sixth of the 2 seconds. The log line's `ms` will show it.
- **A JPEG over 3 MB** is still ignored. Dink only makes a JPEG for a
  screenshot over 8 MB, so this needs a screen bigger than 4K.
- **The RuneLite classes**, which have never been compiled.

## Found along the way

Eight checks in the older smoke tests (`bingo`, `snakes`, `territory`) fail on
the replay. Each expects the words "admins only" where the function now says
"Not a mode you run" or "Not your game". The player is still refused; only
the expected wording is out of date. Not changed here.

## Dink, as it really is

Read in Dink's own code on 2026-11-21, beyond what its documentation page
says. Each point is either handled here or a setup instruction for players.

- **The field names match** what `dink.mjs` reads: `type`, `playerName`,
  `world`, `regionId`, and for loot `extra.items[]` (`id`, `quantity`,
  `priceEach`, `name`), `extra.source` and `extra.category`; for a pet
  `extra.petName`. `seasonalWorld` is a true/false that the parser did not
  read. It is now kept in the evidence detail as `seasonal`, so an organiser
  can see a drop from a Leagues world.
- **One drop can arrive two or three times.** Loot, then a collection log
  notification when the drop fills a new slot, or a clue notification beside
  the casket's loot. Each carries its own screenshot, so the dedupe key cannot
  tell them apart. Only LOOT and PET are read now. With Dink's defaults, loot
  includes clue caskets and has no minimum value, so nothing is lost. A
  player who raises Dink's minimum loot value or turns off "include clue
  scrolls" loses those drops to the plugin and hands them in on the site.
- **A loot notification lists every item of the kill**, not only the ones
  that met the player's Dink settings. An item on the player's Dink deny list
  is still listed. It is matched like any other: it is in the loot.
- **Player names carry the game's non-breaking space** between words. Dink
  sends `getName()` as it is. `rsn_key` does not fold that space, so without
  the fix every player with a space in their name would have been refused.
- **Dink retries every answer that is not a 2xx**, not only 5xx: three times
  by default, after 2, 4 and 8 seconds. A revoked token therefore costs three
  extra calls. Only a 2xx stops the retries.
- **Screenshots** are `image/png`, or `image/jpeg` when Dink had to shrink
  one to stay under 8,000,000 bytes. The part's file name always ends in
  `.png`, so the type is read from the part's content type, never the name.
- **All of Dink's notifiers are off by default.** A player turns on Loot and
  Pet, and keeps "Send image" on for both (on by default).

## To run

    cd runelite-plugin/server/test && npm install && npm test

The local stack needs Docker and the Supabase CLI:

    cd runelite-plugin/server/local && node prepare.mjs && supabase start
    cd ../test && npm run test:stack
    cd ../local && supabase stop

After changing a draft, run `node prepare.mjs` and `supabase db reset` before
the test. The test reads the stack's own development keys from
`supabase status` while it runs; they are never printed or saved.

    cd runelite-plugin/plugin
    javac -d out src/main/java/com/hsevents/core/*.java src/test/java/com/hsevents/core/*.java
    java -cp out com.hsevents.core.CoreSelfTest

## Next

1. One real Dink client pointed at the local function, to see a message that
   was not written by a test.
2. The My Account screen for tokens, and `source` in the review screen. These
   are the first changes to the website itself.
4. Build the RuneLite plugin once on a machine that can reach RuneLite.
