import { useCountdown, pad } from '../lib/countdown.js';
import { REPO_URL, waitingWords } from '../lib/site.js';

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});

/**
 * The full-screen holding pen: for a player with no team yet, and — once a
 * game has a scheduled `starts_at` — for one who has a team but whose game
 * has not been opened for placement yet. `assigned` only changes the copy;
 * the countdown itself is identical, because neither case has anything to
 * click on the board yet.
 *
 * The words follow the game's mode (waitingWords): "await orders" is a
 * battleships line, and a bingo player should not be told to man the guns.
 *
 * WHILE SIGN-UPS ARE OPEN THIS IS ALSO THE SIGN-UP SCREEN. It used to say only
 * that an admin would assign them once the teams were formed -- true, but with
 * nothing for the player to do about it, and nothing to tell the organiser they
 * were there to be picked. So the same screen now carries the one button that
 * matters, and keeps the calm of the holding pen around it: one action, said in
 * the words of the state it is in.
 *
 * There is no name field. game_signup_join snapshots profiles.rsn, which is the
 * account they already set as primary on My Account, so a second place to type
 * a name here would be a second place for it to be wrong.
 */
export default function NoTeamWaiting({
  gameName, mode, startsAt, assigned = false, teamName,
  signupsOpen = false, signedUp = false, signups = 0, signupBusy = false,
  onSignUp, onLeave,
}) {
  const remaining = useCountdown(startsAt);
  const words = waitingWords(mode);
  // Only where there is something to press. A game past placement has nothing
  // left to put a hand up for, somebody already on a team is being told so
  // rather than asked, and a caller with no handlers to give -- the preview
  // harness, which draws this screen on its own -- gets the plain wording.
  const canSignUp = !assigned && signupsOpen && Boolean(onSignUp) && Boolean(onLeave);

  const units = [
    ['days', remaining.days, 'Days'],
    ['hours', remaining.hours, 'Hours'],
    ['minutes', remaining.minutes, 'Minutes'],
    ['seconds', remaining.seconds, 'Seconds'],
  ];

  return (
    <section className="waiting" aria-labelledby="waiting-title">
      <div className="waiting-radar" aria-hidden="true"><span /></div>
      <h1 id="waiting-title">{words.title}</h1>
      {gameName && <p className="waiting-game">{gameName}</p>}
      <p className="waiting-lead">
        {assigned
          ? words.assigned(teamName ?? 'your team')
          : canSignUp
            ? (signedUp
                ? 'You are on the list. The organiser builds the teams from it before the game starts.'
                : 'The teams have not been made yet. Put your hand up and the organiser will count you in.')
            : "You haven't been placed on a team yet. An admin will assign you once the teams are formed."}
      </p>
      {canSignUp && (
        <div className="waiting-signup">
          <button
            className={signedUp ? 'ghost' : undefined}
            disabled={signupBusy}
            onClick={signedUp ? onLeave : onSignUp}
          >
            {signedUp ? 'Take me out' : 'Sign me up'}
          </button>
          {signups > 0 && (
            <p className="waiting-signup-count">
              {signups} signed up so far
            </p>
          )}
        </div>
      )}
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
            : `${words.opens} ${DATE_FORMAT.format(new Date(startsAt))}`}
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
