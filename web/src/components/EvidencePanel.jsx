import { useEffect, useState } from 'react';
import { signedUrls } from '../lib/evidence.js';
import { evidenceSourcesFor } from '../lib/supabase.js';
import { evidenceSource, withSources } from '../lib/evidenceSource.js';

/**
 * What has been submitted for one tile.
 *
 * Shared by the organiser's board and a team's own, because the question is the
 * same from both sides — "what did we send for this?" — and only the gate
 * differs. A team's rows come from my_evidence(), which is scoped to their own
 * teams; an organiser's come from admin_list_evidence(), which is not. Neither
 * decision is made here.
 *
 * Signed URLs are minted for the open tile only, rather than for every piece of
 * evidence in the game up front. They expire, so a panel left open all evening
 * would otherwise quietly stop showing images.
 *
 * A picture a plugin (Dink) sent gets what the plugin reported beside it: the
 * drop, how many, from what, the world. Its screenshot does not always show the
 * drop, so this line is how anyone looking knows what the picture is for. Asked
 * for the open tile only, like the URLs, through evidence_sources(), which
 * answers for the caller's own team's evidence or a game they run and nothing
 * else. "Sent by plugin", never "verified": see lib/evidenceSource.js.
 */
export default function EvidencePanel({ title, coord, meta, items, onClose }) {
  const [urls, setUrls] = useState({});
  const [error, setError] = useState(null);
  const [sources, setSources] = useState(null);
  const [sourceNote, setSourceNote] = useState(null);

  const paths = items.map((e) => e.storage_path).join('\n');
  const ids = items.map((e) => e.id).join('\n');

  useEffect(() => {
    let cancelled = false;
    const list = paths ? paths.split('\n') : [];
    if (!list.length) { setUrls({}); return; }
    signedUrls(list)
      .then((map) => { if (!cancelled) { setUrls(map); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [paths]);

  // Which of these a plugin sent, and what it reported. Null (no lines, the
  // panel as it always was) while the database has no such function; a failure
  // costs the lines, not the pictures.
  useEffect(() => {
    let cancelled = false;
    const list = ids ? ids.split('\n') : [];
    if (!list.length) { setSources(null); setSourceNote(null); return undefined; }
    evidenceSourcesFor(list)
      .then((rows) => { if (!cancelled) { setSources(rows); setSourceNote(null); } })
      .catch((e) => {
        if (!cancelled) {
          setSources(null);
          setSourceNote(`Could not tell which screenshots a plugin sent: ${e.message}`);
        }
      });
    return () => { cancelled = true; };
  }, [ids]);

  const shown = withSources(items, sources);

  return (
    <div className="tile-evidence-panel">
      <div className="panel-head">
        <h3>
          {title}
          {coord && <span className="coord"> {coord}</span>}
        </h3>
        <button className="ghost" onClick={onClose}>Close</button>
      </div>
      {meta && <p className="muted">{meta}</p>}
      {error && <p className="error">{error}</p>}
      {sourceNote && <p className="muted">{sourceNote}</p>}

      {shown.length === 0 ? (
        <p className="muted">Nothing submitted for this tile yet.</p>
      ) : (
        <ul className="evidence-review">
          {shown.map((e, i) => {
            const sent = evidenceSource(e);
            return (
              <li key={e.id}>
                {/* The screenshot is the whole of the row and the whole of the
                    link, so an empty alt left the link with no name at all —
                    announced as "link", full stop, four times over.
                    Numbered rather than named after its uploader: one tile's
                    evidence is usually four shots from the same person minutes
                    apart, so the uploader does not tell them apart, and it is
                    read out anyway from the meta line beside the picture. */}
                <a href={urls[e.storage_path]} target="_blank" rel="noreferrer">
                  {urls[e.storage_path]
                    ? (
                      <img
                        src={urls[e.storage_path]}
                        alt={`Screenshot ${i + 1} of ${shown.length} for ${title}`}
                        loading="lazy"
                      />
                    )
                    : <span className="evidence-pending" />}
                </a>
                <div className="meta">
                  {sent && (
                    <div className="evidence-tags">
                      <span className="evidence-sent" title={sent.title}>{sent.label}</span>
                    </div>
                  )}
                  {sent?.drop && <span className="evidence-sent-drop">{sent.drop}</span>}
                  <strong>{e.uploaded_by_name}</strong>
                  <span className="muted">{new Date(e.created_at).toLocaleString()}</span>
                  {sent?.lines.map((line) => (
                    <span key={line} className="muted evidence-sent-detail">{line}</span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
