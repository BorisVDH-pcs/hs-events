import { useState } from 'react';
import { PLACES, REGIONS } from '../../lib/territoryWorld.js';
import { homesProblem, placeByKey } from '../../lib/territory.js';
import TeamCrest from './TeamCrest.jsx';

/**
 * Where each team starts, for one Territory game.
 *
 * A home has no task and can never be taken, which makes it a wall to every
 * other team. So the picker checks the whole set as it is chosen: a set that
 * would cut any place off from any team -- Rellekka, the only way to the
 * Fremennik isles, is the plain case -- says which and why, and cannot be
 * saved. The server refuses it too.
 *
 *   teams   this game's teams
 *   homes   Map teamId -> placeKey, as saved (picked, or suggested by slot)
 *
 * Fixed once the game starts.
 */
export default function TerritoryHomes({ teams, homes, editable, busy, onSave }) {
  const [draft, setDraft] = useState(() => new Map(homes));
  const sorted = [...teams].sort((a, b) => a.slot - b.slot);
  const nameOf = (id) => teams.find((t) => t.id === id)?.name ?? 'A team';
  const problem = homesProblem(draft, nameOf);
  const dirty = sorted.some((t) => draft.get(t.id) !== homes.get(t.id));
  const takenBy = new Map([...draft].map(([id, key]) => [key, id]));

  return (
    <section className="card territory-homes">
      <h2>Homes</h2>
      <p className="muted">
        Every team starts on its home: it holds it from the start, it needs no task and it can
        never be taken. Because nobody can pass through another team&rsquo;s home, homes that would
        cut any place off from any team are refused.
        {!editable && ' Fixed now the game has started.'}
      </p>
      {sorted.length === 0 && <p className="muted">Add teams first.</p>}
      <ul className="territory-homes-list">
        {sorted.map((t) => (
          <li key={t.id}>
            <TeamCrest slot={t.slot} label={t.name.slice(0, 1).toUpperCase()} size={20} />
            <span className="territory-homes-team">{t.name}</span>
            {editable ? (
              <select
                value={draft.get(t.id) ?? ''}
                disabled={busy}
                aria-label={`Home of ${t.name}`}
                onChange={(e) => setDraft((d) => new Map(d).set(t.id, e.target.value))}
              >
                {REGIONS.map((r) => (
                  <optgroup key={r.key} label={r.name}>
                    {PLACES.filter((p) => p.region === r.key).map((p) => {
                      const other = takenBy.get(p.key);
                      return (
                        <option key={p.key} value={p.key} disabled={Boolean(other) && other !== t.id}>
                          {p.name}{other && other !== t.id ? ` — home of ${nameOf(other)}` : ''}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </select>
            ) : (
              <b>{placeByKey.get(homes.get(t.id))?.name}</b>
            )}
          </li>
        ))}
      </ul>
      {editable && problem && <p className="error">{problem}</p>}
      {editable && sorted.length > 0 && (
        <div className="row">
          <button disabled={busy || !dirty || Boolean(problem)} onClick={() => onSave(Object.fromEntries(draft))}>
            Save homes
          </button>
          {dirty && (
            <button className="ghost" disabled={busy} onClick={() => setDraft(new Map(homes))}>
              Undo changes
            </button>
          )}
          {!dirty && !problem && <span className="muted">Every team can reach every place.</span>}
        </div>
      )}
    </section>
  );
}
