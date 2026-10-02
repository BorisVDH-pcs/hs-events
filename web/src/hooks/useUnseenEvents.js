import { useEffect, useState } from 'react';

const NONE = [];

/**
 * How many feed lines arrived while this tab was in the background, for the
 * tab title: "(2) Game name" tells a player in another tab -- Discord, the
 * game itself -- that something happened, without a sound or a pop-up.
 *
 * Counted by id against what the feed held when the tab was hidden, so it is
 * the player's own feed: whatever the database lets them read, every line of
 * which EventFeed shows. Back to 0 the moment the tab is looked at.
 *
 * `ready` is false while the game is still loading. A tab opened in the
 * background takes its "already seen" snapshot once the first load is in,
 * otherwise that whole first load would count as new.
 */
export default function useUnseenEvents(events, ready) {
  const list = events ?? NONE;
  const [hidden, setHidden] = useState(() => document.hidden);
  const [seen, setSeen] = useState(null);

  useEffect(() => {
    const onChange = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  useEffect(() => {
    if (!hidden || !ready) { setSeen(null); return; }
    setSeen((s) => s ?? new Set(list.map((e) => e.id)));
  }, [hidden, ready, list]);

  if (!hidden || !ready || !seen) return 0;
  return list.filter((e) => !seen.has(e.id)).length;
}
