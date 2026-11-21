// Plugin tokens: the My Account section that lets Dink hand in a player's
// drops (components/PluginTokens.jsx).
//
// The database side is supabase/migrations/20261121120000_plugin_tokens.sql,
// applied to the live project on merge. Until it is applied, the live
// project has no plugin_token_* functions, and the section hides itself rather
// than showing an error (isMissingFunction below).
//
// Plain functions with no imports, so web/scripts/plugin-tokens-selftest.mjs
// and runelite-plugin/server/test/stack.test.mjs can both load this file as it
// is.

/** plugin_token_create refuses a sixth live token. */
export const MAX_TOKENS = 5;
/** The check on plugin_tokens.label. */
export const MAX_TOKEN_LABEL = 40;
/** The intake Edge Function's one route (runelite-plugin/server/intake/index.ts). */
export const INTAKE_PATH = '/functions/v1/intake/dink';

const TOKEN = /^hse_[0-9a-f]{64}$/;

/**
 * The link a player pastes into Dink: the intake function, with the token as
 * `t`. Dink sends to exactly what is typed, query and all, and has no other
 * place to put a token (docs/runelite-plugin-plan.md, section 8).
 */
export function dinkUrl(supabaseUrl, token) {
  if (!TOKEN.test(token ?? '')) throw new Error('That is not a plugin token.');
  const base = String(supabaseUrl ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(base)) throw new Error('The site has no Supabase address.');
  return `${base}${INTAKE_PATH}?t=${token}`;
}

/** What is stored as the name: trimmed, spacing collapsed, nothing is null. */
export function tokenLabelClean(label) {
  const clean = String(label ?? '').replace(/\s+/g, ' ').trim();
  return clean || null;
}

/** Null when the name is fine. A blank name is fine: the name is optional. */
export function tokenLabelError(label) {
  const clean = tokenLabelClean(label);
  if (clean && clean.length > MAX_TOKEN_LABEL) return `At most ${MAX_TOKEN_LABEL} characters.`;
  return null;
}

/**
 * PostgREST's answer when the function is not in the database at all
 * (PGRST202), as opposed to the function refusing. That is the live project
 * until the plugin's migrations are applied.
 */
export function isMissingFunction(error) {
  return error?.code === 'PGRST202';
}

/** "21 Nov", with the year when it is not this one. */
function shortDate(iso, now) {
  const when = new Date(iso);
  return when.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short',
    ...(when.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function tokenMadeText(createdAt, now = new Date()) {
  return `Made ${shortDate(createdAt, now)}`;
}

/**
 * When Dink last used it, in words. "Never used" is worth saying plainly: it
 * is what a player sees when the link went into the wrong box.
 */
export function tokenUsedText(lastUsedAt, now = new Date()) {
  if (!lastUsedAt) return 'never used';
  const minutes = Math.floor((now.getTime() - new Date(lastUsedAt).getTime()) / 60000);
  if (minutes < 1) return 'last used just now';
  if (minutes < 60) return `last used ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `last used ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `last used ${days} day${days === 1 ? '' : 's'} ago`;
  return `last used ${shortDate(lastUsedAt, now)}`;
}
