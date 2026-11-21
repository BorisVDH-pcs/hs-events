# RuneLite plugin — plan

Written 2026-11-20, from Boris's question whether High Society Events could
work with a RuneLite plugin, starting with Region Bingo. **Status: a plan.
Nothing here is built, and nothing is decided.** Proposals are marked
**(proposed)**; the choices that are Boris's to make are collected in
section 10.

First drafts of the server side, with their tests, are in `runelite-plugin/`;
its README says what is tested and what is not. The drafts are ahead of the
SQL sketches below where the two differ.

**In one line:** a drop a player gets in game is matched to their team's open
tiles and handed in as evidence with its screenshot, without the player
opening the site; and what happens in the game (a tile done, a region
complete, time running out) shows up in the game client.

The reason this is a small change and not a new system: every tile in every
mode is completed through one function, `add_evidence`, and every moment worth
a pop-up is already a row in `game_events`. The plugin is a second way to call
the first and a second reader of the second. No game rule moves.

---

## 1. Is it allowed

Yes, inside three fences.

- **Jagex.** RuneLite is an approved client. Jagex's third-party client
  guidelines ban four kinds of feature: boss-fight aids, menu changes,
  interface changes (moving or resizing click zones, unhiding components) and
  interacting with the world from a detached camera. Reading your own loot,
  drawing an information overlay and talking to a web server are none of
  those. The list says it is not exhaustive, so anything that starts to look
  like one of the four is out.
- **RuneLite's Plugin Hub.** A plugin reaches players only through the Hub,
  after review by RuneLite's developers. What they will not accept, as far as
  it touches us: anything but Java; reflection, native code, running other
  programs, or downloading code at run time; plugins that crowdsource data
  about *other* players; plugins that put text in the chat input. Extra
  libraries slow the review down, so use the HTTP client and JSON library the
  client already ships. The repository must be public, and the Hub's guide
  has you add a BSD 2-Clause licence.
- **Precedent.** This exact idea is already on the Hub more than once:
  BingOSRS (a bingo id and a player token; detects the drops a team needs,
  takes a screenshot, submits it), Lucky Clan Bingo, DropTracker, and Dink,
  which sends loot, collection log, pet, kill count and clue notifications
  with a screenshot to any server you name.

What follows from the fences, for the design:

- The plugin only ever sends data about **the player who installed it**. No
  names of raid partners, no nearby players.
- It **never acts in the game**. It reads, draws and notifies.
- Pop-ups carry **event information only** (scores, regions, time). Nothing
  about how to do a tile, and nothing on screen during a boss fight that could
  be read as a mechanic aid.
- The plugin must say plainly that it sends data to a server RuneLite does not
  control. Other Hub plugins with their own server carry that warning.

---

## 2. Two ways in, and why Dink comes first

| | Dink (existing Hub plugin) | Our own plugin |
|---|---|---|
| Who writes it | Nobody. Players install Dink and paste a URL | We do, in Java |
| Hub review | None | Yes, and how long it takes is not ours to say |
| Drops as evidence, with screenshot | Yes | Yes |
| Collection log, pets, kill count, clues | Yes, Dink already detects them | We would write each detector |
| Knows which drops the team needs | No. It sends everything over a GP threshold, and the server throws away what no tile wants | Yes. It fetches a watch list and only screenshots a match |
| Pop-ups in game | No. Dink is one-way | Yes |
| Side panel with regions and progress | No | Yes |
| Asking the player "which tile is this for?" | No | Yes |

Dink posts each notification to a URL the player types in: JSON when there is
no image, `multipart/form-data` when there is, with the JSON in a part called
`payload_json` and the screenshot in a part called `file`. A loot notification
lists each item's id, name, quantity and price, the source, and the player's
name. That is everything the site needs to match a drop.

So automatic evidence does not have to wait for a plugin of our own. **Build
the server side once, let Dink be its first client, and write our plugin as
its second (proposed).** The server work is the same either way; only the
shape of what arrives differs.

---

## 3. Where it fits in Region Bingo

