# hs-events RuneLite plugin: work so far

Started 2026-11-20 from `docs/runelite-plugin-plan.md`. Everything in this
folder is new and stands apart from the website, and nothing was applied to
the live Supabase project.

Two changes to the website itself were made with Boris's go-ahead on
2026-11-21: the **Plugin tokens** section of My Account (see "The token
screen" below), and **"Sent by plugin"** in the organiser's evidence review
(see "The review screen's label"). Both are on this branch only. Both hide
themselves on a database without the drafts, so the live site would show
nothing new even if they were merged before the drafts are applied.

Uploading evidence on the site is unchanged and stays the normal way in. A
plugin is an extra way to hand in a drop, for players who run Dink.

The two `.sql` files in `server/` are drafts. They are kept out of
`supabase/migrations` so that `db-push.yml` cannot apply them. They only
become migrations when they are moved there on purpose.

## What is here

| Path | What | State |
|---|---|---|
| `server/001_plugin_tokens.sql` | Plugin tokens, `drop_key`, `plugin_as`, `plugin_whoami` | Tested offline, and on a local Supabase stack |
| `server/002_plugin_drops.sql` | Evidence `source` and `detail`, the intake log, `plugin_watchlist`, `plugin_match`, `plugin_open`, `plugin_submit`, and `admin_evidence_sources` for the review screen | Tested offline against the real rules, and on a local Supabase stack |
| `server/intake/dink.mjs` | Reads a Dink notification; makes the dedupe key | Tested; checked against Dink's source, and read real loot from a real Dink client on 2026-11-21. Pets not yet from a client |
| `server/intake/handle.mjs` | What happens to one notification: match, open, store, submit | Tested end to end, offline |
| `server/intake/shrink.mjs` | Makes a screenshot over 3 MB smaller: halves a PNG until it fits. No library, only what the runtime has | Tested offline and in the edge runtime |
| `server/intake/index.ts` | The Edge Function shell around `handle.mjs` | Tested on the local stack; not deployed anywhere |
| `server/test/replay.mjs` | Replays all 129 migrations into an in-memory Postgres, with stand-ins for what Supabase provides | Works; the repo's own Region Bingo smoke test passes on it, 76 of 76 |
| `server/test/*.test.mjs` | Three test files, 167 checks, run by `npm test` | All pass |
| `server/test/png.mjs`, `fixtures/` | A PNG writer and reader for the tests only, and one small PNG written by Java's ImageIO | |
| `server/local/` | A local Supabase stack: `config.toml`, and `prepare.mjs`, which copies the migrations, the two drafts and the intake function into it | Works with Supabase CLI 2.122.0 and Docker |
| `server/test/stack.test.mjs` | 65 checks against that stack, the Edge Function included, run by `npm run test:stack` | All pass |
| `plugin/.../core/` | `DropKey` and `WatchList`: the matching rule in plain Java | Tested, 16 checks, also run by `gradle test` |
| `plugin/.../HsEvents*.java`, build files | The RuneLite plugin skeleton, built the template's way | Builds against RuneLite 1.13.7; **never loaded in a client** |
| `web/src/components/PluginTokens.jsx` | The Plugin tokens section of My Account: make a token, see its Dink link once, revoke | Tried in the preview harness, and used by Boris on the local stack to set up a real Dink (2026-11-21). Not on the live project |
| `web/src/lib/pluginTokens.js` | The Dink link, the name check, "last used" in words | Tested by `web/scripts/plugin-tokens-selftest.mjs`, and used by `stack.test.mjs` |
| `web/preview-account.html` | A harness for My Account with fixture tokens | |
| `web/src/components/EvidenceReview.jsx` | The organiser's evidence review: "Sent by plugin" on a row a plugin handed in, with what it reported | Tried in the preview harness, and seen by Boris on the local stack with his own drops (2026-11-21). Not on the live project |
| `web/src/lib/evidenceSource.js` | The label and the lines under it, from `source` and `detail` | Tested by `web/scripts/evidence-source-selftest.mjs`, and used by `stack.test.mjs` |

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
project and never touches it. Tested 2026-11-21, 65 of 65.

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
- **What the token screen asks for works.** A signed-in player's
  `plugin_token_list` has their token by name, and neither the token nor its
  hash. A function the database does not have is answered `PGRST202`, which
  is exactly what the section hides itself on.
- **What the review screen asks for works.** Through PostgREST with the
  organiser's sign-in, `admin_evidence_sources` names every row a plugin
  sent in this run and nothing else. Laid onto `admin_list_evidence` by the
  site's own `withSources`, the chainbody reads "Sent by plugin", "Dragon
  chainbody from Chaos Elemental", "as Mate Iron · world 302" and "Picture
  made smaller from 3840×2400", and the site's own upload has no label. A
  player is refused with "Not your game" and learns nothing; anon and the
  service role cannot call it.

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

## What they do not prove

- **A hosted Supabase project.** The local stack runs the same software, but
  the live project's settings, its Postgres version and its limits were not
  compared, by design. The Edge Function has not been deployed.
- **A pet from a real Dink.** Loot from a real client has been read (see "A
  real Dink client" below). A pet notification has only been checked against
  Dink's source, and a real screenshot over 3 MB has not come in yet: the
  real ones were about 0.2 MB.
- **A hosted CPU.** The shrinking was timed on this machine's CPU, under the
  same limits a hosted project has. A hosted CPU may be slower; the worst
  case uses about a sixth of the 2 seconds. The log line's `ms` will show it.
- **A JPEG over 3 MB** is still ignored. Dink only makes a JPEG for a
  screenshot over 8 MB, so this needs a screen bigger than 4K.
- **The plugin in a client.** It builds, but it has never been loaded in
  RuneLite, and it does nothing visible yet: its watch list is still empty.
- **The live project.** The token screen and the review screen's label have
  run against the local stack only.

## A real Dink client

On 2026-11-21 Boris played the trial game (`trial.mjs`) with his own account
and Dink, on the real site run against the local stack (`site.mjs`). He signed
up, added his in-game name and made a token on the site, put the link in Dink,
and killed cows and chickens at Lumbridge.

| Kill | Dink sent | What happened |
|---|---|---|
| A cow, before his team had a region | Bones, Raw beef, Cowhide | Nothing handed in |
| A cow, after picking Misthalin | the same | Cowhide handed in; Raw beef an "ask" (two tiles), not handed in; Bones not (its tile is in Asgarnia, locked for him) |
| A second cow | the same | Cowhide handed in; "Two cowhides" completed, with the usual feed lines |
| A chicken | Bones, Raw chicken, Feather x5 | Feather handed in; "Feathers" completed |
| A second chicken | the same | Nothing: "Feathers" was done and had left the list |

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
in draft 002 stamps it `web`, and the screen shows it exactly as before.

- **"Sent by plugin", never "verified".** A grey, dashed pill beside the gold
  one that names the drop it was filed as. Its tooltip says the plugin runs on
  the player's own computer, so the picture is checked as any upload is.
- **Under it, what the plugin reported**: the item and what dropped it ("Pet:"
  for a pet), the in-game name and world, and "Picture made smaller from
  3840×2400" when the intake shrank it. These are the client's words, shown as
  text, cut at 60 characters, and only when they have the right shape.
- **Its own function, not two more columns on `admin_list_evidence`.**
  Changing what that returns means dropping and re-creating it, and its live
  body has been rewritten in place since, so a copy in the draft could drift
  from it. `admin_evidence_sources` reads `source` and `detail` and asks the
  same question, `may_manage_game`, in the same words.
- **A database without the drafts** (the live project today): the call
  answers `PGRST202` and no row has a label. **If the call fails** any other
  way, the rows still load and a line says the screen cannot tell which
  evidence a plugin sent, rather than pass plugin evidence off as uploads.

## The RuneLite build

`plugin/` now has the shape of RuneLite's plugin template
(`runelite/example-plugin` at commit `46e14f2`, 2026-10-01), which the Plugin
Hub asks for: the same `build.gradle` with only the names changed, a
`settings.gradle`, the Gradle 8.10 wrapper with the template's checksum, the
`run` and `shadowJar` tasks, and a test class that starts RuneLite with the
plugin loaded. `runelite-plugin.properties` gained the template's `build` and
`version` lines.

Built 2026-11-21 with JDK 17 and Gradle 8.10: `latest.release` is RuneLite
1.13.7. Everything compiles. With every compiler warning turned on there is
one, the same one the template's own test class gives. Nothing needed fixing.
`gradle test` runs the 16 core checks through JUnit.

The template's notes list the Plugin Hub's rules. Four touch this plugin and
are not decided here:

- **The warning text.** A setting that talks to a third-party server must be
  off by default, which "Hand in matching drops" is, and carry one exact
  warning: "This feature submits your IP address to a 3rd-party server not
  controlled or verified by RuneLite developers". Ours is longer and says
  more.
- **Event pop-ups are on by default.** If they come from the site, they talk
  to a third-party server too, and must be off by default.
- **"No plugins that use player-provided IDs for their entire
  functionality."** The plugin does nothing without a token from the site.
  Whether the reviewers read a token as such an ID is worth asking them.
- **Where it lives.** The Hub builds a plugin from a repository and a commit,
  with `build.gradle` at the top, under a permissive licence such as BSD-2.
  This one sits in `runelite-plugin/plugin/` of the site's repository.

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

After changing a draft, run `node prepare.mjs` and `supabase db reset` before
the test. The test reads the stack's own development keys from
`supabase status` while it runs; they are never printed or saved.

A real Dink client against the local stack, with the real site:

    cd runelite-plugin/server/local
    node site.mjs              the site on http://localhost:5177; sign up on it
    node trial.mjs             a Region Bingo game for you, to be played at Lumbridge
    node trial.mjs report      what the intake heard, and the evidence it made
    node trial.mjs organiser   makes you an organiser, to see "Sent by plugin"

`site.mjs` runs the site with no `.env` file read: it gets the stack's
address and public key and nothing else, so it cannot reach the live project
and has no imgbb key to mirror an upload with. `trial.mjs` puts the one
person who signed up on the site in charge of "Your team"; the other team
opens Asgarnia. Its board: "Two cowhides" (handed in, then done), two tiles
that both want Raw beef (an "ask", not handed in), "Feathers", and in
Asgarnia "Bones", which every cow and chicken drops and which must never be
handed in for you. Tried on 2026-11-21 with requests shaped like Dink's
before anyone played it: it answered exactly that. `supabase db reset`
starts over.

    cd runelite-plugin/plugin
    gradle build            (JDK 11 or later; or ./gradlew build)
    gradle run              (starts RuneLite with the plugin, to try in game)

or, with nothing but a JDK:

    javac -d out src/main/java/com/hsevents/core/*.java src/test/java/com/hsevents/core/CoreSelfTest.java
    java -cp out com.hsevents.core.CoreSelfTest

The token screen, with fixture data and no database:

    cd web && npm run preview:evidence      then open /preview-account.html
    cd web && npm run test:plugin-tokens

The review screen's label, the same way (rows 4 and 5 came in through Dink; a
switch shows the live project's case and a failed call):

    cd web && npm run preview:evidence      then open /preview-evidence.html
    cd web && npm run test:evidence-source

## Next

1. **Done 2026-11-21:** a real Dink client against the local stack. See "A
   real Dink client".
2. Boris to decide whether our own plugin is needed at all, or Dink is enough
   (plan, section 10, item 1). Dink handles the evidence; ours would add the
   in-game overview, pop-ups and the "which tile?" question.
3. If it is: load the plugin in RuneLite once (`gradle run`) to see it start
   and show its settings; then the four Plugin Hub points above.
