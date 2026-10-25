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

Organisers can read it, on the Track pane, from a button that fetches it rather
than a field the page already holds. Nobody else can, at any level.

**That code exists in exactly one reply, and WOM will not issue another.** It
comes back from `POST /v2/competitions` and nowhere else, so losing that reply
loses the ability to edit the competition for good — the standings can still be
read, since the GET is public. Test TFA lost one this way on 2026-10-25: pg_net
timed out at its five-second default while WOM took 4.8s to answer, and WOM
created the competition regardless. Hence `challenge_wom_timeout()`, which every
sender now passes, and the two repairs beside it: link the competition WOM
already made, or ask for a new one.

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

## Finding one

This is the one thing the player screen could not do with what was already
there. Every other mode is reached through the roster: `listMyGames`
(`web/src/lib/games.js`) reads `team_members` and answers "which games am I
in". A challenge is opt-in and a solo one has no teams at all, so there is
nothing in `team_members` to find — and an event nobody has joined yet has
nothing anywhere, which would leave the sign-up screen unreachable by the
people it is for.

So `20261026120300` adds `challenge_list()`. It answers with every event open
or running, every one this player entered in the last fortnight, and every one
they organise — each with its setup, how many have signed up, and whether this
caller is one of them. `challenge_setup` and `challenge_entries` both have RLS
on and no policies, so this is the only way in, and it carries counts rather
than names: **who** has signed up stays the organiser's business until the
event starts, which is the same rule `challenge_standings` keeps.

`listMyGames` folds those into the picker after the rostered games, joined
ones first. The order is not cosmetic. `App` opens `mine[0]` for anyone with
no stored choice, so sorting the whole list by date would move every player
off the bingo they are playing the moment an organiser creates next week's
event.

## An end time is not only a bingo's

`admin_set_end_time` has refused every mode but bingo since
`20261001120100`, and said so: *Only a bingo has an end time*. That stopped
being true when territory landed — the end time is the whole of how a conquest
finishes, and the console has offered an editor for it ever since, which has
been refused every time it was pressed. A challenge needs one too, and for a
harder reason: `challenge_start` will not start an event whose end time has
passed or is missing, and the organiser had no way to set it.

`20261026120400` patches that one check to name the three modes that have an
end time. The territory bug is fixed in the same breath rather than left in
place beside the fix for it.

## What is built, and what is not

Done:

- `20261026120200_challenge_rpcs.sql` — creating an event, joining and leaving,
  declaring a figure with the shots behind it, the organiser's review list with
  correct-and-verify, the ladder, starting, ending, and both halves of the Wise
  Old Man call.
- The console — Challenge in New game with its own body (what it is scored on,
  rather than how big the board is), its own checklist, Start event, End event
  now, and a Track pane with the ladder, the review list and a Refresh button
  for the figures. Configure shows Game and Discord only: a challenge has no
  board and no roster.
- The player screen — `components/challenge/`. Sign up with the RSN WOM will
  match, give the number, hang the start and finish shots on it, and the
  ladder. It loads its own data rather than going through `board_for_me`:
  that function answers in one call because every other mode is a board, and
  teaching it a fourth shape would mean editing a shared function for the one
  mode that has nothing in common with the others.

Still to come:

1. Adding a latecomer to a running WOM competition, so sign-ups can stay open.
2. A storage policy for `challenge_evidence` paths (`{game}/{entry}/{uuid}`).
   Until then a screenshot is a pasted link to an image uploaded elsewhere,
   which the organiser opens from the review list.

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
