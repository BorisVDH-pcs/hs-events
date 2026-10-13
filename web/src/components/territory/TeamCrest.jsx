import { markerColor } from '../../lib/snakes.js';

/**
 * A team's shield: the same crest that marks its home on the map, so the
 * standings, the place panel and the map all point at one another. With no
 * slot it is a plain, uncoloured shield -- free land.
 */
export default function TeamCrest({ slot, label, size = 18 }) {
  const fill = slot ? markerColor(slot) : 'rgba(120, 120, 128, .35)';
  return (
    <svg
      className="team-crest"
      width={size} height={size * 1.18}
      viewBox="-12 -12.6 24 28.4"
      aria-hidden="true"
    >
      <path
        d="M-10.5 -11H10.5V1.5Q10.5 10 0 14.6Q-10.5 10 -10.5 1.5Z"
        fill={fill}
        stroke="#ffdf95" strokeWidth="1.8"
      />
      {label && (
        <text x="0" y="1.4" textAnchor="middle" dominantBaseline="central" fontSize="12.5" fontWeight="800" fill="#111">
          {label}
        </text>
      )}
    </svg>
  );
}
