/**
 * One answer to a question that has a small, named set of answers.
 *
 * The admin console had two ways of asking. Step one of the wizard drew a
 * bordered box per choice -- title, a line saying what it means, gold when
 * picked -- and you pressed the box. Every other question drew a bare native
 * radio or checkbox in a flat list, with the explanation demoted to a grey
 * parenthetical. So inside one wizard the way you answer changed between
 * step one and step two, and the second way asked you to hit a 13px square.
 *
 * This is the first way, made general. The box is the hit target, the mark is
 * drawn rather than native so it can be the size of a thing you aim at, and
 * the blurb sits inside the box it belongs to instead of in brackets.
 *
 * The input stays a real radio or checkbox -- hidden, never replaced -- so the
 * group is still a group to a screen reader, still reachable by keyboard, and
 * still answers arrow keys the way a radio group should.
 */

/**
 * The box.
 *
 * `children` are the settings this answer switches on, and they render inside
 * the box, below the label, only while it is picked. They sit OUTSIDE the
 * <label> on purpose: a label forwards clicks to its control, so a text field
 * nested in one would toggle the answer it belongs to every time you clicked
 * into it.
 */
export function Pick({
  type = 'radio', name, checked, onChange, disabled = false,
  title, blurb, children,
}) {
  return (
    <div className={`pick${checked ? ' on' : ''}${children && checked ? ' open' : ''}`}>
      <label className="pick-head">
        <input
          className="pick-input"
          type={type}
          name={name}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
        />
        <span className={`pick-mark pick-mark-${type}`} aria-hidden="true" />
        <span className="pick-text">
          <strong>{title}</strong>
          {blurb && <span className="muted">{blurb}</span>}
        </span>
      </label>
      {children && checked && <div className="pick-more">{children}</div>}
    </div>
  );
}

/**
 * The question above its answers.
 *
 * A fieldset and a legend rather than role="radiogroup" and an aria-label: it
 * names the group natively, it is the right element for a set of checkboxes
 * too, and the question is then on screen instead of only in the markup.
 *
 * `label` instead of `ask` where the step has already asked the question in
 * its own heading: the legend stays, and only stops being drawn.
 */
export function PickSet({ ask, label, children, wide = false }) {
  return (
    <fieldset className="pick-set">
      <legend className={ask ? 'pick-ask' : 'pick-ask-hidden'}>{ask ?? label}</legend>
      <div className={`pick-grid${wide ? ' wide' : ''}`}>{children}</div>
    </fieldset>
  );
}

/**
 * The same choice, shrunk to a pill.
 *
 * For picking several things out of a short named set where a column of boxes
 * would be the wrong shape -- the modes a moderator runs, where there is one
 * row per person and five modes on it. Same marks, same gold, no blurb.
 */
export function PickChip({ checked, onChange, disabled = false, label }) {
  return (
    <label className={`pick-chip${checked ? ' on' : ''}`}>
      <input
        className="pick-input"
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="pick-mark pick-mark-checkbox" aria-hidden="true" />
      {label}
    </label>
  );
}
