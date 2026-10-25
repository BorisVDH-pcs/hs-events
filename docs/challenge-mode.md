# Challenge: short events

The fifth game mode. Not a board: a start time, an end time, one figure per
entrant, and a ladder.

It exists for the run of short events proposed in Discord — Clue, Boss, Raid and
Skill of the Week, twice a month, plus one larger monthly event — and the shape
is the same for all of them.

## The name

The mode value is `challenge`, not `weekly`. The events are weekly *and*
monthly, and an enum value is forever. Nothing here depends on the name; say so
and it changes, while the migration is still unapplied.

## What a challenge is

| | |
|---|---|
| Lives in | `games`, `mode = 'challenge'`, with `starts_at` and `ends_at` |
| Entrants | People opt in while it is open. No sign-up, no row on the ladder |
| Solo or teams | The organiser picks per event (`challenge_setup.solo`) |
| The figure | Up to two per event: one from Wise Old Man, one declared by the player |
| The winner | Whichever figure the organiser said ranks (`ranked_by`) |

`grid_size` is left at its default and means nothing here. The column is `not
null` on the shared table and no challenge reads it; widening that constraint
for a mode with no board would be worse than ignoring it.

## The two figures

An event has a WOM figure, a declared figure, or both. Boss of the Week is the
case that needs both: Wise Old Man counts the kills, and the loot is a number
only the player can give.

### From Wise Old Man

[WOM](https://docs.wiseoldman.net/api/competitions/competition-endpoints) reads
the OSRS hiscores, which covers every metric the proposed events use — bosses,
skills, clue tiers and raids alike.

- `POST /v2/competitions` creates one from a title, a metric, `startsAt`,
  `endsAt` and a list of RSNs. It answers with an id and a `verificationCode`.
- `GET /v2/competitions/:id` **needs no authentication** and gives every
  participant's `start`, `end` and `gained` for the metric.
- `POST /v2/competitions/:id/update-all` asks WOM to re-read the hiscores. It
  needs the verification code, and WOM does not promise it worked.

The verification code is a credential. It lives in `challenge_wom`, which has
RLS on and **no policies at all** — the same arrangement `discord_webhooks`
uses, for the same reason. It must never become a `VITE_` variable.

**The RSN is the join key, and ours is not trustworthy.** `profiles.rsn` is
typed by the player at sign-up and has never been checked against anything. WOM
matches on the exact username. So a challenge stores the RSN **on the entry**,
snapshotted at sign-up, and refuses one WOM has never heard of. Fixing a profile
later must not silently change what a finished ladder was scored on.

### Declared by the player

A number the player types, backed by two screenshots: one at the start, one at
the finish. The site cannot read a screenshot, so the figure is the player's
word and the evidence is what makes it checkable.

- The organiser names it per event — `declared_label` ("Total loot"), and a
  `declared_unit` of `gp` or `count`.
- `gp` is stored in **tenths of a million**, the unit `web/src/lib/millions.js`
  already uses everywhere, so 0.5m is 5 and the existing formatting works. The
  column is `bigint`, not the `smallint` a value tile uses: that caps at 1000m,
  and a week of raids passes it.
- The organiser sees every entry with its screenshots in one list and **can
  alter the number**. An altered figure records who altered it, so a ladder
  always says whose number it is showing.

## How it is scored

`ranked_by` is `wom` or `declared`, set when the event is created. The other
figure is still collected and still shown in its own column — it just does not
decide the winner. One ladder, one winner.

A team's figure is **the sum of its members'**, which is what a clan event
normally means and what WOM's own team competitions do.

## Fetching, with no scheduler

There is no `pg_cron` on this project. Bingo's timer already works around that:
nothing fires on its own, and any client calls an idempotent function when its
countdown says to.

The WOM fetch is the same idea in two phases, because `pg_net` is
fire-and-forget and we need the reply:

1. `challenge_fetch(game_id)` queues `net.http_get` and logs the request id in
   `challenge_fetch_log`, exactly as `relay_pending` logs a Discord post.
2. `challenge_reconcile(game_id)` reads `net._http_response` for that id, parses
   the participations out of the body and writes each entry's figures — the same
   trick `relay_reconcile` uses to find out what Discord did with a message.

Both are idempotent and both are rate-limited by `challenge_wom.fetched_at`, so
a room full of open browsers costs one fetch, not thirty. WOM allows 20 requests
a minute without a key.

## Events

`challenge_declared` and `challenge_ended` only. Joining emits nothing: with the
whole clan opting in over a day it would bury the feed, the same judgement that
keeps `bingo_open_tile` silent.

## Sign-ups close when the event starts

A limitation, not a rule anyone wanted. The WOM competition is created at the
start from exactly the people who have joined, so a latecomer would sit on our
ladder and not on WOM's, scoring zero for a week they actually played. WOM has
an add-participants endpoint and a later migration should use it; until then
`challenge_join` refuses clearly rather than entering someone who cannot score.

## The shared functions are patched, not rewritten

Bingo, snakes and territory each added their mode by copying a shared
function's latest definition **out of the ledger** and re-emitting it with
their lines added. That stopped being safe on 2026-10-25.

`20261025130000` swapped the guard on 44 functions **at runtime**, with
`pg_get_functiondef` and `regexp_replace`. The migration files never saw those
edits, so the newest `admin_new_game` in the repo still reads
`if not is_admin()` while the one in the database reads
`if not may_run_mode(p_mode)`. Re-emitting the repo's copy would have handed
every moderator's permission quietly back to admins only.

So `20261026120200` patches the five it needs the way the sweep patched its
own: read the **live** definition, change one fragment, assert it matched
exactly once, put it back. Nothing looks at the guard, so whatever it now says
is carried through untouched.

| Function | What changed |
|---|---|
| `admin_new_game` | refuses `challenge`, points at `admin_new_challenge` |
| `start_game` | refuses `challenge`, points at `challenge_start` |
| `admin_end_game` | hands `challenge` to `challenge_end` — ending a game is one button whatever the mode |
| `admin_game_readiness` | leaves challenges out; they have no board to count |
| `discord_line` | asks `challenge_discord_line`, the same hand-off snakes and territory use |

`admin_game_readiness` doubles as an integrity check. Its anchor is
`where may_manage_game(g.id)`, which exists **only** because the sweep put it
there. Run this against a database the sweep has not reached and that pattern
matches zero times, so the whole migration aborts instead of half-applying.

## What is built, and what is not

Done, in `20261026120200_challenge_rpcs.sql`: creating an event, joining and
leaving, declaring a figure and uploading the shots behind it, the organiser's
review list with correct-and-verify, the ladder, starting, ending, and both
halves of the Wise Old Man call.

Still to come:

1. The console: a Challenge pane, the setup form, the organiser's review list.
2. The player screen: join, submit, the ladder.
3. Adding a latecomer to a running WOM competition, so sign-ups can stay open.
4. A storage policy for `challenge_evidence` paths (`{game}/{entry}/{uuid}`).

## Who may run one

Nothing to do. `may_run_mode('challenge')` works the day the enum value exists,
because the moderator gates are generic over `game_mode`. The Discord mod gets
`challenge` and nothing else:

```sql
insert into moderator_modes (profile_id, mode)
select p.id, 'challenge'::game_mode from profiles p
 where lower(p.display_name) = lower('REPLACE WITH USERNAME')
   and not p.is_admin;
```
