import { useEffect, useRef } from 'react';
import { coordLabel, fromPosition } from '../../lib/board.js';
import { tileState } from '../../lib/bingo.js';
import { tileProgressText } from '../../lib/tileProgress.js';
import { openBingoTile } from '../../lib/supabase.js';
import TileIcon from '../TileIcon.jsx';
import TileInfo from '../TileInfo.jsx';
import EvidenceUploader from '../EvidenceUploader.jsx';
import EvidencePanel from '../EvidencePanel.jsx';

/**
 * The square a player has pressed: what it asks for, how far the team is, and
 * the uploader. Bingo's equivalent of a battleships active-tile card, except
 * there is only ever the one -- whichever tile is selected -- because any tile
 * can be worked at any time.
 *
 * No lock-in. The first submit opens the tile (bingo_open_tile) and uploads in
 * the same press; the player never sees that a claim row exists.
 *
 * Paste lands here whenever a tile is open, the same way a clicked slot card
 * takes a paste in battleships: a fresh screenshot is already on the
 * clipboard, and asking someone to save it first is asking them not to bother.
 *
 * `readOnly` is another team's card. The task is public in bingo, so it still
 * shows; their evidence and progress are not, so neither does.
 */
export default function BingoTilePanel({
  tile, gameId, teamId, submittable, closedReason, readOnly, evidence, onRefresh, onClose,
}) {
  const uploaderRef = useRef(null);
  const state = tileState(tile);
  const { row, col } = fromPosition(tile.position);
  const label = coordLabel(row, col);
  const mine = evidence.filter((e) => tile.claim_id && e.claim_id === tile.claim_id);
  const showUploader = !readOnly && submittable && state !== 'done';

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
    <section className="bingo-tile-panel" aria-labelledby="bingo-tile-title">
      <div className="bingo-tile-head">
        <div className="slot-art">
          <TileIcon slug={tile.icon} fallback={<span className="slot-art-coord">{label}</span>} />
        </div>
        <div>
          <h2 id="bingo-tile-title">
            {tile.name}
            {/* Renders nothing when the tile has no small print or drop list. */}
            <TileInfo tile={tile} />
          </h2>
          <p className="muted">
            <span className="coord">{label}</span>
            {!readOnly && <> · {state === 'done' ? 'Completed ✓' : tileProgressText(tile)}</>}
          </p>
        </div>
        <button className="ghost" onClick={onClose} aria-label="Close tile">Close</button>
      </div>

      {readOnly && (
        <p className="muted">
          This is another team&rsquo;s card. Their screenshots stay private; switch back to
          your own card to work on this tile.
        </p>
      )}

      {!readOnly && state === 'done' && (
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
          ensureClaimId={() => openBingoTile(tile.id)}
          gameId={gameId}
          teamId={teamId}
          tile={tile}
          onUploaded={() => onRefresh?.()}
        />
      )}

      {!readOnly && !submittable && state !== 'done' && closedReason && (
        <p className="muted">{closedReason}</p>
      )}

      {!readOnly && mine.length > 0 && (
        <EvidencePanel
          title={tile.name}
          meta={`Your team's submissions (${mine.length})`}
          items={mine}
          onClose={onClose}
        />
      )}
    </section>
  );
}
