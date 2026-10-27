import { useCallback, useEffect, useRef, useState } from 'react';
import {
  challengeList, challengeMine, challengeStandings, challengeWomCompetition,
  challengeJoin, challengeLeave, challengeDeclare, challengeTick, womPulse,
  myAccounts, challengeMyAccounts,
} from '../../lib/supabase.js';
import { signedUrls, uploadChallengeShot } from '../../lib/evidence.js';
import {
  CLOCK_TICK_MS, MAX_EVIDENCE, WOM_PULSE_MS,
  figureLabel, figureToStored, metricIcon, metricInitials, metricLabel,
  rankedLabel, storedToInput, womCompetitionUrl, womLabel,
} from '../../lib/challenge.js';
import { useCountdown, pad } from '../../lib/countdown.js';
import EventFeed from '../EventFeed.jsx';
import TileIcon from '../TileIcon.jsx';
import ChallengeLadder from './ChallengeLadder.jsx';
import ChallengeRsnField from './ChallengeRsnField.jsx';

/**
 * The player's view of a challenge.
 *
 * No board, so none of the three-column board layout applies: what a player
 * does here is sign up, give a number, hang the screenshots behind it, and
 * watch the ranking.
 *
 * IT LOADS ITS OWN DATA. Every other mode comes through `board_for_me`, which
 * answers in one call because every other mode is a board. A challenge needs
 * three things that function does not carry — the setup, this player's entry
 * and the ranking — and all three sit behind tables with RLS on and no policies,
 * so they can only come from their own RPCs. Teaching `board_for_me` a fourth
 * shape would mean editing a shared function for the one mode that has nothing
 * in common with the other four.
 */
