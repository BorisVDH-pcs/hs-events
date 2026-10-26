import { useEffect, useState } from 'react';
import {
  METRIC_GROUPS, WOM_METRICS, metricIcon, metricInitials, searchMetrics,
} from '../../lib/challenge.js';
import TileIcon from '../TileIcon.jsx';

/**
 * What the event counts, chosen by looking at it.
 *
 * This replaced a `<select>` of 114 lines. A dropdown is the right control for
 * a list you already know the answer in -- and nobody knows this one: an
 * organiser deciding what to run this week is browsing, not retrieving, and a
 * list of names in a scrolling box is the worst possible shape for browsing.
 * "Zulrah" is a word; the snake is a picture they recognise without reading.
 *
 * THE ARTWORK IS THE TILE ARTWORK. `public/icons` is already 276 drawings
 * because the bingo boards need them, and a boss is a boss whichever mode is
 * asking -- so this costs no new art and gains whatever lands there next.
 * metricIcon() maps the names that differ and checks the generated manifest,
 * so a metric is never drawn as a broken image.
 *
 * Two have no art: EHP and EHB are Wise Old Man's own arithmetic, not things
 * in the game, so there is nothing to draw. They get a worded tile at the same
 * size rather than a gap or a stand-in picture of something else -- a tile
 * that admits it has no portrait is honest, and one borrowing an unrelated
 * drawing would be a lie the eye believes.
 *
 * SEARCH ABOVE, GROUPS BELOW IT. With a query the groups step aside and the
 * whole list is searched, because somebody typing "vard" wants Vardorvis and
 * not a reminder that he is filed under Bosses. With the box empty the groups
 * are how you browse, which is the case this control exists for.
 *
 * THE LIST IS THE WHOLE SET. A box under the grid used to take a name the list
 * did not carry, for the weeks between Wise Old Man adding a boss and the list
 * being brought up to date. It is gone, so an event counts what WOM_METRICS
 * holds and nothing else: a metric they know and this does not is added there,
 * in lib/challenge.js, rather than typed past the grid here.
 */
export default function MetricPicker({ value, disabled, onChange }) {
  const [group, setGroup] = useState(() => groupOf(value));
  const [query, setQuery] = useState('');

  // Follows the value the form holds, so the grid opens on the group that
  // choice sits in rather than on whichever one is the default.
  useEffect(() => { setGroup(groupOf(value)); }, [value]);

  const searching = query.trim().length > 0;
  const shown = searching
    ? searchMetrics(query)
    : WOM_METRICS.filter((m) => m.group === group);

  return (
    <div className="metric-picker">
      <input
        type="search"
        className="metric-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${WOM_METRICS.length} things to count`}
        aria-label="Search what is counted"
        disabled={disabled}
      />

      {!searching && (
        <div className="metric-groups" role="tablist" aria-label="Kind of metric">
          {METRIC_GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={g === group}
              className={`metric-group${g === group ? ' on' : ''}`}
              disabled={disabled}
              onClick={() => setGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="muted metric-empty">
          Nothing matches that — try a shorter word.
        </p>
      ) : (
        <div className="metric-grid">
          {shown.map((m) => (
            <MetricTile
              key={m.value}
              metric={m}
              on={m.value === value}
              disabled={disabled}
              onPick={() => onChange(m.value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MetricTile({ metric, on, disabled, onPick }) {
  const slug = metricIcon(metric.value);
  return (
    <button
      type="button"
      className={`metric-choice${on ? ' on' : ''}`}
      aria-pressed={on}
      disabled={disabled}
      onClick={onPick}
      title={metric.label}
    >
      <span className="metric-choice-art">
        {slug
          ? <TileIcon slug={slug} fallback={null} />
          : <span className="metric-choice-word" aria-hidden="true">{metricInitials(metric.name)}</span>}
      </span>
      <span className="metric-choice-name">{metric.name}</span>
    </button>
  );
}

/** Which group a metric sits in, defaulting to where most events start. */
function groupOf(value) {
  return WOM_METRICS.find((m) => m.value === value)?.group ?? 'Bosses';
}

