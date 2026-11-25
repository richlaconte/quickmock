// Notes the person writes while reviewing a flow: on a frame, or on the one
// component they pointed at. They are drawn in red pencil, the material for
// critique, and an agent can read them and mark each one done.

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from "react";

import type { ReviewNote, Role } from "../shared/types";
import { addNote, changeNote, deleteNote, getNotes, setNoteDone, useServerEvents } from "./api";
import { cx } from "./kit/render";
import { myAuthorName } from "./live";

export interface NoteTarget {
  path: string;
  type: string;
  summary?: string;
}

export interface Notes {
  all: ReviewNote[];
  /** Set when notes cannot be read or written, with what to do about it. */
  error: string | null;
  add: (frame: string, text: string, target?: NoteTarget) => Promise<void>;
  /** Stick a note on the board, `dx` and `dy` board units from the top-left corner of `frame`. */
  addSticky: (frame: string, text: string, at: { dx: number; dy: number }) => Promise<void>;
  /** Change a note's words. */
  rewrite: (noteId: string, text: string) => Promise<void>;
  /** Move a sticky note. */
  move: (noteId: string, frame: string, at: { dx: number; dy: number }) => Promise<void>;
  setDone: (noteId: string, done: boolean) => Promise<void>;
  remove: (noteId: string) => Promise<void>;
}

/** Guests can change what guests wrote; the person who shared the board can change everything. */
export function canChange(note: ReviewNote, role: Role | undefined): boolean {
  return role !== "guest" || note.guest === true;
}

