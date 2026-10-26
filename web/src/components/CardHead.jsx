/**
 * A card's heading, with the part you only need once folded away.
 *
 * Every card in the admin console opened with its own paragraph: what the
 * screen is, and then the rule behind it. Good writing, and worth keeping --
 * "there is nothing to approve" is a real rule nobody would guess -- but it
 * was written for your first visit and shown on your five-hundredth, above
 * the thing you actually came for.
 *
 * So the lead line stays and the rule goes one level down. Shut by default,
 * because the people who need it need it once.
 */
export default function CardHead({ title, lead, more }) {
  return (
    <header className="card-head">
      <h2>{title}</h2>
      {lead && <p className="muted card-lead">{lead}</p>}
      {more && (
        <details className="card-more">
          <summary>How this works</summary>
          <p className="muted">{more}</p>
        </details>
      )}
    </header>
  );
}
