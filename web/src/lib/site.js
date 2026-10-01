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

/** The browser tab: the game when there is one, the platform always. */
export function pageTitle(gameName) {
  return gameName ? `${gameName} — ${SITE_NAME}` : SITE_NAME;
}
