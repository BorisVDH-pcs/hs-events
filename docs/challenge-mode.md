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
- `DELETE /v2/competitions/:id` removes it, code in the body. WOM calls this
  irreversible. Deleting the event here sends it — see **Deleting one** below.

There is no fourth call available to us. Ending a competition early would mean
`PUT /v2/competitions/:id` with a nearer `endsAt`, and pg_net has no PUT — it
"only supports three types of asynchronous requests", GET, POST and DELETE. So
a challenge ended early on the site keeps counting on WOM until its original
end time. The ladder here is unaffected, being scored from the standings as
they stood when it ended.

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

**The picture is a file.** It goes to the same private `evidence` bucket the
tiles use, under `challenge/{game_id}/{entry_id}/{uuid}` — a namespace of its
own, because that bucket's original policies gate on the team folder and a solo
challenge has no team (20261026140000). `challenge_add_shot` rebuilds the
prefix server-side and refuses a path that does not start with it, so the path
is never taken on trust. Links pasted before uploads existed still open: `url`
and `storage_path` sit side by side and a screen draws whichever it is handed.

**One picture a phase.** `challenge_max_evidence()` allows five, and always
did, so that a shot cropped wrong can be taken again — it was never an ask for
five. The screen shows the newest one, with a Replace under it and any earlier
try folded away; the cap is a backstop nobody meets. Replacing supersedes
rather than deletes, because evidence is immutable for players on purpose
(`0021` grants no delete policy), so the organiser can still see what came
before.

- The model names it per event — `declared_label` and a `declared_unit` of
  `gp` or `count` — but **the form no longer asks**. There is no third thing a
  player hands in, so it writes "Loot value" in `gp` and nothing else. The
  columns stay as they are: an event made before this, or by hand, keeps its
  own label and scores exactly as it did.
- `gp` is stored in **tenths of a million**, the unit `web/src/lib/millions.js`
  already uses everywhere, so 0.5m is 5 and the existing formatting works. The
  column is `bigint`, not the `smallint` a value tile uses: that caps at 1000m,
  and a week of raids passes it.
- The organiser sees every entry with its screenshots in one list and **can
  alter the number**. An altered figure records who altered it, so a ladder
  always says whose number it is showing.

## The two events the form makes

The model carries both figures and lets `ranked_by` pick the winner, which is
more shapes than anybody runs. The New game form asks one question with two
answers:

| | What it counts | What wins it | Handed in |
| --- | --- | --- | --- |
| **Hiscores** | the metric, off WOM | the same count | nothing |
| **Loot** | the metric, off WOM | the loot value | two screenshots |

Both count a metric, so the metric is asked once, under either answer.

A loot event **shows both figures and ranks on the loot**, which is the point
rather than a detail: the WOM count keeps climbing after a player hands their
finish screenshot in, so somebody who carries on will show a count their loot
does not cover. The count is there to read; the loot decides.

This narrows the form, not the model. A declared-only event, a figure called
something else, a plain `count` and a WOM-ranked event that also collects a
number are all still valid `challenge_setup` rows and still score, draw and end
as they did — they are simply not among the things the form makes. Nothing was
migrated, so widening it again is one file.

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

## Starting and finishing on the clock

`20261026150000` gives an event a start time that is acted on, and the same
no-scheduler arrangement does the acting: `challenge_tick(game_id)` is what an
open page calls when a countdown reaches zero. It is granted to `authenticated`
on purpose — a browser is the only clock there is — and that is safe because it
reads the times on the event rather than who is asking, refuses anything the
clock has not already earned, and takes `for update` on the games row so a
clan's worth of phones do between them exactly what one would.

The two transitions were split out as `challenge_do_start` and
`challenge_do_end`, with no checks in them and no grants on them. `challenge_start`
and `challenge_end` keep every check they had and call those; the tick calls
them too, having checked the clock instead. One body each, so the button's path
and the clock's path cannot drift.

Three things the clock does differently from the button:

