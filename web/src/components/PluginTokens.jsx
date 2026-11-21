import { useCallback, useEffect, useState } from 'react';
import {
  pluginTokens, makePluginToken, revokePluginToken, pluginDinkUrl,
} from '../lib/supabase.js';
import {
  MAX_TOKENS, MAX_TOKEN_LABEL, tokenLabelClean, tokenLabelError, tokenMadeText, tokenUsedText,
} from '../lib/pluginTokens.js';

/**
 * Plugin tokens, at the foot of My Account.
 *
 * WHAT IT IS FOR. Dink, a RuneLite plugin many players already run, can post
 * each drop to a link. A token is what makes that link this player's: the
 * intake function hands a drop in as them, for tiles their team has opened,
 * and for nothing else (runelite-plugin/README.md).
 *
 * SHOWN ONCE. Only the token's hash is stored, so the link exists in the
 * answer to "Make a token" and in this component's state, and nowhere else.
 * Closing the dialog loses it for good; the way back is a new token.
 *
 * HIDDEN, NOT BROKEN, while the database has no plugin tokens: pluginTokens()
 * answers null until the plugin migrations are applied, and then this renders
 * nothing at all.
 */
export default function PluginTokens() {
  const [tokens, setTokens] = useState(undefined);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setTokens(await pluginTokens());
    } catch (err) {
      setError(err.message);
      setTokens([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Nothing until the first answer, so the live site never flashes a section
  // it is about to hide.
  if (tokens === undefined || tokens === null) return null;

  async function run(fn, message) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await load();
      if (message) setNotice(message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const problem = tokenLabelError(label);
  const full = tokens.length >= MAX_TOKENS;
  // The row the link on screen belongs to: the one that was not there before.
  const freshId = fresh ? tokens.find((t) => !fresh.before.has(t.id))?.id : undefined;

  function make() {
    const name = tokenLabelClean(label);
    const before = new Set(tokens.map((t) => t.id));
    run(async () => {
      const token = await makePluginToken(name);
      setFresh({ name: name ?? 'Your new token', url: pluginDinkUrl(token), before });
      setCopied(false);
      setLabel('');
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(fresh.url);
      setCopied(true);
    } catch {
      // Refused over plain http or with the window out of focus. The link is
      // on screen and selectable, so say so rather than look like a dead button.
      setError('Could not copy it. Select the link and copy it by hand.');
    }
  }

  return (
    <section className="plugin-tokens" aria-labelledby="plugin-tokens-title">
      <h4 id="plugin-tokens-title">Plugin tokens</h4>
      <p className="confirm-message">
        A token lets Dink, a RuneLite plugin, hand in your drops for you: loot
        and pets, for tiles your team has opened. Anyone who has it can hand in
        evidence as you, so keep it to yourself.
      </p>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {fresh && (
        <div className="token-once" role="status">
          <p className="token-once-title">
            {fresh.name}: your Dink link, shown only this once
          </p>
          <div className="token-once-link">
            <input
              readOnly
              value={fresh.url}
              aria-label="Your Dink link"
              onFocus={(e) => e.target.select()}
            />
            <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <ol className="token-once-steps">
            <li>
              In RuneLite, open Dink&apos;s settings and paste the link into
              {' '}<strong>Primary Webhook URLs</strong>, on a line of its own.
            </li>
            <li>
              Turn on <strong>Enable loot</strong> and <strong>Enable pets</strong>,
              and keep <strong>Send Image</strong> on for both.
            </li>
            {/* Both from Dink's own settings (DinkPluginConfig): a drop under
                the minimum is never sent, and an override takes loot away
                from the primary list altogether. */}
            <li>
              Leave <strong>Min Loot value</strong> at 0, or drops worth less
              than it never reach us, and leave <strong>Loot Webhook
              Override</strong> empty, or Dink sends loot only there.
            </li>
          </ol>
          <p className="muted">
            A drop counts when it is for a tile your team has opened and comes
            from one of the names above. Drops on Leagues worlds don&apos;t count.
            Lost the link? Revoke this token and make a new one.
          </p>
        </div>
      )}

      {tokens.length > 0 && (
        <ul className="rsn-list token-list">
          {tokens.map((t) => {
            const name = t.label ?? 'Unnamed token';
            return (
              <li key={t.id} className="rsn-row">
                <div className="rsn-name">
                  <strong>{name}</strong>
                  {t.id === freshId && <span className="badge">new</span>}
                </div>
                <p className="muted">
                  {tokenMadeText(t.created_at)} · {tokenUsedText(t.last_used_at)}
                </p>
                <div className="row">
                  {/* Two presses, like removing an account: a revoked token
                      cannot be brought back, only replaced. */}
                  {confirming === t.id ? (
                    <>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() => {
                          setConfirming(null);
                          // Its link is dead from now on, so it leaves the screen.
                          if (t.id === freshId) setFresh(null);
                          run(
                            () => revokePluginToken(t.id),
                            `${name} revoked. Dink holding it can no longer hand anything in.`,
                          );
                        }}
                      >
                        Really revoke {name}
                      </button>
                      <button className="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                        Keep it
                      </button>
                    </>
                  ) : (
                    <button className="ghost" disabled={busy} onClick={() => setConfirming(t.id)}>
                      Revoke
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!full ? (
        <div className="rsn-add">
          <label className="field-name">Name it, so you know which computer it is on
            <input
              value={label}
              maxLength={MAX_TOKEN_LABEL}
              placeholder="Laptop"
              disabled={busy}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !problem && !busy) make(); }}
            />
          </label>
          {problem && <p className="field-error">{problem}</p>}
          <div className="row">
            <button disabled={busy || Boolean(problem)} onClick={make}>
              {busy ? 'Making…' : 'Make a token'}
            </button>
          </div>
        </div>
      ) : (
        <p className="muted">
          {MAX_TOKENS} tokens is the limit. Revoke one to make another.
        </p>
      )}
    </section>
  );
}
