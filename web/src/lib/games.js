import { challengeList, supabase } from './supabase.js';

/**
 * Every challenge this player can reach: the ones they have entered, and the
 * ones still open for sign-ups.
 *
 * A challenge is opt-in and a solo one has no teams at all, so `team_members`
 * -- which answers this question for every other mode -- has nothing to find,
 * and an event nobody has joined yet has nothing anywhere. A sign-up screen
 * that cannot be reached is a sign-up screen that does not work, so the open
 * ones are listed whether this player is in them or not: that is the way to
 * the Sign up button.
 *
 * Fails soft on its own rather than through the caller's catch: a client ahead
 * of its migration keeps the games it could already see.
 */
async function listMyChallenges() {
  try {
    const rows = await challengeList();
    return (rows ?? []).map((c) => ({
      gameId: c.game_id,
      gameName: c.name,
      // challenge_list only ever answers with challenges, so the mode is not
      // in the payload and does not need to be.
      mode: 'challenge',
      status: c.status,
      createdAt: c.created_at,
      // A challenge has no team of this player's to name. A team event does
      // have teams, but entrants are not team_members -- an organiser puts
      // them on one, and the event's own screen says which.
      teamId: null,
      teamName: null,
      joined: c.joined === true,
    }));
  } catch {
    return [];
  }
}

/**
 * Every game this player is rostered into, newest first.
 *
 * `games`, `teams` and `team_members` are all `for select using (true)` (0001),
 * so one nested read answers this without an RPC or a migration.
 *
 * The dedupe tie-break is NOT cosmetic. A player may sit in both teams of one
 * game -- 0024 keeps that legal on purpose, because one browser driving both
 * sides is a useful testing trick -- and three places already resolve that tie
 * by team name ascending: `my_team_in_game()` (0024), the RLS-side helpers it
 * feeds, and useGame.js, which takes the first match against `teams` ordered by
 * name. If the picker broke the tie any other way it would name one team in the
 * dropdown while the board played as the other.
 */
export async function listMyGames(uid) {
  if (!supabase || !uid) return [];

  const { data, error } = await supabase
    .from('team_members')
    // `games!teams_game_id_fkey` and not plain `games`: there are two foreign
    // keys between these tables -- teams.game_id -> games.id, and the
    // games.winner_team_id -> teams.id added after teams existed (0001) -- so
    // an unqualified embed is ambiguous and PostgREST rejects the whole query
    // with PGRST201. Verified against the live schema, not assumed.
    .select('teams!inner(id, name, game_id, games!teams_game_id_fkey!inner(id, name, mode, status, created_at))')
    .eq('profile_id', uid);

  if (error) throw new Error(error.message);

  // A to-one embed comes back as an object on current PostgREST and as a
  // one-element array on older builds. Both shapes are accepted rather than
  // betting the picker on which one the project is running.
  const one = (v) => (Array.isArray(v) ? v[0] : v) ?? null;

  // Fold the rows down to one entry per game, keeping the name-first team.
  const byGame = new Map();
  for (const row of data ?? []) {
    const team = one(row.teams);
    const game = one(team?.games);
    if (!team || !game) continue;

    const existing = byGame.get(game.id);
    // localeCompare, matching the `order('name')` the rest of the app sorts by.
    if (existing && existing.teamName.localeCompare(team.name) <= 0) continue;

    byGame.set(game.id, {
      gameId: game.id,
      gameName: game.name,
      // Home names the mode on every card; the old header dropdown showed the
      // game name alone and never needed it.
      mode: game.mode,
      status: game.status,
      createdAt: game.created_at,
      teamId: team.id,
      teamName: team.name,
    });
  }

  const rostered = [...byGame.values()];
  const challenges = (await listMyChallenges()).filter((c) => !byGame.has(c.gameId));

  // Rostered games first, then challenges this player entered, then the ones
  // merely open. The order is not cosmetic: Home leads with the first card of
  // `mine`, so sorting the whole list by date alone would push the bingo
  // somebody is mid-way through below next week's event the moment an
  // organiser creates it.
  const rank = (g) => (g.teamId ? 0 : g.joined ? 1 : 2);
  return [...rostered, ...challenges].sort(
    (a, b) => rank(a) - rank(b) || new Date(b.createdAt) - new Date(a.createdAt)
  );
}
