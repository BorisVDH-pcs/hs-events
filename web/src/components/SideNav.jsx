import { modeLabel } from '../lib/site.js';

/**
 * The rail down the left of a wide screen: Home, the game you are in, and the
 * two screens that are not a game.
 *
 * WHY A RAIL AND NOT A MENU BUTTON. The obvious thing to put in the top-left
 * corner is three stripes, and it would be wrong here. A hamburger costs two
 * presses -- open, then choose -- to reach something that already costs one,
 * and it hides the answer to "where am I" behind a press. It earns its keep on
 * a phone, where there is genuinely no room for the choices; on a wide screen
 * it is a way of not using space that is already empty.
 *
 * So this is the opposite trade: on a wide screen the choices are simply
 * there, down the side, saying which one you are on. Below 1100px the rail is
 * hidden by the stylesheet and the header links do the job exactly as before
 * -- on a phone the header IS the hamburger's worth of room.
 *
 * It follows the admin console's sidebar (.admin-nav), which is the same idea
 * on the same site: sticky, one column, the current item filled. That is why
 * there is no rail on the console -- it has its own, and two would be a
 * question about which one moves you.
 */
export default function SideNav({
  onHome, onGame, onAccounts, onConsole,
  atHome, gameName, gameMode, isOrganiser,
}) {
  return (
    <nav className="side-nav" aria-label="Sections">
      <button
        type="button"
        className={atHome ? 'on' : ''}
        aria-current={atHome ? 'page' : undefined}
        onClick={onHome}
      >
        <span className="side-nav-icon" aria-hidden="true">🏠</span>
        <span className="side-nav-text">Home</span>
      </button>

      {/* Only when there is one. An entry that says "no game" would be a dead
          row on the screen of every player between events, and the way to a
          game is the list on Home, not a disabled button. */}
      {gameName && (
        <button
          type="button"
          className={!atHome ? 'on' : ''}
          aria-current={!atHome ? 'page' : undefined}
          onClick={onGame}
        >
          <span className="side-nav-icon" aria-hidden="true">🎮</span>
          <span className="side-nav-text">
            {/* The name, and under it what kind of event it is. Mid-season a
                player is in several, and "Clan Bingo IX" alone does not say
                which of them this rail will take you back to. */}
            <span className="side-nav-name">{gameName}</span>
            <span className="side-nav-sub">{modeLabel(gameMode ?? null)}</span>
          </span>
        </button>
      )}

      <hr className="side-nav-rule" />

      <button type="button" onClick={onAccounts}>
        <span className="side-nav-icon" aria-hidden="true">🧑</span>
        <span className="side-nav-text">My accounts</span>
      </button>

      {isOrganiser && (
        <button type="button" onClick={onConsole}>
          <span className="side-nav-icon" aria-hidden="true">🛠</span>
          <span className="side-nav-text">Organiser console</span>
        </button>
      )}
    </nav>
  );
}
