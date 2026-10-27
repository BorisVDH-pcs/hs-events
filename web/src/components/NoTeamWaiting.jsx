import { waitingWords } from '../lib/site.js';
import WaitingScreen from './WaitingScreen.jsx';

/**
 * The board modes' way into the holding pen: for a player with no team yet,
 * and — once a game has a scheduled `starts_at` — for one who has a team but
 * whose game has not been opened for placement yet. `assigned` only changes
 * the copy; the countdown itself is identical, because neither case has
 * anything to click on the board yet.
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
 * a name here would be a second place for it to be wrong. A challenge does have
 * one -- its entry is scored on a name snapshotted per event -- which is why
 * that mode draws its own action into the same WaitingScreen rather than
 * coming through here.
 */
export default function NoTeamWaiting({
  gameName, mode, startsAt, assigned = false, teamName,
  signupsOpen = false, signedUp = false, signups = 0, signupBusy = false,
  onSignUp, onLeave,
}) {
  const words = waitingWords(mode);
  // Only where there is something to press. A game past placement has nothing
  // left to put a hand up for, somebody already on a team is being told so
  // rather than asked, and a caller with no handlers to give -- the preview
  // harness, which draws this screen on its own -- gets the plain wording.
  const canSignUp = !assigned && signupsOpen && Boolean(onSignUp) && Boolean(onLeave);

  return (
    <WaitingScreen
      title={words.title}
      gameName={gameName}
      opens={words.opens}
      startsAt={startsAt}
      lead={assigned
        ? words.assigned(teamName ?? 'your team')
        : canSignUp
          ? (signedUp
              ? 'You are on the list. The organiser builds the teams from it before the game starts.'
              : 'The teams have not been made yet. Put your hand up and the organiser will count you in.')
          : "You haven't been placed on a team yet. An admin will assign you once the teams are formed."}
    >
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
    </WaitingScreen>
  );
}
