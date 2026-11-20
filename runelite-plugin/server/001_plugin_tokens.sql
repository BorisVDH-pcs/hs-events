-- RuneLite plugin, server part 1: plugin tokens, drop_key, and "act as the
-- player". docs/runelite-plugin-plan.md, sections 4.2 to 4.4.
--
-- DRAFT. Not in supabase/migrations on purpose, so db-push cannot apply it.
-- Purely additive: one new table and new functions. It changes no existing
-- table, function, policy or grant.
--
-- Tested offline by server/test/tokens.test.mjs (PGlite, with stand-ins for
-- auth.uid(), profiles and is_admin()). NOT yet tested through PostgREST with
-- the service role, which is phase 0 of the plan.

-- ============================================================
-- 1. drop_key: one spelling for a drop's name
-- ============================================================
-- A drop option is free text ("Dharok's helm") and the game calls the item by
-- its proper name. Both sides go through this before they are compared, the
-- way rsn_key does for account names. Apostrophes of every kind are removed
-- (people leave them out); anything else that is not a letter or digit is a
-- space; spacing is collapsed. Null for nothing-left, so '' never equals ''.
--
-- The Java twin is com.hsevents.core.DropKey and the two must never disagree:
-- both test files run the same cases.

create or replace function drop_key(p_text text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(
           regexp_replace(
             translate(lower(coalesce(p_text, '')), U&'\0027\2019\2018\0060\00B4', ''),
             '[^a-z0-9]+', ' ', 'g'),
           '\s+', ' ', 'g')), '');
$$;

-- ============================================================
-- 2. plugin_tokens
-- ============================================================
-- The plugin never holds a password. A token is made on My Account, shown
-- once, and stored only as its sha256. It can do what the plugin_* functions
-- do and nothing else.

create table if not exists plugin_tokens (
  id           uuid        primary key default gen_random_uuid(),
  profile_id   uuid        not null references profiles(id) on delete cascade,
  token_hash   text        not null unique,
  label        text        check (label is null or char_length(label) <= 40),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists plugin_tokens_live_idx
  on plugin_tokens (profile_id) where revoked_at is null;

-- RLS on and no policies: nothing reads or writes this table except the
-- security definer functions below.
alter table plugin_tokens enable row level security;
revoke all on plugin_tokens from public, anon, authenticated;

-- ============================================================
-- 3. The player's own three functions
-- ============================================================

-- Answers the token. This reply is the only place it ever exists.
create or replace function plugin_token_create(p_label text default null)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_token text;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if (select count(*) from plugin_tokens
       where profile_id = v_me and revoked_at is null) >= 5 then
    raise exception 'You already have 5 plugin tokens. Revoke one first.';
  end if;

  v_token := 'hse_' || encode(extensions.gen_random_bytes(32), 'hex');

  insert into plugin_tokens (profile_id, token_hash, label)
  values (v_me,
          encode(extensions.digest(v_token, 'sha256'), 'hex'),
          nullif(btrim(coalesce(p_label, '')), ''));

  return v_token;
end;
$$;

create or replace function plugin_token_list()
returns table (id uuid, label text, created_at timestamptz, last_used_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select t.id, t.label, t.created_at, t.last_used_at
    from plugin_tokens t
   where t.profile_id = auth.uid() and t.revoked_at is null
   order by t.created_at;
$$;

-- The owner, or an organiser for anybody.
create or replace function plugin_token_revoke(p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  update plugin_tokens
     set revoked_at = now()
   where id = p_id
     and revoked_at is null
     and (profile_id = auth.uid() or is_admin());

  if not found then
    raise exception 'No such plugin token';
  end if;
end;
$$;

-- ============================================================
-- 4. plugin_as: the rest of this request is that player
-- ============================================================
-- Every rule in the database asks auth.uid() who is calling. Rather than a
-- second body of add_evidence that takes a profile id, the token is turned
-- into the caller's identity for this one transaction, exactly as smoke_as
-- does in the smoke tests. set_config(..., true) is local to the transaction,
-- and PostgREST runs a request in one.
--
-- Internal. Execute is revoked from everybody; the plugin_* functions call it
-- as their owner.

create or replace function plugin_as(p_token text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_profile uuid;
begin
  if p_token is null or p_token !~ '^hse_[0-9a-f]{64}$' then
    raise exception 'Unknown or revoked plugin token';
  end if;

  update plugin_tokens
     set last_used_at = now()
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and revoked_at is null
  returning profile_id into v_profile;

  if v_profile is null then
    raise exception 'Unknown or revoked plugin token';
  end if;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_profile, 'role', 'authenticated')::text,
                     true);
  perform set_config('request.jwt.claim.sub', v_profile::text, true);
  -- No act-as-team through this door, whoever the token belongs to.
  perform set_config('request.headers', '{}', true);

  return v_profile;
end;
$$;

-- ============================================================
-- 5. plugin_whoami: the first thing a plugin can ask
-- ============================================================
-- "Test connection" in the plugin's settings, and what a submission is checked
-- against later: the in-game names this player has put on their own list.
-- Reads only; touches no game.

create or replace function plugin_whoami(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_me uuid := plugin_as(p_token);
begin
  return jsonb_build_object(
    'profile_id', v_me,
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object('rsn', a.rsn, 'primary', a.is_primary)
                       order by a.is_primary desc, a.rsn)
        from profile_accounts a
       where a.profile_id = v_me), '[]'::jsonb));
end;
$$;

-- ============================================================
-- 6. Grants
-- ============================================================

-- Supabase grants every new function in public to the three API roles by
-- default, so "to nobody" has to name the service role as well.
revoke execute on function plugin_as(text)               from public, anon, authenticated, service_role;
revoke execute on function plugin_whoami(text)           from public, anon, authenticated;
-- These three need a signed-in player (auth.uid()), which the service role is not.
revoke execute on function plugin_token_create(text)     from public, anon, service_role;
revoke execute on function plugin_token_list()           from public, anon, service_role;
revoke execute on function plugin_token_revoke(uuid)     from public, anon, service_role;

grant execute on function plugin_token_create(text)      to authenticated;
grant execute on function plugin_token_list()            to authenticated;
grant execute on function plugin_token_revoke(uuid)      to authenticated;
-- Only the intake Edge Function, which holds the service-role key, may call a
-- token-taking function.
grant execute on function plugin_whoami(text)            to service_role;
