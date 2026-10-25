import { rsnError } from '../../lib/accounts.js';

/**
 * The name box on the challenge sign-up card, and on the entry below it.
 *
 * Its own component because it appears twice on the same screen — once to
 * sign up with and once to correct an entry that is already in — and the two
 * drifting apart is how a player ends up able to fix a typo in one place and
 * not the other.
 *
 * A PICKER WHEN THERE IS SOMETHING TO PICK. A player with saved accounts
 * should not be retyping a name the site already knows, because retyping is
 * where the typo comes from in the first place. With nothing saved it is a
 * plain box, the way it has always been, plus a line saying where to save one.
 *
 * "Another name" stays available either way: the entry snapshots whatever is
 * sent (20261026120100), so a one-off account for one event is a real case
 * and must not require editing a profile to get at.
 */
export default function ChallengeRsnField({
  accounts, value, onChange, disabled, onOpenAccounts, freeform, onFreeform,
}) {
  const saved = accounts ?? [];
  const problem = value.trim() ? rsnError(value) : null;

  // The box is shown when there is nothing to pick from, or when the player
  // has asked for it with "Another name".
  const typing = freeform || saved.length === 0;

  return (
    <>
      {saved.length > 0 && (
        <label className="field-name">Which account
          <select
            value={freeform ? '' : (saved.find((a) => a.rsn === value)?.id ?? '')}
            disabled={disabled}
            onChange={(e) => {
              if (e.target.value === '') { onFreeform(true); return; }
              onFreeform(false);
              onChange(saved.find((a) => a.id === e.target.value)?.rsn ?? '');
            }}
          >
            {/* No blank first option: one of these is the player's main, so
                there is always a sensible thing to be selected, and a blank
                that means nothing is a blank somebody can submit. */}
            {saved.map((a) => (
              <option key={a.id} value={a.id}>
                {a.rsn}{a.is_primary ? ' — main' : ''}{a.label ? ` (${a.label})` : ''}
              </option>
            ))}
            <option value="">Another name…</option>
          </select>
        </label>
      )}

      {typing && (
        <label className="field-name">Your RuneScape name
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Exactly as the hiscores spell it"
            disabled={disabled}
          />
        </label>
      )}

      {problem && <p className="field-error">{problem}</p>}

      {saved.length === 0 ? (
        <p className="muted">
          Wise Old Man matches this exactly. Get it wrong and the hiscores have
          nothing to match, so a week of play scores nothing.{' '}
          {onOpenAccounts && (
            <button className="link" type="button" onClick={onOpenAccounts}>
              Save it to My accounts
            </button>
          )}{' '}
          and every event after this one will start from it.
        </p>
      ) : (
        <p className="muted">
          Not the right name?{' '}
          {onOpenAccounts && (
            <button className="link" type="button" onClick={onOpenAccounts}>
              Edit My accounts
            </button>
          )}
        </p>
      )}
    </>
  );
}
