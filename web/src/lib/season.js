// What the interface is dressed in today.
//
// A season is allowed to repaint and nothing else. seasons.css may only
// redeclare tokens :root already defines and the two atmosphere layers that
// sit behind the app at z-index -1; it never sets a size, a position or a
// display on anything a player touches. So the worst a wrong season can do is
// look wrong -- it cannot move a control, crowd a board or break a layout.
// That restraint is the whole reason this is safe to leave switched on with
// nobody watching the calendar.
//
// There is no setting and no table behind this. The client already knows the
// date, which means a season costs no migration, no schema and no round trip,
// and it cannot touch the live database the way a feature would.

// Inclusive windows in LOCAL time, [month, day] with month 1-12.
//
// Local rather than UTC because the date on a player's own clock is the one
// they expect the site to agree with; a UTC boundary undresses the site at 1am
// for half of Europe and an hour early for the rest.
//
// A window rather than the day itself: nobody opens the site at the right hour
// on the 31st, and the week either side is when the events are actually being
// set up. It comes off on the 3rd of November on its own.
const SEASONS = [
  { name: 'halloween', from: [10, 24], to: [11, 2] },
];

// Compared as month*100+day, which orders correctly within a year and needs no
// year on either side of the comparison -- a season is a date, not a date in
// 2026.
export function inWindow(date, from, to) {
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  const start = from[0] * 100 + from[1];
  const end = to[0] * 100 + to[1];
  // A window that crosses new year reads backwards as a pair (1220..0105), so
  // being inside it means being outside the pair rather than between them.
  // Nothing uses that yet; a Wintumber season would be the first, and it is
  // cheaper to get right now than to discover on the 1st of January.
  return start <= end ? md >= start && md <= end : md >= start || md <= end;
}

export function seasonOn(date) {
  const found = SEASONS.find(({ from, to }) => inWindow(date, from, to));
  return found ? found.name : null;
}

// ?season=halloween shows one outside its window, ?season=none takes it off.
//
// A query parameter rather than something stored: this exists to look at the
// thing, and a stored preference would quietly outlive the looking -- somebody
// checks the theme in March and then wonders all year why their site is the
// only one wearing cobwebs.
function asked() {
  try {
    return new URLSearchParams(window.location.search).get('season');
  } catch {
    return null;
  }
}

export function applySeason(date = new Date()) {
  const override = asked();
  const season = override ? (override === 'none' ? null : override) : seasonOn(date);
  const root = document.documentElement;
  if (season) root.setAttribute('data-season', season);
  else root.removeAttribute('data-season');
  return season;
}

// Applied on import, so a page gets dressed by adding one import rather than
// by remembering to call something. Guarded because the self-test imports
// seasonOn from here and node has no document.
if (typeof document !== 'undefined') applySeason();
