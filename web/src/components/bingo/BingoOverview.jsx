import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { coordLabel, fromPosition } from '../../lib/board.js';
import { countLabel } from '../../lib/bingo.js';
import { adminProgress } from '../AdminOverview.jsx';
import EvidencePanel from '../EvidencePanel.jsx';
import BingoCard from './BingoCard.jsx';
import BingoStandings from './BingoStandings.jsx';

/**
 * The organiser's view of a running bingo: the standings, and any team's card
 * with its part-done tiles showing — which players of other teams never see.
 *
 * Built from the same three admin-only reads the battleships overview uses,
 * so the gate is still the database. `admin_tile_progress` cross-joins every
 * team with every tile, so a team's card is one filter away.
 *
 * Same refresh rules as AdminOverview: the feed announces completions, and an
 * upload that does not complete a tile writes no event, so a 20-second poll
 * keeps the progress counts honest.
 */
export default function BingoOverview({ game, teams }) {
  const gameId = game.id;
  const [rows, setRows] = useState([]);
  const [standings, setStandings] = useState([]);
  const [evidence, setEvidence] = useState([]);
  const [teamId, setTeamId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s, e] = await Promise.all([
        supabase.rpc('admin_tile_progress', { p_game_id: gameId }),
        supabase.rpc('bingo_standings', { p_game_id: gameId }),
        supabase.rpc('admin_list_evidence', { p_game_id: gameId }),
      ]);
      const failed = [p, s, e].find((r) => r.error);
      if (failed) throw new Error(failed.error.message);
      setRows(p.data ?? []);
      setStandings(s.data ?? []);
      setEvidence(e.data ?? []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel(`admin-bingo-${gameId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_events', filter: `game_id=eq.${gameId}` },
        () => load())
      .subscribe();
    const id = setInterval(load, 20000);
    return () => { supabase.removeChannel(ch); clearInterval(id); };
  }, [gameId, load]);

  // The team on screen: the one picked, else the leader. A deleted team falls
  // back the same way rather than leaving an empty card.
  const shownTeamId = teams.some((t) => t.id === teamId)
    ? teamId
    : standings[0]?.team_id ?? teams[0]?.id ?? null;
  const shownTeam = standings.find((s) => s.team_id === shownTeamId);

  // admin_tile_progress rows, reshaped into what BingoCard draws from
  // tiles_for_me, so the organiser sees the same card a player does.
  const tiles = useMemo(() => rows
    .filter((r) => r.team_id === shownTeamId)
    .map((r) => ({
      ...r,
      id: r.tile_id,
      name: r.tile_name,
      claim_status: r.status,
    })), [rows, shownTeamId]);

  const selected = tiles.find((t) => t.id === selectedId) ?? null;
  const shown = selected?.claim_id ? evidence.filter((e) => e.claim_id === selected.claim_id) : [];

  if (error) return <p className="error">{error}</p>;
  if (teams.length === 0) return <p className="muted">No teams yet.</p>;
  if (!rows.length) {
    return <p className="muted">{loading ? 'Loading cards…' : 'No tiles on this card yet.'}</p>;
  }

  return (
    <div className="bingo-overview">
      <BingoStandings
        standings={standings}
        myTeamId={null}
        viewingTeamId={shownTeamId}
        onView={(id) => { setTeamId(id ?? null); setSelectedId(null); }}
      />

      <div>
        <h3>
          {shownTeam ? `${shownTeam.team_name} · ${countLabel(shownTeam)}` : 'Card'}
        </h3>
        <BingoCard
          size={game.grid_size}
          tiles={tiles}
          selectedId={selectedId}
          onSelect={(tile) => {
            setSelectedId((id) => (id === tile.id ? null : tile.id));
            requestAnimationFrame(() =>
              panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
          }}
        />
        <p className="legend">
          <span className="legend-item"><span className="key bingo-key done" />completed</span>
          <span className="legend-item"><span className="key bingo-key progress" />part-done</span>
        </p>
      </div>

      {selected && (
        <div ref={panelRef} className="bingo-overview-panel">
          <EvidencePanel
            title={selected.name}
            coord={coordLabel(fromPosition(selected.position).row, fromPosition(selected.position).col)}
            meta={selected.claim_id
              ? `${selected.team_name} · ${adminProgress(selected)}`
                + (selected.status === 'completed' ? ' · completed' : ' · not yet complete')
              : `${selected.team_name} · nothing submitted`}
            items={shown}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}
    </div>
  );
}
