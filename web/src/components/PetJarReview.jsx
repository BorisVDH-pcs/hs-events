import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminListPetJars, adminRevokePetJar } from '../lib/supabase.js';
import { petJarSignedUrls } from '../lib/petJar.js';
import { coordLabel, fromPosition } from '../lib/board.js';
import { useConfirm } from './ConfirmDialog.jsx';

/**
 * The organiser's read of every pet/jar screenshot in a game, and the one
 * place a bad one can be taken back.
 *
 * EvidenceReview's sibling, built the same way: the rows are fetched once,
 * only the page on screen is signed (the `pet-jar` bucket is private and its
 * URLs expire after the hour), and a tab left open past that re-signs on
 * focus. Revoke previews first — `admin_revoke_pet_jar` runs its real body
 * and rolls back, so the dialog says what WILL happen, including the case
 * where the credit is already spent and a preview is withdrawn instead.
 */

const PAGE = 30;
const RESIGN_AFTER_MS = 45 * 60 * 1000;

/** The dry run, as sentences. */
function consequences(p) {
  const out = [];
  if (p.credit_removed) {
    out.push(`${p.team_name} loses the unspent preview it earned — ${p.count_before} → ${p.count_after}.`);
  } else if (p.preview_withdrawn) {
    const { row, col } = fromPosition(p.preview_position);
    out.push(`${p.team_name} has already spent it, so its latest preview — `
      + `${p.preview_tile_name} ${coordLabel(row, col)} — is taken back and hidden again.`);
  } else if (p.nothing_to_take) {
    out.push(`${p.team_name} has already spent it on a tile it has since locked in, `
      + 'so there is nothing left to take back. Only the submission is removed.');
  }
  out.push('The team is told in its own feed and Discord channel. The other team is told nothing.');
  return out;
}

export default function PetJarReview({ gameId }) {
  const [rows, setRows] = useState([]);
  const [urls, setUrls] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [team, setTeam] = useState('');
  const [page, setPage] = useState(0);

  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [confirm, confirmDialog] = useConfirm();

  const mintedAt = useRef(0);
  const signSeq = useRef(0);

  useEffect(() => {
    if (!gameId) { setRows([]); return undefined; }
    let cancelled = false;
    setLoading(true);
    adminListPetJars(gameId)
      .then((data) => {
        if (cancelled) return;
        setRows(data ?? []);
        setError(null);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [gameId, tick]);

  const teams = useMemo(
    () => [...new Set(rows.map((r) => r.team_name).filter(Boolean))].sort(),
    [rows]
  );
  const filtered = useMemo(
    () => (team ? rows.filter((r) => r.team_name === team) : rows),
    [rows, team]
  );

  useEffect(() => { setPage(0); }, [team]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const pageKey = shown.map((r) => r.storage_path).join('\n');

  const sign = useCallback(async (paths) => {
    if (!paths.length) { setUrls({}); return; }
    const seq = ++signSeq.current;
    try {
      const map = await petJarSignedUrls(paths);
      if (seq !== signSeq.current) return;
      setUrls(map);
      mintedAt.current = Date.now();
      setError(null);
    } catch (e) {
      if (seq === signSeq.current) setError(e.message);
    }
  }, []);

  useEffect(() => {
    sign(pageKey ? pageKey.split('\n') : []);
  }, [pageKey, sign]);

  useEffect(() => {
    if (!pageKey) return undefined;
    const recheck = () => {
      if (document.hidden) return;
      if (Date.now() - mintedAt.current < RESIGN_AFTER_MS) return;
      sign(pageKey.split('\n'));
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [pageKey, sign]);

  const revoke = useCallback(async (r) => {
    setBusy(r.id);
    try {
      const p = await adminRevokePetJar(r.id, true);
      const ok = await confirm(
        <>
          {r.team_name}, submitted by <strong>{r.submitted_by_name}</strong>
          {' '}at {new Date(r.created_at).toLocaleString()}.
          {consequences(p).map((line) => (
            <span key={line}><br />{line}</span>
          ))}
        </>,
        {
          title: 'Revoke this pet/jar submission?',
          confirmLabel: 'Revoke it',
          danger: true,
        },
      );
      if (!ok) return;

      await adminRevokePetJar(r.id, false);
      setTick((t) => t + 1);
      setActionError(null);
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(null);
    }
  }, [confirm]);

  if (error) return <p className="error">{error}</p>;
  if (loading) return <p className="muted">Loading pet/jar submissions…</p>;
  if (!rows.length) return <p className="muted">No pet/jar submissions yet.</p>;

  return (
    <>
      {confirmDialog}
      {actionError && <p className="error">{actionError}</p>}

      <div className="evidence-filters">
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Filter by team">
          <option value="">Both teams</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="muted">
          {team ? `${filtered.length} of ${rows.length}` : `${rows.length} submitted`}
        </span>
      </div>

      <ul className="evidence-review">
        {shown.map((r) => (
          <li key={r.id}>
            <a href={urls[r.storage_path]} target="_blank" rel="noreferrer">
              {urls[r.storage_path]
                ? <img
                    src={urls[r.storage_path]}
                    alt={`Pet/jar submitted by ${r.submitted_by_name}`}
                    loading="lazy"
                  />
                : <span className="evidence-pending" />}
            </a>
            <div className="meta">
              <strong>{r.submitted_by_name}</strong>
              <span className="muted">
                {r.team_name} · {new Date(r.created_at).toLocaleString()}
              </span>
            </div>
            <button
              className="ghost danger evidence-revoke"
              disabled={busy !== null}
              onClick={() => revoke(r)}
              aria-label={`Revoke ${r.submitted_by_name}'s pet/jar submission`}
            >
              {busy === r.id ? 'Checking…' : 'Revoke'}
            </button>
          </li>
        ))}
      </ul>

      {pageCount > 1 && (
        <div className="evidence-pager">
          <button
            className="ghost"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← Newer
          </button>
          <span className="muted">Page {page + 1} of {pageCount}</span>
          <button
            className="ghost"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Older →
          </button>
        </div>
      )}
    </>
  );
}
