import { useEffect, useRef, useState } from 'react';
import { REGIONS } from '../../lib/territoryWorld.js';
import { neighbours, openRefusal, placeByKey, placeState } from '../../lib/territory.js';
import { tileProgressText } from '../../lib/tileProgress.js';
import { markerColor } from '../../lib/snakes.js';
import TileIcon from '../TileIcon.jsx';
import TileInfo from '../TileInfo.jsx';
import EvidenceUploader from '../EvidenceUploader.jsx';
import EvidencePanel from '../EvidencePanel.jsx';
import { useConfirm } from '../ConfirmDialog.jsx';
import TeamCrest from './TeamCrest.jsx';

const regionName = new Map(REGIONS.map((r) => [r.key, r.name]));

/**
 * The place a player pressed on the map: who holds it, where it leads, its
 * task, and -- when the team may work on it -- the uploader.
 *
 * There is no separate "attack" button. The first screenshot opens the place
 * (`onOpen`, which counts against the two-place limit), exactly as the first
 * screenshot opens a bingo tile. What the panel does instead is say plainly
 * why a place cannot be worked when it cannot, because on a map the reason is
 * rarely obvious from the colours alone.
 *
 * `onDrop` gives a place up, freeing its slot. The screenshots stay, so picking
 * it up again later carries on where the team left off.
 */
export default function TerritoryPlacePanel({
  placeKey, tile, game, teams, myTeamId, owners, homes, open, attacked,
  evidence, onOpen, onDrop, onSelect, onRefresh, onClose,
}) {
  const uploaderRef = useRef(null);
  const [confirm, confirmDialog] = useConfirm();
  const [error, setError] = useState(null);
  const place = placeByKey.get(placeKey);
  const state = placeState({
    key: placeKey, teamId: myTeamId, owners, homes, open, attacked, status: game.status,
  });
  const refusal = openRefusal({
    teamId: myTeamId, key: placeKey, owners, homes, open, status: game.status,
  });
  const teamOf = (id) => teams.find((t) => t.id === id);
  const owner = teamOf(state.owner);
  const homeOf = [...homes].find(([, key]) => key === placeKey)?.[0];
  const canWork = refusal === null && Boolean(tile);
  // `claim_id` is only set while the place is open (it is what the uploader
  // posts to); `own_claim_id` stays after a capture or a give-up, so the team
  // can still look back at what it handed in.
  const claimRef = tile?.claim_id ?? tile?.own_claim_id;
  const mine = evidence.filter((e) => claimRef && e.claim_id === claimRef);

  useEffect(() => {
    if (!canWork) return undefined;
    function onPaste(e) {
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length || !uploaderRef.current) return;
      e.preventDefault();
      uploaderRef.current.stageFiles(files);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [canWork]);

  async function drop() {
    if (!(await confirm(
      `Give up on ${place.name}? Your screenshots are kept, so you can pick it up again later — `
      + 'but it stops counting as one of your two places.',
      { title: 'Give up this place?', confirmLabel: 'Give it up' },
    ))) return;
    setError(null);
    try {
      await onDrop(placeKey);
      onRefresh?.();
    } catch (err) {
      setError(err.message);
    }
  }

  let ownership;
  if (homeOf) {
    ownership = homeOf === myTeamId
      ? 'Your home. It is yours for the whole game and cannot be taken.'
      : `${teamOf(homeOf)?.name ?? 'A team'}'s home. Homes cannot be taken.`;
  } else if (!owner) {
    ownership = 'Free land — nobody holds it yet.';
  } else if (owner.id === myTeamId) {
    ownership = state.attacked
      ? 'Your team holds it — and someone is attacking it!'
      : 'Your team holds it.';
  } else {
    ownership = `Held by ${owner.name}. Complete the task to take it from them.`;
  }

  return (
    <section
      className="bingo-tile-panel territory-place-panel"
      aria-labelledby="territory-place-title"
      style={owner ? { '--owner': markerColor(owner.slot) } : undefined}
    >
      {confirmDialog}
      <div className="bingo-tile-head">
        <div className="slot-art territory-place-art">
          {tile ? (
            <TileIcon slug={tile.icon} fallback={<span className="slot-art-coord">{place.name[0]}</span>} />
          ) : (
            <span className="slot-art-coord">⌂</span>
          )}
        </div>
        <div>
          <h2 id="territory-place-title">{place.name}</h2>
          <p className="territory-place-region">{regionName.get(place.region)}</p>
        </div>
        <button className="ghost" onClick={onClose} aria-label="Close place">Close</button>
      </div>

      <p className={`territory-owner ${state.kind}${state.attacked ? ' attacked' : ''}`}>
        <TeamCrest slot={owner?.slot} label={owner?.initial} size={16} />
        <span>{ownership}</span>
      </p>

      {tile && (
        <div className="territory-task">
          <h3>
            {tile.name}
            <TileInfo tile={tile} />
          </h3>
          {state.working && <p className="muted">In progress · {tileProgressText(tile)}</p>}
        </div>
      )}

      {canWork && (
        <EvidenceUploader
          ref={uploaderRef}
          mode="territory"
          claimId={tile.claim_id}
          ensureClaimId={() => onOpen(placeKey)}
          gameId={game.id}
          teamId={myTeamId}
          tile={tile}
          onUploaded={() => onRefresh?.()}
        />
      )}

      {/* On your own land the ownership line above already says it all. */}
      {!canWork && refusal && state.kind !== 'home' && state.kind !== 'mine' && (
        <p className="muted territory-refusal">{refusal}</p>
      )}

      {state.working && (
        <button className="ghost territory-drop" onClick={drop}>Give up this place</button>
      )}
      {error && <p className="error">{error}</p>}

      <div className="territory-links-list">
        <p className="muted">Leads to</p>
        <ul>
          {neighbours(placeKey).map((n) => {
            const o = teamOf(owners.get(n.key));
            return (
              <li key={n.key}>
                <button className="territory-link-chip" onClick={() => onSelect(n.key)}>
                  <span
                    className="territory-chip-dot"
                    style={{ background: o ? markerColor(o.slot) : 'transparent' }}
                    aria-hidden="true"
                  />
                  {placeByKey.get(n.key).name}
                  {n.kind !== 'land' && (
                    <span className="muted" title={n.kind === 'boat' ? 'By boat' : 'By other travel'}>
                      {n.kind === 'boat' ? ' ⚓' : ' ✦'}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {mine.length > 0 && (
        <EvidencePanel
          title={place.name}
          meta={`Your team's submissions (${mine.length})`}
          items={mine}
          onClose={onClose}
        />
      )}
    </section>
  );
}
