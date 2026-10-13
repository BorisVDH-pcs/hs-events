import { useEffect, useMemo, useRef, useState } from 'react';
import { useCountdown, pad } from '../../lib/countdown.js';
import { MAX_OPEN, placeByKey, placePosition, resultText, standings as rank } from '../../lib/territory.js';
import { markerColor, teamInitials } from '../../lib/snakes.js';
import EventFeed from '../EventFeed.jsx';
import TeamNameEditor from '../TeamNameEditor.jsx';
import StartTimeBadge from '../StartTimeBadge.jsx';
import TerritoryMap from './TerritoryMap.jsx';
import TerritoryPlacePanel from './TerritoryPlacePanel.jsx';
import TerritoryStandings from './TerritoryStandings.jsx';

/**
 * The player's view of a Territory game: Risk on the OSRS world map.
 *
 * Same three columns as the other modes -- standings and feed on the left, the
 * map in the middle, the place you pressed on the right -- so a player moving
 * between modes does not relearn where anything is.
 *
 * Everything that changes the map is the server's: `actions.open` opens a
 * place (and returns its claim id for the uploader), `actions.drop` gives one
 * up, and a capture happens inside add_evidence when the last screenshot lands.
 * This page draws what it is handed.
 *
 * THE TIMER works as in BingoGame: submissions are refused from `ends_at`,
 * which fixes the result, and every open page asks the server to record it
 * (`actions.settle`, territory_settle) when its countdown reaches zero. The
 * first one wins; the rest are no-ops.
 *
 *   owners    Map placeKey -> teamId, homes included
 *   homes     Map teamId -> placeKey
 *   open      Set of placeKeys my team has in progress
 *   attacked  Set of placeKeys my team holds that a rival is working on
 *   tiles     the task on each place, at placePosition(place) on the 8x8 card
 *
 * `placeTools` lets the harness put its "simulate a screenshot" button under
 * the panel. The app never passes it.
 */
