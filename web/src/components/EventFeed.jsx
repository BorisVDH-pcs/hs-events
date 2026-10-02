import { fromPosition, coordLabel } from '../lib/board.js';
import { evidenceEventText, revokedProgressText } from '../lib/eventText.js';
import { snakesEventText } from '../lib/snakes.js';

/**
 * The live feed. Most event types never name a tile: `game_events` is readable
 * by both teams, and the tile grid is shared, so those payloads deliberately
 * carry only `tile_id`/`position`.
 *
 * The team-private types are the exception — the RLS policy on `game_events`
 * lets only the owning team (and admins) read them, so by the time one reaches
 * this component it is safe to show the tile name. Which types those are is a
 * question for the server, answered per row by `team_private`; see
 * `audienceTag` below for why this component no longer keeps its own list.
 *
 * Note that a payload can be redacted at the source rather than at the tag:
 * `shot_withdrawn` is global precisely because it carries no square, tile or
 * drop to give away (20260918172658).
 */
/**
 * Whether this line is readable by both teams or only by the team it happened
 * to, as **the server** answered it — `board_for_me` stamps every event with
 * `team_private` from the same `is_team_private_event()` the RLS policy uses
 * (20260918173107).
 *
 * This used to be a hand-written Set here, mirroring that function with nothing
 * keeping the two in step, and it drifted the first time it mattered:
 * `evidence_revoked` was added to the function and missed in the Set, so
 * revokes were tagged [GLOBAL] on a screen where the database was correctly
 * hiding them from the other team. Nothing leaked — the label was wrong, not
 * the gating — but a label that calls a private thing public gets acted on the
 * same way a leak does.
 *
 * An unmarked event renders **no tag at all**. That only happens against a
 * server too old to stamp the field, and the whole point of this change is to
 * stop guessing: no tag is honest, and a guessed one is what caused the bug.
 */
function audienceTag(e) {
  if (typeof e.team_private !== 'boolean') return null;
  return e.team_private ? '[TEAM]' : '[GLOBAL]';
}