| Moment | Today | With the plugin | The hook that is already there |
|---|---|---|---|
| A player gets a drop a tile lists | Screenshot, open the site, find the tile, pick the drop, upload | Submitted by itself, with the screenshot | `regions_open_tile` then `add_evidence(claim, path, url, option, amount)` |
| Which drop is it | The player picks an option | Matched on the item's name; the points still come from the option, server-side | `tile_options.label`, `evidence_refusal` |
| Is the region open | `add_evidence` refuses a tile in an unopened region | Same refusal. The watch list never contains a locked region's tiles | `tiles_for_team`, which `regions_tile_visible` already filters |
| Whose account was it | An organiser reads the name in the screenshot | The in-game name is checked against the player's own account list | `profile_accounts`, `rsn_key()` |
| When did it happen | Unknown: a screenshot has no date | The server knows when it arrived | `games.ends_at` check in `add_evidence` |
| Team progress on a tile | The site and the team's Discord channel | A pop-up: "Barrows chest: 3 of 5" | `evidence_submitted` (team-private, names the tile) |
| Tile completed | Feed and Discord | A pop-up: "Barrows chest completed: +5" | `tile_completed` |
| Region reached x% | Feed and Discord | A pop-up: "Misthalin complete. Your team can pick a new region" | `region_completed`, and `picks` in `regions_state` |
| Captain has not picked the first region | The team waits | A reminder to the captain at login | `needs_start` and `is_captain` in `regions_state` |
| A screenshot is revoked | Feed | A pop-up to that team | `evidence_revoked` |
| Time running out | The site's timer | "One hour left", "Ten minutes left" | `games.ends_at`, counted in the plugin |
| Where am I, and what is open here | The site's map | A side panel: open regions, points against the threshold, tiles and progress; "You are in Morytania: 4 open tiles" | `regions_state`; `areas.json` outlines |
| Reviewing evidence | Every screenshot looks the same | Rows say where they came from, with item, source, world and time | `admin_evidence_sources` (new, beside `admin_list_evidence`), `EvidenceReview.jsx` |

The location hint is cheap. `areas.json` draws the 11 regions in map-image
pixels, and the image is one pixel per game square (`MAP` in
`territoryWorld.js`: game x = pixel x + 1016, game y = 4160 − pixel y). It
only works on the surface. Underground and inside a raid the player's
coordinates are nowhere near the map.

### What stays on the website

- **Picking a region.** Rule 11 asks for a confirmation that names the region,
  and a pick cannot be undone. The plugin tells the team it has a pick and
  opens the site. A plugin token cannot spend one (section 4.2).
- **Building boards, review, revoke, rosters.** Organiser work.
- **Uploading by hand.** Mobile and the official client have no plugins. The
  manual route stays exactly as it is, and stays the fallback when a match
  fails.

### Tiles that are not a drop

A tile today is "screenshots against a list of drops". A kill-count, clue or
XP tile is a tile with no drops that needs a number of screenshots, so there
is nothing for a machine to match on. Automating those needs a small new idea,
a *trigger* on the tile (what kind, of what, how many), and belongs in a later
phase. Two notes for then:

- For **XP and kill counts**, Wise Old Man is the better witness. It reads the
  hiscores, a player's client cannot talk it round, and Challenge mode already
  speaks to it.
- **Pets and collection log slots** are announced by the game in chat. Dink
  already turns both into notifications.

**Decided, 2026-11-21:** for now only Dink's Loot and Pet notifications are
read. A tile that needs any other evidence is handed in on the site, as today.

---

## 4. How it would be built: the server

### 4.1 One door

A single Supabase Edge Function, `intake`, is the only thing the outside world
talks to **(proposed)**. It does four things and decides nothing:

1. Reads the plugin token (section 4.2) and the request: Dink's
   `payload_json` and `file`, or our plugin's JSON.
2. Asks the database what the drop matches (4.4).
3. If it matches, stores the screenshot in the `evidence` bucket under the
   usual path, `{game}/{team}/{claim}/{uuid}`.
4. Calls the database to register it (4.5).

**This would be the project's first Edge Function.** Until now everything has
been Postgres: the Discord relay is `pg_net`, and the imgbb mirror exists
because nothing server-side could mint a signed URL. An Edge Function is
needed here because Dink sends a multipart upload that PostgREST cannot read,
and because the storage policies only let a signed-in team member write. It
means a `supabase/functions/` folder and a deploy job beside `db-push.yml`,
using the secrets that job already has.

