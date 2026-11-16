import { useCallback, useEffect, useRef, useState } from 'react';
import { adminSetRegionThreshold, adminSetTileWorth, adminTileWorths } from '../../lib/supabase.js';
import { REGIONS, boardProblems, builderRegions, needFor, pts } from '../../lib/regions.js';
import CardHead from '../CardHead.jsx';
import TileIcon from '../TileIcon.jsx';

const MIN = 1;
const MAX = 100;
// How long a run of + and − presses waits before it is saved. Each press is a
// write otherwise, and five quick presses would be five round trips racing to
// land in order.
const SETTLE_MS = 450;

const clamp = (n) => Math.min(MAX, Math.max(MIN, n));
const whole = (text) => (/^\s*\d+\s*$/.test(String(text)) ? Number(text) : NaN);

/**
 * Region Bingo's points step: what every tile scores, and the line -- the x%
 * of a region's points that completes it and earns a pick.
 *
 * Its own tab rather than a column in the board builder, because the builder
 * is about WHICH tasks and this is about HOW MUCH: two decisions an organiser
 * makes at different moments, and a hundred squares with a stepper in each
 * would be a screen doing both badly.
 *
 * Every change saves on its own (admin_set_tile_worth, one tile at a time), as
 * the builder does, so a half-priced board is a real, resumable thing. The
 * server refuses both writes once the game has started; this says so up front
 * and draws the numbers read-only instead.
 *
 * admin_list_tiles does not carry `worth`, so the points are read beside the
 * tiles (admin_tile_worths) -- only while this tab is open, since the builder
 * re-reads the tiles on every square it fills.
 */
