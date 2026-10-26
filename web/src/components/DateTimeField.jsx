import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Picking a moment, without the browser's own picker.
 *
 * `<input type="datetime-local">` is two controls in a trench coat. Chromium
 * draws a calendar and, beside it, two scrolling columns -- twenty-four rows
 * of hours and sixty of minutes -- and sets an event's end time by making you
 * scroll a list of numbers. Nobody running a clan event wants 14:37. They want
 * Sunday at eight.
 *
 * So the date stays a calendar, which is the metaphor everybody already has,
 * and the time stops being a scale to scroll and becomes a figure you read and
 * type, with the four times this app actually uses under it. The calendar is
 * deliberately quiet; the time is the one loud thing on the panel, because the
 * time is what was wrong.
 *
 * It answers the same contract as the input it replaces -- `YYYY-MM-DDTHH:mm`
 * in local time, or '' for unset -- so every caller's `new Date(value)` is
 * untouched.
 */

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* The times a clan event is actually set to: midday, after work, prime time,
   and the end of the day for a deadline. Anything else is two keystrokes. */
const COMMON_TIMES = ['12:00', '18:00', '20:00', '23:59'];

/* Picking a day on an empty field has to land on some time, and 00:00 would
   quietly end an event the midnight before the one its organiser meant. */
const DEFAULT_TIME = '20:00';

const pad = (n) => String(n).padStart(2, '0');

/** The field's value as numbers, or null when it is unset or malformed. */
function parse(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value ?? '');
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m.map(Number);
  return { y, mo: mo - 1, d, hh, mm };
}

const toValue = ({ y, mo, d, hh, mm }) => `${y}-${pad(mo + 1)}-${pad(d)}T${pad(hh)}:${pad(mm)}`;

/** "Sun 2 Nov 2026, 20:00" -- written out rather than left to the locale, so
    the order of the day and the month is the same for everyone reading it. */
function readable(parts) {
  const date = new Date(parts.y, parts.mo, parts.d);
  return `${SHORT_DAYS[date.getDay()]} ${parts.d} ${SHORT_MONTHS[parts.mo]} ${parts.y}`
    + `, ${pad(parts.hh)}:${pad(parts.mm)}`;
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Six weeks from the Monday on or before the first of the month.
 *
 * Always six, even for a month that fits in five: a panel that changed height
 * as you paged through the months would move the footer out from under the
 * pointer that was paging them.
 */
function monthGrid(year, month) {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - lead + i));
}

