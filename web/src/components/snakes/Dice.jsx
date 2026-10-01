import { useEffect, useState } from 'react';

// Which of the nine pip spots are lit for each face, in reading order.
const PIPS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/**
 * One die. While `rolling` it tumbles through random faces; when it stops it
 * shows `value`. The number itself comes from the server -- this only draws
 * it -- so the tumble is for the waiting, not the deciding.
 *
 * With reduced motion the stylesheet stops the tumble, and the face changes
 * are slowed to a gentle swap rather than a flicker.
 */
export default function Dice({ value, rolling = false, size = 'md', label }) {
  const [face, setFace] = useState(value ?? 1);

  useEffect(() => {
    if (!rolling) {
      if (value) setFace(value);
      return undefined;
    }
    const id = setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 90);
    return () => clearInterval(id);
  }, [rolling, value]);

  const lit = PIPS[face] ?? [];
  return (
    <span
      className={`dice dice-${size}${rolling ? ' rolling' : ''}`}
      role="img"
      aria-label={label ?? (rolling ? 'Rolling…' : `A ${face}`)}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={lit.includes(i) ? 'pip on' : 'pip'} />
      ))}
    </span>
  );
}
