import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inWindow, seasonOn } from '../src/lib/season.js';

// Local-time constructor throughout, because that is what seasonOn reads.
// Month is 0-based here and 1-based in the window table, which is exactly the
// sort of thing this file exists to catch.
const on = (m, d) => new Date(2026, m - 1, d);

// ---- Halloween ----
//
// The window is 24 October to 2 November inclusive. Both edges are tested from
// outside as well as in: an off-by-one at either end is a site that dresses up
// a day late or undresses at the party.

assert.equal(seasonOn(on(10, 23)), null, 'the day before is still plain');
assert.equal(seasonOn(on(10, 24)), 'halloween', 'the first day is in');
assert.equal(seasonOn(on(10, 31)), 'halloween', 'and obviously the night itself');
assert.equal(seasonOn(on(11, 1)), 'halloween', 'it does not end at midnight');
assert.equal(seasonOn(on(11, 2)), 'halloween', 'the last day is in');
assert.equal(seasonOn(on(11, 3)), null, 'and then it takes itself off');

// The rest of the year is not a season, which is the state the site is in for
// fifty weeks and the one worth being sure of.
for (const [m, d] of [[1, 1], [3, 15], [6, 30], [8, 9], [10, 1], [12, 25]]) {
  assert.equal(seasonOn(on(m, d)), null, `${m}/${d} is an ordinary day`);
}

// ---- A window that crosses new year ----
//
// Nothing in SEASONS does this yet. A Wintumber one would, and the branch that
// handles it cannot be checked on the 1st of January after the fact.

const winter = [[12, 20], [1, 5]];
assert.equal(inWindow(on(12, 19), ...winter), false, 'before it opens');
assert.equal(inWindow(on(12, 20), ...winter), true, 'the December edge');
assert.equal(inWindow(on(12, 31), ...winter), true);
assert.equal(inWindow(on(1, 1), ...winter), true, 'and straight over the year');
assert.equal(inWindow(on(1, 5), ...winter), true, 'the January edge');
assert.equal(inWindow(on(1, 6), ...winter), false, 'after it closes');
assert.equal(inWindow(on(7, 1), ...winter), false, 'and nowhere near it in July');

// ---- What a season is allowed to be ----
//
// seasons.css is safe to leave switched on unattended only for as long as it
// stays a repaint. These are the properties that move things, and the day one
// of them turns up in there is the day a season can be the reason a board is
// unusable -- so the file is read rather than trusted.
//
// The line is not "no layout properties anywhere" -- the moons and the
// cobwebs are ::before/::after layers that exist only while a season is on,
// and a layer nobody else draws has to be given a size and a place. The line
// is that those properties may ONLY appear on a pseudo-element. The moment one
// lands on a real selector, a season is moving something a player is reading,
// and this file stops being a repaint.

const css = readFileSync(new URL('../src/seasons.css', import.meta.url), 'utf8');
const body = css.replace(/\/\*[\s\S]*?\*\//g, '');   // comments explain, they do not apply

const MOVES = ['display', 'position', 'width', 'height', 'margin', 'padding', 'font-size', 'gap'];

for (const [, selector, block] of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const moved = MOVES.filter((p) => new RegExp(`(^|[;\\s])${p}\\s*:`).test(block));
  if (!moved.length) continue;
  assert.ok(
    selector.includes('::before') || selector.includes('::after'),
    `seasons.css sets ${moved.join(', ')} on "${selector.trim()}", which is not a `
      + 'season-only pseudo-element'
  );
}

// The accent does not do seasons: --gold is the active tab and the primary
// button, and --hit/--strike/--miss are how a board says what happened.
for (const token of ['--gold', '--hit', '--strike', '--miss', '--text', '--label']) {
  assert.ok(!body.includes(`${token}:`), `${token} is not a season's to redeclare`);
}

console.log('season selftest: ok');
