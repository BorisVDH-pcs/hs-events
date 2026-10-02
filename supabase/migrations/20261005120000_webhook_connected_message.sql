-- Discord: say hello when a webhook is connected.
--
-- Until now a wrong webhook URL showed itself only when the event started and
-- nothing arrived in the channel. admin_set_webhook now posts one line to the
-- channel the moment a webhook starts pointing somewhere new -- a new row, a
-- changed URL, or one switched back on -- so the organiser sees it arrive (or
-- not) while still on the Discord tab:
--
--   :white_check_mark: Webhook connected for **Game**. This channel will get
--   the game's public updates.            (or: Team X's own updates)
--
-- Re-saving the same URL, or switching one off, sends nothing.
--
-- Fire-and-forget through pg_net like every other post (relay_flush): the save
-- never waits on Discord or fails because of it. Same `username` as the relay,
-- so the hello looks like the posts that follow it.
--
-- To undo: scripts/rollback-webhook-connected-message.sql.

create or replace function admin_set_webhook(
  p_game_id uuid, p_team_id uuid, p_url text,
  p_enabled boolean default true, p_label text default null
)
returns discord_webhooks
language plpgsql security definer set search_path = public as $$
declare
  v_row         discord_webhooks;
  v_old_url     text;
  v_old_enabled boolean;
  v_game_name   text;
  v_team_name   text;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_url is null or btrim(p_url) = '' then raise exception 'A webhook needs a URL'; end if;
  if p_team_id is not null
     and not exists (select 1 from teams where id = p_team_id and game_id = p_game_id) then
    raise exception 'That team is not in this game';
  end if;

  select url, enabled into v_old_url, v_old_enabled
    from discord_webhooks
   where game_id = p_game_id and team_id is not distinct from p_team_id;

  update discord_webhooks
     set url = btrim(p_url), enabled = p_enabled,
         label = coalesce(nullif(btrim(p_label), ''), label)
   where game_id = p_game_id and team_id is not distinct from p_team_id
   returning * into v_row;

  if not found then
    insert into discord_webhooks (game_id, team_id, label, url, enabled)
    values (p_game_id, p_team_id,
            coalesce(nullif(btrim(p_label), ''),
                     case when p_team_id is null then 'general' else 'team' end),
            btrim(p_url), p_enabled)
    returning * into v_row;
  end if;

  if v_row.enabled
     and (v_old_url is distinct from v_row.url or not coalesce(v_old_enabled, false)) then
    select name into v_game_name from games where id = p_game_id;
    select name into v_team_name from teams where id = p_team_id;
    perform net.http_post(
      url     := v_row.url,
      body    := jsonb_build_object(
                   'content',
                   format(':white_check_mark: Webhook connected for **%s**. This channel will get %s.',
                          coalesce(v_game_name, 'this game'),
                          case when p_team_id is null
                               then 'the game''s public updates'
                               else format('**%s**''s own updates', coalesce(v_team_name, 'the team'))
                          end),
                   'username', 'HS Battleships'),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;

  return v_row;
end;
$$;

revoke execute on function admin_set_webhook(uuid, uuid, text, boolean, text) from public, anon;
grant  execute on function admin_set_webhook(uuid, uuid, text, boolean, text) to authenticated;