export default function EventFeed({ events, teams, myTeamId }) {
  const teamName = (id) => teams.find((t) => t.id === id)?.name ?? 'Someone';

  function describe(e) {
    const who = teamName(e.team_id);
    const mine = e.team_id === myTeamId;
    const at = e.payload?.position
      ? coordLabel(fromPosition(e.payload.position).row, fromPosition(e.payload.position).col)
      : null;

    // Snakes and Ladders words its own events (tiles are numbered 1-100, not
    // lettered); anything it does not word falls through to the lines below.
    const snakes = snakesEventText(e, who);
    if (snakes) return snakes;

    switch (e.type) {
      case 'fleet_placed':
        // Hull count only — the payload deliberately carries no cells.
        return `${who}'s fleet is set.`;
      case 'team_renamed':
        return `${e.payload?.old_name ?? 'A team'} is now ${e.payload?.new_name ?? who}.`;
      case 'game_started':
        return e.payload?.mode === 'bingo'
          ? 'The bingo has begun — every tile is open.'
          : 'The game has begun — fleets are locked.';
      case 'tile_completed':
        // Public: the bingo card is open to everyone, so naming the tile gives
        // nothing away.
        return `${who} completed ${e.payload?.tile_name ?? 'a tile'}${at ? ` at ${at}` : ''}`
          + ` — ${e.payload?.tiles_completed}/${e.payload?.tiles_total} tiles.`;
      case 'game_ended': {
        const p = e.payload ?? {};
        if (!e.team_id) return p.reason === 'time_up'
          ? "Time's up! No tiles were completed, so nobody wins."
          : 'The organiser ended the game. No tiles were completed, so nobody wins.';
        if (p.reason === 'full_card') return `${who} filled the whole card and wins the bingo!`;
        return `${p.reason === 'time_up' ? "Time's up!" : 'The organiser ended the game.'}`
          + ` ${who} wins with ${p.tiles_completed}/${p.tiles_total} tiles.`;
      }
      case 'tile_claimed':
        return `${who} locked in a tile${at ? ` at ${at}` : ''}.`;
      case 'tile_relocked':
        // Team-private, so it may name the tile. It is a separate type from
        // tile_claimed precisely so it can be: a second global "locked in at
        // H5" for a square already announced once is a tell that something was
        // rolled back there.
        return `${e.payload?.by_name ?? who} locked ${e.payload?.tile_name ?? 'a tile'}`
          + `${at ? ` at ${at}` : ''} back in.`;
      case 'shot_withdrawn':
        // The only thing the other team is told about a revoke. Everything
        // that would identify the square — position, tile name, drop, result —
        // is deliberately absent from the payload, not merely unused here.
        return `One of ${who}'s shots has been withdrawn by an organiser.`;
      case 'claim_released':
        // Says an organiser did it, because a tile going back on the board with
        // no explanation reads like a bug to whoever is watching the feed.
        return `An admin released ${who}'s tile${at ? ` at ${at}` : ''}.`;
      case 'shot_fired':
        return `${who} fired${at ? ` at ${at}` : ''} — ${e.payload?.result === 'hit' ? 'HIT' : 'miss'}.`;
      case 'ship_sunk':
        return `${who} sank a ${e.payload?.size}-tile ship!`;
      case 'game_won':
        return `${who} wins — the enemy fleet is gone.`;
      case 'game_reset':
        if (e.payload?.mode === 'bingo') return 'The bingo has been reset — every tile is open again.';
        return e.payload?.fleets_cleared
          ? 'The game has been reset — fleets need placing again.'
          : 'The game has been reset. Fleets are unchanged.';
      case 'evidence_submitted': {
        // The drop's name is tile content, and safe here only because this
        // event type is one the RLS policy scopes to the submitting team
        // (0035, restated in 0046). It must never reach a global line.
        return evidenceEventText(e.payload, who);
      }
      case 'evidence_revoked': {
        // Names the tile and the drop, and is safe for the same reason
        // evidence_submitted is: team-scoped by the RLS policy. The team is
        // told what to do next, because a screenshot disappearing with no
        // explanation reads like the site losing their evidence.
        const p = e.payload ?? {};
        const what = p.option_label ? ` (${p.option_label})` : '';
        const undone = [
          p.unfired && (p.parked
            ? 'The shot has been taken back and the tile is unlocked — lock it in again to finish it.'
            : 'The shot has been taken back and the tile is active again.'),
          p.uncompleted && 'The tile is no longer complete.',
          p.ship_refloated && 'A ship is no longer sunk.',
          p.game_reopened && 'The game has been reopened.',
          p.winner_changed && 'The winner has changed.',
        ].filter(Boolean).join(' ');
        return `An admin withdrew ${p.submitted_by_name ?? who}'s submission for `
          + `${p.tile_name ?? 'a tile'}${what} — now ${revokedProgressText(p)}.`
          + (undone ? ` ${undone}` : '');
      }
      case 'pet_jar_submitted': {
        // Team-private, worded as the Discord relay words it.
        const p = e.payload ?? {};
        return `${p.submitted_by_name ?? who} submitted a pet/jar — ${p.pet_jar_count} pet jar`
          + ` preview${p.pet_jar_count === 1 ? '' : 's'} now.`;
      }
      case 'pet_jar_spent': {
        // Team-private, so it may name the tile the preview revealed.
        const p = e.payload ?? {};
        return `A pet jar preview was spent on ${p.tile_name ?? 'a tile'}${at ? ` at ${at}` : ''}`
          + ` — ${p.pet_jar_count} left.`;
      }
      case 'pet_jar_revoked': {
        // Team-private, so it may name the previewed tile it took back.
        const p = e.payload ?? {};
        const preview = p.preview_withdrawn
          ? ` and the preview of ${p.tile_name ?? 'a tile'}${at ? ` at ${at}` : ''}`
          : '';
        return `An admin withdrew ${p.submitted_by_name ?? who}'s pet/jar submission${preview}`
          + ` — ${p.pet_jar_count} pet jar preview${p.pet_jar_count === 1 ? '' : 's'} now.`;
      }
      case 'slot_freed':
        // ring_revealed: a sinking proved a locked-in square is water, so the
        // server dropped the lock-in and revealed the miss (20260927120000).
        if (e.payload?.reason === 'ring_revealed') {
          return `The tile${at ? ` at ${at}` : ''} is water next to the sunk ship — `
            + 'its lock-in was cleared. Lock in another target.';
        }
        return 'An active tile is available now. Lock in another target.';
      default:
        // A type nobody has worded yet. Readable beats a raw enum label; the
        // fix is a case above.
        return `${who}: ${String(e.type).replaceAll('_', ' ')}.`;
    }
  }

  // A game runs over days and each line only carries a time, so a heading goes
  // in wherever the day changes: "Today", "Yesterday", then "Fri 2 Oct".
  const now = new Date();
  const rows = [];
  let lastDay = null;
  for (const e of events) {
    const when = new Date(e.created_at);
    const day = when.toDateString();
    if (day !== lastDay) {
      // The key carries the event too: a day can head the list twice if the
      // events ever arrive out of order, and React needs the keys unique.
      rows.push(<li key={`day-${e.id}`} className="feed-day">{dayLabel(when, now)}</li>);
      lastDay = day;
    }
    rows.push(
      <li key={e.id} className={e.team_id === myTeamId ? 'mine' : 'theirs'}>
        <time dateTime={e.created_at} title={when.toLocaleString()}>{when.toLocaleTimeString()}</time>
        {audienceTag(e) && <span className="tag">{audienceTag(e)}</span>}
        <span>{describe(e)}</span>
      </li>,
    );
  }

  return (
    <section className="feed" id="event-feed-section">
      <h2>Activity</h2>
      <ul>
        {rows}
        {events.length === 0 && <li className="muted">Nothing has happened yet.</li>}
      </ul>
    </section>
  );
}

function dayLabel(when, now) {
  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  // Rounded, because a day across a clock change is 23 or 25 hours long.
  const daysAgo = Math.round((midnight(now) - midnight(when)) / 86400000);
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return when.toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    ...(when.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}
