import { useEffect, useMemo, useRef, useState } from 'react';
import { useCountdown, pad } from '../../lib/countdown.js';
import { canSubmit, timeIsUp } from '../../lib/bingo.js';
import {
  REGIONS, nextStep, pickRefusal, pts, regionStatus, resultText,
} from '../../lib/regions.js';
import { markerColor } from '../../lib/snakes.js';
import EventFeed from '../EventFeed.jsx';
import TeamNameEditor from '../TeamNameEditor.jsx';
import StartTimeBadge from '../StartTimeBadge.jsx';
import RegionMap from './RegionMap.jsx';
import RegionPanel from './RegionPanel.jsx';
import RegionTilePanel from './RegionTilePanel.jsx';
import RegionStandings from './RegionStandings.jsx';
import './regions.css';

/**
 * The player's view of a Region Bingo: bingo, region by region, on the OSRS
 * world map. docs/region-bingo-rules.md has the rules.
 *
 * The same three columns as the other modes -- standings and feed on the
 * left, the map in the middle, what you pressed on the right -- and one
 * thing at a time on the right: a region, or one of its tasks, never both.
 *
 * Everything that changes the game is the server's: `actions.pick` opens a
 * region, `actions.openTile` opens a task for the uploader, and a tile
 * completes inside add_evidence when the last screenshot lands. This page
 * draws what it is handed (`view`, from lib/regions.js fromServer).
 *
 * THE TIMER works as in BingoGame: submissions are refused from `ends_at`,
 * which fixes the result, and every open page asks the server to record it
 * (`actions.settle`, regions_settle) when its countdown reaches zero.
 *
 * `tileTools` lets the harness put its "simulate a screenshot" button under
 * the tile panel. The app never passes it.
 */
