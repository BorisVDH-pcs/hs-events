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
assertion aborts the whole migration. 57 assertions in total: 50 standard
guards, 5 reworded ones (`start_game`, `admin_board_for_team`, `place_fleet`,
`rename_team`, `acting_as_team`), and 2 for `admin_game_readiness`, which
filters its rows rather than refusing.

Of the 61 functions carrying the standard guard, 50 are swapped and 11 stay
admin-only by the decisions above. None is unaccounted for.

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

The SQL cannot be checked locally; there is no local Postgres. Make a throwaway
game of a mode the test moderator holds, and one of a mode they do not, and walk
the console with both accounts. `scripts/rollback-moderator-role.sql` undoes the
foundation; drop the sweep migration first if it has been applied.
