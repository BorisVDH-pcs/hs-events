import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { modeLabel } from '../lib/site.js';

/**
 * "Now running" on the login page: which events are on, before anyone signs in.
 *
 * `games` is `for select using (true)` (0001) and was never narrowed, so the
 * anonymous client can already read names, modes and times; this shows nothing
 * a visitor could not fetch themselves. Tile contents, rosters' progress and
 * evidence are all behind their own policies and are not touched here.
 *
 * Silent on failure and when nothing is on: the sign-in form is the point of
 * the page, and a red error above it about a game list would only alarm.
 */
const SHOW = 3;

const when = (iso) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

export default function NowRunning() {
  const [games, setGames] = useState([]);

  useEffect(() => {
    if (!supabase) return undefined;
    let cancelled = false;
    supabase
      .from('games')
      .select('id, name, mode, status, starts_at, ends_at')
      // `placement` is what the players call preparation: set up, not started.
      .in('status', ['active', 'placement'])
      .order('created_at', { ascending: false })
      .limit(SHOW)
      .then(({ data, error }) => {
        if (!cancelled && !error) setGames(data ?? []);
      });
    return () => { cancelled = true; };
  }, []);

  if (games.length === 0) return null;

  // Running first, then what is coming; each group newest first as fetched.
  const ordered = [...games].sort(
    (a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1),
  );

  return (
    <ul className="now-running" aria-label="Events">
      {ordered.map((g) => {
        const live = g.status === 'active';
        const time = live
          ? g.ends_at && `ends ${when(g.ends_at)}`
          : g.starts_at && `starts ${when(g.starts_at)}`;
        return (
          <li key={g.id} className={live ? 'live' : 'soon'}>
            <span className="now-running-state">{live ? 'Now running' : 'Coming up'}</span>
            <span className="now-running-name">{g.name}</span>
            <span className="now-running-meta">
              {modeLabel(g.mode)}{time ? ` · ${time}` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
