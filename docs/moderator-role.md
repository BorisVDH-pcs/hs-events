# Moderators

A moderator is an organiser for **some game modes**. They create and run those
games with the full console for them, and see nothing else: no accounts, no
passwords, no games of other modes.

The tier exists because `profiles.is_admin` is all-or-nothing. Handing someone
the bingo nights currently hands them every player's password as well.

## The model

A grant is a set of **modes**, not a set of games:

```
moderator_modes (profile_id, mode, granted_by, granted_at)
```

Modes are the `game_mode` enum: `battleships`, `bingo`, `snakes`, `territory`.
Per-mode rather than per-game, because running "the bingo nights" is the actual
job, and because whoever creates a game cannot be granted it beforehand.

Three gates sit on top, all `security definer` like `is_admin()`:

| Gate | Answers | Used by |
|---|---|---|
| `may_run_mode(mode)` | may I run this kind of game? | creating a game |
| `may_manage_game(game_id)` | may I touch this game? | everything game-scoped |
| `is_moderator()` | do I have a console at all? | the frontend |

Each returns true for admins, who keep every power they had.

### Nobody widens their own grant

`moderator_modes` has RLS enabled and **no insert, update or delete policy at
all**. The only way in is `admin_set_moderator_modes`, which demands
`is_admin()`. This is the same trick 0006 used for `profiles.is_admin`, where
the self-update policy pins the flag to its current value.

If that table ever gets a write policy "for convenience", the tier is over.

## What still has to happen

`20261025120000_moderator_role.sql` is **inert**. It adds the table, the gates
and the admin RPCs; it changes no existing function, so granting someone modes
today does nothing. The behaviour arrives when the guards are swapped.

### The sweep

62 `admin_*` functions exist. Their guards fall into three groups.

**32 take `p_game_id`** — a direct swap:

```sql
if not is_admin() then raise exception 'Admins only'; end if;
-- becomes
if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;
```

**14 take some other row id** (`p_team_id`, `p_claim_id`, `p_evidence_id`, and
`p_id` on score events and webhooks). Each needs a small resolver beside the
gates — `may_manage_team(uuid)`, `may_manage_claim(uuid)` and so on — that joins
the row back to its game and defers to `may_manage_game`.

**16 take no row id**, and a handful of the scoped ones are policy rather than
mechanics. Decided 2026-10-25:

| Function(s) | Decision |
|---|---|
| `admin_new_game`, `admin_create_game` | `may_run_mode(mode)` — the point of the tier |
| `admin_game_readiness` | filter rows to games they may manage, don't refuse |
| `admin_list_library`, `admin_save_library_tile` | moderators read **and** save |
| `admin_delete_library_tile`, `admin_delete_board_preset` | admin only — deleting hits other organisers' work |
| `admin_list_tile_submissions`, accept/refuse | admin only — a site-wide queue that writes to the shared library |
| `admin_set_featured_game` | `may_manage_game` — a moderator may feature a game of their own mode |
| `admin_delete_game` | `may_manage_game` — they clean up their own games |
| `admin_reset_game` | **admin only** — wiping progress is a deliberate admin act |
| `admin_adjust_score`, `admin_delete_score_event`, `admin_revoke_evidence`, `admin_revoke_pet_jar` | `may_manage_*` — correcting the night is the job |
| `admin_set_webhook`, `admin_list_webhooks`, `admin_delete_webhook` | `may_manage_game` — their event, their channel |
| `admin_set_member`, `admin_remove_member`, `admin_add_team`, `admin_delete_team` | `may_manage_game` — seating players is most of the setup |
| `admin_reset_password`, `admin_delete_account`, `admin_list_password_resets`, `admin_list_account_deletions` | admin only, firmly — the reason the tier exists |
| `admin_set_moderator_modes`, `admin_list_moderators` | admin only, by definition |

