import { useEffect, useRef } from 'react';
import { tileState } from '../../lib/bingo.js';
import { pts, tileInitial } from '../../lib/regions.js';
import { tileProgressText } from '../../lib/tileProgress.js';
import TileIcon from '../TileIcon.jsx';
import TileInfo from '../TileInfo.jsx';
import EvidenceUploader from '../EvidenceUploader.jsx';
import EvidencePanel from '../EvidencePanel.jsx';

/**
 * One task in an opened region: what it asks for, what it scores, how far the
 * team is, and the uploader. BingoTilePanel's job, with points and a way back
 * to the region instead of a grid coordinate.
 *
 * No lock-in, as in bingo: the first submit opens the tile (regions_open_tile,
 * via `onOpen`) and uploads in the same press. A paste lands here whenever the
 * uploader shows -- the screenshot is already on the clipboard.
 */
export default function RegionTilePanel({
  tile, regionName, gameId, teamId, submittable, closedReason, evidence, onOpen, onRefresh, onBack,
}) {
  const uploaderRef = useRef(null);
  const state = tileState(tile);
  const mine = evidence.filter((e) => tile.claim_id && e.claim_id === tile.claim_id);
  const showUploader = submittable && state !== 'done';

  useEffect(() => {
    if (!showUploader) return undefined;
    function onPaste(e) {
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length || !uploaderRef.current) return;
      e.preventDefault();
      uploaderRef.current.stageFiles(files);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [showUploader]);

  return (
    <section className="bingo-tile-panel regions-tile-panel" aria-labelledby="regions-tile-title">
      <button type="button" className="ghost regions-back" onClick={onBack}>‹ {regionName}</button>
      <div className="bingo-tile-head">
        <div className="slot-art">
          <TileIcon slug={tile.icon} fallback={<span className="slot-art-coord">{tileInitial(tile.name)}</span>} />
        </div>
        <div>
          <h2 id="regions-tile-title">
            {tile.name}
            <TileInfo tile={tile} />
          </h2>
          <p className="muted">
            <span className="regions-worth">{pts(tile.worth)}</span>
            {' · '}
            {state === 'done' ? 'Completed ✓' : tileProgressText(tile)}
          </p>
        </div>
      </div>

      {state === 'done' && (
        <p className="bingo-done-note">
          Your team completed this tile
          {tile.claimed_by_name ? <> — opened by <strong>{tile.claimed_by_name}</strong></> : null}.
        </p>
      )}

      {showUploader && (
        <EvidenceUploader
          ref={uploaderRef}
          mode="bingo"
          claimId={tile.claim_id}
          ensureClaimId={() => onOpen(tile.id)}
          gameId={gameId}
          teamId={teamId}
          tile={tile}
          onUploaded={() => onRefresh?.()}
        />
      )}

      {!submittable && state !== 'done' && closedReason && <p className="muted">{closedReason}</p>}

      {mine.length > 0 && (
        <EvidencePanel
          title={tile.name}
          meta={`Your team's submissions (${mine.length})`}
          items={mine}
          onClose={onBack}
        />
      )}
    </section>
  );
}
