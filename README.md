# High Society Events

Clan events for Old School RuneScape, run in a browser. Players get a task, go
and do it in game, and send a screenshot; the site keeps score live and tells
the Discord channel what happened.

**[borisvdh-pcs.github.io/hs-events](https://borisvdh-pcs.github.io/hs-events/)**

It began as one game — Battleships — and now runs five kinds of event on the
same accounts, the same tile catalogue and the same organiser's console. An
organiser picks the kind when they create it.

## The five kinds of event

| | In one line | Rules |
|---|---|---|
| **Battleships** | Two teams, hidden fleets, one shot per tile. | [rules](docs/battleships-rules.md) |
| **Bingo** | Any number of teams on one card. Most tiles wins. | [rules](docs/bingo-rules.md) |
| **Snakes & Ladders** | Teams race up a 100-tile board, snakes and all. | [rules](docs/snakes-and-ladders-rules.md) |
| **Territory** | Teams take ground on the OSRS map. Biggest empire wins. | [rules](docs/territory-rules.md) |
| **Challenge** | No board. Boss, raid or skill of the week. | [rules](docs/challenge-mode.md) |

**Battleships.** Two teams, each hiding a fleet on one shared grid of tasks. You
fire by picking a square, doing the task behind it and sending the evidence —
whether that is a hit depends only on whether a hull is under it. No turn order,
two squares at a time, and the first team to sink the other fleet wins.

**Bingo.** One card, 3×3 up to 10×10, the same for every team. Every square is
open from the moment the organiser starts the game — no claiming, no order, no
limit on how many a team works at once. One point each, most squares wins, and a
tie goes to whoever got there first.

**Snakes & Ladders.** A hundred squares. Finish the task you are standing on,
then roll — any player on the team may do it, and the die is rolled on the
server. Snake heads drop you to the tail, ladder feet lift you to the top, and
squares your team has already done are skipped automatically. Overshooting 100
bounces you back down. A team stuck on a task it does not want can spend a
**rollback** — earned the first time it finishes a square at 40 or above — and
slide backwards onto a different one. First team to *finish* square 100 wins:
landing on it is not enough.

**Territory.** The real Old School map, 64 real places, played like Risk. A team
takes a place by finishing the task on it, and can only reach out from land it
already holds. The biggest empire at the end wins.

**Challenge.** No board and no tiles. Boss, raid, clue or skill of the week:
everybody signs up with their RuneScape name, Wise Old Man counts the hiscores,
and a ladder ranks whoever gained the most. Some events are won on loot instead,
where players send the figure in with a screenshot either side of it. A challenge
takes a start time and an end time and **runs itself** — it opens when the start
comes round and settles shortly after the end, so nobody has to be awake to let
it begin.

## For players

- **Signing in is a username and a password.** There is no email anywhere, so
  there is also no self-service password reset — an organiser sets a new one
  from the console.
- **Home** is where you land: your events with the one that needs you first,
  anything open to join, a Finished tab once you have some history, and a
  warning if one of your names is not being found.
- **My accounts**, on the side rail and beside a challenge's sign-up field, is
  where your RuneScape names live. Wise Old Man matches on the exact name, so
  an event that counts the hiscores finds you only if what is on the list is
  what is in game. If a name has never been found, the site says so in red while
  there is still time to fix it, rather than scoring you zero for a week.
- **Sending evidence** is a drag, a paste or a file. Screenshots are kept
  privately and only an organiser, and your own team, can see them.
- **Suggest a tile** is in the header. You fill in the same form the board
  builder uses and can follow what happens to it; an organiser accepts it into
  the catalogue, possibly after an edit, or refuses it with a note you can read.

## For organisers

The console is the same whichever kind of event you are running.

- **Games** creates one and picks its kind.
- **Configure** holds the board builder, the teams, the roster and the Discord
  webhooks. A setup checklist tells you what is still missing — two teams with
  placed fleets for battleships, a full card and a player on every team for
  bingo, tasks on every place for territory — and the Start button waits until
  the list is clear.
- **Track** shows the live boards, the evidence log and, for a challenge, the
  ladder with the figures behind it.
- **Suggestions** is the queue of tiles players have proposed.
- **Accounts** creates players, resets a password, and hands out moderator
  rights.

A **moderator** is given one or more kinds of event to run. They can do
everything an organiser does within those, and nothing outside them: see
[docs/moderator-role.md](docs/moderator-role.md).

A wrong submission can be taken back one screenshot at a time, rather than
scrapping the whole tile, and the dialog shows exactly what will happen before
it does it — including undoing a sinking or reopening a finished match. The
other team is told only *that* a shot was withdrawn, never which square.

## Running it yourself

```bash
npm install --prefix web
```

Copy `.env.example` to `web/.env` and fill in `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. The rest is optional: without `VITE_IMGBB_API_KEY`
everything still works, the Discord posts just carry no picture. Then:

```bash
npm run dev --prefix web
```

The dev server is on **port 5174**, so it can sit beside HighSocietyScape on
5173.

Most screens can also be looked at **with no database at all**.
`npm run preview:evidence --prefix web` starts a harness on port 5176 that swaps
the Supabase client for canned data, with a page per screen —
`/preview-home.html`, `/preview-admin.html`, `/preview-bingo.html`,
`/preview-snakes.html`, `/preview-territory.html`, `/preview-challenge.html`,
`/preview-evidence.html`, `/preview-login.html` and `/preview-app.html`. They
show what the screens look like. They prove nothing about the rules, which live
in the database.

`npm run test:all --prefix web` runs the self-tests. For the database side,
paste `scripts/bingo-smoke-test.sql` into the Supabase SQL editor: it plays
three small games through the real functions as throwaway accounts and then
rolls everything back. The editor reports the result as an error on purpose —
that error text is the pass/fail report, and nothing is saved.

## How it is built

| Layer | Choice |
|---|---|
| Database | Supabase (Postgres) — one migration per change, in `supabase/migrations/` |
| The rules | Postgres functions, not the browser |
| Live updates | Supabase Realtime on the event feed |
| Frontend | Vite + React |
| Notifications | A Discord relay driven off the same feed |
| Hosting | GitHub Pages, built on every push to `main` |

**The rules live in the database because some of them are secrets.** Ship
placement, the contents of a tile nobody has claimed, another team's
screenshots: if the browser knew them, a player could read them. So the browser
is never told, and every move goes through a function on the server that checks
it. That is also why the harnesses above prove nothing — they have no server to
refuse them.

There is **no scheduler**. Nothing fires by itself; the page that is open calls
an idempotent function when its own countdown reaches zero, and every page after
it is a no-op. That is how a bingo's end time, the Wise Old Man figures and a
challenge's start and finish all work.

Deeper detail lives in [docs/](docs/): the shape of the whole thing in
[architecture.md](docs/architecture.md), how a tile decides it is finished in
[v4-handover.md](docs/v4-handover.md), and a rules sheet per mode.

## Two settings that have to be right

> **GitHub → Settings → Pages → Source** must be **GitHub Actions**, not "Deploy
> from a branch". `dist/` is gitignored, so branch mode serves this README
> instead of the site.

> **Supabase → Authentication → Sign In / Providers → Email → Confirm email**
> must be **off**. Usernames are mapped to an address at a reserved `.invalid`
> domain that can never receive mail, so a confirmation email would fail and
> take the sign-up down with it.

The Supabase URL and anon key are committed in `web/.env.production` on purpose:
Vite builds them into the bundle, so they are public the moment the site is
served either way. Row Level Security and the server-side functions are what
protect the data, not the secrecy of that key.

Migrations reach the live project through CI when they land on `main`. Don't
apply them by hand — that leaves the migration ledger out of step with the
database.

## Built by

- [iftach21](https://github.com/iftach21)
- [BorisVDH-PCS](https://github.com/BorisVDH-pcs)