/** A flow's notes, kept fresh as the person or an agent changes them. */
export function useNotes(flowId: string): Notes {
  const [all, setAll] = useState<ReviewNote[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getNotes(flowId).then(
      (next) => {
        setAll(next);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [flowId]);

  useEffect(load, [load]);

  useServerEvents((event) => {
    // A flow event with no id is the signal that the connection came back, so the notes may have changed too.
    if ((event.type === "notes" && event.id === flowId) || (event.type === "flow" && !event.id)) load();
  });

  const run = useCallback(
    async (action: Promise<unknown>): Promise<void> => {
      try {
        await action;
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        load();
      }
    },
    [load],
  );

  const add = useCallback(
    (frame: string, text: string, target?: NoteTarget) => {
      const author = myAuthorName() || undefined;
      return run(addNote(flowId, target ? { frame, text, target, author } : { frame, text, author }));
    },
    [flowId, run],
  );
  const addSticky = useCallback(
    (frame: string, text: string, at: { dx: number; dy: number }) =>
      run(addNote(flowId, { frame, text, sticky: at, author: myAuthorName() || undefined })),
    [flowId, run],
  );
  // Moves and edits show at once, and the server's answer replaces them a moment later.
  const rewrite = useCallback(
    (noteId: string, text: string) => {
      setAll((notes) => notes.map((note) => (note.id === noteId ? { ...note, text } : note)));
      return run(changeNote(flowId, noteId, { text }));
    },
    [flowId, run],
  );
  const move = useCallback(
    (noteId: string, frame: string, at: { dx: number; dy: number }) => {
      setAll((notes) => notes.map((note) => (note.id === noteId ? { ...note, frame, sticky: at } : note)));
      return run(changeNote(flowId, noteId, { frame, sticky: at }));
    },
    [flowId, run],
  );
  const setDone = useCallback((noteId: string, done: boolean) => run(setNoteDone(flowId, noteId, done)), [flowId, run]);
  const remove = useCallback(
    (noteId: string) => {
      setAll((notes) => notes.filter((note) => note.id !== noteId));
      return run(deleteNote(flowId, noteId));
    },
    [flowId, run],
  );

  return useMemo(() => ({ all, error, add, addSticky, rewrite, move, setDone, remove }), [all, error, add, addSticky, rewrite, move, setDone, remove]);
}

function targetWords(target: NoteTarget): string {
  return `the ${target.type}${target.summary ? ` “${target.summary}”` : ""}`;
}

/** The box a note is typed into. Enter adds it; Shift and Enter makes a new line. */
export function NoteComposer({
  frame,
  target,
  onAdd,
}: {
  frame: string;
  target?: NoteTarget;
  onAdd: (text: string) => Promise<void>;
}): ReactElement {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = (): void => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    onAdd(value).then(
      () => {
        setText("");
        setBusy(false);
      },
      // The reason is shown above the list; keep what was typed so it is not lost.
      () => setBusy(false),
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      className="note-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="note-box">{target ? `Add a note on ${targetWords(target)}` : `Add a note on ${frame}`}</label>
      <textarea
        id="note-box"
        rows={2}
        maxLength={1000}
        value={text}
        placeholder="What should change here?"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="note-form-row">
        <button type="submit" className="bar-button" disabled={!text.trim() || busy}>
          Add note
        </button>
        <span className="note-hint">
          {target ? "Turn Point off to write about the whole frame." : "Enter adds it. Point picks one component. Double-click the board for a sticky note."}
        </span>
      </div>
    </form>
  );
}

function NoteItem({ note, notes, role }: { note: ReviewNote; notes: Notes; role?: Role }): ReactElement {
  // Failures are reported by the notes hook, so the promises here only need to be settled.
  const quietly = (action: Promise<void>): void => void action.catch(() => undefined);
  const details = [note.sticky ? "sticky note" : note.target ? `on ${targetWords(note.target)}` : "", note.author ? `from ${note.author}` : ""].filter(Boolean);
  return (
    <li className={cx("my-note", note.done && "is-done")}>
      <p className="my-note-text">{note.text}</p>
      {details.length > 0 && <p className="my-note-where">{details.join(", ")}</p>}
      {note.done && (
        <p className="my-note-reply">
          Marked done by {note.done.by === "agent" ? "the agent" : "a person"}
          {note.done.reply ? `: ${note.done.reply}` : "."}
        </p>
      )}
      {canChange(note, role) && (
        <p className="my-note-actions">
          <button type="button" className="text-button" onClick={() => quietly(notes.setDone(note.id, !note.done))}>
            {note.done ? "Reopen" : "Mark done"}
          </button>
          <button type="button" className="text-button" onClick={() => quietly(notes.remove(note.id))}>
            Delete
          </button>
        </p>
      )}
    </li>
  );
}

/** The notes part of the Notes tab: the box, this frame's notes, and what is open elsewhere. */
export function ReviewNotes({
  notes,
  frame,
  frames,
  target,
  role,
  onOpenFrame,
}: {
  notes: Notes;
  frame: string;
  /** Every frame in the flow, to tell a note whose frame has gone. */
  frames: string[];
  target?: NoteTarget;
  role?: Role;
  onOpenFrame: (ref: string) => void;
}): ReactElement {
  const here = notes.all.filter((note) => note.frame === frame);
  const open = here.filter((note) => !note.done);
  const done = here.filter((note) => note.done);
  const elsewhere = notes.all.filter((note) => note.frame !== frame && !note.done);

  return (
    <section className="my-notes" aria-label="Your notes">
      <NoteComposer frame={frame} target={target} onAdd={(text) => notes.add(frame, text, target)} />
      {notes.error && (
        <p className="note-error" role="alert">
          {notes.error}
        </p>
      )}
      {here.length > 0 && (
        <ul className="my-note-list">
          {[...open, ...done].map((note) => (
            <NoteItem key={note.id} note={note} notes={notes} role={role} />
          ))}
        </ul>
      )}
      {elsewhere.length > 0 && (
        <>
          <h3 className="mini-head">Open notes on other frames</h3>
          <ul className="my-note-others">
            {elsewhere.map((note) => (
              <li key={note.id}>
                {frames.includes(note.frame) ? (
                  <button type="button" className="text-button" onClick={() => onOpenFrame(note.frame)}>
                    {note.frame}
                  </button>
                ) : (
                  <span className="my-note-gone" title="This frame is no longer in the flow">
                    {note.frame} (removed)
                  </span>
                )}
                <span className="my-note-other-text">{note.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
