// What sits on top of the board: sticky notes anyone can put anywhere, and the
// pointers of the other people who have the board open.

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";

import type { Person, ReviewNote, Role } from "../shared/types";
import type { BoardModel } from "./Board";
import { Ink, seedOf } from "./kit/ink";
import { cx } from "./kit/render";
import { useCursors } from "./live";
import { canChange, type Notes } from "./ReviewNotes";

/** A sticky note's width in board units. Its height follows what is written on it. */
export const STICKY_WIDTH = 200;

/**
 * The frame a point on the board belongs with: the one it is over, otherwise
 * the closest. A sticky note is stored as an offset from that frame, so it
 * stays beside it when the board is laid out again.
 */
export function anchorFor(model: BoardModel, x: number, y: number): { ref: string; dx: number; dy: number } | undefined {
  let best: { ref: string; dx: number; dy: number; distance: number } | undefined;
  const cx0 = x + STICKY_WIDTH / 2;
  const cy0 = y + 40;
  for (const frame of model.frames) {
    const gapX = Math.max(frame.x - cx0, 0, cx0 - (frame.x + frame.w));
    const gapY = Math.max(frame.y - cy0, 0, cy0 - (frame.y + frame.h));
    const distance = Math.hypot(gapX, gapY);
    if (!best || distance < best.distance) best = { ref: frame.ref, dx: Math.round(x - frame.x), dy: Math.round(y - frame.y), distance };
  }
  return best && { ref: best.ref, dx: best.dx, dy: best.dy };
}

/** Where a sticky note sits on the board now. One whose frame has gone keeps its offset from the board's corner. */
export function stickyPosition(model: BoardModel, note: ReviewNote): { x: number; y: number } {
  const frame = model.frames.find((f) => f.ref === note.frame);
  const { dx, dy } = note.sticky ?? { dx: 0, dy: 0 };
  return frame ? { x: frame.x + dx, y: frame.y + dy } : { x: dx, y: dy };
}

/** A small, steady tilt, so a board of sticky notes does not look printed. */
function tilt(id: string): number {
  return ((seedOf(id) % 9) - 4) * 0.45;
}

/** The box a sticky note's words are typed into. Enter keeps them, Escape gives up, and so does leaving it empty. */
function StickyEditor({ initial, onDone }: { initial: string; onDone: (text: string | null) => void }): ReactElement {
  const [text, setText] = useState(initial);
  const finished = useRef(false);
  const finish = (value: string | null): void => {
    if (finished.current) return;
    finished.current = true;
    onDone(value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      finish(null);
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      finish(text);
    }
  };
  return (
    <textarea
      className="sticky-input"
      autoFocus
      maxLength={1000}
      rows={3}
      value={text}
      placeholder="Write a note"
      aria-label="Sticky note"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(text)}
      onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
    />
  );
}

interface StickyProps {
  note: ReviewNote;
  model: BoardModel;
  /** The board's zoom, to turn a drag measured on screen into board units. */
  k: number;
  editable: boolean;
  notes: Notes;
}