export default function RegionsGame({
  game, teams, myTeamId, myRole, view, standings, events, evidence, actions, onRefresh, tileTools,
}) {
  const [selected, setSelected] = useState(null);
  const [tileId, setTileId] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const isPreparation = game.status === 'setup' || game.status === 'placement';
  const isActive = game.status === 'active';
  const finished = game.status === 'finished';
  const myTeam = teams.find((t) => t.id === myTeamId) ?? null;
  const myRow = standings.find((s) => s.team_id === myTeamId);

  // Which teams have opened each region: public, from the standings.
  const presence = useMemo(() => {
    const out = new Map(REGIONS.map((r) => [r.key, []]));
    for (const s of standings) {
      for (const key of s.regions_open ?? []) out.get(key)?.push({ id: s.team_id, name: s.team_name, slot: s.slot });
    }
    return out;
  }, [standings]);

  const pickable = useMemo(() => new Set(
    REGIONS.map((r) => r.key).filter((key) => regionStatus(view.regions.get(key)) === 'locked'
      && pickRefusal({ game, view, regionKey: key, myTeamId, now }) === null),
  ), [game, view, myTeamId, now]);

  const settledFor = useRef(null);
  const settle = actions?.settle;
  useEffect(() => {
    if (!isActive || !game.ends_at || !settle) return undefined;
    const wait = Date.parse(game.ends_at) - Date.now();
    const run = () => {
      if (settledFor.current === game.id) return;
      settledFor.current = game.id;
      setNow(Date.now());
      Promise.resolve(settle())
        .catch(() => { settledFor.current = null; })
        .finally(() => onRefresh?.());
    };
    if (wait <= 0) { run(); return undefined; }
    const id = setTimeout(() => setNow(Date.now()), Math.min(wait + 500, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [isActive, game.id, game.ends_at, now, settle, onRefresh]);

  const select = (key) => {
    setTileId(null);
    setSelected((s) => (s === key ? null : key));
  };
  const region = selected ? view.regions.get(selected) : null;
  const tile = tileId ? view.tiles.find((t) => t.id === tileId) ?? null : null;
  // A region whose tasks the team can see is stepped into: the map flies in
  // and lays them out. One it has not opened stays on the world map, where
  // the side panel offers the pick -- and flies in the moment it is opened.
  const focus = region && !isPreparation && (region.opened || finished) ? region.key : null;
  const leave = () => { setTileId(null); setSelected(null); };

  // Esc steps back: out of a task, then out of the region.
  useEffect(() => {
    if (!focus) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target.closest?.('input, textarea, select, [role="dialog"], [role="alertdialog"], dialog')) return;
      if (tileId) setTileId(null); else setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, tileId]);

  const map = (
    <RegionMap
      view={view} pickable={isActive ? pickable : new Set()} presence={presence}
      selected={selected} onSelect={select} finished={finished}
      focus={focus} activeTile={tileId} onTile={setTileId} onBack={leave}
    />
  );

  if (isPreparation) {
    return (
      <>
        {myTeamId && <StartTimeBadge startsAt={game.starts_at} mode={game.mode} />}
        {myRole === 'captain' && myTeam && (
          <section className="card">
            <h2>Your team</h2>
            <TeamNameEditor team={myTeam} onRenamed={() => onRefresh?.()} />
          </section>
        )}
        <section className="card">
          <h2>{game.name}</h2>
          <p className="muted">
            Region Bingo: every region of Gielinor holds its own tasks, each worth points.
            When the game starts, {myRole === 'captain' ? 'you pick' : 'your captain picks'} your
            team&rsquo;s first region. Score {game.region_threshold ?? view.threshold}% of a region&rsquo;s
            points to earn a pick and open another — any region you like. Most points when the
            timer runs out wins. The tasks stay hidden until your team opens their region.
          </p>
        </section>
        <section className="boards">{map}</section>
        <EventFeed events={events} teams={teams} myTeamId={myTeamId} />
      </>
    );
  }

  const result = resultText(game, teams, standings);
  const step = nextStep(view, game, myTeamId);
  const submittable = canSubmit(game, myTeamId, now);
  const closedReason = !isActive
    ? 'The game is over.'
    : timeIsUp(game, now) ? 'Time is up — no more submissions.' : null;
  const opened = [...view.regions.values()].filter((r) => r.opened)
    .sort((a, b) => (a.openedAt ?? '').localeCompare(b.openedAt ?? ''));

  return (
    <>
      {result && <p className="banner">{result}</p>}

      <section className="boards">
        <div className="board-layout territory-layout regions-layout">
          <div className="feed-col">
            <RegionStandings rows={standings} myTeamId={myTeamId} onFind={(key) => select(key)} />
            <EventFeed events={events} teams={teams} myTeamId={myTeamId} />
          </div>

          <div className="board-col">
            <div className="tabs board-tabs territory-tabs">
              <button className="on" aria-current="true">
                World map{myTeam ? ` · ${pts(myRow?.points ?? 0)}` : ''}
              </button>
              {isActive && <RegionsTimer endsAt={game.ends_at} />}
            </div>
            {step && (
              <p className={`regions-next${pickable.size ? ' lit' : ''}`} role="status">{step}</p>
            )}
            {map}
            {!focus && <RegionsLegend colour={myTeam ? markerColor(myTeam.slot) : null} />}
          </div>

          <div className="side-col">
            {tile && region ? (
              <>
                <RegionTilePanel
                  key={tile.id}
                  tile={tile}
                  regionName={region.name}
                  gameId={game.id}
                  teamId={myTeamId}
                  submittable={submittable && region.opened}
                  closedReason={closedReason}
                  evidence={evidence}
                  onOpen={actions.openTile}
                  onRefresh={onRefresh}
                  onBack={() => setTileId(null)}
                />
                {tileTools?.(tile)}
              </>
            ) : region ? (
              <RegionPanel
                key={region.key}
                game={game}
                view={view}
                region={region}
                presence={presence.get(region.key) ?? []}
                myTeamId={myTeamId}
                finished={finished}
                onPick={actions.pick}
                onRefresh={onRefresh}
                onClose={() => setSelected(null)}
              />
            ) : (
              <section className="bingo-tile-panel bingo-hint">
                <h2>{finished ? 'The final map' : 'Region Bingo'}</h2>
                {opened.length > 0 && (
                  <>
                    <p className="muted">Your regions</p>
                    <ul className="regions-mine">
                      {opened.map((r) => (
                        <li key={r.key}>
                          <button type="button" className="territory-link-chip" onClick={() => select(r.key)}>
                            {r.name}
                            <span className="muted"> · {r.points ?? 0}/{r.total}{(r.points ?? 0) >= r.need ? ' ✓' : ''}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="muted">
                  Press a region on the map. Opened regions show their tasks; each is worth points.
                  Reach {view.threshold}% of a region&rsquo;s points to earn a pick, and spend it on any
                  region you have not opened yet. Old regions stay open.
                </p>
                <p className="muted">
                  Score = every point your team has completed.
                  {game.ends_at ? ' The most points when the timer runs out wins.' : ''}
                </p>
              </section>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

/** "Ends in 1d 04:12:09", or nothing when the game has no timer. */
function RegionsTimer({ endsAt }) {
  const left = useCountdown(endsAt);
  if (!left.set) return null;
  return (
    <span className="next-move-tab bingo-timer" role="timer">
      {left.started
        ? "Time's up"
        : `Ends in ${left.days > 0 ? `${left.days}d ` : ''}${pad(left.hours)}:${pad(left.minutes)}:${pad(left.seconds)}`}
    </span>
  );
}

function RegionsLegend({ colour }) {
  return (
    <ul className="territory-legend regions-legend muted" aria-label="Map key">
      <li><span className="key regions-key locked" /> Not opened</li>
      <li><span className="key regions-key open" /> Opened</li>
      <li><span className="key regions-key complete" /> Complete</li>
      <li><span className="key openable" /> You can open it</li>
      {colour && <li><span className="regions-dot-key" style={{ background: colour }} /> Your team was here</li>}
    </ul>
  );
}