Worth revisiting once it has been used: a moderator may **delete** a game but not
**reset** one, and delete is the less reversible of the two. The reasoning is that
a reset silently wipes a live event's progress while a delete is usually tidying
up a finished or test game — but if that turns out backwards in practice, it is
two guard lines to swap.

**And 11 functions that are not `admin_*` at all** consult `is_admin()` as an
organiser escape hatch: `place_fleet`, `start_game`, `rename_team`,
`acting_as_team`, `acting_for_team`, `my_team_in_game`, `evidence_for_team`,
`tiles_for_me`, `tiles_for_team`, `tile_name_key`, `tile_task_key`. A moderator
running a game needs nearly all of these — seeing tile tasks, viewing as a team,
starting the game — so they take `may_manage_game` too.

Done in `20261025130000_moderator_sweep.sql`, which does NOT re-emit those
bodies. Each guard is one line inside a function that is otherwise untouched, so
the body comes from the live definition via `pg_get_functiondef` and only that
line is replaced — the technique `20261004130000` already used on `fire_tile`
and `add_evidence`, for the reason it gives there: the rest of each function is
taken from the live definition, so nothing else in them can drift.

Every swap asserts its pattern matched **exactly once** and raises otherwise, so
a guard that has been reworded since cannot be silently skipped, and a failed
assertion aborts the whole migration. 51 assertions in total: 44 standard
guards, 5 reworded ones (`start_game`, `admin_board_for_team`, `place_fleet`,
`rename_team`, `acting_as_team`), and 2 for `admin_game_readiness`, which
filters its rows rather than refusing.

55 live functions carry the standard guard: 44 are swapped, `admin_game_readiness`
filters instead, and 10 stay admin-only by the decisions above. None is
unaccounted for.

The swap checks every signature and every guard **before** it changes anything,
and reports all the problems it found rather than stopping at the first. That is
not caution for its own sake. The list originally held six more functions, and
the first attempt to apply it died on `admin_import_board_to_library(uuid)`,
which a later migration had dropped. The check that was supposed to have caught
this read the migration ledger for `create or replace function` and never looked
at `drop function`, so it reported six functions as present that had not existed
for weeks. **The ledger is not the database.** `to_regprocedure` returns null
instead of raising, which is what lets the migration name all six in one run.

`scripts/rollback-moderator-sweep.sql` puts every guard back.

An earlier draft of this document estimated ~3,000 lines of regenerated SQL.
That was before the `fire_tile` precedent turned up; the migration is 290 lines.

### The console

`App.jsx` read one boolean. It now reads two things — `profiles.is_admin` and
`my_moderator_modes()` — and derives `isOrganiser = isAdmin || modModes.length > 0`.
Every place that used to ask "is this an admin?" to decide between the console
and the player screen now asks that instead; the eight of them are one-line
swaps. `isAdmin` itself survives, because `Admin.jsx` still needs to tell the
two apart.

Accounts carries the grant itself: a "Who runs what" section under the
account list, one row per moderator with a tick box per mode and a Save, over
`admin_list_moderators` and `admin_set_moderator_modes`. A player is picked
from a dropdown of everyone who holds nothing yet; unticking a moderator's last
mode is a demotion, so it asks first. Admins never appear in either list,
because `admin_set_moderator_modes` refuses them and `is_admin` already covers
every mode. `supabase/admin/moderators.sql` stays for the case the screen
cannot cover: the first admin, since nothing in the schema sets
`profiles.is_admin`.

`Admin.jsx` takes `isAdmin` and `modes`, and for a moderator:

- the Games list is filtered to the modes they run, so it is the list of games
  they can actually work on;
- New game offers only those modes, and starts on the first one they hold
  rather than always on battleships;
- Suggestions and Accounts are dropped from the tab strip, and a pane
  remembered from an admin session in the same browser falls back to Games;
