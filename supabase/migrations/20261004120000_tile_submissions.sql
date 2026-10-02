-- ============================================================
-- Players suggest tiles; an organiser accepts or refuses them
-- ============================================================
-- Until now only an admin could put a task in the catalogue. Players know the
-- game better than any one organiser, so they get a way to suggest tiles --
-- through the same form the board builder uses -- and the organiser reviews
-- each one before it goes anywhere near `tile_library`.
--
-- Four decisions, made deliberately:
--
--   1. A suggestion is held in its own table, not as a "pending" flag on
--      `tile_library`. Every function that reads the catalogue (the builder,
--      autofill, presets) would otherwise have to learn to skip unreviewed
--      rows, and the one that forgot would put a player's typing on a board.
--      Accepting COPIES the tile into the catalogue -- the same copy-not-link
--      rule the catalogue already has with the boards (20260906190000).
--
--   2. Players never read the catalogue. It is the pool boards are filled
--      from, and bingo keeps its card hidden until Start precisely so nobody
--      works ahead -- a readable catalogue would hand out most of that card in
--      advance. Duplicates are caught by name instead: `tile_name_status` and
--      the submit functions answer "is this name taken" with yes or no, which
--      tells a player only whether the exact task they already thought of
--      exists. The organiser sees the near-misses at review time.
--
--   3. Nothing is ever deleted by a player. A pending suggestion can be
--      edited or withdrawn, and withdrawing is a status, not a DELETE. Refused
--      ones stay too, with the reason, so the player can read why. The one
--      thing that removes rows is an admin deleting the whole account
--      (`admin_delete_account`), which is the troll case and should take that
--      account's suggestions with it.
--
--   4. Same lockdown as every other table: no direct reads, no direct
--      writes. Narrow security definer functions are the whole surface.

do $$ begin
  create type tile_submission_status as enum ('pending', 'accepted', 'refused', 'withdrawn');
exception when duplicate_object then null; end $$;

