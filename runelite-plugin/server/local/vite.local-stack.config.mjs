// web/vite.config.js with no .env file read at all. site.mjs hands the site
// the local stack's address and public key, and those are the only settings it
// has: it cannot reach the live project, and it has no imgbb key, so an upload
// on it is never mirrored anywhere (lib/imgbb.js skips without a key).

import { fileURLToPath } from 'node:url';
import site from '../../../web/vite.config.js';

export default {
  ...site,
  root: fileURLToPath(new URL('../../../web/', import.meta.url)),
  // This folder, which holds no .env file.
  envDir: fileURLToPath(new URL('./', import.meta.url)),
};
