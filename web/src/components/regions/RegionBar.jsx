import { lineNote } from '../../lib/regions.js';
import './regions.css';

/**
 * A region's progress on one bar that runs to ALL of its points: the fill is
 * what the team has scored, and a white mark stands at the line, where a
 * region completes and earns a pick. The fill is gold up to the mark and
 * green past it, and the stretch of track beyond the mark is tinted, so a
 * glance says both how far the team is and whether it has a pick from here.
 *
 *   region   one entry of fromServer().regions: points, need, total
 *   note     false to leave out the "New region at 5 pts" caption
 */
export default function RegionBar({ region, note = true, className = '' }) {
  const total = Math.max(1, region.total ?? 0);
  const points = Math.min(region.points ?? 0, total);
  const need = Math.min(region.need ?? total, total);
  const at = (need / total) * 100;
  // Where the colour changes, measured along the fill itself.
  const split = points > 0 ? Math.min(100, (need / points) * 100) : 100;
  const caption = note ? lineNote(region) : null;
  return (
    <span className={`regions-bar-wrap ${className}`}>
      <span
        className="regions-bar"
        role="img"
        aria-label={`${points} of ${region.total ?? 0} points; ${need} earns a new region`}
        style={{ '--at': `${at}%`, '--split': `${split}%` }}
      >
        <span className="regions-bar-fill" style={{ width: `${(points / total) * 100}%` }} />
        <span className="regions-bar-mark" />
      </span>
      {caption && <span className={`regions-bar-note${points >= need ? ' reached' : ''}`}>{caption}</span>}
    </span>
  );
}