export default function ChallengeGame({
  game, teams = [], events = [], profileId = null, onRefresh, onOpenAccounts = null,
}) {
  const [setup, setSetup] = useState(null);
  const [mine, setMine] = useState(null);
  const [standings, setStandings] = useState([]);
  // The WOM competition's id, or null until the create request comes back.
  const [wom, setWom] = useState(null);
  // The saved accounts behind the picker, and — in an all-accounts event —
  // the ones this entry is actually being scored on.
  const [accounts, setAccounts] = useState([]);
  const [entryAccounts, setEntryAccounts] = useState([]);
  // True while the player is typing a name rather than picking a saved one.
  const [freeform, setFreeform] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [rsn, setRsn] = useState('');
  const [figure, setFigure] = useState('');

  const isOpen = game.status === 'setup' || game.status === 'placement';
  const isActive = game.status === 'active';
  const isFinished = game.status === 'finished';
  const joined = Boolean(mine);
  const unit = setup?.declared_unit ?? null;
  // The time the event is waiting on, which is not the same time all the way
  // through: before it opens that is the start, and once it is running it is
  // the end. One clock either way, because only one of them is ever next.
  const waitingFor = isOpen ? game.starts_at : isActive ? game.ends_at : null;
  const left = useCountdown(waitingFor);

  const load = useCallback(async () => {
    try {
      const [list, entry, rows, womId, mineAccounts] = await Promise.all([
        challengeList(),
        challengeMine(game.id),
        challengeStandings(game.id),
        challengeWomCompetition(game.id),
        // Empty for a normal event — the rows only exist where the organiser
        // asked for every account to count — so it is always asked for rather
        // than branched on a setup that has not loaded yet.
        challengeMyAccounts(game.id),
      ]);
      setSetup((list ?? []).find((c) => c.game_id === game.id) ?? null);
      setMine(entry ?? null);
      setStandings(rows ?? []);
      setWom(womId ?? null);
      setEntryAccounts(mineAccounts ?? []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [game.id]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // The player's saved accounts, which the picker is built from and whose
  // primary is what an empty box starts at. The entry still snapshots whatever
  // is sent, so picking one here fixes this event only and leaves the saved
  // list alone — which is the whole reason My Account had to exist separately.
  useEffect(() => {
    if (!profileId) return;
    myAccounts()
      .then((rows) => setAccounts(rows ?? []))
      .catch(() => setAccounts([]));
  }, [profileId]);

  const primaryRsn = accounts.find((a) => a.is_primary)?.rsn ?? '';

  useEffect(() => {
    const next = mine?.rsn ?? primaryRsn ?? '';
    setRsn(next);
    // A name already on the entry that is not one of the saved accounts is a
    // one-off, and the box has to open on it rather than silently snapping to
    // the main — that would change what the entry is scored on at the next
    // press of Save.
    setFreeform(Boolean(next) && !accounts.some((a) => a.rsn === next));
  }, [mine?.rsn, primaryRsn, accounts]);
  useEffect(() => { setFigure(storedToInput(mine?.declared, unit)); }, [mine?.declared, unit]);

  /*
   * Signed links for the shots that are files.
   *
   * The bucket is private deliberately, so there is no address to build -- and
   * these expire, which is the point: one pasted into the wrong channel stops
   * working rather than showing somebody's bank for the rest of the event.
   *
   * Rows made before uploads existed carry a plain `url` instead and are left
   * alone, so an event that is halfway through draws both kinds without
   * knowing which it has.
   */
  const [shotUrls, setShotUrls] = useState({});
  const shotPaths = (mine?.evidence ?? [])
    .map((e) => e.storage_path).filter(Boolean).join('|');
  useEffect(() => {
    if (!shotPaths) { setShotUrls({}); return undefined; }
    let live = true;
    signedUrls(shotPaths.split('|'))
      .then((map) => { if (live) setShotUrls(map); })
      // A shot that will not sign is one broken picture, not a broken page:
      // ShotBox says so in place of the link and the rest of the screen stays.
      .catch(() => { if (live) setShotUrls({}); });
    return () => { live = false; };
  }, [shotPaths]);

  /**
   * Wise Old Man, on a timer nobody set.
   *
   * There is no scheduler on this project, so an open page is what keeps the
   * numbers moving — the same arrangement that settles a finished bingo. Both
   * halves of the pulse are rate limited server-side, so fifty open phones
   * cost one request between them, and a reply that landed is only worth a
   * reload when it actually changed something.
   */
  const pulsing = useRef(false);
  useEffect(() => {
    if (!isActive || !setup?.wom_metric) return undefined;
    let live = true;
    const tick = async () => {
      if (pulsing.current) return;
      pulsing.current = true;
      try {
        if ((await womPulse(game.id)) > 0 && live) await load();
      } catch {
        // A WOM outage is not this screen's problem to announce: the figures
        // stay where they were until the next turn of the loop.
      } finally {
        pulsing.current = false;
      }
    };
    tick();
    const timer = window.setInterval(tick, WOM_PULSE_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [isActive, setup?.wom_metric, game.id, load]);

  /**
   * The clock, which nothing on a server turns.
   *
   * An event carries a start time and an end time, and both are meant to act on
   * their own -- nobody should have to be awake on a Monday morning to let an
   * event begin. There is no scheduler on this project, so "on its own" means
   * whoever has the page open: the same arrangement the Wise Old Man loop above
   * runs on, and the one that settles a finished bingo.
   *
   * It is only read when there is something owed. Two cases:
   *
   *   OVERDUE -- the time the event is waiting on has gone by and the event has
   *     not moved. Checked every ten seconds, which is also how the ending gets
   *     its second pass: the first writes down whatever WOM has sent and asks
   *     for fresh figures, the next one settles the ranking on them.
   *   NO COMPETITION -- an event that opened before anybody had given a
   *     RuneScape name has nothing for WOM to add latecomers to, so it needs
   *     one made the moment somebody signs up. Checked on the slow beat,
   *     because nothing about it is urgent.
   *
   * `challenge_tick` is idempotent, locks the row and refuses anything the
   * clock has not earned, so fifty open phones do between them exactly what one
   * would. Its answer is null when it did nothing, which is the common case and
   * is not worth a reload.
   */
  const ticking = useRef(false);
  const overdue = (isOpen || isActive) && left.set && left.started;
  const noCompetition = isActive && Boolean(setup?.wom_metric) && !wom;
  useEffect(() => {
    if (!overdue && !noCompetition) return undefined;
    let live = true;
    let spent = false;
    const turn = async () => {
      if (spent || ticking.current) return;
      ticking.current = true;
      try {
        const did = await challengeTick(game.id);
        if (!live) return;
        // The slow beat answering "nothing owed" is the normal case -- it is
        // waiting for somebody to sign up -- and says nothing this screen does
        // not already show.
        if (!did && !overdue) return;
        // Overdue and nothing owed means one of two things, and neither is
        // worth asking about every ten seconds: another browser got there
        // first, so this page is one reload behind, or the event is waiting on
        // a person. One look, then leave it. A status that did change takes
        // this effect down with it, so there is nothing to restart.
        if (!did) spent = true;
        // The status is the parent's to hold, so starting and finishing both
        // need the refresh as well as the reload.
        await load();
        await onRefresh?.();
      } catch {
        // Same as the pulse: whatever went wrong, the times have not changed
        // and the next turn will try again.
      } finally {
        ticking.current = false;
      }
    };
    turn();
    const timer = window.setInterval(turn, overdue ? CLOCK_TICK_MS : WOM_PULSE_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [overdue, noCompetition, game.id, load, onRefresh]);

  const run = async (fn, done) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
      await onRefresh?.();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p>Loading the event…</p>;

  const myTeam = teams.find((t) => t.id === mine?.team_id) ?? null;
  const winner = isFinished ? standings.find((s) => s.place === 1) : null;
  const typed = figureToStored(figure, unit);
  const unchanged = typed !== null && typed === (mine?.declared ?? null);
  const addShot = (phase, file, note) => run(
    () => uploadChallengeShot({
      gameId: game.id, entryId: mine?.entry_id, phase, file, note,
    }),
    phase === 'start' ? 'Start shot added.' : 'Finish shot added.',
  );

  const startShots = (mine?.evidence ?? []).filter((e) => e.phase === 'start');
  const finishShots = (mine?.evidence ?? []).filter((e) => e.phase === 'finish');

  // Whether the head card has anything to say about the competition: the link
  // once Wise Old Man has made it, and the line explaining its absence once
  // the event is running without one. While it is still open there is nothing
  // missing yet, so neither is true and the slot stays empty.
  const womSlot = Boolean(setup?.wom_metric) && (Boolean(wom) || !isOpen);

  return (
    <div className="challenge-layout">
      <div className="challenge-main">
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="muted notice" role="status">✓ {notice}</p>}

        <section className="card challenge-head">
          {/* ---- What event this is ----
              The name used to be an ordinary <h2>, which in this app is a
              13px grey section label -- the title of the thing a player has
              just walked into, set smaller than the sentence under it. It
              leads the card now, with the clock on its right where there is
              room for it, and the event's own face beside both. */}
          <div className="challenge-hero">
            {setup?.wom_metric && (
              <span className="challenge-hero-art">
                {/* The art was only ever on the organiser's metric picker,
                    and a week of Zulrah is a different event to a player long
                    before any rules are read. The two metrics with no picture
                    are Wise Old Man's own arithmetic, EHP and EHB, and both
                    carry their initials in brackets -- so the worded badge is
                    right in exactly the cases it can appear in. */}
                <TileIcon
                  slug={metricIcon(setup.wom_metric)}
                  fallback={(
                    <span className="challenge-hero-word" aria-hidden="true">
                      {metricInitials(metricLabel(setup.wom_metric))}
                    </span>
                  )}
                />
              </span>
            )}

            <div className="challenge-hero-text">
              <h2>{game.name}</h2>
              {/* "won on" said what the figure does without naming the thing
                  it does it to, so the card and the panel at the bottom of the
                  screen described the same rule in two vocabularies. Both say
                  ranked by now. */}
              <p className="muted">
                {setup?.solo === false ? 'Teams' : 'Everyone for themselves'}
                {' · ranked by '}
                {rankedLabel(setup)}
              </p>
            </div>

            {/* The clock is the whole shape of a short event, so it sits in
                the heading whichever phase it is in: counting to the start
                while it is waiting, and to the end once it is running.

                At zero it says what is happening instead of showing 00:00:00,
                because both times now act when they arrive and a stopped clock
                over an event that is about to move reads as broken. */}
            {left.set && !isFinished && (
              <p className="challenge-clock">
                {left.started ? (
                  <span className="muted">{isOpen ? 'Starting…' : 'Finishing…'}</span>
                ) : (
                  <>
                    {left.days > 0 && `${left.days}d `}
                    {pad(left.hours)}:{pad(left.minutes)}:{pad(left.seconds)}
                    <span className="muted">{isOpen ? ' until it starts' : ' left'}</span>
                  </>
                )}
              </p>
            )}
          </div>

          {isFinished && (
            <p className="banner">{winner ? `${winner.name} wins.` : 'The event is over.'}</p>
          )}

          {(!joined || womSlot) && (
            <div className="challenge-head-more">
              {/* ---- What it asks of you ----
                  Only while a player is still outside it. Once they are in,
                  every line here is said again further down the same screen
                  with their own number in it: the hiscores figure carries
                  "counted off the hiscores since the start", the declared one
                  is labelled "in millions" over the box they type it into, and
                  the two screenshots have a section to themselves. Said in
                  both places it read as two sets of rules that did not quite
                  match — which is the whole reason the card was confusing. */}
              {!joined && (
                <ul className="challenge-asks">
                  {setup?.wom_metric && (
                    <li>
                      <strong>{metricLabel(setup.wom_metric)}</strong>
                      <span className="muted">
                        {' — counted off the hiscores by Wise Old Man. Nothing to send in.'}
                      </span>
                    </li>
                  )}
                  {setup?.declared_label && (
                    <li>
                      <strong>{setup.declared_label}</strong>
                      <span className="muted">
                        {' — the number you give'}
                        {setup.declared_unit === 'gp' ? ', in millions' : ''}
                        {', with a screenshot from the start and one from the finish.'}
                      </span>
                    </li>
                  )}
                </ul>
              )}

              {/* ---- The competition behind it ----
                  The competition is public, so the honest thing is to link it:
                  this ranking is a copy of theirs, and anyone who thinks a
                  figure is wrong should be able to go and look rather than
                  take our word for it.

                  One link, and a button rather than prose. Participants was a
                  second link beside it, answering "who is being counted" --
                  which is an organiser's question, and the console pane has
                  it; the competition's own page lists them anyway. Nothing in
                  this app styles a bare <a>, so the pair came out in the
                  browser's underlined blue in the middle of a card that is
                  otherwise all tint and fill. */}
              {womSlot && (wom ? (
                <a
                  className="challenge-wom-button"
                  href={womCompetitionUrl(wom)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  See it on Wise Old Man ↗
                </a>
              ) : (
                <p className="muted challenge-wom-wait">
                  Waiting for Wise Old Man to create the competition.
                </p>
              ))}
            </div>
          )}
        </section>

        {/* Open for as long as the event runs. A latecomer is added to the
            live Wise Old Man competition rather than turned away; once they
            are in, this card gives way to Your event below. */}
        {(isOpen || (isActive && !joined)) && (
          <section className="card">
            <h2>{joined ? 'You are in' : 'Sign up'}</h2>
            <p className="muted">
              {setup?.entrants ?? 0} signed up so far.
              {isActive
                ? ' This one is already running, and you can still join it.'
                : ' You can still join after it has started.'}
            </p>

            {/* Said before they sign up rather than after: WOM measures every
                participant from the competition's own start, so a latecomer is
                credited with the days before they joined. Nobody should find
                that out from the ranking. */}
            {isActive && setup?.wom_metric && (
              <p className="muted">
                Your figure will cover the whole event, including the days before
                you signed up — the hiscores are measured from when it started,
                not from when you joined.
              </p>
            )}

            {setup?.wom_metric && (
              <>
                <ChallengeRsnField
                  accounts={accounts}
                  value={rsn}
                  onChange={setRsn}
                  disabled={busy}
                  freeform={freeform}
                  onFreeform={setFreeform}
                  onOpenAccounts={onOpenAccounts}
                />
                {/* Said before they sign up, not after: in this kind of event
                    the whole list goes on the competition, and somebody with
                    an alt they would rather keep out of it needs to know that
                    while they can still take it off the list. */}
                {setup.all_accounts && (
                  <p className="muted">
                    Every account on your My accounts list counts in this one, and
                    their figures are added together. The name above is just the
                    one the ranking shows you under.
                  </p>
                )}
              </>
            )}

            <div className="row">
              {!joined ? (
                <button
                  disabled={busy || (Boolean(setup?.wom_metric) && !rsn.trim())}
                  onClick={() => run(
                    () => challengeJoin(game.id, rsn.trim() || null),
                    'You are signed up.',
                  )}
                >
                  Sign me up
                </button>
              ) : (
                <>
                  <button
                    disabled={busy || !rsn.trim() || rsn.trim() === mine.rsn}
                    onClick={() => run(() => challengeJoin(game.id, rsn.trim()), 'Name saved.')}
                  >
                    Save my name
                  </button>
                  <button
                    className="ghost"
                      disabled={busy}
                    onClick={() => run(() => challengeLeave(game.id), 'You are out of this one.')}
                  >
                    Take me out
                  </button>
                </>
              )}
            </div>
          </section>
        )}

        {isFinished && !joined && (
          <section className="card">
            <h2>Not in this one</h2>
            <p className="muted">
              This event is over. The ranking is below, and the next one will be
              along.
            </p>
          </section>
        )}

        {(isActive || isFinished) && joined && (
          <section className="card challenge-mine">
            <h2>Your event</h2>
            {/* ---- Who is playing ----
                Name, team and the organiser's verdict used to be one run-on
                muted line with middle dots between them, which made the two
                that matter -- checked, or quietly changed -- read as asides.
                They are tags now, beside the name they belong to. */}
            <section className="entry-box">
              <header className="entry-head">
                <h4>{mine.rsn ? `Playing as ${mine.rsn}` : 'No RuneScape name on this entry'}</h4>
                <span className="entry-tags">
                  {myTeam && <span className="entry-tag">{myTeam.name}</span>}
                  {mine.verified && <span className="entry-tag ok">Checked</span>}
                  {mine.altered && !mine.verified && (
                    <span className="entry-tag warn">Number changed by an organiser</span>
                  )}
                </span>
              </header>

              {/* Being on this ranking and being on WOM's competition are two
                  different things. The one unacceptable outcome is a player
                  finding out at the end of the week that they were never the
                  same, so it is said here, in red, while there is time to fix
                  it. The worse of the two is the one that looks fine: WOM
                  takes any name of the right shape and invents a player for
                  it, so a typo is accepted and then scores nothing for a
                  week. */}
              {mine.wom_found === false && (
                <p className="error">
                  Wise Old Man has <strong>{mine.rsn}</strong> on the competition,
                  but has never found that name on the hiscores — so it is being
                  counted as zero. Either it is spelled differently in game, or
                  the account is too new to be ranked. Correct it below and it
                  will be swapped over.
                </p>
              )}

              {mine.wom_added === false && (
                <p className="error">
                  Wise Old Man has not taken {mine.rsn} yet, so nothing is being
                  counted for you. It is tried again every minute.
                </p>
              )}

              {/* A name can be corrected for as long as the event runs, because
                  a wrong one is the usual reason WOM has not taken it, and
                  nobody should have to sit out a week over a typo. */}
              {isActive && setup?.wom_metric && (
                <div className="entry-name">
                  {/* Wrapped, because ChallengeRsnField returns a fragment --
                      its select and its "Not the right name?" hint are two
                      siblings, and a flex row here laid them out side by side
                      with the hint stranded between the two controls. */}
                  <div className="entry-name-field">
                    <ChallengeRsnField
                      accounts={accounts}
                      value={rsn}
                      onChange={setRsn}
                    disabled={busy}
                      freeform={freeform}
                      onFreeform={setFreeform}
                      onOpenAccounts={onOpenAccounts}
                    />
                  </div>
                  <button
                    className="ghost"
                    disabled={busy || !rsn.trim() || rsn.trim() === mine.rsn}
                    onClick={() => run(() => challengeJoin(game.id, rsn.trim()), 'Name saved.')}
                  >
                    Save my name
                  </button>
                </div>
              )}

              {/* In an all-accounts event the entry's one name is not the whole
                  story, so the accounts actually behind the figure are listed
                  with what WOM made of each. The partly-broken case is the
                  point: a player with three accounts and one typo is still
                  scoring, and a single banner over the lot of them would say
                  nothing is wrong. */}
              {setup?.all_accounts && entryAccounts.length > 0 && (
                <>
                  <p className="muted entry-counting">
                    Counting {entryAccounts.length} account{entryAccounts.length === 1 ? '' : 's'}:
                  </p>
                  <ul className="rsn-list">
                    {entryAccounts.map((a) => (
                      <li key={a.rsn} className="rsn-row">
                        <div className="rsn-name">
                          <strong>{a.rsn}</strong>
                          <span className="muted"> · {womLabel(a.wom_gained)}</span>
                        </div>
                        {a.wom_found === false && (
                          <p className="error">
                            Never found on the hiscores — this one is counting as zero.
                          </p>
                        )}
                        {!a.wom_added && (
                          <p className="error">
                            Wise Old Man has not taken this name yet. It is tried again every minute.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            {/* ---- The two figures ----
                An event can carry a number read off the hiscores, a number the
                player sends in, or both -- and where it carries both, only one
                of them decides the ranking. That used to be said once, in the
                header, as "the other figure is shown, but does not decide it",
                leaving you to work out which was which. Side by side with the
                deciding one ringed, it does not need saying twice. */}
            <div className="figure-boxes">
              {setup?.wom_metric && (
                <section className={`figure-box${setup.ranked_by === 'wom' ? ' decides' : ''}`}>
                  <header className="figure-head">
                    {/* The same picture as the heading, small, so the number
                        and what it is counted off are one thing. */}
                    <span className="figure-head-name">
                      <TileIcon slug={metricIcon(setup.wom_metric)} fallback={null} />
                      <h4>{metricLabel(setup.wom_metric)}</h4>
                    </span>
                    {setup.ranked_by === 'wom' && (
                      <span className="figure-decides">decides the ranking</span>
                    )}
                  </header>
                  <p className="figure-value">{womLabel(mine.wom_gained)}</p>
                  <p className="muted figure-note">
                    {mine.wom_gained === null || mine.wom_gained === undefined
                      ? 'Nothing read off the hiscores yet.'
                      : 'Counted off the hiscores since the start — you send nothing in for this.'}
                  </p>
                </section>
              )}

              {setup?.declared_label && (
                <section className={`figure-box${setup.ranked_by !== 'wom' ? ' decides' : ''}`}>
                  <header className="figure-head">
                    <h4>{setup.declared_label}</h4>
                    {setup.ranked_by !== 'wom' && (
                      <span className="figure-decides">decides the ranking</span>
                    )}
                  </header>

                  <p className="figure-value">
                    {mine.declared === null || mine.declared === undefined
                      ? <span className="muted">Nothing sent in yet</span>
                      : figureLabel(mine.declared, unit)}
                    {mine.altered && <span className="muted"> · set by an organiser</span>}
                  </p>

                  <div className="declare-field">
                    <label>
                      <span className="muted">
                        {setup.declared_unit === 'gp' ? 'In millions' : 'A whole number'}
                      </span>
                      <input
                        value={figure}
                        onChange={(e) => setFigure(e.target.value)}
                        inputMode="decimal"
                        placeholder={setup.declared_unit === 'gp' ? '250, or 0.5' : '12'}
                        disabled={busy || isFinished || mine.verified}
                      />
                    </label>
                    <button
                      disabled={busy || isFinished || mine.verified || typed === null || unchanged}
                      onClick={() => run(
                        () => challengeDeclare(game.id, typed),
                        `${setup.declared_label} saved as ${figureLabel(typed, unit)}.`,
                      )}
                    >
                      {mine.declared === null || mine.declared === undefined ? 'Send it in' : 'Update it'}
                    </button>
                  </div>

                  {figure.trim() !== '' && typed === null && (
                    <p className="error">
                      {setup.declared_unit === 'gp'
                        ? 'A number of millions, at most one decimal — 250, 0.5, 1250.'
                        : 'A whole number.'}
                    </p>
                  )}
                  {mine.verified && (
                    <p className="muted figure-note">
                      An organiser has checked this number, so it is theirs to change
                      now. Ask them.
                    </p>
                  )}
                </section>
              )}
            </div>

            {setup?.declared_label && (
              <>
                <h3 className="shots-head">The shots behind it</h3>
                <p className="muted shots-intro">
                  The site cannot read a screenshot, so these are what make the
                  number checkable. One from before you started and one from
                  when you finished — drag it in, paste it, or pick it off your
                  machine.
                </p>

                <div className="shot-boxes">
                  <ShotBox
                    phase="start"
                    title="Before you started"
                    hint="Whatever the number is counted from — the bank, the log, the collection."
                    shots={startShots}
                    urls={shotUrls}
                    max={MAX_EVIDENCE}
                    busy={busy}
                    closed={isFinished}
                    onAdd={addShot}
                  />
                  <ShotBox
                    phase="finish"
                    title="When you finished"
                    hint="The same thing at the end. The difference between the two is what gets checked."
                    shots={finishShots}
                    urls={shotUrls}
                    max={MAX_EVIDENCE}
                    busy={busy}
                    closed={isFinished}
                    onAdd={addShot}
                  />
                </div>
              </>
            )}
          </section>
        )}

        <ChallengeLadder
          standings={standings}
          setup={setup}
          myProfileId={profileId}
          myTeamId={mine?.team_id ?? null}
        />
      </div>

      <div className="challenge-side">
        <EventFeed events={events} teams={teams} myTeamId={mine?.team_id ?? null} />
      </div>
    </div>
  );
}

/**
 * One phase's shot: the one that counts, and the way to replace it.
 *
 * WHY TWO OF THESE, rather than the one form with a Start/Finish dropdown that
 * this replaced. The dropdown existed only because a single form served two
 * lists, so adding a finish shot meant setting a mode, typing a link, and then
 * working out which of two lists further up the page had grown by one. A box
 * per phase deletes the control and the hunt together: what you add turns up
 * in the box you added it to.
 *
 * WHY ONE SHOT, where this drew five numbered slots. The cap was never an ask
 * for five -- challenge_max_evidence() allows a handful so that a picture
 * cropped wrong can be taken again, and says so -- but a box headed "0 of 5"
 * beside an empty list reads as a demand for five. A loot tracker needs one
 * picture. So one shows, and the second try is a Replace rather than four
 * slots standing empty under it.
 *
 * Replace SUPERSEDES; it does not delete. Evidence is immutable for players on
 * purpose -- 0021 grants no delete policy and says why -- so an earlier try
 * stays where an organiser can still open it, folded away rather than gone.
 *
 * STAGED, THEN SENT. A dropped file sits in the box until a second press,
 * which is the only moment a player can change their mind: once it is up it is
 * up. It also means a picture dropped on the wrong box is not permanently
 * filed against the wrong half of the event. Same rule, same reason, as the
 * tile uploader.
 */
function ShotBox({ phase, title, hint, shots, urls, max, busy, closed, onAdd }) {
  const [file, setFile] = useState(null);
  const [note, setNote] = useState('');
  const [replacing, setReplacing] = useState(false);

  /* The server hands these back ordered by added_at, in both the player's
     entry and the organiser's review list, so the last one is the newest --
     and the newest is the one the player meant. */
  const current = shots.length ? shots[shots.length - 1] : null;
  const earlier = shots.slice(0, -1);
  const full = shots.length >= max;
  const asking = !closed && !full && (!current || replacing);

  const clear = () => { setFile(null); setNote(''); setReplacing(false); };

  return (
    <section className="shot-box">
      <header className="shot-box-head">
        <h4>{title}</h4>
      </header>
      <p className="muted shot-box-hint">{hint}</p>

      {current ? (
        <p className="shot-current">
          <ShotLink shot={current} urls={urls} label="The picture" />
          {current.note && <span className="muted"> — {current.note}</span>}
        </p>
      ) : !asking && (
        <p className="muted shot-box-empty">Nothing here yet.</p>
      )}

      {/* Folded away rather than listed beside the one that counts: these are
          the tries that did not come out, and an organiser only wants them
          when the current one does not settle it. */}
      {earlier.length > 0 && (
        <details className="shot-earlier">
          <summary>
            {earlier.length === 1 ? 'An earlier try' : `${earlier.length} earlier tries`}
          </summary>
          <ol className="shot-list">
            {earlier.map((s, i) => (
              <li key={s.id}>
                <ShotLink shot={s} urls={urls} label={`Try ${i + 1}`} />
                {s.note && <span className="muted"> — {s.note}</span>}
              </li>
            ))}
          </ol>
        </details>
      )}

      {asking && (
        <div className="shot-add">
          <ShotDrop file={file} onFile={setFile} disabled={busy} phase={phase} />
          <label>
            <span>Note <span className="muted">(optional)</span></span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What it shows"
              disabled={busy}
            />
          </label>
          <div className="shot-add-buttons">
            <button
              disabled={busy || !file}
              onClick={async () => {
                const ok = await onAdd(phase, file, note.trim() || null);
                if (ok) clear();
              }}
            >
              {current ? 'Replace it' : 'Add it'}
            </button>
            {current && (
              <button className="ghost" disabled={busy} onClick={clear}>
                Keep the one I have
              </button>
            )}
          </div>
        </div>
      )}

      {current && !closed && !replacing && (full ? (
        <p className="muted shot-box-full">That is as many tries as this takes.</p>
      ) : (
        <button className="ghost shot-replace" disabled={busy} onClick={() => setReplacing(true)}>
          Replace it
        </button>
      ))}
    </section>
  );
}

/**
 * A link to one shot, whichever kind it is.
 *
 * A file has to be signed first and the signing is a round trip, so there is a
 * moment where the row is there and the address is not. Saying so beats a dead
 * link, and beats hiding a shot the player knows they sent.
 */
function ShotLink({ shot, urls, label }) {
  const href = shot.storage_path ? urls[shot.storage_path] : shot.url;
  if (!href) return <span className="muted">{label} — still loading</span>;
  return <a href={href} target="_blank" rel="noreferrer">{label}</a>;
}

/**
 * Where a screenshot goes in. Drag it, paste it, or pick it.
 *
 * All three, because people hand a screenshot over three ways and the one they
 * reach for is not ours to choose. Paste is the one that matters most: a fresh
 * screenshot is already on the clipboard, and asking someone to save it to
 * disk first is asking them not to bother.
 *
 * The paste listener is on this element rather than the window, so the two
 * boxes on the screen cannot both claim the same Ctrl+V. It is focusable for
 * that reason -- and a zone you have to click before pasting is also a zone
 * that tells you, by its highlight, which half of the event you are about to
 * paste into.
 */
function ShotDrop({ file, onFile, disabled, phase }) {
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const input = useRef(null);

  // Revoked on the way out: an object URL holds the whole image in memory
  // until it is, and a player who tries four screenshots would hold all four.
  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const take = (list) => {
    const picked = [...(list ?? [])].find((f) => f && f.type.startsWith('image/'));
    if (picked) onFile(picked);
  };

  return (
    <div className="shot-drop-field">
      <span className="shot-drop-label">The picture</span>
      <div
        className={`shot-drop${over ? ' over' : ''}${file ? ' has' : ''}`}
        tabIndex={disabled ? -1 : 0}
        role="button"
        aria-label={`Add the ${phase} screenshot`}
        aria-disabled={disabled || undefined}
        onClick={() => { if (!disabled) input.current?.click(); }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); }
        }}
        onPaste={(e) => {
          if (disabled) return;
          const files = [...(e.clipboardData?.files ?? [])];
          if (files.length) { e.preventDefault(); take(files); }
        }}
        onDragOver={(e) => { if (!disabled) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer?.files);
        }}
      >
        {preview ? (
          <>
            <img className="shot-drop-shot" src={preview} alt="" />
            <span className="shot-drop-say">
              {file.name || 'That one'} — click to pick another
            </span>
          </>
        ) : (
          <span className="shot-drop-say">
            Drop a screenshot here, paste one, or <u>pick a file</u>
          </span>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="shot-drop-input"
          disabled={disabled}
          onChange={(e) => { take(e.target.files); e.target.value = ''; }}
        />
      </div>
    </div>
  );
}
