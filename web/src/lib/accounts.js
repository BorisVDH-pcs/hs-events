/**
 * What counts as a RuneScape name, on this side of the wire.
 *
 * The database has the same rules twice over -- rsn_key and rsn_clean in
 * 20261026130000, and the check constraint beside them -- and these exist so
 * the box can say what is wrong while somebody is typing it, instead of a
 * constraint violation arriving from Postgres half a second after they press
 * Save. The server is still the one that decides; this is the courtesy.
 *
 * THE RULES ARE WISE OLD MAN'S, not Jagex's. WOM's addParticipants validates
 * the format and nothing else: one to twelve characters, letters, digits and
 * spaces. It does NOT check the account exists -- findOrCreatePlayers invents
 * a row for a name it has never seen, so a typo is accepted with a 200 and
 * then scores nothing for a week. That is what `wom_found` is for, and it is
 * why the screen says a valid-looking name is not the same as a real one.
 */

/** Main plus four. The database enforces it; this is so the button can say so. */
export const MAX_ACCOUNTS = 5;

/** WOM's limit, and the reason a long name is refused rather than cut. */
export const MAX_RSN = 12;

/**
 * Two names are the same account when their keys match.
 *
 * Mirrors rsn_key() in SQL exactly: case folded, padding gone, and an
 * underscore the same as a space -- RuneScape writes a space as an underscore
 * in a URL, so somebody typing Zezima_1 means Zezima 1.
 */
export function rsnKey(name) {
  const key = String(name ?? '').replace(/[_\s]+/g, ' ').trim().toLowerCase();
  return key === '' ? null : key;
}

/** The stored form: the same folding, with the player's own capitalisation left alone. */
export function rsnClean(name) {
  const clean = String(name ?? '').replace(/[_\s]+/g, ' ').trim();
  return clean === '' ? null : clean;
}

/**
 * Null when the name is fine, otherwise the sentence to put under the box.
 *
 * Said as what to do, not as what the regex thinks: "letters, digits and
 * spaces" is something a player can act on, and "does not match
 * ^[A-Za-z0-9 ]{1,12}$" is not.
 */
export function rsnError(name) {
  const clean = rsnClean(name);
  if (clean === null) return 'Type the account’s RuneScape name.';
  if (clean.length > MAX_RSN) return `A RuneScape name is at most ${MAX_RSN} characters.`;
  if (!/^[A-Za-z0-9 ]+$/.test(clean)) {
    return 'A RuneScape name is letters, digits and spaces — nothing else.';
  }
  return null;
}

/** True when this name is already on the list, whatever it was typed like. */
export function hasRsn(accounts, name) {
  const key = rsnKey(name);
  return key !== null && (accounts ?? []).some((a) => rsnKey(a.rsn) === key);
}

/**
 * What WOM has to say about one account, as a line to show beside it.
 *
 * `wom_found` is three-valued and every value means something different, so
 * it is spelled out rather than collapsed into a tick:
 *
 *   null   nobody has looked yet -- no tracked event has carried this name
 *   false  WOM holds the name and has never found it on the hiscores
 *   true   WOM has really pulled this account off the hiscores
 *
 * False is the one that matters, and the wording stays off blame: an account
 * too new to be ranked looks exactly the same as a typo, and both score zero.
 */
export function accountStatus(account) {
  if (!account || account.wom_found === null || account.wom_found === undefined) {
    return { tone: 'muted', text: 'Not checked yet — it will be, the first time you enter a tracked event.' };
  }
  if (account.wom_found === false) {
    return {
      tone: 'error',
      text: 'Wise Old Man has never found this name on the hiscores. Either it is spelled '
          + 'differently in game, or the account is too new to be ranked — either way it scores nothing.',
    };
  }
  return { tone: 'ok', text: 'Found on the hiscores.' };
}

/**
 * The same three states, said about somebody rather than to them.
 *
 * accountStatus is written to the account's owner -- "the first time YOU enter
 * a tracked event" -- which is the wrong person when an organiser is reading
 * the list to work out why a score came back zero. Shorter too: they are
 * scanning five names, not reading advice about one.
 *
 * The TONES are the contract between the two, not the words: `error` is the
 * state worth acting on, and the selftest holds them equal so that a change to
 * one cannot quietly disagree with the other about which that is.
 */
export function accountStatusShort(account) {
  if (!account || account.wom_found === null || account.wom_found === undefined) {
    return { tone: 'muted', text: 'Not checked — no tracked event has carried this name yet.' };
  }
  if (account.wom_found === false) {
    return {
      tone: 'error',
      text: 'Never found on the hiscores — spelled differently in game, or too new to be '
          + 'ranked. Either way it scores nothing.',
    };
  }
  return { tone: 'ok', text: 'Found on the hiscores.' };
}
