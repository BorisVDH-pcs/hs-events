import { useEffect, useState } from 'react';
import { myAccounts } from '../lib/supabase.js';
import { groupGames, gameUrgency, splitFinished, bySoonest } from '../lib/homeGames.js';
import { modeLabel } from '../lib/site.js';
import { metricIcon, metricInitials, metricLabel, rankedLabel } from '../lib/challenge.js';
import { useCountdown, pad } from '../lib/countdown.js';
import TileIcon from './TileIcon.jsx';

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
 *
 * ONE EVENT LEADS, THE REST ARE A GRID. The first version of this screen gave
 * every event the same small card and gave the accounts list more weight than
 * any of them, on a page whose whole subject is events. A player opening the
 * app has one question -- what is there to do -- and the answer is one event,
 * so it is drawn once at full size with its artwork, what it is scored on, the
 * clock and the way in. Everything else is a card underneath it.
 *
 * AND THE LEAD CAN BE AN EVENT THEY ARE NOT IN. `mine[0]` was the only
 * candidate before, so a player in nothing led with a sentence apologising for
 * it while the thing to do sat in a small card below. An open event takes the
 * lead when there is nothing of their own to put there: it is the way in,
 * which is what a landing screen is for.
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

  // Theirs: running first, then about to run. Within a kind, listMyGames' own
  // order stands -- rostered before entered, newest first -- because a new
  // event must not bury the bingo somebody is mid-way through.
  const ordered = [...current].sort((a, b) => gameUrgency(a) - gameUrgency(b));
  // Open: soonest first. Every open event is in the same state, so urgency
  // cannot separate two of them and the clock is what does.
  const invites = [...open].sort(bySoonest);

  // Theirs if they have one, otherwise the next thing starting. Deliberately
  // not tied to the tabs below: which list is on screen is a question about
  // history, and the lead answers what to do now.
  const lead = ordered[0] ?? invites[0] ?? null;
  const mineRest = ordered.filter((g) => g !== lead);
  const openRest = invites.filter((g) => g !== lead);

  // One tab is not a choice, so the strip only appears once there is history
  // to go and look at. A player's first season never sees it.
  const showTabs = finished.length > 0;
  const onHistory = showTabs && tab === 'finished';
  const list = onHistory ? finished : mineRest;

  const broken = (accounts ?? []).filter((a) => a.wom_found === false);

  return (
    <section className="home">
      <h2 className="home-greeting">
        {displayName ? `Hello, ${displayName}` : 'Hello'}
      </h2>

      {/* ---- The lead ---- */}

      {lead ? (
        <>
          <p className="home-eyebrow">
            {lead.status === 'active' ? 'Now playing' : 'Next up'}
          </p>
          <LeadCard game={lead} onPick={onPick} />
        </>
      ) : (
        <p className="muted home-empty">
          {/* Two nothings, where there used to be three. The third -- "there
              is something open below" -- was a sentence pointing at a card
              four inches down the page, and that card is the lead now, so the
              case cannot arise. These two are still different answers and
              still need different words: a season behind you and never having
              played are not the same thing. */}
          {finished.length > 0
            ? 'Nothing running right now — your finished events are under History.'
            : 'You are not in anything yet. When an organiser starts an event it will show up here.'}
        </p>
      )}

      {/* ---- Your games ---- */}

      {(list.length > 0 || showTabs) && (
        <>
          <div className="home-section-head">
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
          </div>

          {list.length > 0 ? (
            <ul className="home-games">
              {list.map((g) => (
                <li key={g.gameId}><GameCard game={g} onPick={onPick} /></li>
              ))}
            </ul>
          ) : (
            <p className="muted home-empty">
              The one above is everything you are in right now.
            </p>
          )}
        </>
      )}

      {/* ---- Open to join ----
          Their own section, not mixed in above. An event you could enter and
          an event you are playing are different offers, and the old header
          dropdown had nowhere to say so. */}

      {openRest.length > 0 && (
        <>
          <div className="home-section-head"><h3>Open to join</h3></div>
          <ul className="home-games">
            {openRest.map((g) => (
              <li key={g.gameId}><GameCard game={g} onPick={onPick} /></li>
            ))}
          </ul>
        </>
      )}

      {/* ---- Your accounts ----
          A strip on a hairline rather than a third section of cards. It is
          reference, not something to do, and it used to carry more weight on
          this page than any of the events -- which on a screen whose whole
          subject is events is the wrong way round. The real editing is behind
          the same dialog the challenge sign-up field opens: two ways in, one
          screen. */}

      <div className="home-strip">
        <h3>Your accounts</h3>
        {accounts === null ? (
          <p className="muted">Loading…</p>
        ) : accounts.length === 0 ? (
          <p className="muted">
            No RuneScape names saved — events scored from the hiscores need one.
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
        <span className="home-strip-links">
          <button className="link" onClick={onOpenAccounts}>
            {accounts?.length ? 'Edit my accounts' : 'Add a RuneScape name'}
          </button>
          {/* The rail carries this too, but only above 1400px. Below that
              width Home is the only way to the console, so it stays. */}
          {isOrganiser && (
            <button className="link" onClick={onConsole}>Organiser console</button>
          )}
        </span>
      </div>

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
    </section>
  );
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});

