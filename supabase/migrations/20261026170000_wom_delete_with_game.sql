-- ============================================================
-- Deleting a challenge takes its WOM competition with it
-- ============================================================
--
-- admin_delete_game has always been one line: `delete from games`. Everything
-- else goes by cascade, and challenge_wom is one of the things that goes --
-- which means the competition_id AND the verification_code vanish at the same
-- moment the game does.
--
-- That is the wrong order of events. WOM requires the verification code to
-- edit or delete a competition, so once the cascade has run, a competition
-- created by this site is live on wiseoldman.net with nobody on our side able
-- to touch it ever again. Deleting the event here quietly orphans it there.
--
-- So the competition is deleted FIRST, and the game only afterwards.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. Ending a challenge is untouched.
-- challenge_do_end is the moment the standings crown a winner, and the
-- competition is the public record of that result -- taking it down at exactly
-- the point it becomes worth reading is not a tidy-up, it is destroying the
-- evidence. Ending early would ideally PUT endsAt so WOM stops counting, but
-- pg_net only speaks GET, POST and DELETE ("only supports three types of
-- asynchronous requests"), so there is no PUT to be had from inside Postgres.
-- That half needs somewhere that can issue one; it is not here.

-- pg_net grew the body parameter on http_delete late, and WOM wants the
-- verification code in the body. Same check 20261026120600 makes, for the same
-- reason: a missing signature should fail the deploy, not the first deletion.
do $guard$
begin
  if to_regprocedure('net.http_delete(text, jsonb, jsonb, integer, jsonb)') is null then
    raise exception
      'pg_net''s http_delete does not take a body on this database, so a competition cannot be deleted';
  end if;
end
$guard$;

-- ============================================================
-- 1. What was asked for, after the game is gone
-- ============================================================
--
-- pg_net is fire-and-forget. It queues the request and answers with an id; it
-- never tells us WOM accepted it. For every other call that is fine, because
-- the game is still there to try again from. Here it is not: by the time WOM
-- answers, the game, the challenge_wom row and the code are all gone, so a
-- refusal would leave exactly the orphan this migration exists to prevent,
-- and no trace of which competition it was.
--
-- Hence a table that is NOT keyed to games and so survives the cascade.
--
-- IT KEEPS THE VERIFICATION CODE, on purpose. A credential outliving the thing
-- it protects is not a decision to make quietly, so: the code is the only
-- means of deleting that competition, and a row only exists here because we
-- have already tried and cannot know whether it worked. Dropping the code
-- would make this table a list of competitions you can see are orphaned and
-- cannot do anything about. It is as locked down as challenge_wom -- RLS on,
-- no policies, nothing granted -- so only a definer function or the service
-- role reads it.
create table challenge_wom_deleted (
  request_id        bigint      primary key,
  competition_id    bigint      not null,
  verification_code text        not null,

  -- Loose references, deliberately not foreign keys: the game is deleted in
  -- the same transaction, and the whole point is to outlive it.
  game_id           uuid        not null,
  game_name         text,

  requested_at      timestamptz not null default now()
);

comment on table challenge_wom_deleted is
  'Competitions this site asked WOM to delete as their game was deleted. CREDENTIALS: keeps the verification code so an orphan can still be cleaned up by hand. RLS on with no policies, so no client can read this.';

alter table challenge_wom_deleted enable row level security;
revoke all on challenge_wom_deleted from anon, authenticated;

-- ============================================================
-- 2. Taking the competition down
-- ============================================================

create or replace function challenge_wom_destroy(p_game_id uuid)
returns bigint
language plpgsql
security definer set search_path = public as $fn$
declare
  v_wom  challenge_wom%rowtype;
  v_name text;
  v_req  bigint;
begin
  select * into v_wom from challenge_wom where game_id = p_game_id;
  -- No competition behind this game: every non-challenge mode, and a challenge
  -- whose competition was never created. Nothing to do, and not an error.
  if not found then return null; end if;

  select name into v_name from games where id = p_game_id;

  -- DELETE /competitions/:id, code in the body. WOM calls this irreversible
  -- and they are right -- which is why nothing calls this except the deletion
  -- of the game it belongs to.
  select net.http_delete(
    url     := challenge_wom_base() || '/competitions/' || v_wom.competition_id,
    body    := jsonb_build_object('verificationCode', v_wom.verification_code),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    -- See 130200: pg_net defaults to five seconds, and WOM needs more.
    timeout_milliseconds := challenge_wom_timeout()
  ) into v_req;

  insert into challenge_wom_deleted
    (request_id, competition_id, verification_code, game_id, game_name)
  values (v_req, v_wom.competition_id, v_wom.verification_code, p_game_id, v_name);

  return v_req;
end;
$fn$;

comment on function challenge_wom_destroy(uuid) is
  'Queues the WOM delete for a game about to be deleted. Must be called BEFORE the game row goes.';

-- Internal. admin_delete_game is already the admin gate, and nothing else has
-- any business deleting a competition.
revoke execute on function challenge_wom_destroy(uuid) from public, anon, authenticated;

-- ============================================================
-- 3. admin_delete_game, in the right order
-- ============================================================
--
-- Body from 0006_admin_and_ship_spacing.sql, with the competition taken down
-- first. The ordering is the whole substance of this function: challenge_wom
-- is `on delete cascade`, so after the delete there is no code left to send.
--
-- Both happen in one transaction, which is what makes this safe in the other
-- direction too. pg_net queues into a table, so if anything below raises, the
-- queued request rolls back with everything else and WOM is never called --
-- no competition is deleted for a game that then survived.

create or replace function admin_delete_game(p_game_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  perform challenge_wom_destroy(p_game_id);
  delete from games where id = p_game_id;   -- cascades to teams, tiles, claims, events
end;
$$;

revoke execute on function admin_delete_game(uuid) from public, anon;
grant  execute on function admin_delete_game(uuid) to authenticated;
