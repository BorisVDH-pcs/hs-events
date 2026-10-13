import { useCallback, useEffect, useState } from 'react';
import { supabase, territoryStandings } from '../../lib/supabase.js';
import { teamInitials } from '../../lib/snakes.js';
import TerritoryStandings from './TerritoryStandings.jsx';

/**
 * The organiser's view of a running conquest: the standings exactly as the
 * server scores them -- the order that decides the winner when the timer runs
 * out. The map itself is one click away under Team screens ("View as").
 *
 * Re-reads on every game event, which every capture, steal and revoke writes.
 */
export default function TerritoryAdminTrack({ game }) {
  const [rows, setRows] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows((await territoryStandings(game.id)) ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    }
  }, [game.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`admin-territory:${game.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_events', filter: `game_id=eq.${game.id}` },
        () => load()
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [game.id, load]);

  const initials = teamInitials(rows);
  const teams = rows.map((r) => ({
    id: r.team_id, name: r.team_name, slot: r.slot, initial: initials.get(r.team_id),
  }));

  return (
    <section className="card">
      {/* TerritoryStandings carries its own "Standings" heading. */}
      {rows.length > 0 && <TerritoryStandings rows={rows} teams={teams} />}
      {loadError && <p className="error">{loadError}</p>}
      <p className="muted">
        One point per place held, plus the bonus for every region held whole.
        A tie goes to the team whose last capture came first.
      </p>
    </section>
  );
}
