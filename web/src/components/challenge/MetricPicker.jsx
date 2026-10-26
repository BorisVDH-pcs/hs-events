import { useEffect, useState } from 'react';
import { METRIC_GROUPS, WOM_METRICS, metricIcon, searchMetrics } from '../../lib/challenge.js';
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
 * Thirteen have no art at all: Overall, Sailing, the Fractured Archive,
 * Wintertodt, the seven minigames and the two efficiency figures. They get a
 * worded tile at the same size rather than a gap or a stand-in picture of
 * something else -- a tile that admits it has no portrait is honest, and one
 * borrowing an unrelated drawing would be a lie the eye believes.
 *
 * SEARCH ABOVE, GROUPS BELOW IT. With a query the groups step aside and the
 * whole list is searched, because somebody typing "vard" wants Vardorvis and
 * not a reminder that he is filed under Bosses. With the box empty the groups
 * are how you browse, which is the case this control exists for.
 */
export default function MetricPicker({ value, disabled, onChange, onType }) {
  const [group, setGroup] = useState(() => groupOf(value));
  const [query, setQuery] = useState('');

  // Follows a choice made from outside -- the typed escape hatch hands one
  // back, and the grid should not still be showing the group it came from.
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
          Nothing matches that. Wise Old Man may still know it — type its name below.
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

      {/* Still an open set: WOM adds bosses faster than the metric list is
          regenerated, and an event refused for a metric that exists would be
          our fault rather than the organiser's. */}
      <button type="button" className="ghost metric-type" disabled={disabled} onClick={onType}>
        Not here? Type its Wise Old Man name
      </button>
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
          : <span className="metric-choice-word" aria-hidden="true">{initials(metric.name)}</span>}
      </span>
      <span className="metric-choice-name">{metric.name}</span>
    </button>
  );
}

/** Which group a metric sits in, defaulting to where most events start. */
function groupOf(value) {
  return WOM_METRICS.find((m) => m.value === value)?.group ?? 'Bosses';
}

/**
 * A short word for a metric with no picture.
 *
 * Capitals first, because the names that need this mostly carry their own
 * abbreviation already -- Last Man Standing is LMS to everyone who plays it,
 * and EHP is written in the name. A single-capital name falls back to its
 * first two letters so the tile never shows one lonely character.
 */
function initials(name) {
  const caps = name.replace(/[^A-Z]/g, '').slice(0, 3);
  return caps.length > 1 ? caps : name.slice(0, 2).toUpperCase();
}