export default function RegionPoints({ game, tiles, active = true, onSaved }) {
  const editable = game.status === 'setup' || game.status === 'placement';
  const savedLine = game.region_threshold ?? 50;

  // position -> saved worth, as the server holds it.
  const [worths, setWorths] = useState(() => new Map());
  const [loadError, setLoadError] = useState(null);
  // Nothing is drawn until the saved points are in: a + pressed against the
  // stand-in 1 would save 2 over a tile that is really worth 5.
  const [loaded, setLoaded] = useState(false);
  // position -> the text in that tile's field, while it differs from saved.
  const [drafts, setDrafts] = useState(() => new Map());
  // position -> why its last save was refused.
  const [rowErrors, setRowErrors] = useState(() => new Map());
  const [saving, setSaving] = useState(() => new Set());

  const [line, setLine] = useState(savedLine);
  const [lineBusy, setLineBusy] = useState(false);
  const [lineError, setLineError] = useState(null);
  const [lineNote, setLineNote] = useState(null);
  useEffect(() => { setLine(savedLine); }, [savedLine]);

  // Read by saves that land after a newer render, so they compare against
  // what is saved now rather than what was saved when the press happened.
  const worthsRef = useRef(worths);
  worthsRef.current = worths;
  const timers = useRef(new Map());
  // One save at a time per tile, in the order they were asked for.
  const queues = useRef(new Map());

  // Keyed on which tile sits where, not on the array: the builder hands a new
  // array on every refresh, and only a placed, cleared or moved tile can
  // change what the points are.
  const tileKey = tiles.map((t) => `${t.id}:${t.position}`).join(',');

  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    adminTileWorths(game.id)
      .then((rows) => {
        if (!live) return;
        setWorths(new Map((rows ?? []).map((r) => [Number(r.position), Number(r.worth)])));
        setLoaded(true);
        setLoadError(null);
      })
      .catch((err) => { if (live) setLoadError(err.message); });
    return () => { live = false; };
  }, [active, game.id, tileKey]);

  const setIn = (setter, key, value) => setter((prev) => {
    const next = new Map(prev);
    if (value === undefined) next.delete(key); else next.set(key, value);
    return next;
  });

  const save = useCallback((position, value) => {
    const run = async () => {
      if (!Number.isInteger(value) || value < MIN || value > MAX) {
        setIn(setRowErrors, position, `A tile is worth ${MIN} to ${MAX} points.`);
        return;
      }
      if (worthsRef.current.get(position) === value) {
        setIn(setDrafts, position, undefined);
        setIn(setRowErrors, position, undefined);
        return;
      }
      setSaving((prev) => new Set(prev).add(position));
      try {
        await adminSetTileWorth(game.id, position, value);
        setIn(setWorths, position, value);
        setIn(setRowErrors, position, undefined);
        // Only if nobody has typed something newer in the meantime.
        setDrafts((prev) => {
          if (whole(prev.get(position)) !== value) return prev;
          const next = new Map(prev);
          next.delete(position);
          return next;
        });
      } catch (err) {
        // Back to what is saved, with the reason beside it: a number that
        // was refused must not sit in the field looking accepted.
        setIn(setRowErrors, position, err.message);
        setIn(setDrafts, position, undefined);
      } finally {
        setSaving((prev) => {
          const next = new Set(prev);
          next.delete(position);
          return next;
        });
      }
    };
    const queued = (queues.current.get(position) ?? Promise.resolve()).then(run);
    queues.current.set(position, queued.catch(() => {}));
    return queued;
  }, [game.id]);

  function later(position, value) {
    clearTimeout(timers.current.get(position));
    timers.current.set(position, setTimeout(() => {
      timers.current.delete(position);
      save(position, value);
    }, SETTLE_MS));
  }

  function now(position, value) {
    clearTimeout(timers.current.get(position));
    timers.current.delete(position);
    save(position, value);
  }

  const shownWorth = (position, saved) => {
    const d = drafts.get(position);
    const n = d === undefined ? NaN : whole(d);
    return Number.isInteger(n) ? clamp(n) : saved;
  };

  function step(position, saved, delta) {
    const next = clamp(shownWorth(position, saved) + delta);
    setIn(setDrafts, position, String(next));
    setIn(setRowErrors, position, undefined);
    later(position, next);
  }

  // The totals follow the fields as they are typed, so "needs 8 of 15" moves
  // with the stepper rather than one round trip behind it.
  const effective = new Map(worths);
  for (const [position, text] of drafts) {
    const n = whole(text);
    if (Number.isInteger(n) && n >= MIN && n <= MAX) effective.set(position, n);
  }
  const regions = builderRegions(tiles, effective, line);
  const problems = boardProblems(tiles).filter((p) => p.startsWith('Square 100'));
  const filledRegions = regions.filter((r) => r.count > 0).length;
  const totalTiles = regions.reduce((n, r) => n + r.count, 0);
  const totalPoints = regions.reduce((n, r) => n + r.total, 0);
  const lineChanged = line !== savedLine;
  // An example in the organiser's own numbers, from the first region that has
  // any: the rule is easier to check against a region you just priced.
  const example = regions.find((r) => r.total > 0);

  async function saveLine() {
    setLineBusy(true); setLineError(null); setLineNote(null);
    try {
      await adminSetRegionThreshold(game.id, line);
      setLineNote(`Saved — the line is at ${line}%.`);
      await onSaved?.();
    } catch (err) {
      setLineError(err.message);
    } finally {
      setLineBusy(false);
    }
  }

  return (
    <section className="card region-points">
      <CardHead
        title="Points"
        lead="What each tile scores, and how much of a region a team needs to complete it."
        more={'Harder tiles are worth more. A region’s points are its tiles added up; a team that reaches '
          + 'the line in a region completes it and earns one pick, which opens any other region, near or '
          + 'far. Score is every completed tile’s points, and most points wins. Points and the line are '
          + 'fixed once the game starts.'}
      />

      {!editable && (
        <p className="muted region-points-locked">
          Fixed now the game is under way. These are the numbers it is played with.
        </p>
      )}

      <div className="region-line">
        <div className="region-line-head">
          <label htmlFor={`region-line-${game.id}`}>The line</label>
          <output htmlFor={`region-line-${game.id}`} className="region-line-value">{line}%</output>
        </div>
        <input
          id={`region-line-${game.id}`}
          type="range"
          min={MIN}
          max={MAX}
          value={line}
          disabled={!editable || lineBusy}
          onChange={(e) => { setLine(Number(e.target.value)); setLineNote(null); setLineError(null); }}
        />
        <p className="muted">
          A team completes a region at {line}% of its points, rounded up, and earns a pick
          to open any other region.
          {loaded && example && (
            <> {example.name} is worth {pts(example.total)}, so a team needs {needFor(example.total, line)} there.</>
          )}
        </p>
        {editable && lineChanged && (
          <div className="row">
            <button disabled={lineBusy} onClick={saveLine}>Save the line at {line}%</button>
            <button className="ghost" disabled={lineBusy} onClick={() => setLine(savedLine)}>
              Back to {savedLine}%
            </button>
          </div>
        )}
        {lineError && <p className="error">{lineError}</p>}
        {lineNote && !lineChanged && <p className="muted notice" role="status">{lineNote}</p>}
      </div>

      {loaded && (
      <p className="region-points-sum">
        {totalTiles === 0
          ? 'No tiles on the board yet — give each region its tasks on the Board tab first.'
          : <>{totalTiles} tile{totalTiles === 1 ? '' : 's'} worth {pts(totalPoints)}, in {filledRegions} of {REGIONS.length} regions.</>}
        {editable && totalTiles > 0 && ' Each tile starts at 1 point.'}
      </p>
      )}
      {problems.map((p) => <p key={p} className="error">{p} It is on the Board tab.</p>)}
      {loadError && <p className="error">The points could not be loaded: {loadError}</p>}
      {!loaded && !loadError && <p className="muted" role="status">Loading the points…</p>}

      {loaded && (
      <div className="region-points-grid">
        {regions.map((r) => (
          <section
            key={r.key}
            className={`region-points-card${r.count === 0 ? ' empty' : ''}`}
            aria-labelledby={`region-points-${r.key}`}
          >
            <header>
              <h3 id={`region-points-${r.key}`}>{r.name}</h3>
              {r.count > 0 ? (
                <span className="region-points-need">
                  needs <b>{r.need}</b> of {r.total}
                </span>
              ) : (
                <span className="region-points-need missing">No tiles</span>
              )}
            </header>

            {r.count === 0 ? (
              <p className="muted">
                Every region needs at least one tile before the game can start. Add one on the Board tab.
              </p>
            ) : (
              <ul>
                {r.squares.filter((s) => s.tile).map((s) => {
                  const saved = worths.get(s.position) ?? s.worth;
                  const draft = drafts.get(s.position);
                  const value = draft ?? String(saved);
                  const err = rowErrors.get(s.position);
                  return (
                    <li key={s.position} className={err ? 'has-error' : undefined}>
                      <TileIcon slug={s.tile.icon} fallback={<span className="region-points-icon" />} />
                      <span className="region-points-name" title={s.tile.name}>{s.tile.name}</span>
                      {editable ? (
                        <span className={`region-points-stepper${saving.has(s.position) ? ' saving' : ''}`}>
                          <button
                            type="button" className="ghost"
                            aria-label={`One point less for ${s.tile.name}`}
                            disabled={shownWorth(s.position, saved) <= MIN}
                            onClick={() => step(s.position, saved, -1)}
                          >
                            −
                          </button>
                          <input
                            type="text"
                            inputMode="numeric"
                            aria-label={`Points for ${s.tile.name}`}
                            value={value}
                            onChange={(e) => {
                              setIn(setDrafts, s.position, e.target.value.replace(/[^\d]/g, '').slice(0, 3));
                              setIn(setRowErrors, s.position, undefined);
                            }}
                            onBlur={() => { if (draft !== undefined) now(s.position, whole(draft)); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                          />
                          <button
                            type="button" className="ghost"
                            aria-label={`One point more for ${s.tile.name}`}
                            disabled={shownWorth(s.position, saved) >= MAX}
                            onClick={() => step(s.position, saved, 1)}
                          >
                            +
                          </button>
                        </span>
                      ) : (
                        <span className="region-points-fixed">{pts(saved)}</span>
                      )}
                      {err && <span className="error region-points-error">{err}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
      )}
    </section>
  );
}
