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

/**
 * Which of two events a player should be offered first: the one starting
 * soonest.
 *
 * Only ever used on the OPEN list, and only because of what Home leads with.
 * `gameUrgency` ranks a game by what state it is in, which settles the list of
 * games somebody is already playing -- but every open event is in the same
 * state, so urgency cannot tell two of them apart. What separates them is the
 * clock: a sign-up closing on Thursday is more use to somebody tonight than
 * one closing in three weeks.
 *
 * An event with no `starts_at` sorts last rather than first. `starts_at` is
 * nullable (0013) and plenty of events never get one, and a null read as zero
 * would put every undated event ahead of the one actually starting tomorrow.
 * Within the undated, newest first, which is the order the lists already
 * arrive in.
 */
export function bySoonest(a, b) {
  const at = startTime(a);
  const bt = startTime(b);
  if (at !== bt) {
    if (at === null) return 1;
    if (bt === null) return -1;
    return at - bt;
  }
  return new Date(b?.createdAt ?? 0) - new Date(a?.createdAt ?? 0);
}

function startTime(game) {
  if (!game?.startsAt) return null;
  const at = Date.parse(game.startsAt);
  // A date the browser cannot read is the same as no date: undated, last,
  // rather than NaN poisoning every comparison it takes part in.
  return Number.isNaN(at) ? null : at;
}

/**
 * Split a player's own games into the ones still to play and the ones over.
 *
 * Home shows these as two tabs rather than one list. A finished event is not
 * nothing -- the ladder is the whole point of having played it -- but it is
 * done, and a player with a season behind them had to scroll past all of it
 * to reach the bingo running tonight. History is a place to go and look, not
 * something to put in front of somebody who opened the app to play.
 *
 * `finished` comes back newest first. That is `created_at`, not a finish time,
 * because the row has no finish time to sort on: `games` records when an event
 * was made and when it starts, not when it ended. For a history list the two
 * orders only disagree when a short event is created before a long one that
 * ends sooner, which is rare enough to be worth less than another column.
 */
export function splitFinished(games) {
  const all = games ?? [];
  return {
    current: all.filter((g) => g?.status !== 'finished'),
    finished: all
      .filter((g) => g?.status === 'finished')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  };
}