- the Library stays — a moderator builds boards, so `admin_list_library` and
  `admin_save_library_tile` take `is_admin() or is_moderator()` — but
  "Delete from the catalogue" is not rendered for them, because the catalogue
  is shared with every other organiser.

The console is **not** the security boundary and must not be treated as one —
`App.jsx` already says so: *"is_admin() server-side, so faking this flag buys
nothing."* Hiding a tab is a courtesy to the moderator, not a lock. Every one
of the four points above has a guard behind it that refuses the call anyway.

## Testing

There is one Supabase project and no staging one, so this is tested against the
live database or not at all. Everything below is reversible and touches nothing
a player can see.

### 1. Apply the migration through CI, not by hand

`db-push.yml` has a `workflow_dispatch` trigger. Actions -> "Push database
migrations" -> Run workflow -> branch `feat/moderator-sweep`. The dry-run step
prints the pending migrations before the real push, so the log shows what is
about to happen before it happens.

Do not paste the migration into the SQL editor instead. `supabase db push`
records what it applied in `supabase_migrations.schema_migrations`; the SQL
editor does not. A sweep applied by hand would be run again by CI on merge, and
the second run finds zero copies of the standard guard, raises, and aborts --
a red run on `main` for no reason, since the guards were already swapped.

### 2. Set up a moderator and two throwaway games

Sign up an ordinary account on the site the way a player does; it needs no
special treatment. As an admin, create two throwaway games: one bingo, one
battleships. Note both ids.

Then grant the account **bingo only**, with the snippet from
`supabase/admin/moderators.sql`, so battleships is the mode it must be refused.
Check it took:

```sql
select p.display_name, array_agg(m.mode order by m.mode) as modes
  from moderator_modes m
  join profiles p on p.id = m.profile_id
 group by p.display_name;
```

### 3. Test the guards, with no console in the way

This is the part that matters. The console is a courtesy; the functions are the
control, so test them directly. In the SQL editor, become the moderator for the
length of one transaction and call them. `auth.uid()` reads
`request.jwt.claims`, which is why setting it is enough. Everything is rolled
back, so a guard that wrongly lets something through still changes nothing.

```sql
begin;
set local request.jwt.claims = '{"sub":"<moderator profile id>","role":"authenticated"}';
set local role authenticated;

select is_admin()                  as expect_false;
select is_moderator()              as expect_true;
select may_run_mode('bingo')       as expect_true;
select may_run_mode('battleships') as expect_false;

select may_manage_game('<bingo game id>')       as expect_true;
select may_manage_game('<battleships game id>') as expect_false;

-- expect: ERROR Not your game
select admin_end_game('<battleships game id>');

rollback;
```

Then run the same block with an admin's id in place of the moderator's. Every
line should come back true and `admin_end_game` should be accepted: the sweep
must not have taken anything away from an admin. This is the half that is easy
to forget and the half a user would notice.

### 4. Test the console

A pull request does not deploy -- the `deploy` job in `deploy.yml` only runs on
a push to `main` -- so run the branch locally against the same database:

```
cd web
npm run build && npm run preview
```

`vite build` runs in production mode, so it reads the `VITE_SUPABASE_*` values
already in `.env.production` and no new file is needed. For iterating instead,
a gitignored `web/.env.local` holding those same two values makes `npm run dev`
work.

Signed in as the moderator, expect: a console at all; Games listing the bingo
game and not the battleships one; New game offering bingo alone and starting on
it; no Suggestions and no Accounts tab; a Library that still works but has no
"Delete from the catalogue". Signed in as an admin, expect everything exactly
as it was.

### Undoing it

`scripts/rollback-moderator-sweep.sql` puts every guard back. One wrinkle: it
leaves `supabase_migrations.schema_migrations` alone, so `supabase db push`
goes on considering the sweep applied and will skip it. Delete the row for
`20261025130000` as well if the sweep should be able to go on again afterwards.

`scripts/rollback-moderator-role.sql` then undoes the foundation, if even that
should go.
