// Fills this folder's supabase/ with what the local stack should run: every
// migration in the repo's supabase/migrations (the plugin's two among them,
// since 2026-11-21) and the intake Edge Function. All of it is a COPY, remade
// on every run and never committed, so there is one source for each file.
//
// The repo's own supabase/ folder is not touched: it has no config.toml, and
// adding one there could change what db-push.yml does.
//
//   node prepare.mjs
//   supabase start          (from this folder; applies the copies)
//   supabase db reset       (after a change, to apply them again)

import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const here = (p) => new URL(p, import.meta.url);
const REPO_MIGRATIONS = here('../../../supabase/migrations/');
const FUNCTION_FILES = ['index.ts', 'handle.mjs', 'dink.mjs', 'shrink.mjs'];

const migrations = here('supabase/migrations/');
rmSync(migrations, { recursive: true, force: true });
mkdirSync(migrations, { recursive: true });
const repo = readdirSync(REPO_MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
for (const f of repo) copyFileSync(new URL(f, REPO_MIGRATIONS), new URL(f, migrations));

const fn = here('supabase/functions/intake/');
rmSync(here('supabase/functions/'), { recursive: true, force: true });
mkdirSync(fn, { recursive: true });
for (const f of FUNCTION_FILES) copyFileSync(here(`../intake/${f}`), new URL(f, fn));

console.log(`${repo.length} migrations and the intake function copied`);
