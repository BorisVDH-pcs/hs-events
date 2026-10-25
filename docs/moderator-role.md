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

**16 take no row id.** These are the decisions, not the mechanics:

| Function(s) | Proposed |
|---|---|
| `admin_new_game`, `admin_create_game` | `may_run_mode(mode)` — the point of the tier |
| `admin_game_readiness` | filter rows to games they may manage, don't refuse |
| `admin_list_library`, `admin_save_library_tile` | moderators may read and save |
| `admin_delete_library_tile`, board presets delete | admin only — shared catalogue |
| `admin_list_tile_submissions`, accept/refuse | admin only — a site-wide queue |
| `admin_set_featured_game` | admin only — it changes the front page |
| `admin_reset_password`, `admin_delete_account`, `admin_list_password_resets`, `admin_list_account_deletions` | admin only, firmly |
| `admin_set_moderator_modes`, `admin_list_moderators` | admin only, by definition |

**And 11 functions that are not `admin_*` at all** consult `is_admin()` as an
organiser escape hatch: `place_fleet`, `start_game`, `rename_team`,
`acting_as_team`, `acting_for_team`, `my_team_in_game`, `evidence_for_team`,
`tiles_for_me`, `tiles_for_team`, `tile_name_key`, `tile_task_key`. A moderator
running a game needs nearly all of these — seeing tile tasks, viewing as a team,
starting the game — so they take `may_manage_game` too.

Total: about 3,000 lines of function bodies to re-emit. They should be generated
from the latest definition in the migration files with the guard line swapped,
not retyped, and reviewed by diffing the guard lines only.

### The console

`App.jsx` reads one boolean today:

```js
.select('is_admin').then(({ data }) => setIsAdmin(Boolean(data?.is_admin)))
```

That becomes a role: admin, moderator with modes, or player. Then in `Admin.jsx`
(2,310 lines) the Games list filters to the modes held, and the Accounts,
Library and Submissions tabs are admin-only.

The console is **not** the security boundary and must not be treated as one —
`App.jsx` already says so: *"is_admin() server-side, so faking this flag buys
nothing."* Hiding a tab is a courtesy to the moderator, not a lock.

## Testing

The SQL cannot be checked locally; there is no local Postgres. Make a throwaway
game of a mode the test moderator holds, and one of a mode they do not, and walk
the console with both accounts. `scripts/rollback-moderator-role.sql` undoes the
foundation; drop the sweep migration first if it has been applied.
