# hs-events and Dink: work so far

Started 2026-11-20 from `docs/runelite-plugin-plan.md`. Nothing has been
applied to the live Supabase project yet: that happens when Boris merges
this branch (see "Going live").

**Dink only.** On 2026-11-21 Boris decided against a plugin of our own: drops
come in through Dink, the RuneLite plugin many players already run, and this
folder holds what receives them. The Java plugin that was started here was
removed the same day; it is in the branch's history at commit `dcceb68` if it
is ever wanted again. On 2026-11-21, to go live for Region Bingo, the two
drafts became migrations in `supabase/migrations` and the intake moved to
`supabase/functions/intake`. This folder keeps the tests, the local stack and
this file.

Six changes to the website itself were made with Boris's go-ahead on
2026-11-21: the **Plugin tokens** section of My Account (see "The token
screen" below), **"Sent by plugin"** in the organiser's evidence review
(see "The review screen's label"), a **check on drop names** with
ready-made lists of drops in the tile editor (see "The tile editor's name
check"), **Dink's report beside every Dink screenshot** in a tile's
panel, the team's own included (see "Dink's report beside the picture"), a
**box above the board where the team chooses the tile** for a drop two
tiles want (see "A drop two tiles want"), and a **"Drops from Dink" switch**
on each Region Bingo game in the admin console (see "Dink on or off, per
game"). All six are on this branch only. The token screen, the label, the
report, the box and the switch hide themselves on a database without the
plugin's migrations, so a site published before the migrations are applied
shows nothing new. The name check needs no database and shows at once; it
only warns.

Uploading evidence on the site is unchanged and stays the normal way in,
whether Dink is on or off for a game. Dink is an extra way to hand in a
drop, for players who run it.

The two plugin migrations were kept out of `supabase/migrations`, as
drafts, until Boris said to go live. They are there now, so `db-push.yml`
applies them on merge.

## What is here

| Path | What | State |
|---|---|---|
| `supabase/migrations/20261121120000_plugin_tokens.sql` | Plugin tokens, `drop_key`, `plugin_as` | Tested offline, and on a local Supabase stack |
| `supabase/migrations/20261121120100_plugin_drops.sql` | Evidence `source` and `detail`, the intake log, `plugin_wanted`, `plugin_match`, `plugin_open`, `plugin_submit` (for Region Bingo and Bingo), `admin_evidence_sources` for the review screen, `evidence_sources` for a tile's panel, a drop two tiles want, kept for the team to choose (`plugin_wait_open`, `plugin_wait`, `waiting_drops`, `waiting_drop_open`, `waiting_drop_choose`), removing the screenshots nobody needs (`plugin_leftover_files`, `plugin_leftovers_removed`), and Dink on or off per game (`games.plugin_drops`, `admin_set_plugin_drops`) | Tested offline against the real rules, and on a local Supabase stack |
| `supabase/functions/intake/dink.mjs` | Reads a Dink notification; makes the dedupe key | Tested; checked against Dink's source, and read real loot from a real Dink client on 2026-11-21. Pets not yet from a client |
| `supabase/functions/intake/handle.mjs` | What happens to one notification: match, open, store, submit, or keep it for the team to choose; and removing the screenshots nobody needs | Tested end to end, offline |
| `supabase/functions/intake/shrink.mjs` | Makes a screenshot over 3 MB smaller: halves a PNG until it fits. No library, only what the runtime has | Tested offline and in the edge runtime |
| `supabase/functions/intake/index.ts` | The Edge Function shell around `handle.mjs`; cleans up after each request whose token the database accepted | Tested on the local stack; not deployed anywhere yet |
| `.github/workflows/functions-deploy.yml` | Deploys `intake` when `supabase/functions` changes on `main`, with the secrets `db-push.yml` has | Not run yet: it first runs on merge |
| `server/test/replay.mjs` | Replays all 131 migrations into an in-memory Postgres, with stand-ins for what Supabase provides | Works; the repo's own Region Bingo smoke test passes on it, 76 of 76 |
| `server/test/*.test.mjs` | Seven test files, 358 checks, run by `npm test` | All pass |
| `server/test/png.mjs`, `fixtures/` | A PNG writer and reader for the tests only, and one small PNG written by Java's ImageIO | |
| `server/local/` | A local Supabase stack: `config.toml`, and `prepare.mjs`, which copies the migrations and the intake function into it | Works with Supabase CLI 2.122.0 and Docker |
| `server/test/stack.test.mjs` | 128 checks against that stack, the Edge Function included, run by `npm run test:stack` | All pass |
| `web/src/components/PluginTokens.jsx` | The Plugin tokens section of My Account: make a token, see its Dink link once, revoke | Tried in the preview harness, and used by Boris on the local stack to set up a real Dink (2026-11-21). Not on the live project |
| `web/src/lib/pluginTokens.js` | The Dink link, the name check, "last used" in words | Tested by `web/scripts/plugin-tokens-selftest.mjs`, and used by `stack.test.mjs` |
| `web/preview-account.html` | A harness for My Account with fixture tokens | |
| `web/src/components/EvidenceReview.jsx` | The organiser's evidence review: "Sent by plugin" on a row a plugin handed in, with what it reported | Tried in the preview harness, and seen by Boris on the local stack with his own drops (2026-11-21). Not on the live project |
| `web/src/components/EvidencePanel.jsx` | Every tile's panel, a team's and an organiser's: Dink's report beside each Dink screenshot ("Bones ×1 from Woman", the time, the world) | Tried in the preview harness at desktop and phone width; its call tested through PostgREST on the local stack, and Boris's own Bones row read through it. Not yet opened by Boris on the local site. Not on the live project |
| `web/src/lib/evidenceSource.js` | The label, the drop line and the lines under it, from `source` and `detail` | Tested by `web/scripts/evidence-source-selftest.mjs`, and used by `stack.test.mjs` |
| `web/src/components/WaitingDrops.jsx` | The box above a team's board: a drop two tiles want, its screenshot and Dink's report, and a button for each tile | Tried in the preview harness at desktop and phone width; the calls behind it tested through PostgREST and Storage on the local stack; used by Boris on the local site for a real Dink cow (2026-11-21). Not on the live project |
| `web/src/lib/waitingDrops.js` | The box's helpers: a tile's name with its region, the time left. Where the copy goes is now the database's answer | Tested by `web/scripts/waiting-drops-selftest.mjs` |
| `web/src/components/Admin.jsx` | "Drops from Dink" on each Region Bingo game that has not finished: the site's own switch, as for Discord | Tried in the admin harness (`/preview-admin.html`) at desktop and phone width; its call tested through PostgREST on the local stack. Not used by Boris yet. Not on the live project |
| `web/src/components/TileForm.jsx` | The tile editor: "Not in the item list" under a drop, with names to click, and "Add a list…" | Tried in the admin harness (`/preview-admin.html`), at desktop and phone width. Not on the live project, not used by Boris yet |
| `web/src/lib/itemNames.js`, `itemNames.data.js` | `dropKey` (the server's `drop_key` in JS), the check, and 4,820 item names | Tested by `web/scripts/item-names-selftest.mjs`; `tokens.test.mjs` checks `dropKey` against `drop_key` on every name |
| `web/scripts/build-item-names.mjs` | Makes `itemNames.data.js` from the OSRS Wiki's price list and a typed list of untradeables | Run once, 2026-11-21 |
| `web/src/lib/dropLists.js` | The ready-made lists: 65 of them, for raids, groups of bosses, every boss in the collection log and pets | Every name is checked against the item list by the selftest, spelled exactly as the item is |

## Going live

Asked for by Boris on 2026-11-21: Dink goes live for Region Bingo. Nothing
reaches the live project until he merges this branch into `main`. Then, side
by side:

- **`db-push.yml`** applies the two new migrations,
  `20261121120000_plugin_tokens.sql` and `20261121120100_plugin_drops.sql`,
  after a dry run that lists them. They add tables, functions, two columns
  to `tile_evidence` and one to `games`. No existing function, policy or
  grant changes. A new trigger marks each new piece of evidence with where it
  came from: an upload from the site is `web`, as every existing row is.
- **`functions-deploy.yml`** (new) deploys `intake`, with no JWT check, using
  the secrets `db-push.yml` already has. No new secret.
- **`deploy.yml`** publishes the site: the token screen, "Sent by plugin",
  Dink's report in a tile's panel, the box for a drop two tiles want, the
  tile editor's name check and the console's switch.

**Every game, old and new, starts with Dink off.** Nothing changes for
anyone until an organiser switches a Region Bingo game on. Uploading on the
site works as before, on or off.

**After the merge, with Boris:**

1. All three runs green, and the dry run listed exactly the two migrations.
2. My Account on the live site: make a token. Its Dink link is the live
   project's address with `/functions/v1/intake/dink?t=hse_…`.
3. The console, on a Region Bingo game: "Drops from Dink" is there, off.
4. On a game switched on, one drop from a real Dink, and the function's log
   in the Supabase dashboard: one line, with the outcome.

**If something is wrong:** switch the game off in the console. Dink's drops
then count nowhere, and the site works as before. A player can revoke their
token in My Account. A revert does not take the migrations back out
(`db-push` only runs forward), but with every game off they change nothing.

**Not known until then:**

- **Whether the live project's migration history matches the repo.** The
  dry run shows it before anything is applied, and `db push` refuses if it
  does not match. The 131 migrations were applied from nothing on a
  throwaway local stack with the CLI version `db-push` pins (2026-11-21).
- **Whether the hosted function's service-role key works.** Supabase gives
  every function `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and the
  local stack did the same. If the live project has turned its older keys
  off, the first request fails in the log, and the key has to be set under
  Edge Functions, Secrets. Until then nothing counts: Dink tries three more
  times, then gives up.
- **A hosted CPU** for a big screenshot (see "What they do not prove").

## What the tests prove

Against a replay of every migration, so `tiles_for_team`, `regions_open_tile`,
`bingo_open_tile` and `add_evidence` are the real ones:

- **A token is the player, for one request.** `plugin_as` makes `auth.uid()`
  the token's owner for one transaction, so the existing functions apply their
  own rules. None of them was rewritten.
- **The second secret holds.** What a team's drops are matched against
  (`plugin_wanted`) holds the drops of the regions it has opened and nothing
  else: no tile name, no drop. A drop for a
  locked tile gets the same answer, word for word, as a drop for a tile that
  does not exist.
- **A whole Region Bingo game, played through Dink** (`regions-game.test.mjs`,
  added 2026-11-21 after Bingo, because Region Bingo is the next event). A
  region completed by drops alone earns its pick; the pick, spent on the
  site, makes the new region's drops count at once, and until then they get
  the answer junk gets. All three set rules work from drops: one set (a piece
  already in is not wanted again), one from each group, and points per group.
  A tile with no drop list, and a value tile, are never matched and are still
  handed in on the site. A revoke undoes the tile, its points and the region's
  completion; the region its pick opened stays open; the drop is wanted again,
  and handing it in again does not pay a second pick. Once the organiser ends
  the game, when every tile is shown to everyone, no drop counts.
- **Bingo works the same way, by Bingo's own rules.** See "Bingo" below.
- **A drop counts as an upload does.** One evidence row, by that player, for
  their team, with the points taken from the option. The tile completes by its
  own rule, and the usual feed lines are written.
- **The plugin cannot choose.** The item's name must match the option's label;
  a drop two tiles want waits for the team to choose (see "A drop two tiles
  want"); another team's tile, another player's in-game name and a path
  under another team are all refused.
- **Sent twice, counted once**, and the second screenshot is not kept.
- **An upload from the site is unchanged**: source `web`, no detail.
- **Time up is still time up**: `add_evidence` refuses, and the plugin has no
  way round it.
- **Grants.** A signed-in player can call no token function; the service role
  can call exactly the seven the intake uses (`plugin_match`, `plugin_open`,
  `plugin_submit`, `plugin_wait_open`, `plugin_wait`, `plugin_leftover_files`,
  `plugin_leftovers_removed`); nobody can call `plugin_as`.
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
- **A Leagues drop does not count.** A drop from a seasonal world is ignored
  even when an open tile wants it. The database is never asked, and a big
  screenshot is not made smaller for it.
- **The review screen is told which evidence a plugin sent, and nobody else
  is.** `admin_evidence_sources` gives an organiser, and a moderator of the
  game's mode, the plugin's rows with what was reported, and never an upload
  from the site. Every row it names is one `admin_list_evidence` already
  lists. A moderator of another mode, and a player on either team, get "Not
  your game", the evidence list's own words, and so does a game that does not
  exist. Only a signed-in caller may ask: not anon, not the service role.
- **A tile's panel is told what Dink reported for the caller's own team's
  drops, and nothing else.** `evidence_sources` is asked by evidence id. A
  player gets the plugin's rows of their own team; an organiser gets both
  teams'. Red asking for Blue's drop on the tile in Asgarnia, a region Red has
  not opened, gets nothing, the same answer, with no error, as for evidence
  that does not exist; an upload from the site and someone on no team get
  nothing too. Not anon, not the service role.
- **A drop two tiles want waits, for its own team only**
  (`waiting.test.mjs`, 76 checks, on a Region Bingo board and a Bingo card).
  The intake keeps it with the tiles that wanted it, its screenshot under the
  team's `waiting/` folder; sent twice, kept once. The team lists it with
  those tiles, and anyone on it can hand it in on one: the evidence is the
  player's who got the drop, credited as Dink's would be, with who chose
  beside it. Another team asking for it by id, a tile that was never a
  choice and a drop that does not exist get one answer, word for word, so a
  drop for a locked tile gives nothing away. After an hour, once handed in,
  once its tile has filled, and once the game has ended or its time is up,
  it no longer counts, each with its own words to the team. A picture that
  is not Dink's (another file, the waiting file itself, a copy under another
  tile, a missing one) is refused, and so is Dink's own picture copied to a
  place the database did not give out. A drop two games want is not kept.
- **The screenshots nobody needs are removed, and nothing else**
  (`waiting.test.mjs`). Once a drop is handed in: its file under `waiting/`
  and every copy but the one handed in. Once its hour and five minutes are
  up: its file and its copies. Never evidence, never an upload from the site,
  never the copy handed in. A removal that fails is tried again next time.
- **Dink is off until an organiser switches it on** (`switch.test.mjs`, 27
  checks). Off, a drop an open tile wants gets the answer junk gets, word for
  word, and so does a locked tile's; nothing is stored, nothing waits, and a
  drop already waiting is not offered. Uploading on the site works, on or
  off. A player, someone on no team and a moderator of another mode cannot
  switch it; a moderator of Region Bingo can. Switched off mid-game and on
  again, the drop that waited is back. Bingo cannot be switched on from the
  console. `add_evidence` does not read the switch at all.

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
project and never touches it. Tested 2026-11-21, 128 of 128.

- **The migrations apply on real Supabase.** All 131, the plugin's two the
  last, by the CLI itself, with no errors. And all 131 again from nothing, on
  a second, throwaway stack with CLI 2.122.0, the version `db-push.yml` pins
  (2026-11-21, removed after): every plugin function there, Dink off by
  default.
- **The game is built the site's way.** Users are made through Auth, sign in
  with a password, add their in-game names and pick regions through PostgREST
  with their own sign-in. Done in SQL: making the organiser an admin, as on
  the live project; switching Dink on for a Bingo game, which the console
  will not do yet; and moving a waiting drop's hour into the past.
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
  makes an organiser's own sign-in act as Red leaves an organiser's token
  matching nothing of Red's.
- **Only the service role gets in.** Anyone signed in, and anyone not signed
  in, is refused by `plugin_match`. Nobody can call `plugin_as`, not even the
  service role.
- **The second secret holds through PostgREST.** Each team's drops match its
  opened region and nothing of the other's. A drop for a locked tile and
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
- **What the token screen asks for works.** A signed-in player's
  `plugin_token_list` has their token by name, and neither the token nor its
  hash. A function the database does not have is answered `PGRST202`, which
  is exactly what the section hides itself on.
- **What the review screen asks for works.** Through PostgREST with the
  organiser's sign-in, `admin_evidence_sources` names every row a plugin
  sent in this run and nothing else. Laid onto `admin_list_evidence` by the
  site's own `withSources`, the chainbody reads "Sent by plugin", "Dragon
  chainbody ×1 from Chaos Elemental", "World 302 · as Mate Iron" and "Picture
  made smaller from 3840×2400", and the site's own upload has no label. A
  player is refused with "Not your game" and learns nothing; anon and the
  service role cannot call it.
- **What a tile's panel asks for works.** Through PostgREST with each
  player's sign-in, `evidence_sources`, asked for every row in the game, names
  exactly the rows a plugin sent for that player's own team. Laid onto the
  player's own `my_evidence` the chainbody reads as it does on the review
  screen. Blue learns nothing of Red's; anon and the service role cannot ask.

The Edge Function, called the way Dink calls it: a multipart request built as
Dink's HTTP library writes it, `payload_json` with no content type and a
`file` part named `lootImage.png`, to `/functions/v1/intake/dink?t=<token>`,
with no sign-in. Every request goes to a link made by the site's own
`dinkUrl`, the one the token screen shows a player.

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
- **A Leagues drop is refused.** Red's chainbody from a seasonal world gets
  the same `200 {"ok":true}` as any drop and hands nothing in. The same drop
  from a normal world, next, is handed in.
- **The worst screenshot fits in the runtime.** A 7.2 MB, 3840 x 2400 PNG is
  handed in, kept at 1920 x 1200 and 1.7 MB, pixel for pixel the expected
  half-size picture, with `resized_from` on its evidence.
- **Bingo through the function.** A Bingo game built through PostgREST beside
  the Region Bingo one. A drop on the card before the start hands nothing in;
  after it, the same drop is one row for the player's Bingo team, with its
  screenshot in Storage. The other team's drop on the same tile is its own.
  Red's Dragon pickaxe, wanted by the card and by the tile in the region Red
  has not opened, is handed in on the card and nowhere else.
- **A drop two tiles want, through the function and Storage.** Red Mate's
  Dharok's helm, wanted by two of Red's tiles, is answered `200 {"ok":true}`
  and waits, its screenshot in Red's `waiting/` folder byte for byte; Dink's
  retry keeps it once. Through PostgREST, Red Cap's sign-in lists it with
  both tiles and who got it; Blue's lists nothing, and anon and the service
  role cannot ask. Blue asking for it by id gets the same status, code and
  words as for a drop that does not exist, and Red asking for the tile in
  Blue's region gets what a tile that does not exist gets. Blue cannot read
  the file, nor copy it into either team's folder. Storage's own copy, as Red
  Cap, gives the copy the same eTag and size, which is what the check rests
  on. The database gives the copy its place and writes it down: Red Cap's own
  picture at that place is refused, and so is Dink's picture copied anywhere
  else. Handed in on "Any helmet", the tile completes by its own rule, the
  evidence is Red Mate's, and the panel reads "Dharok's helm ×1 from Chaos
  Elemental" and "Arrived … · tile chosen by Red Cap". A second hand-in is
  told it already was, and the list holds only a second helm, left waiting.
- **The screenshots nobody needs go, through the function and Storage.** The
  second helm's hour is moved into the past. The intake's own question lists
  exactly three files: the first helm's under `waiting/`, the copy holding
  Red Cap's own picture, and the second helm's. A request from a made-up
  token removes nothing. The next request from Dink, a drop nobody wants,
  removes all three from Storage, and the log line says `"cleaned":3`. The
  copy handed in is still there, byte for byte, and still the evidence; the
  stray copy nobody gave out is not touched; the rows are kept, marked. Anon
  and a signed-in player can neither ask for the list nor mark a file
  removed. With the cleanup taken out of the function, 5 checks fail.
- **The switch, through PostgREST.** A new game starts with Dink off. A
  captain, anon and the service role cannot switch it; the organiser can.
  Switched off mid-game, Dink's Dharok's helm for Barrows chest is answered
  `200 {"ok":true}` as always and handed in nowhere, and nothing waits; the
  same helm uploaded on the site completes the tile. The console will not
  switch the Bingo game on.

## What they do not prove

- **Bingo with a real Dink.** Only the tests so far. Its trial card was ended
  on 2026-11-21 so that one game runs at a time, Region Bingo first.
- **The other modes.** Snakes and Ladders, Territory and Challenge are not
  wired: a drop there is never counted, because `plugin_wanted` does not
  read those games.

- **A hosted Supabase project.** The local stack runs the same software, but
  the live project's settings, its Postgres version and its limits were not
  compared, by design. The Edge Function has not been deployed; see "Going
  live" for what is checked after the merge.
- **A pet from a real Dink.** Loot from a real client has been read (see "A
  real Dink client" below). A pet notification has only been checked against
  Dink's source, and a real screenshot over 3 MB has not come in yet: the
  real ones were about 0.2 MB.
- **A hosted CPU.** The shrinking was timed on this machine's CPU, under the
  same limits a hosted project has. A hosted CPU may be slower; the worst
  case uses about a sixth of the 2 seconds. The log line's `ms` will show it.
- **A JPEG over 3 MB** is still ignored. Dink only makes a JPEG for a
  screenshot over 8 MB, so this needs a screen bigger than 4K.
- **The live project.** The token screen, the review screen's label,
  Dink's report in a tile's panel, the waiting box and the switch have run
  against the local stack only.
- **The switch in a signed-in browser.** Tried in the admin harness and
  through PostgREST. Boris has not flipped it on the local site yet. His
  "Dink trial", built before the switch existed, was switched on by SQL on
  2026-11-21 so that it keeps working; new trial games are switched on by
  `trial.mjs` through the console's own call.
- **The cleanup with a real Dink.** Only the tests. It did run on the local
  stack's real data: the stack test's requests removed the waiting file of
  every drop there that had been chosen or had run out, Boris's Raw beef
  from the trial among them, and its evidence file is still there.
- **The panel in a signed-in browser.** Its call is tested through PostgREST,
  the harness draws it, and Boris's own Bones row reads "Bones ×1 from Woman",
  16:57:22, "World 308 · as Soft Papi" when asked as his account. Nobody has
  yet opened that tile on the local site to see it there.
- **An organiser choosing for a team.** Acting for a team, an organiser
  should see its box and be able to choose, as they can upload for it; that
  has not been tried. Only viewing a team, they see no box.
- **Raid loot from a real Dink.** Dink sends a raid chest as loot with the
  category "EVENT" (its own docs show one for Tombs of Amascut), and the
  intake does not look at the category, so it should be matched like a cow's
  drop. Nobody has done a raid against the local stack yet. Only the player
  whose chest holds the purple sends it.
- **That the raid weapons drop uncharged.** The lists say "Tumeken's shadow
  (uncharged)", "Scythe of Vitur (uncharged)" and "Sanguinesti staff
  (uncharged)" because the wiki's chest pages list them so and the price list
  has only those forms. Not yet seen in a real Dink message.
- **Every real item is in the list.** The price list has only what the Grand
  Exchange trades. Pets, the raids' untradeables, the boss jars and the
  untradeable drops in the ready-made lists were added by hand; any other
  untradeable item (a Dragon defender, for one) is flagged although it is
  real. The warning says what the list holds, and never blocks a save.
- **Loot that is not a kill's.** Barrows, the Moons of Peril, the Fortis
  Colosseum, the Gauntlet, Tempoross, Wintertodt, Zalcano, Hespori and the
  Fight Caves and Inferno capes come from a chest, a reward pool or a
  completion, not from a monster. Whether Dink sends each of those as loot
  has not been tried. The Abyssal Sire's list is the same: only Unsired drops
  from the Sire, and the rest come from the Font of Consumption, which is not
  loot at all. Whatever Dink does not send is uploaded by hand, as now.
- **The boss lists are right.** Each is the boss's "Uniques" table on the
  wiki, read on 2026-11-21, or its collection log where it has none. The
  newest bosses (Brutus, the Mad Angel, the Maggot King, the Shellbane
  Gryphon) are known to this work only from the wiki. Nobody has checked the
  lists against the game.

## Bingo

Added 2026-11-21. Dink works for a Bingo game as it does for Region Bingo,
and no rule was written twice:

- **What a team can hand in** is its card's drops, once the organiser has
  pressed Start, less the tiles it has completed and the options that are
  full. Before the start the card is hidden, so nothing matches: that is
  `tiles_for_team`'s own rule.
- **Opening a tile** goes through `bingo_open_tile`, what the site calls on a
  first screenshot, so the player's team, the game running and the time are
  checked by the site's own code. A small internal function,
  `plugin_open_tile`, sends each tile to the opener for its mode. Nobody
  outside may call it.
- **Completing a tile, and the card,** happen in `add_evidence`, as for an
  upload. In the tests the drop that fills the card ends the game, by "full
  card", with that team the winner.
- **Both teams play the same card.** A drop is handed in for the player's own
  team, on its own claim. A path under the other team's claim is refused by
  `add_evidence` itself.

**Two games at once.** A player in a Bingo game and a Region Bingo game at
the same time has every drop matched against both. A drop wanted by tiles in
both games is handed in nowhere, and the player uploads it on the site
where they want it. It is not kept for the team to choose, as two tiles in
one game are (see "A drop two tiles want"): the two games may not even have
the same team.
**Decided 2026-11-21:** the clan runs one game at a time, so a drop is never
wanted by two games and nothing more is built for it. The tests still run two
games at once, only to prove the second secret holds if it ever happens.

**The second secret across games.** A drop wanted by the card and by a tile
in a region the team has not opened is a "one", for the card. The tests check
that the answer is word for word what it would be with no Region Bingo game
running at all, so nothing in it gives the locked tile away.

**The switch per game.** Built 2026-11-21 (see "Dink on or off, per game").
The console switches Dink on for Region Bingo only. Bingo is built and
tested, and waits for Boris's word: until then a Bingo game can only be
switched on in SQL, as the tests do.

## A real Dink client

On 2026-11-21 Boris played the trial game (`trial.mjs`) with his own account
and Dink, on the real site run against the local stack (`site.mjs`). He signed
up, added his in-game name and made a token on the site, put the link in Dink,
and killed cows and chickens at Lumbridge.

| Kill | Dink sent | What happened |
|---|---|---|
| A cow, before his team had a region | Bones, Raw beef, Cowhide | Nothing handed in |
| A cow, after picking Misthalin | the same | Cowhide handed in; Raw beef an "ask" (two tiles), not handed in at the time; Bones not (its tile is in Asgarnia, locked for him) |
| A second cow | the same | Cowhide handed in; "Two cowhides" completed, with the usual feed lines |
| A chicken | Bones, Raw chicken, Feather x5 | Feather handed in; "Feathers" completed |
| A second chicken | the same | Nothing: "Feathers" was done and had left the list |

Since then a drop two tiles want is kept for the team to choose: that Raw
beef now waits an hour on the site, and Boris played it the same day (see "A
drop two tiles want").

What that proves, beyond the tests:

- **Dink's real message is what `dink.mjs` expects.** Item names, ids,
  quantities and prices, `extra.source` ("Cow"), `extra.category` ("NPC"),
  the world (308) and the region id (12850, 12851) all arrived and were read.
  His in-game name, which has a space, matched his account. Every request was
  `multipart/form-data` with a PNG of about 0.2 MB.
- **Matching, the second secret and the tile's own rule held** with real
  drops: one tile handed in, two tiles never guessed, a locked tile never
  touched, a completed tile no longer wanted.
- **The token screen works against a database.** The token was made on the
  site, its link worked in Dink as shown, and "last used" moved.
- **The review screen's label works against a database.** Made an organiser
  afterwards, Boris saw "Sent by plugin" on both tiles' evidence, with his
  screenshots.

Not tried with a real client: a pet, a screenshot over 3 MB, a Leagues world.
Our own plugin was not involved.

### Region Bingo first: a region opened by a pick

Region Bingo is the next event, so it is proven before the other modes. By
the end of the first trial Boris's team had completed Misthalin (7 points)
and had a pick it had not spent. The Bingo trial card was ended on
2026-11-21, so the trial game is the only game he plays in, as in a real
event. What his drops are matched against now: Raw beef only (two tiles, so
it waits for him to choose). Spending the pick on Asgarnia was tried first as his account,
inside a transaction that was then undone: Bones then joins the list, and the
pick is still his.

To play it, with Dink as it is:

1. On the local site, spend the pick on Asgarnia.
2. Kill a cow: its Bones are handed in, on the "Bones" tile. They never were
   before the pick.
3. `node trial.mjs report` shows the points, the picks and the evidence.
4. If wanted, as an organiser, revoke that Bones in the review screen and kill
   another cow: it is handed in again.

**Played 2026-11-21, with Dink as it is.** From the intake's log and the
game's own feed (times in UTC):

| Time | What happened |
|---|---|
| 15:39 to 15:53 | Five kills that dropped Bones, before the pick: nothing handed in, each Bones a "none" |
| 15:56:58 | Boris spent the pick on Asgarnia, on the site |
| 15:57:22 | A Woman dropped Bones and Coins. Bones handed in on "Bones", the tile completed, and with it Asgarnia (4 of 4 points), which earned a new pick. Coins: no tile wants them |

His team went from 7 to 11 points. So with a real client: a region's drops
do not count until the team opens it, count from the first kill after the
pick, and a drop that completes a region earns the next pick, all by the
game's own rules. Not tried with the real client: the revoke in step 4 (the
tests cover it).

## The token screen

At the foot of My Account, under the in-game names. Made on 2026-11-21 after
Boris agreed to a sketch of it.

- **Make a token.** An optional name ("Laptop", at most 40 characters), then
  one press. The answer is shown as the whole Dink link, not the bare token,
  because the link is what the player pastes. It is shown only this once,
  with a Copy button and the two steps in Dink: paste into "Primary Webhook
  URLs" on a line of its own, then turn on "Enable loot" and "Enable pets"
  with "Send Image" on, and leave "Min Loot value" at 0 and "Loot Webhook
  Override" empty (see "Dink, as it really is").
- **The list** shows each live token's name, when it was made and when Dink
  last used it, or "never used", which is the clue that a link went into the
  wrong box. Never the token.
- **Revoke** takes two presses, like removing an account. Revoking the token
  whose link is still on screen takes the link off the screen too.
- **At five tokens** the form gives way to "5 tokens is the limit".
- **No plugin tokens in the database** (the live project today): no section
  at all, and no error. The site tells this apart from a refusal by
  PostgREST's `PGRST202`, "no such function".
- **Nothing is kept in the browser.** The link lives in the section's memory
  until the dialog closes.

## The review screen's label

In the organiser's evidence review, made on 2026-11-21 with Boris's go-ahead.
Uploading on the site is not touched: an upload sends no source, the trigger
in `20261121120100_plugin_drops.sql` stamps it `web`, and the screen shows
it exactly as before.

- **"Sent by plugin", never "verified".** A grey, dashed pill beside the gold
  one that names the drop it was filed as. Its tooltip says the plugin runs on
  the player's own computer, so the picture is checked as any upload is.
- **Under it, what the plugin reported**: first, in bold, the drop, how many
  and what dropped it ("Bones ×1 from Woman"; "Pet:" for a pet), then the
  world and the in-game name ("World 308 · as Soft Papi"), and "Picture made
  smaller from 3840×2400" when the intake shrank it. These are the client's
  words, shown as text, cut at 60 characters, and only when they have the
  right shape.
- **Its own function, not two more columns on `admin_list_evidence`.**
  Changing what that returns means dropping and re-creating it, and its live
  body has been rewritten in place since, so a copy in the migration could drift
  from it. `admin_evidence_sources` reads `source` and `detail` and asks the
  same question, `may_manage_game`, in the same words.
- **A database without the plugin's migrations** (the live project until
  the merge): the call answers `PGRST202` and no row has a label. **If the call fails** any other
  way, the rows still load and a line says the screen cannot tell which
  evidence a plugin sent, rather than pass plugin evidence off as uploads.

## Dink's report beside the picture

Asked for by Boris on 2026-11-21. A Woman's Bones were handed in on a
screenshot that showed neither the Bones nor a chat line: the camera was
zoomed out, RuneLite hides Bones on the ground by default, and the game only
prints a drop in the chat when its loot notification is on. Boris decided not
to ask players to change any game or RuneLite setting. Instead the site shows
what Dink reported beside every Dink screenshot, for the team as well as the
organiser.

- **Where:** every tile's panel (`EvidencePanel`), on a team's own board and
  an organiser's, in every mode; and the review screen, as above.
- **What:** the "Sent by plugin" pill, then in bold the drop, how many and
  from what ("Bones ×1 from Woman"), the player and the time it arrived, and
  the world and in-game name ("World 308 · as Soft Papi"). An upload from the
  site looks exactly as before.
- **The time** is the evidence row's own: our server's clock when Dink's
  message arrived, a few seconds after the kill, not the player's.
- **Asked for the open tile only**, by evidence id, through
  `evidence_sources`. It answers for the caller's own team's
  evidence, or a game they run, and gives the same empty answer for anything
  else, so the second secret holds (see "What the tests prove").
- **Still what the player's client said.** The line tells anyone looking what
  the picture is for; it is not proof, and the label still says "Sent by
  plugin", never "verified". **Decided by Boris, 2026-11-21:** a Dink picture
  that does not show the drop is accepted on Dink's report. The organiser can
  still revoke it, as any evidence.
- **A database without the function** (the live project today): the panel is
  what it was. **If the call fails** any other way, the pictures still show
  and a line says the panel cannot tell which screenshots a plugin sent.

## A drop two tiles want

Asked for by Boris on 2026-11-21: "anyone on the team, 1 hour". Before, a
drop two open tiles wanted was an "ask": Dink handed it in nowhere and its
screenshot was thrown away. Now it waits for the team.

- **The intake keeps it**, with the tiles that wanted it at that moment. Its
  screenshot goes into the team's own folder in the `evidence` bucket, under
  `waiting/`, made smaller first if it is over 3 MB. Sent twice, kept once.
- **Anyone on the team chooses, on the site, within an hour.** A box above
  the team's board, in Region Bingo and Bingo while the game runs: the
  screenshot, the drop ("Raw beef ×1 from Cow"), who got it and when, until
  when it waits, and a button for each tile ("Raw beef, one · Misthalin"). A
  choice is asked twice, "Hand it in for …?", since only an organiser can
  take it back. The box looks again every 30 seconds while the page is in
  view, and at once when the game's feed moves.
- **Handed in as the player who got it.** The tile is opened by the site's
  own rule, and the drop handed in by `add_evidence`, as Dink would have: the
  evidence row is theirs, whoever chose. In a tile's panel and the review
  screen it reads "Sent by plugin", the drop, and "Arrived 16:57:22 · tile
  chosen by Red Cap", since the row's own time is when the tile was chosen.
- **Only a tile that wanted it when it dropped.** A region opened afterwards
  cannot take it, so nothing is banked (plan, decision 4). A tile that has
  filled up since is no longer offered. A drop with no tile left, one a
  teammate handed in, and one older than an hour are no longer shown; a click
  that comes too late says which. Time up for the game is still time up.
- **The picture is Dink's.** The site copies the screenshot from `waiting/`
  to the tile with Storage's own copy, as the player, the way an upload goes
  in; the database then checks the copy has the size and checksum (eTag) of
  what Dink sent. A teammate cannot hand in a picture of their own in its
  place. Where the copy goes is the database's answer, written down, so a
  copy that is never handed in can be removed (see "Screenshots nobody
  needs"); a copy anywhere else is refused.
- **The second secret holds.** Only the drop's own team sees it, its picture
  and its tiles. Another team asking for it by id gets the answer a drop that
  does not exist gets, and a tile in a region the team has not opened is never
  a choice. The waiting file is in the team's own folder, which only the team
  and an organiser can read.
- **Two games at once:** a drop two games want is still not kept (see
  "Bingo"). The clan runs one game at a time.
- **Cleaned up** since the evening of 2026-11-21: see "Screenshots nobody
  needs".
- **Only while Dink is on for the game.** Switched off, a drop already
  waiting is no longer offered; switched on again within its hour, it is
  back (see "Dink on or off, per game").
- **A database without the plugin's migrations** (the live project until
  the merge): there is no box, and no error.

Tested offline (`waiting.test.mjs`), on the local stack (`stack.test.mjs`)
and in the harness.

**Played 2026-11-21, with a real Dink.** Boris killed two cows in the trial
game, where "Raw beef, one" and "Raw beef, two" both want Raw beef (times in
UTC):

| Time | What happened |
|---|---|
| 17:00:50 | First cow. Raw beef wanted by both tiles: it waits, its 0.2 MB screenshot in the team's `waiting/` folder. Bones and Cowhide: no open tile wants them |
| 17:01:20 | Boris chose "Raw beef, one" in the box on the local site. Handed in as his, source `dink`, "chosen by" him; the copy has Dink's eTag and size. The tile completed, with the usual feed lines (11 to 13 points) |
| 17:01:43 | Second cow. Only "Raw beef, two" still wants Raw beef, so it is handed in at once, with no choice to make (13 to 15 points) |

So with a real client and a real browser: a drop two tiles want waits and
is handed in on the tile the team picks, and once one of the two is done
the next drop goes straight to the other. Not tried with the real client: a
drop left until the hour is up, and a teammate choosing for the player who
got it (the tests cover both).

## Screenshots nobody needs

Asked for by Boris on 2026-11-21. A drop two tiles want left files behind in
the `evidence` bucket: Dink's screenshot under the team's `waiting/` folder,
and a copy in a tile's folder for each try at choosing. About 0.2 MB each.
Now the intake removes them.

- **What goes.** Once a waiting drop is handed in: its file under
  `waiting/`, and every copy but the one handed in. Once its hour is up and
  nobody chose: its file and any copies. Five minutes' grace after the hour,
  so a choice made in the last second is told "waited more than an hour",
  not that a file is missing.
- **What never goes.** Evidence, an upload from the site, and the copy that
  was handed in. Only files the database lists are touched, and it lists
  nothing but the two kinds above.
- **The database says where a copy goes.** `waiting_drop_open` gives the
  site the copy's exact place and writes it down, so a copy that is never
  handed in can be found. The hand-in only takes a copy at such a place. Ten
  tries per drop.
- **When.** There is no timer on the project (no pg_cron). Instead, after
  every request from Dink whose token the database accepted, the intake asks
  `plugin_leftover_files` for up to 20, oldest first, removes them through
  Storage, and marks them with `plugin_leftovers_removed`, so a removal that
  fails is tried again next time. Dink sends something whenever a player who
  runs it gets loot. A cleanup that fails never changes Dink's answer; it is
  logged, and the log line says how many files went (`cleaned`).
- **Rows stay.** A waiting drop's row is kept, with when its file went.

Tested offline (`waiting.test.mjs`, `intake.test.mjs`) and on the local stack
through the function and real Storage (`stack.test.mjs`).

## Dink on or off, per game

Decided by Boris on 2026-11-21 (plan, section 10, item 6): a switch on each
game in the admin console, "Drops from Dink", off until an organiser turns
it on, Region Bingo only for now.

- **Off** (the default): Dink's drops for that game get the answer junk gets,
  nothing is stored, nothing new waits, and a drop already waiting is not
  offered. Dink is still answered `200 {"ok":true}`, so it does not retry.
- **On:** a drop one open tile wants is handed in for the player, with
  Dink's screenshot; a drop two tiles want waits an hour for the team.
- **Uploading on the site works either way.** `add_evidence` does not read
  the switch.
- **Who:** an organiser, or a moderator of the game's mode, the same people
  who manage the game. It can be changed while the game runs.
- **Region Bingo only.** Switching a Bingo game on is refused ("Drops from
  Dink are for Region Bingo only, for now"); switching any game off works.
  The switch shows only on Region Bingo games that have not finished.
- **In the console:** under the game's start and end times, the site's own
  switch, as for Discord, with a line saying what on and off mean. On a
  database without the plugin's migrations it does not show.

Tested offline (`switch.test.mjs`), on the local stack through PostgREST
(`stack.test.mjs`), and in the admin harness at desktop and phone width.

## The tile editor's name check

Dink is matched to a tile by name: `drop_key` forgives capitals, apostrophes
and spacing, and nothing else. A drop typed "thamarons sceptre" never meets
the "Thammaron's sceptre (u)" the revenants drop. Made on 2026-11-21 with
Boris's go-ahead, in the one tile form the board builder, the catalogue and
tile suggestions all use.

- **"Not in the item list."** Shown under a drop once its box is left, not
  while it is typed. Up to three real names follow, to click: "Did you mean
  Thammaron's sceptre (u)?". It finds a missing letter, two letters swapped,
  "scepter" for "sceptre", and a bracket left out or wrong ("Tumeken's shadow"
  offers "Tumeken's shadow (uncharged)"). Under five letters it does not guess.
- **A warning, never an error.** "Any Barrows piece" is a fine drop for a tile
  uploaded by hand, and the line under the list says so. Nothing about names
  stops a save.
- **"Add a list…"** beside "Add drop" adds every drop of a ready-made list,
  spelled as the items are. 65 lists under four headings:
  - *Raids*: raid uniques from all three raids (26), from each raid (12, 7,
    7), and raid weapons (10). Weapons here are what goes in the weapon slot:
    Dinh's bulwark is in, Kodai insignia and the Avernic hilt are not.
  - *Groups of bosses*: Barrows (24), the four God Wars generals (19), the
    four Desert Treasure II bosses (12), the Moons of Peril (12) and the
    Wilderness bosses (17).
  - *Bosses*: one list for each boss in the collection log, 52, in
    alphabetical order and named as players say them ("Nightmare", not "The
    Nightmare"), so typing a letter in the menu finds them. Nex has 6.
  - *Pets*: all pets (71), boss pets (54), skilling pets (9). Gull is left out
    until its item name is checked.
- **Uniques only.** Dink hands in every drop that matches a tile by itself, so
  a list holds only what a tile would want counted. Left out: common drops the
  collection log also shows (Bolt racks at Barrows, Key master teleports at
  Cerberus), drops that come with every kill or completion (anima seeds,
  Dizana's quiver, the Gauntlet cape), jars, and pets outside the pet lists.
  The Fire cape and the Infernal cape are the one exception: they are what
  those two are played for. Giant Mole has no list: besides its pet, its
  collection log is the skin and claw every kill gives. Obor and Bryophyta
  have none either, as low-level bosses seldom on a clan board; they are
  quick to add if wanted. Anything left out can be added to a tile by hand.
- **Sets.** On a set rule each drop gets a set. A boss's own list is one set,
  named after the boss. A list of several bosses gives each boss its own set
  (each Barrows brother, each general, each moon), so "one full Barrows set" or
  "something from every general" is one pick. A drop that more than one boss in
  the list drops goes in a set named after the whole list: the Godsword shards
  in "God Wars Dungeon", the Virtus robes and the Chromium ingot in "Desert
  Treasure II", the Dragon pickaxe and Dragon 2h sword in "Wilderness bosses".
  A drop's name does not say which boss it came from.
- **Two lists on one tile.** A drop the tile already has is not added twice.
  Add the Kalphite Queen's list and then the King Black Dragon's, and the
  Dragon pickaxe is there once, in the Kalphite Queen's set.
- **A drop counts wherever it came from.** Dink is matched by name only, so a
  Dragon pickaxe from the King Black Dragon finishes a tile that has the
  Kalphite Queen's list. Several lists share a drop this way: the Dragon
  pickaxe and the Dragon 2h sword, Uncut onyx (Zulrah, Zalcano, Skotizo), the
  Dragon chainbody (Kalphite Queen, the smoke devil), the Dragon axe (Dagannoth
  Kings, Wintertodt) and the Draconic visage (King Black Dragon, Vorkath).
  Dink does send the monster's name, so a rule that looks at it is possible.
  That would be a new game rule, and it is Boris's call. Nothing has changed.
- **A tile that lists drops takes only those.** Once a tile has a drop list,
  every hand-in must be one of its drops, uploads on the site included
  (`add_evidence`: "Say which drop this screenshot shows"). So a list made
  for Dink has to hold every item that should count, or the missing ones
  cannot be handed in at all. A tile with no drops listed takes any
  screenshot, and Dink can never match it. Going through the existing tile
  catalogue with this in mind is open (see "Next").
- **The names**: 4,820, from the OSRS Wiki. Its price list gives every item
  the Grand Exchange trades; pets, the raids' untradeable drops, the boss
  jars and the untradeable drops in the lists were typed from the wiki's own
  pages. Each of the last 44 was checked to exist on the wiki; two had been
  renamed in August ("Eye of the Duke", "Pendant of Ates"), and the list has
  the new names. Wiki content is CC BY-NC-SA 3.0,
  and the file says where it came from. The list is its own 24 KB file,
  loaded the first time a tile form opens. `npm run items:names` makes it
  again when the game adds items.
- **The same spelling rule as the server.** `dropKey` in
  `web/src/lib/itemNames.js` is `drop_key` written again in JS, so the editor
  can answer what the server would. `tokens.test.mjs` runs both over every
  name in the list and every ready-made drop: they agree on all 5,317.

## Found along the way

Eight checks in the older smoke tests (`bingo`, `snakes`, `territory`) fail on
the replay. Each expects the words "admins only" where the function now says
"Not a mode you run" or "Not your game". The player is still refused; only
the expected wording is out of date. Not changed here.

`drop_key` turns "+" into a space like any other sign, so "Dragon dagger(p)",
"(p+)" and "(p++)" are one drop to it, and so are "Anti-venom" and
"Anti-venom+". A tile wanting the (p++) would take a (p). Found while building
the name check; not changed, since it is a rule and Boris's call.

## Dink, as it really is

Read in Dink's own code on 2026-11-21, beyond what its documentation page
says. Each point is either handled here or a setup instruction for players.

- **The field names match** what `dink.mjs` reads: `type`, `playerName`,
  `world`, `regionId`, and for loot `extra.items[]` (`id`, `quantity`,
  `priceEach`, `name`), `extra.source` and `extra.category`; for a pet
  `extra.petName`. `seasonalWorld` is a true/false that the parser did not
  read. **Decided by Boris, 2026-11-21:** a drop on a Leagues or other
  seasonal world does not count. The intake ignores it, before the database
  is asked, and answers `200` so Dink does not send it again.
- **One drop can arrive two or three times.** Loot, then a collection log
  notification when the drop fills a new slot, or a clue notification beside
  the casket's loot. Each carries its own screenshot, so the dedupe key cannot
  tell them apart. **Decided by Boris, 2026-11-21:** only LOOT and PET are
  read. Any other evidence a tile needs is handed in on the site, as today.
  With Dink's defaults, loot includes clue caskets and has no minimum value,
  so no drop is lost. A player who raises "Min Loot value" or turns off
  "include clue scrolls" loses those drops to the plugin and hands them in on
  the site.
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
- **Two settings can stop loot reaching us**, and the token screen's steps
  name both (checked in `DinkPluginConfig.java` on 2026-11-21). "Min Loot
  value" is 0 by default; a drop under it is not sent. "Loot Webhook
  Override", when it holds a link, sends loot there *instead of* the primary
  URLs, so a player who uses it would send us pets but no loot.

## To run

    cd runelite-plugin/server/test && npm install && npm test

The local stack needs Docker and the Supabase CLI:

    cd runelite-plugin/server/local && node prepare.mjs && supabase start
    cd ../test && npm run test:stack
    cd ../local && supabase stop

After changing a migration, run `node prepare.mjs` and `supabase db reset`
before the test. After changing the function, run `node prepare.mjs` and
give the edge runtime a few seconds: a test started at once can still meet
the old code. A reset also wipes a trial account;
`20261121120100_plugin_drops.sql` can instead be run again as it is, with
psql in the stack's database container, since every statement in it is "if
not exists" or "create or replace" (done that way for the Bingo change and
the switch, 2026-11-21). When the drafts became migrations, the stack's own
migration history was renamed to match, so the trial was kept. The test reads the stack's own development keys from
`supabase status` while it runs; they are never printed or saved.

A real Dink client against the local stack, with the real site:

    cd runelite-plugin/server/local
    node site.mjs              the site on http://localhost:5177; sign up on it
    node trial.mjs             a Region Bingo game for you, to be played at Lumbridge
    node trial.mjs bingo       a Bingo card beside it, for the same drops
    node trial.mjs bingo-end   end that card again: one game at a time
    node trial.mjs report      what the intake heard, and the evidence it made
    node trial.mjs organiser   makes you an organiser, to see "Sent by plugin"
                               and the game's "Drops from Dink" switch

`site.mjs` runs the site with no `.env` file read: it gets the stack's
address and public key and nothing else, so it cannot reach the live project
and has no imgbb key to mirror an upload with. `trial.mjs` puts the one
person who signed up on the site in charge of "Your team"; the other team
opens Asgarnia. Its board: "Two cowhides" (handed in, then done), two tiles
that both want Raw beef (it waits, and you choose one in the box above the
board), "Feathers", and in
Asgarnia "Bones", which every cow and chicken drops and which must never be
handed in for you. Tried on 2026-11-21 with requests shaped like Dink's
before anyone played it: it answered exactly that. `trial.mjs` switches
Dink on for the game, with the console's own call. `supabase db reset`
starts over.

`trial.mjs bingo` adds "Dink trial bingo", started at once, with the same
person as captain of "Your team". Its card: "Three bones" (Bones, three
times: locked in Region Bingo, so it counts for the card and must never
count for the region), "Raw chicken", "Raw beef" (two Region Bingo tiles want
it as well, and a drop two games want is not kept), "Cowhide" and "Feathers" (done in Region Bingo
already, so only the card wants them), and four tiles with no drop list, for
uploads on the site. Built on 2026-11-21 for Boris's local account; what his
drops would match was read from `plugin_wanted` as his account, and is
exactly that list. Ended the same day with `trial.mjs bingo-end` (the
organiser's own `admin_end_game`), since the clan runs one game at a time.
`report` now also shows the team's points, picks and regions, and the drops
that waited for a tile.

The token screen, with fixture data and no database:

    cd web && npm run preview:evidence      then open /preview-account.html
    cd web && npm run test:plugin-tokens

The review screen's label and a tile's panel, the same way (rows 4 and 5 and
the panel's first picture came in through Dink; a switch shows the live
project's case and a failed call):

    cd web && npm run preview:evidence      then open /preview-evidence.html
    cd web && npm run test:evidence-source

The waiting box is on the same page, under "A drop two tiles want", with a
switch for its cases (two waiting, nothing waiting, the live project, a
failed call), one for a drop a teammate handed in first, and "Put them
back":

    cd web && npm run test:waiting-drops

The console's "Drops from Dink" switch: open the admin harness, Manage on
"Region Bingo — Leagues", and it is under the end time.

The tile editor's name check: open a game's board in the admin harness, pick
a square, Edit, and type a drop.

    cd web && npm run preview:evidence      then open /preview-admin.html
    cd web && npm run test:item-names
    cd web && npm run items:names           fetches the wiki's price list again

## Next

1. **Done 2026-11-21:** a real Dink client against the local stack. See "A
   real Dink client".
2. **Decided 2026-11-21:** Dink only, no plugin of our own (plan, section 10,
   item 1). The Java plugin and the two functions only it needed
   (`plugin_watchlist`, `plugin_whoami`) were removed.
3. Boris to try the tile editor's name check and "Add a list…" on the local
   site (`site.mjs`), and say whether the raid weapons list is the one he
   means. The boss lists were added on 2026-11-21; he may want lists changed,
   added or split.
4. Boris to say whether a drop should count only from the boss its tile
   names, or from anywhere, as now (see "A drop counts wherever it came
   from").
5. **Done 2026-11-21:** Bingo (see "Bingo"). Its trial card is ended for
   now: Region Bingo first.
5a. **Region Bingo first (Boris, 2026-11-21).** A whole game through Dink is
   tested (`regions-game.test.mjs`), and Boris played a region opened by a
   pick with a real Dink the same day (see "Region Bingo first: a region
   opened by a pick"). Next, for the real event: its board's drop tiles
   checked against the item list, and the steps to the live project, each
   Boris's call.
6. **Decided 2026-11-21:** one game at a time, so a drop is never wanted by
   two games; nothing is built for it. **Done** the same day: the switch per
   game, off by default, Region Bingo only (see "Dink on or off, per game").
   Boris to flip it on the local site.
7. Snakes & Ladders next. And whether to go through the tile catalogue so its
   drop tiles list real items (see "The tile editor's name check").
8. **Done 2026-11-21:** Dink's report beside every Dink screenshot (see
   "Dink's report beside the picture"). **Decided** the same day: players are
   not asked to change game or RuneLite settings, and a Dink picture that
   does not show the drop is accepted on Dink's report. Boris to look at the
   panel on the local site. For the go-live rules line: say both.
9. **Done 2026-11-21:** a drop two tiles want waits an hour, and anyone on
   the team chooses its tile on the site (see "A drop two tiles want").
   Boris played it the same day with two cows and a real Dink. **Done** the
   same evening: removing the screenshots nobody needs (see "Screenshots
   nobody needs").
10. **Going live for Region Bingo** (Boris, 2026-11-21): **ready to
    merge.** The two drafts are migrations, the function is in
    `supabase/functions`, and a workflow deploys it (see "Going live").
    Decided with it: a matched drop counts at once (plan, item 3), only
    tiles open when it dropped (item 4), and an organiser cannot require
    Dink evidence for a tile (item 8). Boris merges the pull request on
    GitHub; after it, the checks in "Going live". Still open: a line about
    Dink in `docs/region-bingo-rules.md`, Boris's words.
