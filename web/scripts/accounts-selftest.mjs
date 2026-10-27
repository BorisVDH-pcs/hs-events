import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_ACCOUNTS, MAX_RSN, accountStatus, accountStatusShort,
  hasRsn, rsnClean, rsnError, rsnKey,
} from '../src/lib/accounts.js';

// ---- The same name, written differently ----
//
// rsnKey has to agree with rsn_key() in SQL, because that is what decides
// whether WOM's reply is about this account. A disagreement here is an account
// that scores nothing and a screen that says everything is fine.

assert.equal(rsnKey('Zezima'), 'zezima');
assert.equal(rsnKey('  Zezima  '), 'zezima', 'padding is not part of a name');
assert.equal(rsnKey('ZEZIMA'), 'zezima', 'case is not part of a name');
assert.equal(rsnKey('Zezima_1'), 'zezima 1', 'an underscore is how a URL writes a space');
assert.equal(rsnKey('Zezima  1'), 'zezima 1', 'doubled spacing collapses');
assert.equal(rsnKey('Zezima_ 1'), 'zezima 1', 'and so does a mix of the two');
assert.equal(rsnKey(''), null, 'nothing is not a name');
assert.equal(rsnKey('   '), null);
assert.equal(rsnKey(null), null);
assert.equal(rsnKey(undefined), null);

// The stored form folds the same things but keeps the player's capitalisation:
// in-game names are shown the way their owner writes them.
assert.equal(rsnClean('  Zezima_1 '), 'Zezima 1');
assert.equal(rsnClean('ZEZIMA'), 'ZEZIMA', 'capitals are the player’s business');
assert.equal(rsnClean(''), null);

// Two names are the same account when their keys match, however they were typed.
const list = [{ rsn: 'Zezima 1' }, { rsn: 'Lynx Titan' }];
assert.ok(hasRsn(list, 'zezima_1'), 'the same name in another shape is already on the list');
assert.ok(hasRsn(list, '  LYNX   TITAN '));
assert.ok(!hasRsn(list, 'Zezima 2'));
assert.ok(!hasRsn(list, ''), 'nothing is on no list');
assert.ok(!hasRsn([], 'Zezima'));

// ---- What WOM will take ----
//
// Its addParticipants validates the format and nothing else: 1-12 characters,
// letters, digits and spaces. These mirror the check constraint in
// 20261026130000, and a name this accepts and the constraint refuses would be
// a green button and then an error from Postgres.

assert.equal(rsnError('Zezima'), null);
assert.equal(rsnError('Lynx Titan'), null);
assert.equal(rsnError('Zezima_1'), null, 'underscores fold to spaces before checking');
assert.equal(rsnError('123456789012'), null, 'twelve is allowed');
assert.ok(rsnError('1234567890123'), 'thirteen is not');
assert.ok(rsnError(''), 'an empty box is asked about, not accepted');
assert.ok(rsnError('   '));
assert.ok(rsnError('Zezima!'), 'punctuation is not a RuneScape name');
assert.ok(rsnError('Zezimä'), 'nor is an accent');
assert.ok(rsnError('Zezima-1'), 'nor a hyphen, which folds to nothing');

// A name at the limit that only fits once the spacing is folded is accepted,
// because that is what gets stored.
assert.equal(rsnError('Lynx   Titan'), null, 'folded, it is ten characters');
assert.equal(rsnClean('Lynx   Titan').length, 10);

// And the case that makes the folding matter: thirteen characters as typed,
// twelve once the doubled spacing is gone. Refusing this would refuse a name
// the database would have accepted.
assert.equal('Lynx    Titan'.length, 13);
assert.equal(rsnError('Lynx    Titan'), null, 'measured after folding, not before');

// ---- Three values, three meanings ----
//
// wom_found is null / false / true and each one says something different. The
// false wording is the one that matters, and it must not accuse anybody of a
// typo: an account too new to be ranked looks identical and scores the same.

assert.equal(accountStatus({ wom_found: null }).tone, 'muted');
assert.equal(accountStatus({}).tone, 'muted', 'a missing value is "nobody has looked"');
assert.equal(accountStatus(null).tone, 'muted');
assert.equal(accountStatus({ wom_found: true }).tone, 'ok');

const bad = accountStatus({ wom_found: false });
assert.equal(bad.tone, 'error');
assert.match(bad.text, /too new to be ranked/, 'the innocent explanation is offered too');
assert.match(bad.text, /scores nothing/, 'and what it costs is said plainly');

// ---- The same three states, said to an organiser ----
//
// Two wordings exist because the reader is different: the player's screen is
// addressed to the account's owner, and the console is somebody else reading
// about them. What must NOT differ is which state is worth acting on, so the
// tones are asserted equal -- that is the contract between the two, and the
// words are not.