export default function DateTimeField({
  label, hint, value, onChange, disabled = false,
}) {
  const labelId = `${useId()}-label`;
  const parts = parse(value);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => (parts
    ? { y: parts.y, mo: parts.mo }
    : { y: new Date().getFullYear(), mo: new Date().getMonth() }));
  const [at, setAt] = useState(null);

  const wrap = useRef(null);
  const trigger = useRef(null);
  const panel = useRef(null);
  const grid = useRef(null);

  const today = useMemo(() => new Date(), []);
  const days = useMemo(() => monthGrid(cursor.y, cursor.mo), [cursor.y, cursor.mo]);
  const selected = parts ? new Date(parts.y, parts.mo, parts.d) : null;
  const time = parts ? `${pad(parts.hh)}:${pad(parts.mm)}` : DEFAULT_TIME;

  // Reopening on a month the value is not in would hide the answer already
  // given, so every open starts where the value is.
  useEffect(() => {
    if (!open) return;
    if (parts) setCursor({ y: parts.y, mo: parts.mo });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* Where the panel goes, in viewport coordinates.
     It lives in the top layer (see showPopover below), which is the only place
     it is not painted over, and the top layer is positioned against the
     viewport rather than against the field -- so the field's position is
     measured here instead of left to `top: 100%`.

     The corner it opens from moves when there is no room, but it always grows
     out of the field and shrinks back into it. */
  const settle = () => {
    const p = panel.current;
    const t = trigger.current;
    if (!p || !t) return;
    const box = t.getBoundingClientRect();
    const { offsetHeight: h, offsetWidth: w } = p;
    const up = window.innerHeight - box.bottom < h + 16 && box.top > h + 16;
    const right = box.left + w > window.innerWidth - 16 && box.right > w + 16;
    // Clamped into the viewport after the side is chosen. On a phone a field
    // in the middle of a form has room neither above nor below, and a footer
    // under the fold is a Done button nobody can reach.
    const wanted = up ? box.top - 8 - h : box.bottom + 8;
    setAt({
      up,
      right,
      top: Math.max(8, Math.min(wanted, window.innerHeight - h - 8)),
      left: Math.max(8, right ? box.right - w : box.left),
      width: box.width,
    });
  };

  /* The top layer, because the console's cards are blurred glass: a
     backdrop-filtered card paints over a positioned descendant of an earlier
     one whatever its z-index, so the panel lost every row below the card it
     belonged to. Nothing paints over the top layer.

     It is also rendered into the body rather than here (see createPortal
     below), because the same is true of the card the field itself sits in:
     Chromium draws that card's own content over a popover nested inside it.
     Out of the card and into the top layer, nothing is left to paint over.

     Measured in a layout effect, before the browser paints, so it is never
     seen in the wrong place. */
  useLayoutEffect(() => {
    if (!open || !panel.current) return undefined;
    panel.current.showPopover?.();
    settle();
    const again = () => settle();
    window.addEventListener('scroll', again, true);
    window.addEventListener('resize', again);
    return () => {
      window.removeEventListener('scroll', again, true);
      window.removeEventListener('resize', again);
      setAt(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    // The panel is portalled to the body, so it is not inside `wrap` any
    // more and has to be asked about separately.
    const onDown = (e) => {
      if (wrap.current?.contains(e.target) || panel.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const setDay = (date) => {
    const [hh, mm] = time.split(':').map(Number);
    onChange(toValue({ y: date.getFullYear(), mo: date.getMonth(), d: date.getDate(), hh, mm }));
  };

  const setTime = (next) => {
    const [hh, mm] = next.split(':').map(Number);
    const base = parts ?? { y: today.getFullYear(), mo: today.getMonth(), d: today.getDate() };
    onChange(toValue({ ...base, hh, mm }));
  };

  const step = (date, by) => {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + by);
    setCursor({ y: next.getFullYear(), mo: next.getMonth() });
    // The focus has to follow the month, and the button for the new day only
    // exists after the grid has re-rendered on the new cursor.
    requestAnimationFrame(() => {
      grid.current?.querySelector(`[data-day="${next.toDateString()}"]`)?.focus();
    });
  };

  const onGridKey = (e, date) => {
    const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (by === undefined) return;
    e.preventDefault();
    step(date, by);
  };

  const moveMonth = (by) => {
    const next = new Date(cursor.y, cursor.mo + by, 1);
    setCursor({ y: next.getFullYear(), mo: next.getMonth() });
  };

  // One day in the grid is tabbable, and the arrows move between the rest --
  // forty-two stops on the way to the footer is not a keyboard path.
  const inMonth = (d) => d.getFullYear() === cursor.y && d.getMonth() === cursor.mo;
  const tabStop = selected && inMonth(selected) ? selected
    : inMonth(today) ? today
      : new Date(cursor.y, cursor.mo, 1);

  return (
    <div className="datetime-field" ref={wrap}>
      <span className="datetime-label" id={labelId}>
        {label}{hint && <> <span className="muted">{hint}</span></>}
      </span>

      <button
        type="button"
        ref={trigger}
        className={`datetime-trigger${parts ? '' : ' empty'}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={labelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{parts ? readable(parts) : 'Choose a date and time'}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true" className="datetime-icon">
          <rect x="2" y="3" width="12" height="11" rx="2.5" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
        </svg>
      </button>

      {open && createPortal((
        <div
          className={`datetime-panel${at?.up ? ' up' : ''}${at?.right ? ' right' : ''}`}
          ref={panel}
          popover="manual"
          style={at
            ? { top: `${at.top}px`, left: `${at.left}px`, minWidth: `${at.width}px` }
            : { visibility: 'hidden' }}
          role="dialog"
          aria-label={`Choose ${label.toLowerCase()}`}
        >
          <div className="datetime-month">
            <button type="button" className="ghost" aria-label="Previous month"
                    onClick={() => moveMonth(-1)}>‹</button>
            <strong aria-live="polite">{MONTHS[cursor.mo]} {cursor.y}</strong>
            <button type="button" className="ghost" aria-label="Next month"
                    onClick={() => moveMonth(1)}>›</button>
          </div>

          <div className="datetime-weekdays" aria-hidden="true">
            {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
          </div>

          <div className="datetime-grid" ref={grid}>
            {days.map((date) => {
              const outside = date.getMonth() !== cursor.mo;
              const isToday = sameDay(date, today);
              const isOn = selected && sameDay(date, selected);
              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  data-day={date.toDateString()}
                  tabIndex={sameDay(date, tabStop) ? 0 : -1}
                  className={`datetime-day${outside ? ' outside' : ''}${isOn ? ' on' : ''}`
                    + `${isToday ? ' today' : ''}`}
                  aria-pressed={Boolean(isOn)}
                  aria-current={isToday ? 'date' : undefined}
                  onKeyDown={(e) => onGridKey(e, date)}
                  onClick={() => setDay(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <TimeRow time={time} onPick={setTime} />

          <div className="datetime-foot">
            <button
              type="button"
              className="ghost"
              disabled={!parts}
              onClick={() => { onChange(''); setOpen(false); trigger.current?.focus(); }}
            >
              Clear
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => setCursor({ y: today.getFullYear(), mo: today.getMonth() })}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); trigger.current?.focus(); }}
            >
              Done
            </button>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

/**
 * The hour and the minute, big enough to read and to type into.
 *
 * Each box keeps what you typed while you are typing it -- a controlled field
 * that padded "2" to "02" on the first keystroke would never let you reach
 * 20 -- and only reports a figure once it is one. Blur tidies it.
 */
function TimeRow({ time, onPick }) {
  const [hh, mm] = time.split(':');
  const [draft, setDraft] = useState(null);

  const show = draft ?? { hh, mm };

  const commit = (which, raw) => {
    const digits = raw.replace(/\D/g, '').slice(0, 2);
    const max = which === 'hh' ? 23 : 59;
    // A second digit that cannot lead anywhere is not taken at all. Showing 99
    // in a box that will never accept it is worse than the keystroke going
    // nowhere; a lone 9 is still on its way to 09.
    if (digits.length === 2 && Number(digits) > max) return;
    setDraft({ ...show, [which]: digits });
    if (digits === '') return;
    const n = Number(digits);
    onPick(which === 'hh' ? `${pad(n)}:${mm}` : `${hh}:${pad(n)}`);
  };

  const tidy = () => setDraft(null);

  const nudge = (e, which) => {
    const by = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
    if (!by) return;
    e.preventDefault();
    const max = which === 'hh' ? 24 : 60;
    const now = Number(which === 'hh' ? hh : mm);
    const next = (now + by + max) % max;
    setDraft(null);
    onPick(which === 'hh' ? `${pad(next)}:${mm}` : `${hh}:${pad(next)}`);
  };

  return (
    <div className="datetime-time">
      <div className="datetime-clock">
        <input
          className="datetime-num"
          inputMode="numeric"
          aria-label="Hour"
          value={show.hh}
          onChange={(e) => commit('hh', e.target.value)}
          onKeyDown={(e) => nudge(e, 'hh')}
          onBlur={tidy}
          onFocus={(e) => e.target.select()}
        />
        <span aria-hidden="true">:</span>
        <input
          className="datetime-num"
          inputMode="numeric"
          aria-label="Minute"
          value={show.mm}
          onChange={(e) => commit('mm', e.target.value)}
          onKeyDown={(e) => nudge(e, 'mm')}
          onBlur={tidy}
          onFocus={(e) => e.target.select()}
        />
      </div>
      <div className="datetime-common">
        {COMMON_TIMES.map((t) => (
          <button
            key={t}
            type="button"
            className={`datetime-quick${t === time ? ' on' : ''}`}
            aria-pressed={t === time}
            onClick={() => { setDraft(null); onPick(t); }}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