create table if not exists tile_submissions (
  id                uuid        primary key default gen_random_uuid(),
  -- Cascade, unlike the catalogue's `created_by`: see (3) above.
  submitted_by      uuid        not null references profiles(id) on delete cascade,
  status            tile_submission_status not null default 'pending',
  -- The tile, in the catalogue's own columns, so the review form can open it
  -- with the same `draftFromRow` it opens a catalogue entry with.
  name              text        not null check (btrim(name) <> ''),
  icon              text,
  description       text,
  required_evidence smallint    not null default 1
                    check (required_evidence between 1 and 10000),
  completion        tile_completion not null default 'points',
  per_set           smallint    not null default 1 check (per_set between 1 and 30),
  -- Row-shaped drops: label, points, grp, max_times. A JSON array rather than a
  -- child table, because nothing queries into a suggestion's drops -- it is
  -- read whole, edited whole and copied whole on accept.
  options           jsonb       not null default '[]'::jsonb
                    check (jsonb_typeof(options) = 'array'),
  player_note       text        check (char_length(player_note) <= 500),
  review_note       text        check (char_length(review_note) <= 500),
  reviewed_by       uuid        references profiles(id) on delete set null,
  reviewed_at       timestamptz,
  -- Which catalogue entry an accepted suggestion became. `set null` for the
  -- same reason as `tiles.library_id`: tidying the catalogue later must not
  -- fail because a suggestion once pointed at the entry.
  library_id        uuid        references tile_library(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists tile_submissions_status_idx
  on tile_submissions (status, created_at desc);
create index if not exists tile_submissions_mine_idx
  on tile_submissions (submitted_by, created_at desc);
-- The duplicate check asks "is anything pending under this name" on every
-- submit and on every pause in typing.
create index if not exists tile_submissions_pending_name_idx
  on tile_submissions (tile_name_key(name)) where status = 'pending';

alter table tile_submissions enable row level security;

drop policy if exists tile_submissions_no_direct_read on tile_submissions;
create policy tile_submissions_no_direct_read on tile_submissions for select using (false);

-- The policy already denies everything; the grants go too, so a policy added
-- later for some other reason cannot quietly open writes.
revoke all on tile_submissions from anon, authenticated;

-- ============================================================
-- 1. One payload, checked once
-- ============================================================
-- The payload is what `payloadFromDraft` emits -- the shape
-- `admin_save_library_tile` takes -- and this applies the same clamps and the
-- same two rule checks to it, returning the row-shaped fields to store. A
-- suggestion the catalogue would refuse is refused here, at submit, rather
-- than at review where the player is no longer around to fix it.
--
-- Internal: execute is revoked from every client role.

create or replace function tile_submission_fields(p_tile jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name       text;
  v_completion tile_completion;
  v_amount     int;
  v_raw        jsonb;
  v_options    jsonb;
begin
  if jsonb_typeof(p_tile) is distinct from 'object' then
    raise exception 'That is not a tile';
  end if;

  v_name := left(btrim(regexp_replace(coalesce(p_tile ->> 'name', ''), '\s+', ' ', 'g')), 120);
  if v_name = '' then raise exception 'Your tile needs a name'; end if;

  begin
    v_completion := coalesce(nullif(btrim(coalesce(p_tile ->> 'rule', '')), ''),
                             'points')::tile_completion;
  exception when invalid_text_representation then
    raise exception 'Pick how the tile finishes';
  end;

  begin
    v_amount := least(greatest(coalesce((nullif(btrim(p_tile ->> 'amount'), ''))::int, 1), 1),
                      case when v_completion = 'value' then 10000 else 1000 end);
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'The target has to be a number';
  end;

  v_raw := case when jsonb_typeof(p_tile -> 'options') = 'array'
                then p_tile -> 'options' else '[]'::jsonb end;

  -- A board tile has no such limit, but a board tile is typed by an organiser.
  -- Sixty is more drops than any tile on the boards so far.
  if jsonb_array_length(v_raw) > 60 then
    raise exception 'A tile can list at most 60 drops';
  end if;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'label',     left(btrim(o.val ->> 'label'), 80),
             'points',    least(greatest(coalesce((o.val ->> 'points')::smallint, 1), 1), 30),
             'grp',       nullif(left(btrim(coalesce(o.val ->> 'grp', '')), 40), ''),
             'max_times', case when nullif(btrim(coalesce(o.val ->> 'maxTimes', '')), '') is null then null
                               else least(greatest((o.val ->> 'maxTimes')::smallint, 1), 30) end
           ) order by o.ord), '[]'::jsonb)
      into v_options
      from jsonb_array_elements(v_raw) with ordinality as o(val, ord)
     where btrim(coalesce(o.val ->> 'label', '')) <> '';
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'A drop''s points and max have to be whole numbers';
  end;

  perform assert_tile_rule_ok(v_completion, jsonb_array_length(v_options), 'This tile');
  -- Read from the raw payload: the check speaks the payload's `maxTimes`.
  perform assert_points_cap_reachable(v_completion, v_amount, v_raw, 'This tile');

  return jsonb_build_object(
    'name',              v_name,
    'icon',              nullif(regexp_replace(btrim(coalesce(p_tile ->> 'icon', '')),
                                               '[^A-Za-z0-9_-]', '', 'g'), ''),
    'description',       nullif(left(btrim(coalesce(p_tile ->> 'description', '')), 500), ''),
    'required_evidence', v_amount,
    'completion',        v_completion,
    'per_set',           least(greatest(coalesce((nullif(btrim(p_tile ->> 'perSet'), ''))::smallint, 1), 1), 30),
    'options',           v_options
  );
end;
$$;

revoke execute on function tile_submission_fields(jsonb) from public, anon, authenticated;

-- ============================================================
-- 2. Is this name taken?
-- ============================================================
-- 'catalogue' when the catalogue already has a tile by this name, 'pending'
-- when someone's suggestion under it is waiting for review, null when it is
-- free. Same `tile_name_key` the catalogue's unique index uses, so "taken"
-- here means exactly "accepting it would collide".
--
-- `p_except` skips one suggestion, so editing your own pending tile does not
-- report its own name as taken.

