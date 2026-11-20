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
| `server/001_plugin_tokens.sql` | Plugin tokens, `drop_key`, `plugin_as`, `plugin_whoami` | Tested offline |
| `server/002_plugin_drops.sql` | Evidence `source` and `detail`, the intake log, `plugin_watchlist`, `plugin_match`, `plugin_open`, `plugin_submit` | Tested offline against the real rules |
| `server/intake/dink.mjs` | Reads a Dink notification; makes the dedupe key | Tested |
| `server/intake/handle.mjs` | What happens to one notification: match, open, store, submit | Tested end to end, offline |
| `server/intake/index.ts` | The Edge Function shell around `handle.mjs` | **Never run** (no Deno here) |
| `server/test/replay.mjs` | Replays all 129 migrations into an in-memory Postgres, with stand-ins for what Supabase provides | Works; the repo's own Region Bingo smoke test passes on it, 76 of 76 |
| `server/test/*.test.mjs` | Three test files, 129 checks | All pass |
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

## What they do not prove

- **A real Supabase project.** The replay is real Postgres, but the roles,
  `auth`, `storage` and `pg_net` are stand-ins. PostgREST with the service
  role, real Storage and a deployed Edge Function are still untried.
- **A real Dink message.** `dink.mjs` is written from Dink's documentation,
  not from a notification sent by a client.
- **Screenshot size.** Dink can send up to 8 MB and the bucket takes 3 MB.
  Today anything larger is ignored. Shrinking it in the Edge Function is not
  written.
- **The RuneLite classes**, which have never been compiled.

## Found along the way

Eight checks in the older smoke tests (`bingo`, `snakes`, `territory`) fail on
the replay. Each expects the words "admins only" where the function now says
"Not a mode you run" or "Not your game". The player is still refused; only
the expected wording is out of date. Not changed here.

## To run

    cd runelite-plugin/server/test && npm install && npm test

    cd runelite-plugin/plugin
    javac -d out src/main/java/com/hsevents/core/*.java src/test/java/com/hsevents/core/*.java
    java -cp out com.hsevents.core.CoreSelfTest

## Next

1. A spare Supabase project: apply the migrations and the two drafts, deploy
   `intake`, point one Dink client at it. This settles the three things the
   offline tests cannot.
2. Shrinking a screenshot that is over 3 MB.
3. The My Account screen for tokens, and `source` in the review screen. These
   are the first changes to the website itself.
4. Build the RuneLite plugin once on a machine that can reach RuneLite.
