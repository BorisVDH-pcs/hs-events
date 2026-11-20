# hs-events plugin: first part

Started 2026-11-20 from `docs/runelite-plugin-plan.md`. Everything in this
folder is new and stands apart from the website: no existing file in the repo
was edited, nothing here is built or deployed with the site, and nothing was
applied to the live Supabase project.

`server/001_plugin_tokens.sql` is a draft. It is kept out of
`supabase/migrations` so that `db-push.yml` cannot apply it. It only becomes a
migration when it is moved there on purpose.

## What is here

| Path | What | State |
|---|---|---|
| `server/001_plugin_tokens.sql` | Plugin tokens, `drop_key`, `plugin_as`, `plugin_whoami`. One new table and new functions; changes nothing that exists | **Tested offline**, 41 checks |
| `server/test/tokens.test.mjs` | That test, in PGlite with stand-ins for what Supabase provides | Passes |
| `plugin/src/main/java/com/hsevents/core/` | `DropKey` and `WatchList`: the matching rule, in plain Java | **Tested**, 16 checks |
| `plugin/src/test/.../CoreSelfTest.java` | That test; needs only a JDK | Passes |
| `plugin/src/main/java/com/hsevents/HsEvents*.java` | The RuneLite plugin skeleton: settings, and a loot listener that asks the watch list for a verdict | **Not compiled** |
| `plugin/build.gradle`, `runelite-plugin.properties` | Build files in the template's shape | Not run |

## What the tests prove

- A token is `hse_` + 64 hex characters, and only its sha256 is stored.
- `plugin_as` makes `auth.uid()` the token's owner for one transaction, and it
  ends with the transaction. This is the plan's first "prove it" item.
- One player's token never reads another's accounts; a revoked, made-up or
  malformed token is refused; a sixth live token is refused.
- Only the owner or an organiser can revoke. `anon` can call nothing, and no
  role is granted `plugin_as`.
- `drop_key` in SQL and `DropKey` in Java give the same answer on the same cases.
- A drop two tiles want is `ASK`, never a guess.

## What they do not prove

- **The real path.** PGlite is real Postgres, but the test stands in for
  `auth.uid()`, the roles, `profiles`, `profile_accounts` and `is_admin()`.
  Calling `plugin_whoami` through PostgREST with the service role still has to
  be tried on a spare Supabase project.
- **The RuneLite classes.** `repo.runelite.net` was not reachable from the
  workspace this was written in, so `HsEventsPlugin` and `HsEventsConfig` have
  never been compiled. Their API names come from the documentation.

## To run

    cd runelite-plugin/server/test && npm install && node tokens.test.mjs

    cd runelite-plugin/plugin
    javac -d out src/main/java/com/hsevents/core/*.java src/test/java/com/hsevents/core/*.java
    java -cp out com.hsevents.core.CoreSelfTest

## Next

1. Build the plugin once on a machine that can reach RuneLite, and fix what
   the compiler finds.
2. Try `001_plugin_tokens.sql` on a spare Supabase project, through PostgREST.
3. `plugin_watchlist` (needs `tiles_for_team`, so it is tested against a copy
   of the real schema, not stand-ins).
4. The `intake` Edge Function and the Dink parser.