create or replace function tile_name_status(p_name text, p_except uuid default null)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_key text := tile_name_key(left(coalesce(p_name, ''), 120));
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if v_key is null or v_key = '' then return null; end if;

  if exists (select 1 from tile_library l where tile_name_key(l.name) = v_key) then
    return 'catalogue';
  end if;
  if exists (select 1 from tile_submissions s
              where s.status = 'pending'
                and tile_name_key(s.name) = v_key
                and s.id is distinct from p_except) then
    return 'pending';
  end if;
  return null;
end;
$$;

revoke execute on function tile_name_status(text, uuid) from public, anon;
grant  execute on function tile_name_status(text, uuid) to authenticated;

-- Raises the player-facing sentence for a taken name. Internal.
create or replace function assert_tile_name_free(p_name text, p_except uuid default null)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  case tile_name_status(p_name, p_except)
    when 'catalogue' then
      raise exception 'There is already a tile called "%" in the catalogue', p_name;
    when 'pending' then
      raise exception 'Someone has already suggested a tile called "%" and it is waiting for review', p_name;
    else
      null;
  end case;
end;
$$;

revoke execute on function assert_tile_name_free(text, uuid) from public, anon, authenticated;

-- ============================================================
-- 3. The player's side
-- ============================================================

create or replace function submit_tile(p_tile jsonb, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_fields  jsonb;
  v_pending int;
  v_id      uuid;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from profiles where id = v_uid) then
    raise exception 'Sign in first';
  end if;

  -- Ten waiting at once is plenty for anyone with real ideas, and a hard stop
  -- for anyone pasting the same tile fifty times.
  select count(*) into v_pending
    from tile_submissions where submitted_by = v_uid and status = 'pending';
  if v_pending >= 10 then
    raise exception 'You already have 10 tiles waiting for review. Wait for those first, or withdraw one.';
  end if;

  v_fields := tile_submission_fields(p_tile);
  perform assert_tile_name_free(v_fields ->> 'name');

  insert into tile_submissions (submitted_by, name, icon, description,
                                required_evidence, completion, per_set,
                                options, player_note)
  values (v_uid,
          v_fields ->> 'name',
          v_fields ->> 'icon',
          v_fields ->> 'description',
          (v_fields ->> 'required_evidence')::smallint,
          (v_fields ->> 'completion')::tile_completion,
          (v_fields ->> 'per_set')::smallint,
          v_fields -> 'options',
          nullif(left(btrim(coalesce(p_note, '')), 500), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function submit_tile(jsonb, text) from public, anon;
grant  execute on function submit_tile(jsonb, text) to authenticated;

-- Only your own, and only while it is still pending: once an organiser has
-- answered, the suggestion is a record of what they answered.
create or replace function update_tile_submission(p_id uuid, p_tile jsonb, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_row    tile_submissions%rowtype;
  v_fields jsonb;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;

  select * into v_row from tile_submissions where id = p_id for update;
  if not found or v_row.submitted_by <> v_uid then
    raise exception 'No such suggestion';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'This suggestion has already been %', v_row.status;
  end if;

  v_fields := tile_submission_fields(p_tile);
  perform assert_tile_name_free(v_fields ->> 'name', p_id);

  update tile_submissions set
    name              = v_fields ->> 'name',
    icon              = v_fields ->> 'icon',
    description       = v_fields ->> 'description',
    required_evidence = (v_fields ->> 'required_evidence')::smallint,
    completion        = (v_fields ->> 'completion')::tile_completion,
    per_set           = (v_fields ->> 'per_set')::smallint,
    options           = v_fields -> 'options',
    player_note       = nullif(left(btrim(coalesce(p_note, '')), 500), ''),
    updated_at        = now()
  where id = p_id;
end;
$$;

revoke execute on function update_tile_submission(uuid, jsonb, text) from public, anon;
grant  execute on function update_tile_submission(uuid, jsonb, text) to authenticated;

create or replace function withdraw_tile_submission(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row tile_submissions%rowtype;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;

  select * into v_row from tile_submissions where id = p_id for update;
  if not found or v_row.submitted_by <> v_uid then
    raise exception 'No such suggestion';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'This suggestion has already been %', v_row.status;
  end if;

  update tile_submissions set status = 'withdrawn', updated_at = now() where id = p_id;
end;
$$;

revoke execute on function withdraw_tile_submission(uuid) from public, anon;
grant  execute on function withdraw_tile_submission(uuid) to authenticated;

-- The caller's own suggestions, newest first. Never anyone else's, and never
-- the catalogue entry an accepted one became -- an organiser may have
-- reworded it on the way in, and that version belongs to the catalogue.
create or replace function my_tile_submissions()
returns table (id uuid, status text, name text, icon text, description text,
               required_evidence smallint, completion text, per_set smallint,
               options jsonb, player_note text, review_note text,
               reviewed_at timestamptz, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return query
    select s.id, s.status::text, s.name, s.icon, s.description,
           s.required_evidence, s.completion::text, s.per_set,
           s.options, s.player_note, s.review_note,
           s.reviewed_at, s.created_at, s.updated_at
      from tile_submissions s
     where s.submitted_by = auth.uid()
     order by s.created_at desc;
end;
$$;

revoke execute on function my_tile_submissions() from public, anon;
grant  execute on function my_tile_submissions() to authenticated;

-- ============================================================
-- 4. The organiser's side
-- ============================================================

create or replace function admin_list_tile_submissions()
returns table (id uuid, status text, name text, icon text, description text,
               required_evidence smallint, completion text, per_set smallint,
               options jsonb, player_note text, review_note text,
               submitted_by uuid, submitted_by_name text,
               reviewed_by_name text, reviewed_at timestamptz,
               library_id uuid, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
    select s.id, s.status::text, s.name, s.icon, s.description,
           s.required_evidence, s.completion::text, s.per_set,
           s.options, s.player_note, s.review_note,
           s.submitted_by, p.display_name, r.display_name, s.reviewed_at,
           s.library_id, s.created_at, s.updated_at
      from tile_submissions s
      join profiles p on p.id = s.submitted_by
      left join profiles r on r.id = s.reviewed_by
     -- The queue first, oldest at the top so nothing waits forever; then the
     -- history, newest first.
     order by (s.status = 'pending') desc,
              case when s.status = 'pending' then s.created_at end asc,
              coalesce(s.reviewed_at, s.updated_at) desc;
end;
$$;

revoke execute on function admin_list_tile_submissions() from public, anon;
grant  execute on function admin_list_tile_submissions() to authenticated;

-- `p_tile` is the organiser's version, which may differ from what was
-- submitted -- fixing a typo or a price on the way in is the point of review.
-- It goes through `admin_save_library_tile` itself, so there is still exactly
-- one definition of a valid catalogue entry, and its friendly "already exists"
-- message comes along for free. The catalogue then credits the player.
create or replace function admin_accept_tile_submission(p_id uuid, p_tile jsonb,
                                                        p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_row tile_submissions%rowtype;
  v_lib uuid;
begin
  if not is_admin() then raise exception 'Admins only'; end if;

  select * into v_row from tile_submissions where id = p_id for update;
  if not found then raise exception 'No such suggestion'; end if;
  if v_row.status <> 'pending' then
    raise exception 'This suggestion has already been %', v_row.status;
  end if;

  v_lib := admin_save_library_tile(null, p_tile);

  update tile_library set created_by = v_row.submitted_by where id = v_lib;

  update tile_submissions set
    status      = 'accepted',
    library_id  = v_lib,
    review_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_at  = now()
  where id = p_id;

  return v_lib;
end;
$$;

revoke execute on function admin_accept_tile_submission(uuid, jsonb, text) from public, anon;
grant  execute on function admin_accept_tile_submission(uuid, jsonb, text) to authenticated;

create or replace function admin_refuse_tile_submission(p_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row tile_submissions%rowtype;
begin
  if not is_admin() then raise exception 'Admins only'; end if;

  select * into v_row from tile_submissions where id = p_id for update;
  if not found then raise exception 'No such suggestion'; end if;
  if v_row.status <> 'pending' then
    raise exception 'This suggestion has already been %', v_row.status;
  end if;

  update tile_submissions set
    status      = 'refused',
    review_note = nullif(left(btrim(coalesce(p_reason, '')), 500), ''),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_at  = now()
  where id = p_id;
end;
$$;

revoke execute on function admin_refuse_tile_submission(uuid, text) from public, anon;
grant  execute on function admin_refuse_tile_submission(uuid, text) to authenticated;
