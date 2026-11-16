import { useMemo } from 'react';
import { regionsOpenTile, regionsPick, settleRegions } from '../../lib/supabase.js';
import { fromServer } from '../../lib/regions.js';
import RegionsGame from './RegionsGame.jsx';

/**
 * RegionsGame on the real server: the board from board_for_me, shaped by
 * fromServer, and the three things a player can do wired to their RPCs. The
 * harness (/preview-regions.html) renders RegionsGame directly with its own
 * simulation instead.
 */
export default function RegionsLive({
  game, teams, myTeamId, myRole, tiles, regions, standings, events, evidence, onRefresh,
}) {
  const view = useMemo(() => fromServer({ tiles, regions }), [tiles, regions]);
  // Stable per game, so RegionsGame's timer effect is not re-armed on every refresh.
  const actions = useMemo(() => ({
    pick: (key) => regionsPick(game.id, key),
    openTile: (tileId) => regionsOpenTile(tileId),
    settle: () => settleRegions(game.id),
  }), [game.id]);

  return (
    <RegionsGame
      game={game}
      teams={teams}
      myTeamId={myTeamId}
      myRole={myRole}
      view={view}
      standings={standings}
      events={events}
      evidence={evidence}
      actions={actions}
      onRefresh={onRefresh}
    />
  );
}