- **It starts an event nobody has joined.** `challenge_start` refuses an empty
  event, and a team event with anybody unseated. Those are right for a person
  pressing a button too early and wrong for a Monday morning — an event that sat
  in setup because nobody had signed up is the thing this removes. Affordable
  only because sign-ups now stay open while it runs.
- **It creates the WOM competition in two places.** `challenge_wom_create`
  *raises* when nobody with a RuneScape name has joined, and the start calls it,
  so an empty scheduled start would roll itself back. The tick therefore creates
  the competition only when there is somebody to put in it — and creates it
  later, on the first tick that finds a running event with entrants and no
  competition, because `challenge_wom_add` returns null where there is no
  competition to add to and an event that opened empty would otherwise score
  nothing all week.
- **Ending takes two passes.** `challenge_end` will not settle a ladder on
  standings older than fifteen minutes, and `pg_net` is fire-and-forget, so
  queueing the fetch and reading its reply are different transactions. The first
  tick after the end time reconciles what has landed and asks for fresh figures;
  the next one, ten seconds later, settles it. An event finishes shortly after
  its end time rather than on it, which is what the right winner costs.

Both buttons stay. Start event is now "go early", End event now is "call it
early", and an organiser can move the start time while the event is waiting.

## Events

`challenge_declared` and `challenge_ended` only. Joining emits nothing: with the
whole clan opting in over a day it would bury the feed, the same judgement that
keeps `bingo_open_tile` silent.

## Sign-ups stay open while it runs

They did close at the start, and that was a limitation rather than a rule
anyone wanted: the WOM competition was created from exactly the people who had
joined, so a latecomer would have sat on our ladder and not on WOM's, scoring
zero for a week they actually played.

`20261026120500` uses WOM's add-participants endpoint, so `challenge_join`
takes somebody mid-event and `challenge_wom_add` puts them on the live
competition. `challenge_entries.wom_added_at` is null until WOM confirms it, and
the player's own screen says so in red while there is still time to fix it —
being on this ladder and being on WOM's are two different things, and the one
unacceptable outcome is finding that out at the end of the week.

WOM measures every participant from the competition's own start, so a latecomer
is credited with the days before they joined. The sign-up card says that before
they sign up, not after.

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

## Deleting one

Deleting a challenge deletes its WOM competition, in that order
(`20261026170000`). The order is the whole point: `challenge_wom` is
`on delete cascade`, so a `delete from games` run first takes the verification
code with it, and the competition is then live on wiseoldman.net with nobody
on this side able to touch it again. `admin_delete_game` therefore calls
`challenge_wom_destroy` before it deletes anything.

Both sit in one transaction, and pg_net queues rather than sends, so a delete
that raises part-way never reaches WOM — no competition is deleted for a game
that then survives.

What cannot be known from here is whether WOM accepted it: the call is
fire-and-forget, and by the time an answer exists, the game and the code are
gone. So `challenge_wom_deleted` keeps the competition id, the game's name and
**the verification code**, outside the cascade. A credential outliving the
thing it protects is a deliberate trade: without it, that table would be a list
of competitions you can see are orphaned and cannot do anything about. It is
closed exactly as `challenge_wom` is.

**Ending a challenge sends nothing.** The standings are the public record of
the result at the moment they crown a winner, and there is no PUT to end the
competition early with (above).

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
- `20261026150000_challenge_schedule.sql` — the start time, and the clock that
  acts on both times. See *Starting and finishing on the clock*.
- The console — Challenge in New game with its own body (what it is scored on,
  rather than how big the board is), its own checklist, both times, Start event,
  End event now, and a Track pane with the ladder, the review list and a Refresh
  button for the figures. Configure shows Game and Discord only: a challenge has
  no board and no roster.
- The player screen — `components/challenge/`. Sign up with the RSN WOM will
  match, give the number, hang the start and finish shots on it, and the
  ladder. It loads its own data rather than going through `board_for_me`:
  that function answers in one call because every other mode is a board, and
  teaching it a fourth shape would mean editing a shared function for the one
  mode that has nothing in common with the others.

Still to come:

1. Nothing outstanding. Latecomers landed in `20261026120500` and scheduling in
   `20261026150000`; what is left is whatever the first scheduled event turns up.

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
