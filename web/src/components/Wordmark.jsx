import { useState } from 'react';
import { modeTitle } from '../lib/site.js';

/**
 * The clan logo, with the gold CSS wordmark as its fallback.
 *
 * `public/logo.png` is derived from the master at the repo root by
 * `tools/make_logo.py` — cropped, keyed to transparency and scaled down from
 * 2.6 MB, which is not a thing to send a player on a phone. The CSS fallback
 * stays because a logo that fails to load should cost nothing: the header
 * degrades to the gold wordmark rather than a broken image.
 *
 * The subtitle follows the game on screen (`mode`): Battleships keeps its
 * drawn wordmark, other modes and the login page get the CSS gold lettering.
 * See lib/site.js.
 */
export default function Wordmark({ mode = null }) {
  const [failed, setFailed] = useState(false);
  const [subtitleFailed, setSubtitleFailed] = useState(false);
  const { text, image } = modeTitle(mode);

  if (failed) return <h1>HS {text}</h1>;

  return (
    <h1 className="wordmark">
      {/* BASE_URL, not a leading slash — the site is served from
          /hs-events/ in production. Same rule as TileIcon. */}
      <img
        src={`${import.meta.env.BASE_URL}logo.png`}
        alt="High Society"
        onError={() => setFailed(true)}
        draggable="false"
      />
      {image && !subtitleFailed ? (
        <img
          className="wordmark-subtitle"
          src={`${import.meta.env.BASE_URL}${image}`}
          alt={text}
          onError={() => setSubtitleFailed(true)}
          draggable="false"
        />
      ) : (
        <span className="sub">{text}</span>
      )}
    </h1>
  );
}
