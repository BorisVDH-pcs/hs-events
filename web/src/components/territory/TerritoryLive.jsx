import { useMemo } from 'react';
import { settleTerritory, territoryDropTile, territoryOpenTile } from '../../lib/supabase.js';
import { fromServer } from '../../lib/territory.js';
import TerritoryGame from './TerritoryGame.jsx';

/**
 * TerritoryGame on the real server: the board from board_for_me, shaped by
 * fromServer into what the map draws, and the three things a player can do
 * wired to their RPCs. The harness (/preview-territory.html) renders
 * TerritoryGame directly with its own simulation instead.
 */
export default function TerritoryLive({
  game, teams, myTeamId, myRole, tiles, territory, events, evidence, onRefresh,
}) {
  const board = useMemo(
    () => fromServer({ teams, tiles, territory, myTeamId }),
    [teams, tiles, territory, myTeamId],
  );
  // Stable per game, so TerritoryGame's timer effect is not re-armed on every
  // refresh.
  const actions = useMemo(() => ({
    open: (key) => territoryOpenTile(game.id, key),
    drop: (key) => territoryDropTile(game.id, key),
    settle: () => settleTerritory(game.id),
  }), [game.id]);

  return (
    <TerritoryGame
      game={game}
      teams={teams}
      myTeamId={myTeamId}
      myRole={myRole}
      tiles={board.tiles}
      owners={board.owners}
      homes={board.homes}
      open={board.open}
      attacked={board.attacked}
      captures={board.captures}
      bonuses={board.bonuses}
      events={events}
      evidence={evidence}
      actions={actions}
      onRefresh={onRefresh}
    />
  );
}
