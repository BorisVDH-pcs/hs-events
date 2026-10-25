/**
 * What the games list MEANS, as opposed to where it comes from.
 *
 * Split from games.js, which it describes, for a plain reason: games.js
 * imports the Supabase client, the client reads `import.meta.env`, and that
 * exists only inside Vite. Anything importing games.js therefore has to be
 * bundled, which puts it out of reach of `scripts/*-selftest.mjs` -- and the
 * rules below are exactly the kind that are worth a test, because they decide
 * what a player sees first and will go quietly wrong if the shape of a row
 * changes. Nothing in here fetches, so nothing in here needs the client.
 */

/**
 * Split the picker's flat list into the two things Home shows separately.
 *
 * `listMyGames` deliberately mixes three kinds of row — games this player is
 * rostered into, challenges they have entered, and challenges merely open for
 * sign-ups — because the old header dropdown had one list and nowhere to
 * explain itself. On Home there is room to tell them apart, and the
 * difference matters: "the bingo you are playing" and "an event you could
 * enter" are not the same offer, and putting them in one list was the reason
 * `listMyChallenges` needed a paragraph justifying why strangers' events were
 * in a player's own picker at all.
 *
 * `mine` keeps listMyGames' order, which is load-bearing: rostered first so a
 * new event never buries the bingo somebody is mid-way through.
 */
export function groupGames(games) {
  const all = games ?? [];
  return {
    // Rostered into, or entered. Yours either way.
    mine: all.filter((g) => g.teamId !== null || g.joined === true),
    // Open, and not entered. An invitation, not a game in progress.
    open: all.filter((g) => g.teamId === null && g.joined !== true),
  };
}

/**
 * Whether a game is worth putting in front of somebody right now.
 *
 * Used to pick the one card Home leads with. 'active' beats everything: it is
 * running and the clock is against them. A game still in setup or placement
 * is next, because it is about to need them. Finished is last -- there is
 * nothing left to do but read the ladder.
 */
export function gameUrgency(game) {
  if (game?.status === 'active') return 0;
  if (game?.status === 'finished') return 2;
  return 1;
}