/**
 * The event to do something about, at the size of the decision it is.
 *
 * Everything on it is already in the list Home is given. challenge_list and
 * game_signup_list have always returned the start time, the metric and the
 * count; games.js simply dropped them on the floor. So this card costs no
 * migration and no second read -- it just stops throwing away the facts that
 * decide whether somebody signs up tonight.
 *
 * The whole card is the button, as the small ones are. The pill at the bottom
 * is a span that looks like one: a real button inside a button is two targets
 * where a player can see one, and the small one is the one that works.
 */
function LeadCard({ game, onPick }) {
  const remaining = useCountdown(game.startsAt ?? null);
  const status = cardStatus(game);
  const score = game.mode === 'challenge' ? metricLabel(game.metric) : null;
  // Only while it is still ahead. A clock sitting at zero over a game that is
  // already running says nothing, and a countdown under a finished one is a
  // lie.
  const counting = remaining.set && !remaining.started
    && game.status !== 'active' && game.status !== 'finished';

  const units = [
    ['days', remaining.days, 'Days'],
    ['hours', remaining.hours, 'Hours'],
    ['minutes', remaining.minutes, 'Minutes'],
    ['seconds', remaining.seconds, 'Seconds'],
  ];

  const when = whenLine(game);

  return (
    <button
      type="button"
      className={`home-lead ${status.tone}`}
      onClick={() => onPick(game.gameId)}
    >
      {/* The words first and the artwork after them, so that every line on
          the card -- status, name, score, meta, clock, pill, footer -- starts
          at the same left edge. With the art in front, these three began 5rem
          further right than the four blocks below them, and a card with two
          left edges reads as leaning rather than as aligned. */}
      <span className="home-lead-head">
        <span className="home-lead-words">
          <span className={`home-game-status ${status.tone}`}>{status.text}</span>
          <span className="home-lead-name">{game.gameName}</span>
          {score && <span className="home-lead-score">{score}</span>}
        </span>
        <span className="home-art lead"><GameArt game={game} /></span>
      </span>

      <span className="home-lead-meta">{metaLine(game)}</span>

      {counting && (
        <span
          className="countdown home-countdown"
          aria-label={`Starts in ${remaining.days} days, ${remaining.hours} hours, ${remaining.minutes} minutes, and ${remaining.seconds} seconds`}
        >
          {units.map(([key, value, label]) => (
            <span className="countdown-unit" key={key}>
              <span className="countdown-value">{key === 'days' ? value : pad(value)}</span>
              <span className="countdown-label">{label}</span>
            </span>
          ))}
        </span>
      )}

      <span className="home-lead-cta">{ctaWords(game)}</span>
      {when && <span className="home-lead-when">{when}</span>}
    </button>
  );
}

/**
 * One game, as a way in rather than a row of facts.
 *
 * The whole card is the button: a card with a button inside it gives a player
 * two targets where they can see one, and the small one is the one that works.
 */
function GameCard({ game, onPick }) {
  const status = cardStatus(game);
  const score = game.mode === 'challenge' ? metricLabel(game.metric) : null;
  const when = whenLine(game);

  return (
    <button
      type="button"
      className={`home-game${status.tone === 'open' ? ' invite' : ''}`}
      onClick={() => onPick(game.gameId)}
    >
      <span className="home-art"><GameArt game={game} /></span>
      {/* Lifted out of the middle of the meta line. Somebody scanning five
          cards is looking for the live one, and a coloured dot answers that
          faster than a word buried between two middle dots. */}
      <span className={`home-game-status ${status.tone}`}>{status.text}</span>
      <span className="home-game-name">{game.gameName}</span>
      <span className="home-game-meta">{score ?? metaLine(game)}</span>
      {when && <span className="home-game-when">{when}</span>}
    </button>
  );
}

/**
 * A picture on every card, because a page about events with none on it reads
 * as a page of settings.
 *
 * A challenge has a real one: the boss, skill, raid or tier of clue it is
 * scored on, the same artwork its board and its sign-up screen already show.
 * The four board modes have no single subject to draw -- a bingo is ninety
 * tiles -- so they get a drawn mark of the game itself, rather than one tile's
 * picture pretending to stand for the whole event.
 */
function GameArt({ game }) {
  if (game.mode === 'challenge') {
    const label = metricLabel(game.metric);
    return (
      <TileIcon
        slug={metricIcon(game.metric)}
        fallback={(
          <span className="home-art-word" aria-hidden="true">
            {label ? metricInitials(label) : '?'}
          </span>
        )}
      />
    );
  }
  return (
    <svg className="home-art-mark" viewBox="0 0 24 24" aria-hidden="true">
      {MODE_MARKS[game.mode] ?? MODE_MARKS.default}
    </svg>
  );
}