The rules still live in the database. The function holds the service-role key
and uses it for two things only: writing the image, and calling the `plugin_*`
functions below, which are granted to `service_role` and nobody else.

### 4.2 Plugin tokens

The plugin must never hold a player's password, and a Dink URL is typed into a
settings box and can leak like a Discord webhook URL can. So a token is its
own thing: made on **My Account**, shown once, revocable, and able to do far
less than a login.

```sql
-- Sketch, not a migration.
create table plugin_tokens (
  id           uuid        primary key default gen_random_uuid(),
  profile_id   uuid        not null references profiles(id) on delete cascade,
  token_hash   text        not null unique,   -- sha256 of the token; the token itself is never stored
  label        text        check (label is null or char_length(label) <= 40),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
alter table plugin_tokens enable row level security;   -- and no policies: functions only
```

| Function | Who | Does |
|---|---|---|
| `plugin_token_create(label)` | the player | Makes `hse_` + 32 random bytes, stores the hash, answers the token **once**. At most 5 live tokens per player |
| `plugin_token_list()` | the player | Label, created, last used. Never the token |
| `plugin_token_revoke(id)` | the player; an organiser for anybody | Sets `revoked_at` |

The token exists in exactly one reply, the same arrangement as WOM's
verification code in `challenge_wom`. `pgcrypto` lives in the `extensions`
schema on hosted Supabase (see `20260925120000`), so it is
`extensions.digest(...)`.

**What a token can do** is whatever the `plugin_*` functions do, and nothing
else: read the holder's watch list and feed, and hand in evidence for the
holder's own team. It cannot pick a region, edit accounts, or reach any
`admin_*` function. That holds for an organiser's token too.

### 4.3 Acting as the player, without a second copy of the rules

`add_evidence`, `regions_open_tile`, `tiles_for_team` and `regions_state` all
ask `auth.uid()` who is calling. Rewriting them to take a profile id would
mean a second body for each, and this codebase patches functions in place
precisely so there is never a second body.

Instead, one internal function turns a token into "this request is that
player" **(proposed)**. It is what `smoke_as` does in the smoke tests:

```sql
-- Sketch. Internal: execute revoked from everybody, called by the plugin_* functions as their owner.
create function plugin_as(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid;
begin
  update plugin_tokens
     set last_used_at = now()
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and revoked_at is null
  returning profile_id into v_profile;
  if v_profile is null then
    raise exception 'Unknown or revoked plugin token';
  end if;

  -- For the rest of this request, auth.uid() is that player, so every existing
  -- check runs unchanged. Local to the transaction: it ends with the request.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_profile, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_profile::text, true);
  -- No act-as-team through this door, whoever the token belongs to.
  perform set_config('request.headers', '{}', true);
  return v_profile;
end;
$$;
```

This is the part to prove first, on a spare project, with a smoke test of its
own: a token for a Red player must not be able to read or write anything of
Blue's, and a revoked token must do nothing.

### 4.4 The watch list, and matching a drop

```sql
-- Sketch. Granted to service_role only.
create function plugin_watchlist(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := plugin_as(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'game_id', g.id,  'game', g.name,  'mode', g.mode,  'ends_at', g.ends_at,
      'team_id', te.id, 'team', te.name,
      'regions', regions_state(g.id, te.id),
      'tiles', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'tile_id',  t.id,          'name',     t.name,
                 'position', t.position,    'region',   regions_region_at(t.position),
                 'rule',     t.completion,  'per_set',  t.per_set,
                 'required', t.required_evidence,
                 'have',     t.evidence_count, 'points', t.evidence_points,
                 'options',  t.options) order by t.position), '[]'::jsonb)
          from tiles_for_team(g.id, te.id) t
         where t.revealed
           and t.claim_status is distinct from 'completed')))
      from games g
      join teams te        on te.game_id = g.id
      join team_members tm on tm.team_id = te.id and tm.profile_id = v_me
     where g.status = 'active' and g.mode = 'regions'
  ), '[]'::jsonb);
end;
$$;
```