export default function TerritoryGame({
  game, teams, myTeamId, myRole, tiles, owners, homes, open, attacked, captures, bonuses,
  events, evidence, actions, onRefresh, placeTools,
}) {
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const isPreparation = game.status === 'setup' || game.status === 'placement';
  const isActive = game.status === 'active';
  const lettered = useMemo(() => {
    const initials = teamInitials(teams);
    return teams.map((t) => ({ ...t, initial: initials.get(t.id) }));
  }, [teams]);
  const myTeam = lettered.find((t) => t.id === myTeamId) ?? null;
  const rows = useMemo(() => rank(lettered, owners, captures, bonuses), [lettered, owners, captures, bonuses]);
  const tileFor = (key) => tiles.find((t) => t.position === placePosition(key)) ?? null;

  const settledFor = useRef(null);
  const settle = actions?.settle;
  useEffect(() => {
    if (!isActive || !game.ends_at || !settle) return undefined;
    const wait = Date.parse(game.ends_at) - Date.now();
    const run = () => {
      // Guard before touching `now`, which is a dependency of this effect.
      if (settledFor.current === game.id) return;
      settledFor.current = game.id;
      setNow(Date.now());
      Promise.resolve(settle())
        .catch(() => { settledFor.current = null; })
        .finally(() => onRefresh?.());
    };
    if (wait <= 0) { run(); return undefined; }
    // setTimeout clamps anything past ~24.8 days; re-arm instead of firing early.
    const id = setTimeout(() => setNow(Date.now()), Math.min(wait + 500, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [isActive, game.id, game.ends_at, now, settle, onRefresh]);

  const select = (key) => setSelected((s) => (s === key ? null : key));
  const findTeam = (teamId) => {
    const key = homes.get(teamId);
    if (key) { setFocus({ key, at: Date.now() }); setSelected(key); }
  };

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
            Territory: the whole of Gielinor, from Varlamore to Morytania, carved into places.
            Every team starts at home and conquers outward — finish a place&rsquo;s task to take it,
            even from another team. Hold whole regions for bonus points. When the timer runs out,
            the biggest empire wins. The tasks are revealed when the organiser starts the game.
          </p>
        </section>
        <section className="boards" id="territory-map-section">
          <TerritoryMap
            teams={lettered} myTeamId={myTeamId} owners={owners} homes={homes}
            open={open} attacked={attacked} status={game.status}
            selected={selected} onSelect={select} focus={focus} bonuses={bonuses}
          />
        </section>
        <EventFeed events={events} teams={teams} myTeamId={myTeamId} />
      </>
    );
  }

  const result = resultText(game, lettered);
  const working = [...open].map((k) => placeByKey.get(k)?.name).filter(Boolean);

  return (
    <>
      {result && <p className="banner">{result}</p>}

      <section className="boards">
        <div className="board-layout territory-layout">
          <div className="feed-col">
            <TerritoryStandings rows={rows} teams={lettered} myTeamId={myTeamId} onFind={findTeam} />
            <EventFeed events={events} teams={teams} myTeamId={myTeamId} />
          </div>

          <div className="board-col" id="territory-map-section">
            <div className="tabs board-tabs territory-tabs">
              <button className="on" aria-current="true">
                World map{myTeam ? ` · ${rows.find((r) => r.team_id === myTeamId)?.score ?? 0} pts` : ''}
              </button>
              {myTeam && <button onClick={() => findTeam(myTeamId)}>My home</button>}
              {isActive && <TerritoryTimer endsAt={game.ends_at} />}
            </div>
            <TerritoryMap
              teams={lettered} myTeamId={myTeamId} owners={owners} homes={homes}
              open={open} attacked={attacked} status={game.status}
              selected={selected} onSelect={select} focus={focus} bonuses={bonuses}
            />
            <TerritoryLegend colour={myTeam ? markerColor(myTeam.slot) : null} />
          </div>

          <div className="side-col" id="territory-place-section">
            {selected ? (
              <>
                <TerritoryPlacePanel
                  key={selected}
                  placeKey={selected}
                  tile={tileFor(selected)}
                  game={game}
                  teams={lettered}
                  myTeamId={myTeamId}
                  owners={owners}
                  homes={homes}
                  open={open}
                  attacked={attacked}
                  evidence={evidence}
                  onOpen={actions.open}
                  onDrop={actions.drop}
                  onSelect={(key) => { setSelected(key); setFocus({ key, at: Date.now() }); }}
                  onRefresh={onRefresh}
                  onClose={() => setSelected(null)}
                />
                {placeTools?.(selected)}
              </>
            ) : (
              <section className="bingo-tile-panel bingo-hint">
                <h2>{game.status === 'finished' ? 'The final map' : 'Conquer the world'}</h2>
                {myTeam && isActive && (
                  <p>
                    {working.length
                      ? <>Working on <strong>{working.join(' and ')}</strong> ({working.length}/{MAX_OPEN}).</>
                      : <>Your team is not working on anything. Pick a glowing place next to your land.</>}
                  </p>
                )}
                <p className="muted">
                  Press a place to read its task. You can work on places linked to land you
                  hold — they glow gold — up to {MAX_OPEN} at a time. Finish the task and the place
                  is yours, even if another team held it.
                </p>
                <p className="muted">
                  Score = places held, plus a bonus for every region you hold whole.
                  {game.ends_at ? ' The highest score when the timer runs out wins.' : ''}
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
function TerritoryTimer({ endsAt }) {
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

function TerritoryLegend({ colour }) {
  return (
    <ul className="territory-legend muted" aria-label="Map key">
      {colour && <li><span className="key mine" style={{ '--mine': colour }} /> Your land</li>}
      <li><span className="key" /> Free land</li>
      <li><span className="key openable" /> You can attack</li>
      <li><span className="key working" /> Working on it</li>
      <li><span className="key attacked" /> Under attack</li>
      <li><span className="key line region" /> Region border</li>
      <li><span className="key line boat" /> Boat or travel</li>
    </ul>
  );
}
