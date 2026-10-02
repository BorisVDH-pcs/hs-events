import { markerColor } from '../../lib/snakes.js';

/**
 * A team's marker as it sits beside the team's name -- in the standings, the
 * Start row, the organiser's tables: the colour and the letter of its token on
 * the board, so a reader can match the two without a legend. The letter comes
 * from teamInitials, worked out once for every team in the game.
 */
export default function TeamDot({ slot, label }) {
  return (
    <span className="team-dot" style={{ background: markerColor(slot) }} aria-hidden="true">
      {label}
    </span>
  );
}