It is built on `tiles_for_team`, so the region secrecy comes along for
nothing: a tile in a region the team has not opened is not in the answer, and
no new code decides that.

**Matching is by name (proposed).** A drop option is free text
(`tile_options.label`, "Dharok's helm", "Fire cape"), and the options are
*copied* from the catalogue onto a board, through the board builder, the
random deal, saved boards and tile swaps. An item-id column would have to be
carried through every one of those. A name needs nothing carried:

- `drop_key(text)`, a normaliser in the manner of `rsn_key`: lower case,
  spacing collapsed, curly apostrophes straightened.
- A drop matches an option when `drop_key(item name) = drop_key(label)`. Both
  Dink and the game client give the item's proper name.
- For labels that are not one item ("Any godsword shard", "Any Barrows
  piece"), a small dictionary keyed on the label: `drop_aliases (label_key,
  item_name_key)`. Because it is keyed on the text, it survives the copying.
- The board builder shows, beside each drop, whether it will be recognised. A
  label nobody can match is not an error. It only means that drop is handed in
  by hand.

**What happens to a drop (proposed):**

1. No open tile of the team's lists it: nothing is stored, nothing is kept.
2. Exactly one open tile lists it, and `evidence_refusal` has no objection (a
   repeat cap, a set already taken): it is submitted.
3. More than one tile lists it: the plugin does not guess. With Dink, the team
   gets a private feed line asking the player to hand it in on the site. With
   our own plugin, the side panel asks which tile and then submits.
4. The in-game name is not on the player's account list: refused, with a
   private line telling the player to add the account under My Account.
5. One drop is one piece of evidence, whatever the quantity, as one screenshot
   is today.

A `value` tile (worth typed in tenths of a million) has no drop list, so it is
not matched automatically. See section 9, phase 3.

### 4.5 Handing it in

```sql
-- Sketch. Granted to service_role only.
create function plugin_submit(
  p_token text, p_tile_id uuid, p_option_id uuid,
  p_storage_path text, p_public_url text, p_detail jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := plugin_as(p_token);
  v_claim uuid;
begin
  -- Opens the tile for the team exactly as the first screenshot does on the
  -- site, and refuses a region the team has not opened.
  v_claim := regions_open_tile(p_tile_id);

  -- Read by a before-insert trigger on tile_evidence, so add_evidence stays
  -- word for word what it is, and the row is still written once and never updated.
  perform set_config('hs.evidence_source', coalesce(p_detail ->> 'source', 'plugin'), true);
  perform set_config('hs.evidence_detail', p_detail::text, true);

  return add_evidence(v_claim, p_storage_path, p_public_url, p_option_id, null);
end;
$$;
```

The storage path contains the claim id, and the claim does not exist until the
tile is opened, so in practice `intake` makes two calls: one that opens the
tile and answers the claim, then the upload, then this.

Two columns on `tile_evidence` **(proposed)**: `source` (`web`, `dink` or
`plugin`, default `web`) and `detail` (item, quantity, where it came from,
world, in-game name). The review screen shows them.

**As built, 2026-11-21:** not through `admin_list_evidence`. Changing what it
returns means dropping and re-creating it, and its live body has been rewritten
in place since (20261025130000), so a copy in a draft could drift from it.
Instead draft 002 adds `admin_evidence_sources(game)`: the id, `source` and
`detail` of every row that did not come from the site, behind the same
`may_manage_game` gate and the same "Not your game". The review screen lays
them onto its rows by id. An upload from the site is unchanged and has no
label.

**The label is "sent by plugin", not "verified".** The data comes from a
client the player controls. Somebody who would fake a screenshot today could
fake a request tomorrow. Every row keeps its screenshot, and the revoke button
works on it like on any other.

A small log, `plugin_intake_log` (who, when, what arrived, what it matched,
what was done), does two jobs. It drops the duplicate when Dink retries after
a network error, and it answers "why didn't my drop count".

### 4.6 The feed, for pop-ups

Our own plugin asks one question on a timer: what is new since my last
answer? `plugin_poll(token, since)` returns the events the player may read,
under the same rule as the `events_read` policy (public, or private to the
caller's own team), each with a line of text ready to show.

- **The words come from `discord_line`**, with Discord's markup stripped. A
  third copy of the wording, in Java, would drift from the site and from
  Discord the way `EventFeed.jsx`'s hand-written Set once did.
- A tile is named only when the team can see it, by the test `tiles_for_team`
  uses.
- Once a minute, only while the player is logged in to the game and has an
  active event. Twenty players for four hours a day is under 5,000 calls a
  day.

Custom messages from the console ("Event starts in ten minutes") would be one
new event type, `announcement`, written by an `admin_announce` function on
`may_manage_game`, and one new `discord_line` case. Plain text, a length cap,
no links: text pushed from a server into the game is exactly what a Hub
reviewer will look at hardest.

---

## 5. How it would be built: our own plugin

Its own public repository **(proposed: `hs-events-plugin`)**, made from
RuneLite's plugin template. Java, no extra libraries.

| Part | Does |
|---|---|
| Settings | The token (masked), and switches: pop-ups on or off, which kinds, submit drops automatically or ask first |
| Watch list | Fetched at login and after every submission; kept in memory only |
| Drop listener | On the client's loot events, checks each item's name against the watch list. Nothing matches: nothing leaves the computer |
| Screenshot | Taken only for a match, shrunk to 1600px JPEG before upload, as the site does to stay inside the bucket's 3 MB |
| Submit | Posts to `intake`; shows the answer ("Barrows chest: 3 of 5") |
| Side panel | Regions with points against the threshold, open tiles and their progress, a button that opens the game on the site |
| Pop-ups | An overlay box the player can move, a chat line, or a desktop notification, by the player's choice |

RuneLite's API has what each row needs: loot events
(`LootReceived`, `NpcLootReceived`, `ServerNpcLoot`), overlay and side-panel
classes, and a notifier. Those names are from the API documentation as it
stood in November 2026; check them when building.

To reach players: a pull request to `runelite/plugin-hub` naming the
repository and a commit, then review. Players can run it before that only from
a development build, so testing during review is a job for one or two people,
not for the clan.

---

## 6. The two secrets, and this plan

`architecture.md` names two secrets. The second is the one a plugin could
break: a team must not learn tiles it has not earned sight of. In Region Bingo
that is every tile in a region the team has not opened.

- The watch list is `tiles_for_team`. There is no other source of tile names.
- A drop for a tile in a locked region matches nothing, so the answer is the
  same as for a drop no tile wants. The response must not differ between "no
  such tile" and "a tile you cannot see yet", in words or in timing.
- Feed lines go through the same audience rule as the site.
- Storage paths stay ids only.
- Other modes inherit this from the same function. Battleships is the one to
  watch: its secret is tighter, and it is not part of this plan's first phases.

---

## 7. Other modes

`add_evidence` is shared, so the door works for all of them, but automatic is
not always right. A per-game switch, `games.plugin_evidence`
**(proposed: on by default for Region Bingo and Bingo, off elsewhere)**.

| Mode | Automatic evidence |
|---|---|
| Region Bingo, Bingo | Yes. Own progress, no claim step, nothing to give away |
| Snakes & Ladders | Yes, for the tile the team stands on, which `add_evidence` already enforces |
| Territory | Not by default. The first screenshot on a rival's place is announced to its owner, and a plugin would make that announcement for the team |
| Battleships | No. The last screenshot fires the shot, and when to fire is the team's decision |
| Challenge | Different shape: a declared loot total, not tiles. Later |

---

## 8. Limits and risks

- **Not everybody can use it.** No plugins on mobile or the official client.
  Manual upload stays, and the plugin must never become a requirement.
- **Plugin data can be forged.** See 4.5.
- **Screenshot size.** Dink sends images of up to 8 MB, usually PNG; the
  `evidence` bucket takes 3 MB, and `evidence.js` already budgets for a 1 GB
  free tier. `intake` must shrink what Dink
  sends or refuse it. Whether an Edge Function can re-encode an image inside
  its CPU allowance is the second thing to prove.
- **Edge Function allowance.** Check the free tier's monthly call count
  against 4.6's polling before choosing the interval.
- **The token is in the Dink URL**, so it may appear in the function's request
  log. It is narrow and revocable, and Dink offers no other place to put it.
- **Not every drop is a loot event.** Rewards that land in the inventory or
  the bank, pets, and some minigame rewards reach the client differently. Go
  through the Region Bingo catalogue once and mark which tiles a plugin will
  see.
- **Loot Tracker.** The richest loot event comes from RuneLite's own Loot
  Tracker plugin, which a player can switch off.
- **Hub review.** Unknown length, and the rules change. Ask in RuneLite's
  Discord before writing much Java.

---

## 9. Phases

**Phase 0: prove the two unknowns.** On a spare Supabase project:
`plugin_as` with a smoke test (4.3), and an Edge Function that receives a real
Dink loot notification and stores a shrunken screenshot.

**Phase 1: automatic drops through Dink.** Tokens and the My Account screen
for them; `intake`; `drop_key`, matching and the alias dictionary;
`plugin_submit`; `source` and `detail` on evidence and in the review screen;
the per-game switch; a rules line in `region-bingo-rules.md`; a setup page for
players (install Dink, paste this URL). This is the whole of "evidence
submission is not needed any more" for drop tiles, with no Hub review.

**Phase 2: our own plugin.** `plugin_watchlist` and `plugin_poll`; the plugin
with side panel, pop-ups and its own drop submission; Hub submission. Dink
keeps working beside it.

**Phase 3: the rest.** The "which tile?" chooser; `announcement`; pets and
collection log slots as tile triggers; `value` tiles priced by the server from
the item id, not by a number the client sends; the location hint; the other
modes, one at a time.

---

## 10. Decisions for Boris

1. **Dink first, or straight to our own plugin?** Proposed: Dink first.
2. **An Edge Function in the project.** It is the first, and a new thing to
   deploy and watch. Proposed: yes; there is no way to receive Dink without
   one.
3. **Does a matched drop count at once, or wait for the player to confirm?**
   Proposed: at once, since uploading already counts at once and revoke
   exists.
4. **A drop from before the team opened the region.** Today nothing stops a
   player saving a screenshot and uploading it later. The plugin knows the
   time. Proposed: it only submits for tiles open at that moment, and banks
   nothing.
5. **The same drop on two open tiles.** Proposed: the player chooses; the
   plugin never does.
6. **Which modes, and the default of the per-game switch** (section 7).
7. **Organiser announcements as in-game pop-ups.** Wanted, or noise?
8. **May an organiser require plugin evidence for a tile?** Proposed: no.
   Mobile players could never complete it.
9. **The name on the Hub.** The plugin is public: anybody can install it, and
   it does nothing without a token from the site.
10. **A drop on a Leagues or other seasonal world.** **Decided, 2026-11-21:**
    it does not count. The intake ignores it, and our own plugin must do the
    same.
11. **Which Dink notifications.** **Decided, 2026-11-21:** Loot and Pet only.
    A collection log or clue notification often repeats a drop already sent
    as loot, so reading it could count one drop twice. Any other evidence is
    handed in on the site.

---

## Sources

Checked 2026-11-20.

- Jagex, [Third-party client guidelines](https://secure.runescape.com/m=news/third-party-client-guidelines?oldschool=1)
- RuneLite, [Plugin Hub: creating and submitting a plugin](https://github.com/runelite/plugin-hub)
- RuneLite wiki, [Rejected or rolled-back features](https://github.com/runelite/runelite/wiki/Rejected-or-Rolled-Back-Features)
- RuneLite wiki, [Developer guide](https://www.github.com/runelite/runelite/wiki/Developer-Guide)
- RuneLite, [client events in the API documentation](https://static.runelite.net/runelite-client/apidocs/net/runelite/client/events/package-summary.html)
- Dink, [README](https://github.com/pajlads/DinkPlugin) and [what a custom server receives](https://github.com/pajlads/DinkPlugin/blob/master/docs/json-examples.md)
- Hub plugins doing the same job, on a third-party listing of the Hub: [BingOSRS](https://the-plugin-exchange.vercel.app/plugins/bingosrs), [Lucky Clan Bingo](https://the-plugin-exchange.vercel.app/plugins/lucky-clan-bingo), [DropTracker](https://the-plugin-exchange.vercel.app/plugins/droptracker)
