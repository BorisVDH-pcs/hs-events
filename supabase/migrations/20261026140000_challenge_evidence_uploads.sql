-- Challenge screenshots arrive as files, not as links to somewhere else.
--
-- WHY IT WAS A PASTED LINK UNTIL NOW. The `evidence` bucket's policies gate on
-- the team folder -- (storage.foldername(name))[2] against my_team_ids(), see
-- 0021 -- and a solo challenge has no team at all. There was no path a
-- challenge entrant was allowed to write to, so the only thing left was to ask
-- them to upload the picture somewhere else and paste the address.
--
-- That hands the player the hardest part of the job, and it leaves the proof
-- somewhere nobody here controls: an imgur link rots, and a Discord attachment
-- opens for the poster and for no one else. Evidence that cannot be opened in
-- three weeks is not evidence.
--
-- The fix is a second namespace in the same bucket, keyed on the ENTRY rather
-- than on a team:
--
--     challenge/{game_id}/{entry_id}/{uuid}.webp
--
-- The literal first segment is what keeps the two apart. A tile path's segment
-- 2 is a team id; a challenge path's segment 2 is a game id, which is never a
-- team id, so 0021's policies cannot be coaxed into matching one of these --
-- and the policies below check segment 1 before they look at anything else.
--
-- The `url` column stays, and stays readable. Events made while pasting a link
-- was the only way in are still running, and their shots must keep opening.

-- ============================================================
-- 1. A file, or a link, but one of them
-- ============================================================

alter table challenge_evidence add column if not exists storage_path text;
alter table challenge_evidence alter column url drop not null;

-- Unique so the same object cannot be registered against two entries. Partial,
-- because every row written before today has no path at all and nulls would
-- collide on a plain unique constraint in some of the places this runs.
create unique index if not exists challenge_evidence_path_idx
  on challenge_evidence (storage_path) where storage_path is not null;

-- A row with neither is a shot nobody can look at, which is the one thing this
-- table exists to prevent.
alter table challenge_evidence drop constraint if exists challenge_evidence_has_a_shot;
alter table challenge_evidence add constraint challenge_evidence_has_a_shot
  check (url is not null or storage_path is not null);

-- ============================================================
-- 2. Which entries are mine
-- ============================================================
-- SECURITY DEFINER for the same reason my_team_ids() is (0001): challenge
-- entries carry RLS with no select policy, so a storage policy evaluating as
-- the caller sees an empty table and refuses every upload.
--
-- It answers ids only. Who is in an event is already public on the ladder; what
-- they declared and what they handed in is not, and none of that is in here.

create or replace function my_challenge_entry_ids() returns setof uuid
language sql stable security definer set search_path = public as $fn$
  select id from challenge_entries where profile_id = auth.uid()
$fn$;

revoke execute on function my_challenge_entry_ids() from public, anon;
grant  execute on function my_challenge_entry_ids() to authenticated;

-- ============================================================
-- 3. The bucket
-- ============================================================
-- Added beside 0021's policies rather than folded into them. Postgres ORs the
-- permissive policies on a table together, so the organiser's read of the whole
-- bucket still comes from `evidence_objects_read`'s is_admin() branch and is
-- not repeated here.

drop policy if exists challenge_evidence_objects_read on storage.objects;
create policy challenge_evidence_objects_read on storage.objects
  for select using (
    bucket_id = 'evidence'
    and (storage.foldername(name))[1] = 'challenge'
    and (storage.foldername(name))[3] in (select e::text from my_challenge_entry_ids() e)
  );

drop policy if exists challenge_evidence_objects_write on storage.objects;
create policy challenge_evidence_objects_write on storage.objects
  for insert with check (
    bucket_id = 'evidence'
    and (storage.foldername(name))[1] = 'challenge'
    and (storage.foldername(name))[3] in (select e::text from my_challenge_entry_ids() e)
  );

-- Still no update or delete policy, deliberately, exactly as for tile evidence:
-- a player replacing a shot supersedes it, and what came before stays where an
-- organiser can still open it.

-- ============================================================
-- 4. Registering an uploaded shot
-- ============================================================
-- A sibling of challenge_add_evidence rather than a wider version of it. The
-- old one is what every running event's screen calls, and the two differ in
-- precisely one way that matters: a path has to be checked against the entry it
-- claims to belong to, and a link cannot be checked at all.

create or replace function challenge_add_shot(
  p_game_id uuid, p_phase text, p_storage_path text, p_note text default null)
returns uuid
language plpgsql
security definer set search_path = public as $fn$
declare
  v_game   games%rowtype;
  v_setup  challenge_setup%rowtype;
  v_entry  challenge_entries%rowtype;
  v_prefix text;
  v_n      int;
  v_id     uuid;
