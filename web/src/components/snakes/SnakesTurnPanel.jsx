import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { snakesOpenTile, snakesRoll, snakesSpendRollback } from '../../lib/supabase.js';
import { tradePet } from '../../lib/evidence.js';
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
 * The upload is the loud part (a gold "Upload proof"); everything under it is
 * the way out for a tile the team would rather not do, kept deliberately
 * quieter: the rollback, and trading a pet for one.
 *
 * The last move -- ours, whoever on the team made it -- sits under the die,
 * read off the newest `team_moved` event, so a teammate's roll shows here too.
 *
 * `petClaims` is the set of claim ids my team has already traded a pet on,
 * read off the feed. The server refuses a second trade either way; this only
 * stops the panel offering one.
 */
export default function SnakesTurnPanel({ game, team, tiles, evidence, lastMove, petClaims, onRefresh }) {
  const uploaderRef = useRef(null);
  const petRef = useRef(null);
  const [busy, setBusy] = useState(null);  // 'roll' | 'rollback' | null
  const [error, setError] = useState(null);
  const [hiddenFor, setHiddenFor] = useState(null);  // tile whose submissions were closed
  const [petOpen, setPetOpen] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const isActive = game.status === 'active';
  const tile = currentTile(team, tiles);
  const rollable = isActive && canRoll(team, tiles);
  const working = isActive && Boolean(tile) && tile.claim_status !== 'completed';
  const mine = tile ? evidence.filter((e) => tile.claim_id && e.claim_id === tile.claim_id) : [];
  const rollbacks = team?.rollbacks_available ?? 0;
  const lastDice = lastMove?.payload?.dice?.[0] ?? null;
  const lastText = lastMove ? snakesEventText(lastMove, team?.name ?? 'Your team') : null;
  const petDone = Boolean(tile?.claim_id && petClaims?.has(tile.claim_id));
  const canTradePet = working && tile.position < LAST_TILE && !petDone;

  // A new tile closes the pet box: it was opened for the old one.
  useEffect(() => { setPetOpen(false); }, [tile?.position]);

  // Paste a screenshot straight onto the tile, as on the bingo panel -- or into
  // the pet box while that is open.
  useEffect(() => {
    if (!working) return undefined;
    function onPaste(e) {
      const files = [...(e.clipboardData?.files ?? [])];
      const target = petOpen ? petRef.current : uploaderRef.current;
      if (!files.length || !target) return;
      e.preventDefault();
      target.stageFiles(files);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [working, petOpen]);

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

  const earnText = team.auto_rollback_earned
    ? 'Trade in a pet to get another.'
    : 'Earn one by finishing a tile at 40 or higher (once per game), or by trading in a pet.';

  return (
    <section className="bingo-tile-panel snakes-turn" id="snakes-turn-section" aria-labelledby="snakes-turn-title">
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
        <div className="snakes-current" id="snakes-task-section">
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
              prominent
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

      {isActive && team.board_tile > 0 && (
        <div className="snakes-rollback" id="snakes-rollback-section">
          {rollbacks > 0 ? (
            <button
              className="ghost snakes-rollback-btn"
              disabled={Boolean(busy)}
              onClick={onRollback}
              title={`The next one goes back ${rollbackSize(team.rollbacks_used)}.`}
            >
              {busy === 'rollback'
                ? 'Going back…'
                : <>Stuck on this tile? ⏪ Use a rollback ({rollbacks} left)</>}
            </button>
          ) : (
            <p className="snakes-rollback-none">No rollbacks{team.rollbacks_used > 0 ? ' left' : ' yet'}.</p>
          )}
          <p className="snakes-rollback-how">{earnText}</p>

          {canTradePet && !petOpen && (
            <button className="link snakes-pet-open" onClick={() => setPetOpen(true)}>
              🐾 Got a pet? Trade it for a rollback
            </button>
          )}
          {canTradePet && petOpen && (
            <PetTrade
              ref={petRef}
              game={game}
              team={team}
              tile={tile}
              confirm={confirm}
              onClose={() => setPetOpen(false)}
              onDone={async () => { setPetOpen(false); await onRefresh?.(); }}
            />
          )}
          {working && petDone && (
            <p className="snakes-rollback-how">🐾 Your team traded a pet on this tile.</p>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {!isActive && game.status === 'finished' && <p className="muted">The game is over.</p>}
      {confirmDialog}
    </section>
  );
}

/**
 * Hand in a pet screenshot for one rollback (snakes_trade_pet). The tile is not
 * completed by it -- the team still finishes it, or spends the rollback to get
 * off it -- and the pet cannot count towards the tile as well. Once per tile.
 *
 * One file, staged first like the uploader, so a wrong paste can be taken back
 * before it is sent. Exposes `stageFiles` for the panel's paste handler.
 */
const PetTrade = forwardRef(function PetTrade({ game, team, tile, confirm, onClose, onDone }, ref) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function stage(files) {
    const image = [...files].find((f) => f.type.startsWith('image/'));
    if (!image) {
      if (files.length) setError('That was not an image.');
      return;
    }
    setError(null);
    setFile(image);
  }

  useImperativeHandle(ref, () => ({ stageFiles: stage }));

  async function send() {
    const ok = await confirm(
      `Trade this pet for a rollback? "${tile.name}" stays unfinished: your team still has to `
      + 'complete it, or use a rollback to get off it. The pet cannot count for this tile as well.',
      { title: 'Trade the pet?', confirmLabel: 'Trade for a rollback' },
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const claimId = tile.claim_id ?? await snakesOpenTile(game.id);
      if (!claimId) throw new Error('Could not open this tile.');
      await tradePet({ gameId: game.id, teamId: team.id, claimId, file });
      await onDone?.();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="snakes-pet">
      <p>
        <strong>🐾 Trade a pet for a rollback.</strong> Got a pet while doing this tile? Hand in a
        screenshot and your team gets <strong>1 rollback</strong>. The tile is <strong>not</strong>{' '}
        completed, and a pet counts for the tile or a rollback, not both. Once per tile.
      </p>
      {file ? (
        <div className="row">
          <span className="evidence-staged-name">{file.name || 'Screenshot'}</span>
          <button className="ghost" disabled={busy} onClick={() => setFile(null)}>Remove</button>
          <button disabled={busy} onClick={send}>{busy ? 'Trading…' : 'Trade for a rollback'}</button>
        </div>
      ) : (
        <div className="row">
          <button className="ghost" onClick={() => inputRef.current?.click()}>Choose the pet screenshot</button>
          <button className="link" onClick={onClose}>Cancel</button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => { stage(e.target.files); e.target.value = ''; }}
          />
        </div>
      )}
      {!file && <p className="muted">Or paste it while this box is open.</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
});

