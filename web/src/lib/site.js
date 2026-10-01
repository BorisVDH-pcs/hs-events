/**
 * The platform's own name and where it lives, in one place.
 *
 * The site started as HS Battleships and was renamed High Society Events once it
 * ran more than one kind of game. Every screen that names the platform or links
 * to the repo reads it from here, so the next rename is one file.
 */
export const SITE_NAME = 'High Society Events';
export const REPO_URL = 'https://github.com/BorisVDH-pcs/hs-events';

/**
 * The subtitle under the crest, by game mode. Battleships keeps the artwork it
 * was drawn with; every other mode is set in the CSS gold wordmark, so a new
 * mode only needs a line here. `null` (no game on screen) says what the
 * platform is.
 */
const MODE_TITLES = {
  battleships: { text: 'Battleships', image: 'battleships-wordmark.png' },
  bingo: { text: 'Bingo' },
  snakes: { text: 'Snakes & Ladders' },
};

export function modeTitle(mode) {
  return MODE_TITLES[mode] ?? { text: 'Events' };
}

/** What a game's mode is called in running text, e.g. "Now running". */
export function modeLabel(mode) {
  return MODE_TITLES[mode]?.text ?? 'Event';
}

/**
 * What the waiting screens say before a game starts, by mode: the full-screen
 * countdown for a player with no team (or a game not open yet) and the
 * one-line badge during preparation. Battleships keeps its naval voice; the
 * other modes talk about their own game, and an unknown mode says nothing
 * that belongs to any one of them.
 */
const WAITING_WORDS = {
  battleships: {
    title: 'Please await orders',
    assigned: (team) => `You're aboard ${team}. Keep this channel open — the board opens once an admin gives the order.`,
    opens: 'Battle stations open',
    soon: 'Battle stations in',
    standby: 'Battle stations: waiting on an admin to start',
  },
  bingo: {
    title: 'Eyes down soon',
    assigned: (team) => `You're on ${team}. The card is revealed the moment an admin starts the game.`,
    opens: 'The card is revealed',
    soon: 'The card is revealed in',
    standby: 'Card ready: waiting on an admin to start',
  },
  snakes: {
    title: 'Lining up at the start',
    assigned: (team) => `You're on ${team}. The board opens and the first die is rolled once an admin starts the game.`,
    opens: 'The first roll is',
    soon: 'First roll in',
    standby: 'Everyone at Start: waiting on an admin to start',
  },
};
const WAITING_DEFAULT = {
  title: 'Waiting for the game to start',
  assigned: (team) => `You're on ${team}. The game opens once an admin starts it.`,
  opens: 'The game starts',
  soon: 'Starts in',
  standby: 'Waiting on an admin to start',
};

export function waitingWords(mode) {
  return WAITING_WORDS[mode] ?? WAITING_DEFAULT;
}

/** The browser tab: the game when there is one, the platform always. */
export function pageTitle(gameName) {
  return gameName ? `${gameName} — ${SITE_NAME}` : SITE_NAME;
}