begin
  v_setup := challenge_setup_for(p_game_id);
  select * into v_game from games where id = p_game_id;

  if v_setup.declared_label is null then
    raise exception 'This event has nothing to prove — it is scored from the hiscores';
  end if;
  if p_phase not in ('start', 'finish') then
    raise exception 'A shot is either the start or the finish';
  end if;
  if coalesce(btrim(p_storage_path), '') = '' then
    raise exception 'That is not a picture';
  end if;
  if v_game.status <> 'active' then
    raise exception 'The event is % — nothing can be submitted', v_game.status;
  end if;
  if v_game.ends_at is not null and now() >= v_game.ends_at then
    raise exception 'The event is over — submissions closed';
  end if;

  select * into v_entry from challenge_entries
   where game_id = p_game_id and profile_id = auth.uid();
  if not found then raise exception 'You are not in this event'; end if;

  -- Re-derived here, never trusted from the client. The bucket policy lets a
  -- player write anywhere under any entry of their own, so without this they
  -- could upload into one event's folder and register it against another.
  v_prefix := 'challenge/' || p_game_id || '/' || v_entry.id || '/';
  if position(v_prefix in p_storage_path) <> 1 then
    raise exception 'That picture is not filed under this entry';
  end if;

  select count(*) into v_n from challenge_evidence
   where entry_id = v_entry.id and phase = p_phase;
  if v_n >= challenge_max_evidence() then
    raise exception 'That is enough % shots', p_phase;
  end if;

  insert into challenge_evidence (entry_id, phase, storage_path, note)
  values (v_entry.id, p_phase, btrim(p_storage_path),
          nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke execute on function challenge_add_shot(uuid, text, text, text) from public, anon;
grant  execute on function challenge_add_shot(uuid, text, text, text) to authenticated;

-- ============================================================
-- 5. Handing the path back out
-- ============================================================
-- Both readers gain `storage_path` beside `url`. A screen signs the one it gets
-- and opens the other, so a mixed event -- links from before, files from now --
-- draws without knowing which is which.

-- Carried forward from 20261026120600, which is where this last changed:
-- `wom_added` and `wom_found` tell the player which half of a name check went
-- wrong, and replacing the function from an older copy would quietly take both
-- messages away again.
create or replace function challenge_mine(p_game_id uuid)
returns jsonb
language plpgsql stable
security definer set search_path = public as $fn$
declare
  v_entry challenge_entries%rowtype;
  v_has   boolean;
begin
  perform challenge_setup_for(p_game_id);
  select * into v_entry from challenge_entries
   where game_id = p_game_id and profile_id = auth.uid();
  if not found then return null; end if;

  select exists (select 1 from challenge_wom where game_id = p_game_id) into v_has;

  return jsonb_build_object(
    'entry_id',    v_entry.id,
    'team_id',     v_entry.team_id,
    'rsn',         v_entry.rsn,
    'wom_start',   v_entry.wom_start,
    'wom_end',     v_entry.wom_end,
    'wom_gained',  v_entry.wom_gained,
    'wom_added',   case when not v_has or v_entry.rsn is null then null
                        else v_entry.wom_added_at is not null end,
    'wom_found',   v_entry.wom_found,
    'declared',    v_entry.declared,
    'declared_at', v_entry.declared_at,
    'altered',     v_entry.altered_by is not null,
    'verified',    v_entry.verified_at is not null,
    'evidence',    coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'phase', e.phase, 'url', e.url,
                                          'storage_path', e.storage_path, 'note', e.note)
                       order by e.added_at)
        from challenge_evidence e where e.entry_id = v_entry.id), '[]'::jsonb));
end;
$fn$;

create or replace function admin_challenge_entries(p_game_id uuid)
returns jsonb
language plpgsql stable
security definer set search_path = public as $fn$
begin
  perform challenge_setup_for(p_game_id);
  if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'entry_id',    e.id,
             'profile_id',  e.profile_id,
             'name',        coalesce(p.display_name, 'Someone'),
             'rsn',         e.rsn,
             'team_id',     e.team_id,
             'team_name',   t.name,
             'wom_gained',  e.wom_gained,
             'declared',    e.declared,
             'declared_at', e.declared_at,
             'altered_by',  e.altered_by,
             'altered_by_name', ap.display_name,
             'verified_at', e.verified_at,
             'evidence',    coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', v.id, 'phase', v.phase, 'url', v.url,
                        'storage_path', v.storage_path, 'note', v.note)
                      order by v.phase desc, v.added_at)
                 from challenge_evidence v where v.entry_id = e.id), '[]'::jsonb))
           order by e.declared desc nulls last, e.joined_at)
      from challenge_entries e
      join profiles p on p.id = e.profile_id
      left join teams t on t.id = e.team_id
      left join profiles ap on ap.id = e.altered_by
     where e.game_id = p_game_id), '[]'::jsonb);
end;
$fn$;
