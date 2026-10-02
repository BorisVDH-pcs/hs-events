-- Undo 20261005120000_webhook_connected_message.sql: admin_set_webhook as it
-- was in 0040, saving without posting a "Webhook connected" line.

create or replace function admin_set_webhook(
  p_game_id uuid, p_team_id uuid, p_url text,
  p_enabled boolean default true, p_label text default null
)
returns discord_webhooks
language plpgsql security definer set search_path = public as $$
declare
  v_row discord_webhooks;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_url is null or btrim(p_url) = '' then raise exception 'A webhook needs a URL'; end if;
  if p_team_id is not null
     and not exists (select 1 from teams where id = p_team_id and game_id = p_game_id) then
    raise exception 'That team is not in this game';
  end if;

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

  return v_row;
end;
$$;

revoke execute on function admin_set_webhook(uuid, uuid, text, boolean, text) from public, anon;
grant  execute on function admin_set_webhook(uuid, uuid, text, boolean, text) to authenticated;