for (const account of [{ wom_found: null }, {}, null, { wom_found: true }, { wom_found: false }]) {
  assert.equal(
    accountStatusShort(account).tone, accountStatus(account).tone,
    'the two wordings must agree about which state is an error',
  );
}

const shortBad = accountStatusShort({ wom_found: false });
assert.match(shortBad.text, /scores nothing/, 'what it costs is said to an organiser too');
assert.ok(
  shortBad.text.length < bad.text.length,
  'the organiser is scanning a list, not being advised about one name',
);

// The giveaway that a line was written for the wrong reader. An organiser
// reading "the first time you enter a tracked event" is being told about
// somebody else's account in the second person.
for (const state of [{ wom_found: null }, { wom_found: false }, { wom_found: true }]) {
  assert.ok(
    !/\byou\b|\byour\b/i.test(accountStatusShort(state).text),
    'the organiser wording talks about the player, not to them',
  );
}

// ---- Who may read somebody else's list ----

const organiserSql = readFileSync(
  new URL('../../supabase/migrations/20261027130000_admin_profile_accounts.sql', import.meta.url),
  'utf8',
  // Comments stripped first. This file explains in prose that the helper is
  // never granted and that the gate matches the table's policy, so a search
  // over the raw text would pass whether or not the SQL said either.
).replace(/--[^\n]*/g, '');

assert.ok(
  organiserSql.includes('is_admin() or is_moderator()'),
  'an organiser is who the read policy on profile_accounts already allows',
);
assert.ok(
  /revoke execute on function profile_accounts_for\(uuid\)\s+from public, anon, authenticated;/
    .test(organiserSql),
  'the ungated body takes any profile id, so it is revoked from authenticated as well',
);
assert.ok(
  !/grant\s+execute on function profile_accounts_for/.test(organiserSql),
  'and never handed back to anybody',
);

// ---- The cap, in both places ----

assert.equal(MAX_ACCOUNTS, 5);
assert.equal(MAX_RSN, 12);

const accountsSql = readFileSync(
  new URL('../../supabase/migrations/20261026130000_profile_accounts.sql', import.meta.url),
  'utf8',
);

// The database is the one that decides; these assertions are about the two
// sides agreeing, because the screen hides the add form at the cap and would
// otherwise hide it at the wrong number.
assert.ok(accountsSql.includes('> 5'), 'the migration caps a list at five');
assert.ok(
  accountsSql.includes("'^[A-Za-z0-9 ]{1,12}$'"),
  'the migration holds WOM’s own format rule',
);

// profiles.rsn following the primary is what keeps challenge_join's fallback
// and the Discord feed working without either of them knowing this table
// exists. If that trigger goes, a player edits their accounts and nothing
// anywhere else changes.
assert.ok(
  accountsSql.includes('profile_accounts_sync_rsn'),
  'the primary account is mirrored into profiles.rsn',
);

// The partial unique index cannot be deferred, so the old primary has to be
// cleared BEFORE the new row lands. An AFTER trigger here would be refused by
// the index before it ever ran.
assert.ok(
  /before insert or update of is_primary on profile_accounts/.test(accountsSql),
  'one-primary is enforced before the write, not after it',
);

// The list is not world-readable, unlike profiles: people hide their alts.
assert.ok(
  accountsSql.includes('is_admin() or is_moderator()'),
  'only the owner and organisers read an account list',
);

const allSql = readFileSync(
  new URL('../../supabase/migrations/20261026130100_challenge_all_accounts.sql', import.meta.url),
  'utf8',
);

assert.ok(allSql.includes('all_accounts boolean not null default false'),
  'one account per person stays the default');

// Replaced, never added to: reconcile can run twice over one reply.
assert.ok(/set wom_gained = coalesce\(\(select sum\(a\.wom_gained\)/.test(allSql),
  'an all-accounts total is replaced on each pass, not accumulated');

// NOT IN would go null on a single null and quietly stop removing anything.
assert.ok(!/rsn_key\(a\.rsn\) not in \(/.test(allSql),
  'removing a dropped account does not hang on NOT IN');

// challenge_list is the only call carrying the setup to either screen.
assert.ok(allSql.includes("'all_accounts',   s.all_accounts"),
  'challenge_list tells the screens which kind of event this is');

// Re-emitting challenge_list is how the field gets in, and it is easy to
// re-emit a shorter one by accident: everything below was in the version this
// replaced (20261026120300) and has to still be there.
for (const kept of ['starts_at', 'created_at', 'may_manage_game', "interval '14 days'"]) {
  assert.ok(allSql.includes(kept), `challenge_list still has ${kept}`);
}

console.log('accounts selftest: ok');