/* Drawn rather than borrowed: one stroke weight, no fill, so the four of them
   read as one set at card size and at lead size. */
const MODE_MARKS = {
  battleships: (
    <>
      <circle cx="12" cy="12" r="7.4" />
      <circle cx="12" cy="12" r="2.3" />
      <path d="M12 2.2v3.6M12 18.2v3.6M2.2 12h3.6M18.2 12h3.6" />
    </>
  ),
  bingo: (
    <>
      <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="2.6" />
      <path d="M3.2 9.07h17.6M3.2 14.93h17.6M9.07 3.2v17.6M14.93 3.2v17.6" />
    </>
  ),
  snakes: (
    <>
      <path d="M7.2 2.8v18.4M16.8 2.8v18.4" />
      <path d="M7.2 7.4h9.6M7.2 12h9.6M7.2 16.6h9.6" />
    </>
  ),
  territory: (
    <>
      <path d="M12 2.6 20.4 7.3v9.4L12 21.4 3.6 16.7V7.3Z" />
      <path d="M12 11.5 20.4 7.3M12 11.5 3.6 7.3M12 11.5v9.9" />
    </>
  ),
  default: (
    <>
      <path d="M6 21.4V3" />
      <path d="M6 4h12.6l-2.7 4 2.7 4H6" />
    </>
  ),
};

/**
 * What state the event is in, as a dot and a word or two.
 *
 * "Open to join" is its own answer rather than a shade of "not started": an
 * event you could enter and one you are already in are different offers, and
 * the card's border says so too.
 */
function cardStatus(game) {
  if (game.status === 'active') return { text: 'Running', tone: 'live' };
  if (game.status === 'finished') return { text: 'Finished', tone: 'done' };
  if (game.teamId === null && game.joined !== true) return { text: 'Open to join', tone: 'open' };
  if (game.teamId === null && game.joined === true) return { text: 'You are in', tone: 'joined' };
  return { text: 'Not started', tone: 'soon' };
}

/**
 * What pressing the card does, said before it is pressed.
 *
 * Deliberately not the wording on the sign-up screen's own button: this card
 * opens that screen, it does not enter anybody. A label one press short of
 * what it promises is a promise broken.
 */
function ctaWords(game) {
  // "Ranking", not "ladder": #65 renamed it everywhere a challenge says it,
  // and only challenge files were in that rename. This card was saying the
  // old word about the same screen.
  if (game.status === 'finished') return 'See the ranking →';
  if (game.teamId === null && game.joined !== true) return 'Sign up →';
  if (game.status === 'active') return 'Play →';
  return 'Open it →';
}

/**
 * The line under the name: what kind of event it is, in its own words.
 *
 * A challenge says how it is run and what it is scored on, which is what makes
 * two of them different from each other -- "Challenge" is the one thing every
 * challenge card would say identically. A board mode says its mode and the
 * team, which is all there is to say.
 */
function metaLine(game) {
  const parts = game.mode === 'challenge'
    ? [
        game.solo === true ? 'Everyone for themselves'
          : game.solo === false ? 'Teams' : null,
        rankedOn(game),
      ]
    : [modeLabel(game.mode), game.teamName];
  // A challenge whose setup row never arrived has neither, and a card saying
  // nothing at all is worse than one saying only what mode it is.
  return parts.filter(Boolean).join(' · ') || modeLabel(game.mode);
}

/**
 * Where the number comes from.
 *
 * NOT `ranked by <the metric>` for a hiscores event, which is what
 * rankedLabel would answer: the metric is already the gold line above, and
 * naming it twice in two lines says nothing the second time. What a player
 * does not know yet is whether a figure is read for them or typed in by them,
 * and that is the difference these two answers draw.
 *
 * rankedLabel still owns the declared case, so the words for an event with no
 * label set are decided in one place rather than two.
 */
function rankedOn(game) {
  if (!game.rankedBy) return null;
  if (game.rankedBy === 'wom') return 'ranked on the hiscores';
  return `ranked by ${rankedLabel({
    ranked_by: game.rankedBy,
    declared_label: game.declaredLabel,
  })}`;
}

/**
 * How many are in, and when it starts: the two facts that decide whether
 * somebody signs up tonight, and the two the cards used to leave out.
 *
 * `starts_at` is nullable and plenty of events never get one, so this is
 * routinely half a line or none at all -- which is why every caller checks
 * before drawing a row for it.
 */
function whenLine(game) {
  const parts = [];
  if (game.signups > 0) parts.push(`${game.signups} signed up`);
  if (game.startsAt && game.status !== 'finished') {
    const at = new Date(game.startsAt);
    if (!Number.isNaN(at.getTime())) {
      parts.push(`${at.getTime() > Date.now() ? 'starts' : 'started'} ${DATE_FORMAT.format(at)}`);
    }
  }
  return parts.join(' · ');
}
