import { useEffect, useState } from 'react';
import { myAccounts } from '../lib/supabase.js';
import { groupGames, gameUrgency, splitFinished } from '../lib/homeGames.js';
import { modeLabel } from '../lib/site.js';

/**
 * Where a player lands, and the one screen reachable from everywhere else.
 *
 * WHAT IT REPLACES. Landing used to be decided by invisible state: a
 * localStorage pick per browser, falling back to a ranked `mine[0]`, falling
 * back to the newest game in the whole database. That last step is the one
 * worth naming -- a player who was in nothing at all was shown a stranger's
 * game, with nothing on screen to say that was what had happened. Home makes
 * that case say what it is, and makes the common case explainable: the same
 * player gets the same screen on their phone and their PC, which the stored
 * pick never promised.
 *
 * A LIST, NOT A REDIRECT. It would be one tap cheaper to drop somebody
 * straight into their only running game, and that is exactly the conditional,
 * unexplainable landing this replaces. The active game is the first and
 * largest card instead; one tap, and they can see what they are tapping.
 */
export default function Home({
  games, onPick, displayName, isOrganiser, onConsole, onOpenAccounts,
}) {
  const { mine, open } = groupGames(games);
  const { current, finished } = splitFinished(mine);
  const [accounts, setAccounts] = useState(null);
  const [tab, setTab] = useState('current');

  useEffect(() => {
    myAccounts()
      .then((rows) => setAccounts(rows ?? []))
      .catch(() => setAccounts([]));
  }, []);

  // The one to lead with: running first, then about to run. Within a kind,
  // listMyGames' own order stands -- rostered before entered, newest first --
  // because a new event must not bury the bingo somebody is mid-way through.
  const ordered = [...current].sort((a, b) => gameUrgency(a) - gameUrgency(b));
  const primary = ordered[0] ?? null;
  const rest = ordered.slice(1);

  // One tab is not a choice, so the strip only appears once there is history
  // to go and look at. A player's first season never sees it.
  const showTabs = finished.length > 0;
  const onHistory = showTabs && tab === 'finished';

  const broken = (accounts ?? []).filter((a) => a.wom_found === false);

  return (
    <section className="home">
      <h2 className="home-greeting">
        {displayName ? `Hello, ${displayName}` : 'Hello'}
      </h2>

      {/* ---- Your games ---- */}

      <h3>Your games</h3>

      {showTabs && (
        <div className="tabs home-tabs" role="tablist" aria-label="Your games">
          <button
            role="tab"
            aria-selected={!onHistory}
            className={!onHistory ? 'on' : ''}
            onClick={() => setTab('current')}
          >
            Playing
            <span className="home-tab-count">{current.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={onHistory}
            className={onHistory ? 'on' : ''}
            onClick={() => setTab('finished')}
          >
            History
            <span className="home-tab-count">{finished.length}</span>
          </button>
        </div>
      )}

      {onHistory ? (
        <ul className="home-games">
          {finished.map((g) => (
            <li key={g.gameId}><GameCard game={g} onPick={onPick} /></li>
          ))}
        </ul>
      ) : current.length === 0 ? (
        <p className="muted">
          {/* Three different nothings, and they mean different things. Having
              played a season and having never played are not the same answer
              to "where are my games", and the old single sentence told a
              returning player they were not in anything yet. */}
          {finished.length > 0
            ? 'Nothing running right now — your finished events are under History.'
            : open.length > 0
              ? 'You are not in anything yet. There is something open below — that is the way in.'
              : 'You are not in anything yet. When an organiser starts an event it will show up here.'}
        </p>
      ) : (
        <>
          {primary && <GameCard game={primary} onPick={onPick} lead />}
          {rest.length > 0 && (
            <ul className="home-games">
              {rest.map((g) => (
                <li key={g.gameId}><GameCard game={g} onPick={onPick} /></li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* ---- Open to join ----
          Their own section, not mixed in above. An event you could enter and
          an event you are playing are different offers, and the old header
          dropdown had nowhere to say so. */}

      {open.length > 0 && (
        <>
          <h3>Open to join</h3>
          <ul className="home-games">
            {open.map((g) => (
              <li key={g.gameId}><GameCard game={g} onPick={onPick} invite /></li>
            ))}
          </ul>
        </>
      )}

      {/* ---- Your account ----
          A summary, with the real editing behind the same dialog the
          challenge sign-up field opens. Two ways in, one screen: that one is
          for the moment somebody discovers mid-event that the hiscores are
          not finding them, and this is for the moment they are looking at
          their own page. */}

      <h3>Your accounts</h3>

      {accounts === null ? (
        <p className="muted">Loading…</p>
      ) : accounts.length === 0 ? (
        <p className="muted">
          No RuneScape names saved. Events scored from the hiscores need one, and
          without it Wise Old Man has nothing to look up.
        </p>
      ) : (
        <p className="home-accounts">
          {accounts.map((a) => (
            <span key={a.id} className={a.wom_found === false ? 'rsn-chip bad' : 'rsn-chip'}>
              {a.rsn}{a.is_primary ? ' ★' : ''}
            </span>
          ))}
        </p>
      )}

      {/* Said here because Home is where somebody will actually see it: a name
          WOM never found scores nothing, and the only clue otherwise is a
          ladder entry stuck on zero. */}
      {broken.length > 0 && (
        <p className="error">
          {broken.length === 1
            ? `Wise Old Man has never found ${broken[0].rsn} on the hiscores, so it scores nothing.`
            : `Wise Old Man has never found ${broken.length} of these on the hiscores, so they score nothing.`}
        </p>
      )}

      <div className="row">
        <button className="ghost" onClick={onOpenAccounts}>
          {accounts?.length ? 'Edit my accounts' : 'Add a RuneScape name'}
        </button>
        {isOrganiser && (
          <button className="ghost" onClick={onConsole}>🛠 Organiser console</button>
        )}
      </div>
    </section>
  );
}

/**
 * One game, as a way in rather than a row of facts.
 *
 * The whole card is the button: a card with a button inside it gives a player
 * two targets where they can see one, and the small one is the one that works.
 */
function GameCard({ game, onPick, lead = false, invite = false }) {
  const text = modeLabel(game.mode ?? null);
  const status = game.status === 'active' ? 'Running now'
    : game.status === 'finished' ? 'Finished'
      : 'Not started yet';

  return (
    <button
      type="button"
      className={`home-game${lead ? ' lead' : ''}${invite ? ' invite' : ''}`}
      onClick={() => onPick(game.gameId)}
    >
      <span className="home-game-name">{game.gameName}</span>
      <span className="home-game-meta">
        {text}
        {' · '}{status}
        {game.teamName && <> · {game.teamName}</>}
      </span>
      <span className="home-game-go">
        {invite ? 'Have a look →' : game.status === 'finished' ? 'See the ladder →' : 'Open →'}
      </span>
    </button>
  );
}
