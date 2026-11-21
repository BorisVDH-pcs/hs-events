import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INTAKE_PATH, MAX_TOKENS, MAX_TOKEN_LABEL, dinkUrl, isMissingFunction,
  tokenLabelClean, tokenLabelError, tokenMadeText, tokenUsedText,
} from '../src/lib/pluginTokens.js';

// ---- The link a player pastes into Dink ----
//
// It has to be exactly what the intake function answers to: its one route,
// with the token as `t`. runelite-plugin/server/test/stack.test.mjs sends every
// one of its Dink requests to a link made by this same function, so a link
// built here that the function did not take would fail there too.

const token = `hse_${'0123456789abcdef'.repeat(4)}`;
assert.equal(INTAKE_PATH, '/functions/v1/intake/dink');
assert.equal(
  dinkUrl('https://abc.supabase.co', token),
  `https://abc.supabase.co/functions/v1/intake/dink?t=${token}`,
);
assert.equal(
  dinkUrl('https://abc.supabase.co/', token),
  `https://abc.supabase.co/functions/v1/intake/dink?t=${token}`,
  'a trailing slash on the address does not double up',
);
assert.equal(dinkUrl('http://127.0.0.1:54321', token), `http://127.0.0.1:54321${INTAKE_PATH}?t=${token}`,
  'the local stack works too');
// Nothing but a real token goes into a link a player is told to keep secret.
for (const bad of ['', null, undefined, 'hse_', `hse_${'0'.repeat(63)}`, `hse_${'G'.repeat(64)}`, ` ${token}`, `${token}&x=1`]) {
  assert.throws(() => dinkUrl('https://abc.supabase.co', bad), /not a plugin token/, `refuses ${JSON.stringify(bad)}`);
}
for (const bad of ['', null, undefined, 'abc.supabase.co', 'https://abc.supabase.co/rest/v1', 'javascript:alert(1)']) {
  assert.throws(() => dinkUrl(bad, token), /no Supabase address/, `refuses the address ${JSON.stringify(bad)}`);
}

// ---- The token's name ----

assert.equal(MAX_TOKEN_LABEL, 40, 'the check on plugin_tokens.label');
assert.equal(MAX_TOKENS, 5, 'what plugin_token_create allows');
assert.equal(tokenLabelClean('  Main   PC '), 'Main PC');
assert.equal(tokenLabelClean(''), null, 'no name is fine, and is stored as none');
assert.equal(tokenLabelClean('   '), null);
assert.equal(tokenLabelClean(null), null);
assert.equal(tokenLabelError(''), null, 'the name is optional');
assert.equal(tokenLabelError('x'.repeat(40)), null);
assert.equal(tokenLabelError(`  ${'x'.repeat(40)}  `), null, 'padding does not count against the limit');
assert.match(tokenLabelError('x'.repeat(41)), /At most 40/);

// The draft's own limits, read from the draft, so the two cannot drift apart.
const sql = readFileSync(new URL('../../runelite-plugin/server/001_plugin_tokens.sql', import.meta.url), 'utf8');
assert.match(sql, /char_length\(label\) <= 40/, 'the label check in the draft is still 40');
assert.match(sql, />= 5 then/, 'the draft still allows 5 live tokens');
assert.match(sql, /'hse_' \|\| encode\(extensions\.gen_random_bytes\(32\), 'hex'\)/,
  'tokens are still hse_ and 64 hex digits, which is what dinkUrl takes');

// ---- A database without plugin tokens ----
//
// The live project until the draft is applied. PostgREST says PGRST202 for a
// function that is not there; the section hides on that and only that. A
// refusal from a function that IS there (P0001) is a message for the player.

assert.equal(isMissingFunction({ code: 'PGRST202', message: 'Could not find the function public.plugin_token_list' }), true);
assert.equal(isMissingFunction({ code: 'P0001', message: 'Not signed in' }), false);
assert.equal(isMissingFunction(null), false);
assert.equal(isMissingFunction(undefined), false);

// ---- When it was made and last used ----

const now = new Date('2026-11-21T12:00:00Z');
const back = (mins) => new Date(now.getTime() - mins * 60000).toISOString();
assert.equal(tokenUsedText(null, now), 'never used', 'the clue that the link went into the wrong box');
assert.equal(tokenUsedText(back(0), now), 'last used just now');
assert.equal(tokenUsedText(back(1), now), 'last used 1 minute ago');
assert.equal(tokenUsedText(back(59), now), 'last used 59 minutes ago');
assert.equal(tokenUsedText(back(60), now), 'last used 1 hour ago');
assert.equal(tokenUsedText(back(60 * 23), now), 'last used 23 hours ago');
assert.equal(tokenUsedText(back(60 * 24), now), 'last used 1 day ago');
assert.equal(tokenUsedText(back(60 * 24 * 29), now), 'last used 29 days ago');
assert.match(tokenUsedText(back(60 * 24 * 40), now), /^last used .*12/, 'over a month: the date (12 Oct)');
assert.match(tokenMadeText(back(60 * 24 * 9), now), /^Made .*12/, 'the day it was made (12 Nov)');
assert.doesNotMatch(tokenMadeText(back(60 * 24 * 9), now), /2026/, 'no year when it is this year');
assert.match(tokenMadeText('2025-03-04T12:00:00Z', now), /2025/, 'the year when it is not');

// ---- The section is wired in, and hides itself ----
//
// Read from the source rather than rendered: the repo has no DOM for its tests.

const account = readFileSync(new URL('../src/components/MyAccount.jsx', import.meta.url), 'utf8');
assert.match(account, /<PluginTokens \/>/, 'My Account shows the section');
const section = readFileSync(new URL('../src/components/PluginTokens.jsx', import.meta.url), 'utf8');
assert.match(section, /if \(tokens === undefined \|\| tokens === null\) return null;/,
  'no section until the first answer, and none at all without plugin tokens');
const lib = readFileSync(new URL('../src/lib/supabase.js', import.meta.url), 'utf8');
assert.match(lib, /if \(isMissingFunction\(error\)\) return null;/, 'pluginTokens() answers null for a missing function');
// The two Dink settings that stop drops arriving, named as Dink names them.
assert.match(section, /<strong>Min Loot value<\/strong> at 0/, 'the steps say to leave the minimum at 0');
assert.match(section, /<strong>Loot Webhook\s+Override<\/strong> empty/, 'and the loot override empty');
// Shown once: the token is never written anywhere the browser keeps.
assert.doesNotMatch(section, /localStorage|sessionStorage|indexedDB/, 'the link is never stored in the browser');

console.log('plugin-tokens selftest: ok');