function Sticky({ note, model, k, editable, notes }: StickyProps): ReactElement {
  const at = stickyPosition(model, note);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  // Failures are shown by the notes hook, in the Notes tab.
  const quietly = (action: Promise<void>): void => void action.catch(() => undefined);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    // Keep the board from panning, whatever happens next.
    e.stopPropagation();
    if (!editable || editing || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const p = press.current;
    if (!p) return;
    const x = (e.clientX - p.x) / k;
    const y = (e.clientY - p.y) / k;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) return;
    p.moved = true;
    setOffset({ x, y });
  };
  const onPointerUp = (): void => {
    const p = press.current;
    press.current = null;
    if (p?.moved && offset) {
      const anchor = anchorFor(model, at.x + offset.x, at.y + offset.y);
      if (anchor) quietly(notes.move(note.id, anchor.ref, { dx: anchor.dx, dy: anchor.dy }));
    }
    setOffset(null);
  };

  const finishEdit = (text: string | null): void => {
    setEditing(false);
    if (text === null) return;
    const value = text.trim();
    if (!value) quietly(notes.remove(note.id));
    else if (value !== note.text) quietly(notes.rewrite(note.id, value));
  };

  const x = at.x + (offset?.x ?? 0);
  const y = at.y + (offset?.y ?? 0);
  return (
    <div
      className={cx("sticky", "qm-inked", offset && "is-moving", editable && "is-mine")}
      style={{ left: x, top: y, width: STICKY_WIDTH, transform: `rotate(${offset ? 0 : tilt(note.id)}deg)` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (editable) setEditing(true);
      }}
      tabIndex={editable && !editing ? 0 : undefined}
      onKeyDown={(e) => {
        // With the keyboard: Enter on a sticky note opens it for writing.
        if (e.key === "Enter" && editable && !editing && e.target === e.currentTarget) {
          e.preventDefault();
          setEditing(true);
        }
      }}
      title={editable && !editing ? "Drag to move. Double-click to change the words." : undefined}
    >
      <Ink shape="box" seed={`sticky/${note.id}`} color="graphite" fill="sticky" pen="fine" rough="loose" />
      {editing ? <StickyEditor initial={note.text} onDone={finishEdit} /> : <p className="sticky-text">{note.text}</p>}
      {note.author && <p className="sticky-author">{note.author}</p>}
      {editable && !editing && (
        <button type="button" className="sticky-x" aria-label="Delete this sticky note" onClick={() => quietly(notes.remove(note.id))}>
          ×
        </button>
      )}
    </div>
  );
}

/** Every open sticky note on the board, plus the one being written, if any. */
export function Stickies({
  model,
  notes,
  role,
  k,
  draft,
  onDraftDone,
}: {
  model: BoardModel;
  notes: Notes;
  role?: Role;
  k: number;
  /** Where a new sticky note is being written, in board units. */
  draft: { x: number; y: number } | null;
  onDraftDone: () => void;
}): ReactElement {
  const stickies = useMemo(() => notes.all.filter((note) => note.sticky && !note.done), [notes.all]);
  const finishDraft = (text: string | null): void => {
    const value = text?.trim();
    const anchor = draft && value ? anchorFor(model, draft.x, draft.y) : undefined;
    if (anchor && value) void notes.addSticky(anchor.ref, value, { dx: anchor.dx, dy: anchor.dy }).catch(() => undefined);
    onDraftDone();
  };
  return (
    <>
      {stickies.map((note) => (
        <Sticky key={note.id} note={note} model={model} k={k} editable={canChange(note, role)} notes={notes} />
      ))}
      {draft && (
        <div
          className="sticky qm-inked is-draft"
          style={{ left: draft.x, top: draft.y, width: STICKY_WIDTH }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Ink shape="box" seed="sticky/draft" color="graphite" fill="sticky" pen="fine" rough="loose" />
          <StickyEditor initial="" onDone={finishDraft} />
        </div>
      )}
    </>
  );
}

/** Other people's pointers. They sit in board units, so they point at the same thing however each person has zoomed. */
export function LiveCursors({ people, k }: { people: Person[]; k: number }): ReactElement {
  const cursors = useCursors();
  return (
    <>
      {people.map((person) => {
        const at = cursors.get(person.pid);
        if (!at) return null;
        return (
          <div
            key={person.pid}
            className="live-cursor"
            style={{ transform: `translate(${at.x}px, ${at.y}px) scale(${1 / k})`, color: person.color }}
            aria-hidden="true"
          >
            <svg width="18" height="22" viewBox="0 0 18 22">
              <path d="M2 1.5 L2 17.5 L6.4 13.6 L9.6 20.5 L12.4 19.2 L9.3 12.4 L15.2 12.2 Z" fill="currentColor" stroke="#FBFCFD" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            <span className="live-name" style={{ background: person.color }}>
              {person.name}
            </span>
          </div>
        );
      })}
    </>
  );
}

/** One or two letters for a person's badge. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}
