import { challengeList, gameSignupList, supabase } from './supabase.js';

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
      // When it starts, which is the fact that decides whether somebody signs
      // up tonight or next week. challenge_list has always returned it; the
      // row simply threw it away, so Home could only ever say "Not started".
      startsAt: c.starts_at,
      endsAt: c.ends_at,
      // What the event IS -- the boss, skill, raid or tier of clue -- and how
      // it is scored. A card with this on it needs no explaining; without it,
      // five challenges in a row are five identical grey rows.
      metric: c.wom_metric,
      rankedBy: c.ranked_by,
      declaredLabel: c.declared_label,
      solo: c.solo,
      // Called `entrants` by challenge_list and `signups` by game_signup_list,
      // because the two tables are not the same thing. On a card they are the
      // same sentence -- how many are in -- so one name reaches Home and the
      // difference stays where it belongs, in the database.
      signups: c.entrants ?? 0,
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
 * Every board event this player could still sign up for, and the ones they
 * already signed up for but have not been put on a team for yet.
 *
 * The same gap listMyChallenges fills, for the four modes that have a board.
 * `team_members` answers "which games am I in", which says nothing at all about
 * an event nobody has rostered this player into -- and that is precisely the
 * event a Sign up button is for.
 *
 * Fails soft on its own, exactly as listMyChallenges does: a client ahead of
 * its migration keeps the games it could already see.
 */
async function listOpenEvents() {
  try {
    const rows = await gameSignupList();
    return (rows ?? []).map((g) => ({
      gameId: g.game_id,
      gameName: g.name,
      mode: g.mode,
      status: g.status,
      createdAt: g.created_at,
      // As above: game_signup_list returns it, the row used to drop it.
      startsAt: g.starts_at,
      // How many are in, which is what makes somebody else join. A count and
      // never a list: who signed up is the organiser's business.
      signups: g.signups ?? 0,
      // Signing up is not being rostered. An organiser puts them on a team
      // afterwards, and from then on the read above finds the same game with
      // its team name on it.
      teamId: null,
      teamName: null,
      joined: g.joined === true,
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
    .select('teams!inner(id, name, game_id, games!teams_game_id_fkey!inner(id, name, mode, status, created_at, starts_at))')
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
      // Added when Home started counting down to it. `starts_at` is nullable
      // (0013) and plenty of games have none -- the card says "Not started"
      // for those, which is the truth rather than a clock at zero.
      startsAt: game.starts_at,
      teamId: team.id,
      teamName: team.name,
    });
  }

  // Both lists are asked at once, and both drop anything already rostered: the
  // same game arriving twice would draw two cards on Home, one of them with no
  // team name on it.
  const [challenges, open] = await Promise.all([listMyChallenges(), listOpenEvents()]);
  const notRostered = [...challenges, ...open].filter((g) => !byGame.has(g.gameId));

  // A TEAM challenge is in both: team_members has the roster, challenge_list
  // has the metric. Dropping the duplicate used to mean dropping the metric
  // with it, so the one card that has a picture to show -- the event you are
  // actually in -- was the one card that showed none. The roster's own answers
  // win every field it has; the rest is taken from the list that knows it.
  const extra = new Map([...challenges, ...open].map((g) => [g.gameId, g]));
  const rostered = [...byGame.values()].map((g) => {
    const more = extra.get(g.gameId);
    return more ? { ...more, ...g } : g;
  });

  // Rostered games first, then the events this player has put their hand up
  // for, then the ones merely open. The order is not cosmetic: Home leads with
  // the first card of `mine`, so sorting the whole list by date alone would
  // push the bingo somebody is mid-way through below next week's event the
  // moment an organiser creates it.
  const rank = (g) => (g.teamId ? 0 : g.joined ? 1 : 2);
  return [...rostered, ...notRostered].sort(
    (a, b) => rank(a) - rank(b) || new Date(b.createdAt) - new Date(a.createdAt)
  );
}
