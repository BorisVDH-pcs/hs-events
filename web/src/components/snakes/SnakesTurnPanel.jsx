import { useEffect, useRef, useState } from 'react';
import { snakesOpenTile, snakesRoll, snakesSpendRollback } from '../../lib/supabase.js';
import { canRoll, currentTile, rollbackSize, snakesEventText, LAST_TILE } from '../../lib/snakes.js';
import { tileProgressText } from '../../lib/tileProgress.js';
import { useConfirm } from '../ConfirmDialog.jsx';
import TileIcon from '../TileIcon.jsx';
import TileInfo from '../TileInfo.jsx';
import EvidenceUploader from '../EvidenceUploader.jsx';
import EvidencePanel from '../EvidencePanel.jsx';
import Dice from './Dice.jsx';

// The die tumbles at least this long, so a fast answer still reads as a roll.
const MIN_ROLL_MS = 900;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * What my team does next, which is always exactly one of two things:
 *
 *   - roll the die: from Start, or once the tile we stand on is done;
 *   - finish the tile we stand on: its task, its progress, the uploader.
 *
 * Plus the rollback, whenever the team has one, for getting off a tile it
 * would rather not do.
 *
 * The last move -- ours, whoever on the team made it -- sits under the die,
 * read off the newest `team_moved` event, so a teammate's roll shows here too.
 */
export default function SnakesTurnPanel({ game, team, tiles, evidence, lastMove, onRefresh }) {
  const uploaderRef = useRef(null);
  const [busy, setBusy] = useState(null);  // 'roll' | 'rollback' | null
  const [error, setError] = useState(null);
  const [hiddenFor, setHiddenFor] = useState(null);  // tile whose submissions were closed
  const [confirm, confirmDialog] = useConfirm();

  const isActive = game.status === 'active';
  const tile = currentTile(team, tiles);
  const rollable = isActive && canRoll(team, tiles);
  const working = isActive && Boolean(tile) && tile.claim_status !== 'completed';
  const mine = tile ? evidence.filter((e) => tile.claim_id && e.claim_id === tile.claim_id) : [];
  const rollbacks = team?.rollbacks_available ?? 0;
  const lastDice = lastMove?.payload?.dice?.[0] ?? null;
  const lastText = lastMove ? snakesEventText(lastMove, team?.name ?? 'Your team') : null;

  // Paste a screenshot straight onto the tile, as on the bingo panel.
  useEffect(() => {
    if (!working) return undefined;
    function onPaste(e) {
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length || !uploaderRef.current) return;
      e.preventDefault();
      uploaderRef.current.stageFiles(files);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [working]);

  async function act(kind, call) {
    setBusy(kind);
    setError(null);
    try {
      await Promise.all([call(), wait(kind === 'roll' ? MIN_ROLL_MS : 0)]);
      await onRefresh?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function onRollback() {
    const ok = await confirm(
      `Your team goes back ${rollbackSize(team.rollbacks_used)}. Tiles you have already `
      + 'finished are skipped on the way, never past where you are now — and snakes still bite.',
      { title: 'Use a rollback?', confirmLabel: 'Use rollback' },
    );
    if (ok) act('rollback', () => snakesSpendRollback(game.id));
  }

  if (!team) {
    return (
      <section className="bingo-tile-panel snakes-turn">
        <h2>Your turn</h2>
        <p className="muted">You are not on a team in this game, so you can watch but not roll.</p>
      </section>
    );
  }

  return (
    <section className="bingo-tile-panel snakes-turn" aria-labelledby="snakes-turn-title">
      <h2 id="snakes-turn-title">
        {team.name}
        <span className="snakes-where">
          {team.board_tile ? `Tile ${team.board_tile}` : 'At Start'}
        </span>
      </h2>

      <div className="snakes-roll-row">
        <Dice value={lastDice} rolling={busy === 'roll'} size="lg" />
        <p className="snakes-last">
          {busy === 'roll'
            ? 'Rolling…'
            : lastText ?? (team.board_tile ? '' : 'Roll the die to leave Start.')}
        </p>
      </div>

      {rollable && (
        <button className="primary snakes-roll" disabled={Boolean(busy)} onClick={() => act('roll', () => snakesRoll(game.id))}>
          {busy === 'roll' ? 'Rolling…' : '🎲 Roll the die'}
        </button>
      )}

      {tile && (
        <div className="snakes-current">
          <div className="bingo-tile-head">
            <div className="slot-art">
              <TileIcon slug={tile.icon} fallback={<span className="slot-art-coord">{tile.position}</span>} />
            </div>
            <div>
              <h3>
                {tile.name}
                <TileInfo tile={tile} />
              </h3>
              <p className="muted">
                Tile {tile.position} · {tile.claim_status === 'completed' ? 'Completed ✓' : tileProgressText(tile)}
              </p>
            </div>
          </div>

          {tile.claim_status === 'completed' && isActive && (
            <p className="bingo-done-note">Done — roll the die to move on.</p>
          )}
          {working && tile.position === LAST_TILE && (
            <p className="snakes-finish-note">Finish this one and your team wins.</p>
          )}

          {working && (
            <EvidenceUploader
              ref={uploaderRef}
              mode="snakes"
              claimId={tile.claim_id}
              ensureClaimId={() => snakesOpenTile(game.id)}
              gameId={game.id}
              teamId={team.id}
              tile={tile}
              onUploaded={() => onRefresh?.()}
            />
          )}

          {mine.length > 0 && hiddenFor !== tile.position && (
            <EvidencePanel
              title={tile.name}
              meta={`Your team's submissions (${mine.length})`}
              items={mine}
              onClose={() => setHiddenFor(tile.position)}
            />
          )}
        </div>
      )}

      {isActive && (rollbacks > 0 || team.rollbacks_used > 0) && (
        <div className="snakes-rollback">
          <p className="muted">
            {rollbacks > 0
              ? <>You have <strong>{rollbacks}</strong> rollback{rollbacks === 1 ? '' : 's'}. The next one goes back {rollbackSize(team.rollbacks_used)}.</>
              : 'No rollbacks left.'}
          </p>
          {rollbacks > 0 && team.board_tile > 0 && (
            <button disabled={Boolean(busy)} onClick={onRollback}>
              {busy === 'rollback' ? 'Going back…' : '⏪ Use a rollback'}
            </button>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {!isActive && game.status === 'finished' && <p className="muted">The game is over.</p>}
      {confirmDialog}
    </section>
  );
}
