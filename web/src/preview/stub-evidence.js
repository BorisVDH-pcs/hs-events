/**
 * Stand-in for lib/evidence.js in the harness. The real one mints signed URLs
 * against a private Supabase bucket; here the thumbnails are inline SVG, so the
 * layout is real and nothing leaves the machine.
 */
import { DEMO_URLS } from './stub-supabase.js';

export const BUCKET = 'evidence';

/**
 * A harness that simulates a game (territory-main.jsx) plugs in here:
 * `upload(args)` stands in for add_evidence and returns what it would, and
 * `urls` maps the storage paths it invents to object URLs of the picked file.
 * Every other harness leaves it empty and uploads refuse, as they always did.
 */
export const evidenceHandlers = { upload: null, urls: {}, addChallengeShot: null };

export async function signedUrls(paths) {
  const out = {};
  for (const p of paths) {
    const url = DEMO_URLS[p] ?? evidenceHandlers.urls[p];
    if (url) out[p] = url;
  }
  return out;
}

// The evidence harness only renders EvidenceReview, which needs signedUrls and
// nothing else. These exist because this server also serves the app's own
// index.html at `/`, and a visit there pulls in EvidenceUploader: a missing
// export is a hard module error that breaks the page before anything renders.
// Stubbed to refuse rather than to pretend, unless a harness simulates them.
export async function downscale() {
  throw new Error('Uploads are not available in the evidence harness.');
}

export async function uploadEvidence(args) {
  if (evidenceHandlers.upload) return evidenceHandlers.upload(args);
  throw new Error('Uploads are not available in the evidence harness.');
}

export async function tradePet() {
  throw new Error('Uploads are not available in the evidence harness.');
}

/**
 * The challenge harness simulates this one properly rather than refusing.
 *
 * Dropping a picture is the whole of what changed, so a stand-in that throws
 * would leave the screen it changed the only one nobody can look at. The file
 * never leaves the machine: it becomes an object URL under the same storage
 * path the real upload would have used, which signedUrls above then hands back.
 */
export async function uploadChallengeShot({ gameId, entryId, phase, file, note = null }) {
  const path = `challenge/${gameId}/${entryId}/${crypto.randomUUID()}.webp`;
  evidenceHandlers.urls[path] = URL.createObjectURL(file);
  const add = evidenceHandlers.addChallengeShot;
  if (add) add({ phase, storage_path: path, note });
  return path;
}

export function extFor() {
  return 'webp';
}
