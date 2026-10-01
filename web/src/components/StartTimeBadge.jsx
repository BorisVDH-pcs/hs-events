import { useCountdown, pad } from '../lib/countdown.js';
import { waitingWords } from '../lib/site.js';

/**
 * A one-line reminder during placement: fleets can be arranged early, but the
 * scheduled time is still worth keeping in view while doing it. Renders
 * nothing once a game has no `starts_at` set — a game without one gives this
 * nothing true to say.
 */
export default function StartTimeBadge({ startsAt, mode }) {
  const remaining = useCountdown(startsAt);
  if (!remaining.set) return null;
  const words = waitingWords(mode);

  return (
    <p className="start-time-badge">
      {remaining.started
        ? words.standby
        : `${words.soon} ${remaining.days > 0 ? `${remaining.days}d ` : ''}${pad(remaining.hours)}:${pad(remaining.minutes)}:${pad(remaining.seconds)}`}
    </p>
  );
}
