import { useCountdown, pad } from '../lib/countdown.js';
import { REPO_URL } from '../lib/site.js';

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});

/**
 * The room every mode waits in before its game opens: the radar, the name of
 * what you are waiting for, the clock, and the one thing there is to do while
 * it runs.
 *
 * ITS OWN COMPONENT BECAUSE A CHALLENGE WAITS HERE TOO. A challenge used to
 * wait on its own screen -- a head card, a sign-up card and an empty ranking,
 * stacked in the ordinary layout -- and the difference was not a decision
 * anybody made, it was just two screens written at different times. "The same
 * as the bingo one" is not a promise two separately maintained files can keep,
 * so the screen is one file and the modes pass in what differs.
 *
 * What differs is the words and the action. Everything a player recognises --
 * where the clock sits, how big the title is, what the footer says -- is here,
 * which is the whole point: change it once and every mode changes with it.
 */
export default function WaitingScreen({
  title, art, gameName, subtitle, lead, opens, startsAt, children,
}) {
  const remaining = useCountdown(startsAt);

  const units = [
    ['days', remaining.days, 'Days'],
    ['hours', remaining.hours, 'Hours'],
    ['minutes', remaining.minutes, 'Minutes'],
    ['seconds', remaining.seconds, 'Seconds'],
  ];

  return (
    <section className="waiting" aria-labelledby="waiting-title">
      <div className="waiting-radar" aria-hidden="true"><span /></div>
      {/* The event's own face, inside the radar's sweep. A challenge is a
          week of one boss, one skill or one tier of clue, and the picture
          says which of them faster than any name does. The modes with a
          board have nothing to put here and pass nothing, rather than
          having a crest invented for them. */}
      {art && <div className="waiting-art">{art}</div>}
      <h1 id="waiting-title">{title}</h1>
      {gameName && <p className="waiting-game">{gameName}</p>}
      {/* What the event actually is, for the modes that have something to say
          here. A challenge is a week of one boss or one skill, and the name of
          that boss is the first thing a player wants off this screen. */}
      {subtitle && <p className="waiting-sub">{subtitle}</p>}
      <p className="waiting-lead">{lead}</p>

      {/* The one action, between the explanation and the clock: read why you
          are here, do the thing, then watch the time. */}
      {children}

      {remaining.set && (
        <div className="countdown" aria-live="polite" aria-label={remaining.started ? 'Start time reached' : `Starts in ${remaining.days} days, ${remaining.hours} hours, ${remaining.minutes} minutes, and ${remaining.seconds} seconds`}>
          {units.map(([key, value, label]) => (
            <div className="countdown-unit" key={key}>
              <span className="countdown-value">{key === 'days' ? value : pad(value)}</span>
              <span className="countdown-label">{label}</span>
            </div>
          ))}
        </div>
      )}
      <p className="waiting-launch">
        <span className="launch-marker" aria-hidden="true">◆</span>
        {!remaining.set
          ? 'An admin will announce a start time soon.'
          : remaining.started
            ? 'Standing by for an admin to start the game.'
            : `${opens} ${DATE_FORMAT.format(new Date(startsAt))}`}
      </p>
      <footer className="waiting-credits">
        <span>
          High Society platform created by{' '}
          <span className="waiting-creator">BludgenMaker</span>{' '}
          and{' '}
          <span className="waiting-creator">Soft Papi</span>
        </span>
        <a
          className="waiting-star"
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
        >
          <span aria-hidden="true">★</span>
          Star on GitHub
        </a>
      </footer>
    </section>
  );
}
