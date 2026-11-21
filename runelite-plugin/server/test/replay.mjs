// Replays every file in supabase/migrations, in order, into PGlite (real
// Postgres, in memory), so the plugin drafts can be tested against the real
// rules -- tiles_for_team, regions_open_tile, add_evidence -- with nothing
// touching the live project.
//
// What Supabase provides is stood in for below: the roles, auth.users and
// auth.uid(), storage.buckets/objects, pg_net and the realtime publication.
// The stand-ins store what the migrations write and do nothing else: no
// request ever leaves this process.
//
//   import { replay } from './replay.mjs';
//   const db = await replay();

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readdirSync, readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);

const STAND_INS = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage; create schema net; create schema extensions;
  grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
  -- Supabase's defaults: the API roles may touch everything in public, and
  -- row-level security and the migrations' own revokes do the narrowing.
  alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  -- Hosted Supabase keeps pgcrypto here, not in public (see 20260925120000).
  create extension pgcrypto schema extensions;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    instance_id uuid, aud text, role text,
    email text unique,
    encrypted_password text,
    raw_user_meta_data jsonb not null default '{}',
    raw_app_meta_data jsonb not null default '{}',
    email_confirmed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')) $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[],
    created_at timestamptz default now(), updated_at timestamptz default now());
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text, owner uuid, metadata jsonb,
    created_at timestamptz default now(), updated_at timestamptz default now());
  alter table storage.objects enable row level security;
  -- Supabase's own grant: the policies (0021) do the narrowing.
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1] $$;

  -- pg_net: record the request, send nothing.
  create table net._http_response (
    id bigint primary key, status_code int, content_type text, headers jsonb,
    content text, timed_out boolean, error_msg text, created timestamptz not null default now());
  create table net.sent (id bigserial primary key, method text, url text, body jsonb, at timestamptz default now());
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
                                headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language sql as $$ insert into net.sent (method, url, body) values ('POST', url, body) returning id $$;
  create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}',
                               timeout_milliseconds int default 5000)
  returns bigint language sql as $$ insert into net.sent (method, url) values ('GET', url) returning id $$;
  -- With the body parameter newer pg_net has; 20261026120600 checks for it.
  create function net.http_delete(url text, params jsonb default '{}', headers jsonb default '{}',
                                  timeout_milliseconds int default 5000, body jsonb default null)
  returns bigint language sql as $$ insert into net.sent (method, url, body) values ('DELETE', url, body) returning id $$;

  create publication supabase_realtime;
`;

/** @returns {Promise<PGlite>} a database with every migration applied. */
export async function replay({ quiet = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STAND_INS);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    // pg_net is not built for PGlite; its schema is stood in for above.
    const sql = readFileSync(new URL(file, MIGRATIONS), 'utf8')
      .replace(/^\s*create extension if not exists pg_net[^;]*;/gim, '');
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`${file}: ${e.message}`);
    }
    if (!quiet) console.log('applied', file);
  }
  return Object.assign(db, { migrationCount: files.length });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t = Date.now();
  const db = await replay({ quiet: !process.argv.includes('-v') });
  const n = (await db.query(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace`)).rows[0].n;
  console.log(`${db.migrationCount} migrations applied in ${((Date.now() - t) / 1000).toFixed(1)}s; ${n} public functions`);
}
