// "View as team": an organiser looking at a team's player screen.
//
// The screen is the players' own, buttons and all, so this is what keeps it
// read only. Every player action calls assertWritable() before it reaches the
// server, and while a team is being viewed that throws -- the error lands in
// the same red line as any refusal, and nothing is sent.
//
// Most of these would be refused by the server anyway: they take the team from
// auth.uid(), and an organiser is on no team. Two would not -- place_fleet and
// rename_team take a team id and let an organiser through -- and an upload
// reaches storage before any RPC runs. So the line is drawn here, for all of
// them, rather than left to which ones happen to be refused.
//
// "Act for team": the organiser can lift that, on purpose, for the team being
// viewed. assertWritable() then lets everything through, and lib/supabase.js
// names the team on every database request in an `x-act-as-team` header. The
// server honours it for organisers only (acting_as_team() in
// 20261003150000_admin_act_as_team.sql) and plays the action as that team.
//
// Module state rather than React context: the guards live in plain functions
// (lib/supabase.js, lib/evidence.js, lib/petJar.js) that components call
// directly, and there is only ever one screen on the page.

// Off switch for acting, if it ever needs pulling without a database change:
// the button disappears and every team screen goes back to read only.
export const ACTING_ENABLED = true;

let viewing = null;
let actingTeamId = null;

/**
 * The team on screen, or null to end it. `acting` is that team's id while the
 * organiser acts for it, null while only viewing.
 */
export function setViewOnly(teamName, acting = null) {
  viewing = teamName || null;
  actingTeamId = (ACTING_ENABLED && viewing && acting) || null;
}

export function isViewOnly() {
  return viewing !== null && actingTeamId === null;
}

/** The team id to send in `x-act-as-team`, or null. */
export function actingTeam() {
  return actingTeamId;
}

export function assertWritable() {
  if (viewing !== null && actingTeamId === null) {
    throw new Error(
      `Read only: you are viewing ${viewing}’s screen as an organiser, so nothing was changed.`
    );
  }
}
