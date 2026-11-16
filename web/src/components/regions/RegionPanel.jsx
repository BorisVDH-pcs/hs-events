import { useState } from 'react';
import {
  pickConfirm, pickRefusal, pts, regionByKey, regionStatus,
} from '../../lib/regions.js';
import { markerColor } from '../../lib/snakes.js';
import { useConfirm } from '../ConfirmDialog.jsx';
import RegionBar from './RegionBar.jsx';

const STATUS = {
  locked: 'Not opened',
  open: 'Opened',
  complete: 'Complete — its pick is ready',
  spent: 'Complete',
};

/**
 * The region a player pressed on the map.
 *
 * Opened: how far the team is towards the line and who else is there; its
 * tasks are on the map, which steps into the region (RegionMap). Not opened: nothing of what is inside (the server sends
 * nothing), only whether the team may open it, and the button that does,
 * behind a confirm dialog because a pick cannot be taken back.
 *
 *   region     one entry of fromServer().regions
 *   presence   the teams that have opened it (public)
 */
export default function RegionPanel({
  game, view, region, presence, myTeamId, finished, onPick, onRefresh, onClose,
}) {
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const status = regionStatus(region);
  const refusal = status === 'locked' ? pickRefusal({ game, view, regionKey: region.key, myTeamId }) : null;
  const canPick = status === 'locked' && !refusal && myTeamId;

  async function pick() {
    const words = pickConfirm(view, region.key);
    if (!(await confirm(words.body, { title: words.title, confirmLabel: words.confirmLabel }))) return;
    setBusy(true);
    setError(null);
    try {
      await onPick(region.key);
      onRefresh?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`bingo-tile-panel regions-panel ${status}`} aria-labelledby="regions-panel-title">
      {confirmDialog}
      <div className="bingo-tile-head">
        <div>
          <h2 id="regions-panel-title">{region.name}</h2>
          <p className="muted">{region.opened ? STATUS[status] : finished ? 'Your team never opened it' : STATUS.locked}</p>
        </div>
        <button className="ghost" onClick={onClose} aria-label="Close region">Close</button>
      </div>

      {region.total != null && (region.opened || finished) && (
        <div className="regions-progress">
          <div className="regions-progress-numbers">
            <strong>{region.points ?? 0}</strong>
            <span className="muted"> / {pts(region.total)}</span>
          </div>
          <RegionBar region={region} />
          {region.fundedBy && (
            <p className="muted regions-funded">
              Opened with the pick {regionByKey.get(region.fundedBy)?.name ?? 'another region'} earned.
            </p>
          )}
          {status === 'spent' && <p className="muted regions-funded">Its pick has been spent.</p>}
        </div>
      )}

      {status === 'locked' && !finished && (
        <div className="regions-locked">
          <p>
            Its tasks stay hidden until your team opens it.
            {view.needsStart ? ' Your first region is free.' : ''}
          </p>
          {canPick ? (
            <button className="regions-pick" onClick={pick} disabled={busy}>
              {busy ? 'Opening…' : view.needsStart ? `Start in ${region.name}` : `Open ${region.name}`}
            </button>
          ) : (
            refusal && <p className="muted">{refusal}</p>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}


      {presence.length > 0 && (
        <p className="muted regions-presence">
          Opened by{' '}
          {presence.map((t, i) => (
            <span key={t.id}>
              {i > 0 && (i === presence.length - 1 ? ' and ' : ', ')}
              <i className="regions-team-swatch" style={{ background: markerColor(t.slot) }} aria-hidden="true" />
              {t.id === myTeamId ? 'your team' : t.name}
            </span>
          ))}
          .
        </p>
      )}
    </section>
  );
}
