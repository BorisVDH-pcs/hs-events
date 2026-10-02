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
// Module state rather than React context: the guards live in plain functions
// (lib/supabase.js, lib/evidence.js, lib/petJar.js) that components call
// directly, and there is only ever one screen on the page.

let viewing = null;

/** The team name while one is being viewed, or null to end it. */
export function setViewOnly(teamName) {
  viewing = teamName || null;
}

export function isViewOnly() {
  return viewing !== null;
}

export function assertWritable() {
  if (viewing !== null) {
    throw new Error(
      `Read only: you are viewing ${viewing}’s screen as an organiser, so nothing was changed.`
    );
  }
}
