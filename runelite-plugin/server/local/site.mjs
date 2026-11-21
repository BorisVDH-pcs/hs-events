// The real site, on this computer, talking to the local stack instead of the
// live project: for trying a real Dink client against the intake function.
//
//   node site.mjs          then open http://localhost:5177
//
// The stack's address and public key are read from `supabase status` and
// handed to Vite as environment variables. They are never printed. No .env
// file is read (vite.local-stack.config.mjs), so nothing from the live project
// reaches this copy of the site.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL = fileURLToPath(new URL('./', import.meta.url));
const WEB = fileURLToPath(new URL('../../../web/', import.meta.url));
// The CLI on PATH, or the copy beside the repository that this work used.
const besideRepo = fileURLToPath(new URL('../../../../tools/supabase-cli/supabase.exe', import.meta.url));
const SUPABASE = process.env.SUPABASE_BIN ?? (existsSync(besideRepo) ? besideRepo : 'supabase');

const status = JSON.parse(execFileSync(SUPABASE, ['status', '-o', 'json'],
  { cwd: LOCAL, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(status.API_URL ?? '') || !status.ANON_KEY) {
  throw new Error('No local stack: run `supabase start` in runelite-plugin/server/local first');
}

const port = process.env.PORT ?? '5177';
console.log(`The site, on the local stack (${status.API_URL}): http://localhost:${port}`);

// Only these two reach the site: any VITE_ setting already in this shell is
// dropped, the imgbb key included.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_')));
Object.assign(env, { PORT: port, VITE_SUPABASE_URL: status.API_URL, VITE_SUPABASE_ANON_KEY: status.ANON_KEY });

// Vite's own entry, run by this node: no shell, so the variables arrive as set.
const child = spawn(process.execPath, [
  join(WEB, 'node_modules', 'vite', 'bin', 'vite.js'),
  '--config', fileURLToPath(new URL('vite.local-stack.config.mjs', import.meta.url)),
], { cwd: WEB, stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
