// Notes the person writes in the viewer. They live in flows/.notes/<flow>.json,
// beside the flows instead of inside them: they belong to the reviewer, and an
// agent replacing a state must not be able to lose them.

import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ReviewNote } from "../shared/types";

interface NoteFile {
  /** The number the next note gets, so ids are never reused. */
  next: number;
  notes: ReviewNote[];
}

export interface NoteInput {
  frame: string;
  text: string;
  target?: { path: string; type: string; summary?: string };
  /** For a sticky note: its offset from the frame's top-left corner, in board units. */
  sticky?: { dx: number; dy: number };
  /** The name the writer gave themselves. */
  author?: string;
}

/** What can be changed on a note after it is written. */
export interface NotePatch {
  text?: string;
  frame?: string;
  sticky?: { dx: number; dy: number };
}

export const NOTE_MAX_LENGTH = 1000;
/** More notes than a review ever produces; the limit only stops a file growing without end. */
export const NOTES_PER_FLOW = 500;

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function offset(value: unknown): { dx: number; dy: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { dx, dy } = value as { dx?: unknown; dy?: unknown };
  if (typeof dx !== "number" || typeof dy !== "number" || !Number.isFinite(dx) || !Number.isFinite(dy)) return undefined;
  const tidy = (n: number): number => Math.round(Math.max(-20000, Math.min(20000, n)));
  return { dx: tidy(dx), dy: tidy(dy) };
}

/** Tidy what a client sent into a note's fields. Returns a message when it cannot be a note. */
export function readNoteInput(body: unknown): NoteInput | string {
  if (typeof body !== "object" || body === null) return "Send the note as a JSON object with \"frame\" and \"text\".";
  const raw = body as Record<string, unknown>;
  const frame = clip(raw.frame, 120);
  if (!frame) return "A note needs the \"frame\" it is about, such as \"team.default\".";
  if (typeof raw.text !== "string" || !raw.text.trim()) return "A note needs some \"text\".";
  if (raw.text.trim().length > NOTE_MAX_LENGTH) return `A note can be at most ${NOTE_MAX_LENGTH} characters.`;
  const input: NoteInput = { frame, text: raw.text.trim() };
  if (typeof raw.target === "object" && raw.target !== null) {
    const t = raw.target as Record<string, unknown>;
    const path = clip(t.path, 200);
    const type = clip(t.type, 40);
    if (path && type) {
      input.target = { path, type };
      const summary = clip(t.summary, 120);
      if (summary) input.target.summary = summary;
    }
  }
  const sticky = offset(raw.sticky);
  if (sticky) input.sticky = sticky;
  const author = clip(raw.author, 24);
  if (author) input.author = author;
  return input;
}

/** Tidy a change to a note: new words, or a sticky moved to a new place. Returns a message when there is nothing usable. */
export function readNotePatch(body: unknown): NotePatch | string {
  if (typeof body !== "object" || body === null) return "Send the change as a JSON object.";
  const raw = body as Record<string, unknown>;
  const patch: NotePatch = {};
  if (raw.text !== undefined) {
    if (typeof raw.text !== "string" || !raw.text.trim()) return "A note needs some \"text\". Delete the note to remove it.";
    if (raw.text.trim().length > NOTE_MAX_LENGTH) return `A note can be at most ${NOTE_MAX_LENGTH} characters.`;
    patch.text = raw.text.trim();
  }
  if (raw.sticky !== undefined) {
    const sticky = offset(raw.sticky);
    const frame = clip(raw.frame, 120);
    if (!sticky || !frame) return "Moving a sticky note needs its \"frame\" and a \"sticky\" offset with dx and dy.";
    patch.sticky = sticky;
    patch.frame = frame;
  }
  return Object.keys(patch).length ? patch : "There is nothing to change: send \"text\", or \"frame\" and \"sticky\".";
}

export class NoteStore extends EventEmitter {
  private cache = new Map<string, NoteFile>();

  /** `dir` is the flows folder; notes go in its `.notes` subfolder. */
  constructor(private readonly dir: string) {
    super();
  }

  private path(flowId: string): string {
    return join(this.dir, ".notes", `${flowId}.json`);
  }

  private read(flowId: string): NoteFile {
    const cached = this.cache.get(flowId);
    if (cached) return cached;
    let file: NoteFile = { next: 1, notes: [] };
    try {
      if (existsSync(this.path(flowId))) {
        const parsed = JSON.parse(readFileSync(this.path(flowId), "utf8")) as Partial<NoteFile>;
        const notes = Array.isArray(parsed.notes) ? parsed.notes.filter((n) => n && typeof n.id === "string" && typeof n.text === "string") : [];
        const highest = notes.reduce((max, n) => Math.max(max, Number(n.id.slice(1)) || 0), 0);
        file = { next: Math.max(typeof parsed.next === "number" ? parsed.next : 1, highest + 1), notes };
      }
    } catch {
      // A notes file that cannot be read is treated as empty; the flow itself is unaffected.
    }
    this.cache.set(flowId, file);
    return file;
  }

  private write(flowId: string, file: NoteFile): void {
    mkdirSync(join(this.dir, ".notes"), { recursive: true });
    writeFileSync(this.path(flowId), `${JSON.stringify(file, null, 2)}\n`);
    this.emit("change", { type: "notes", id: flowId });
  }

  /** Every note on a flow, oldest first. */
  list(flowId: string): ReviewNote[] {
    return this.read(flowId).notes;
  }

  open(flowId: string): ReviewNote[] {
    return this.list(flowId).filter((note) => !note.done);
  }

  /** `guest` marks a note that came in over the share link. Returns undefined when the flow has too many notes. */
  add(flowId: string, input: NoteInput, guest = false): ReviewNote | undefined {
    const file = this.read(flowId);
    if (file.notes.length >= NOTES_PER_FLOW) return undefined;
    const note: ReviewNote = { id: `n${file.next}`, frame: input.frame, text: input.text, at: new Date().toISOString() };
    if (input.target && !input.sticky) note.target = input.target;
    if (input.sticky) note.sticky = input.sticky;
    if (input.author) note.author = input.author;
    if (guest) note.guest = true;
    file.next += 1;
    file.notes.push(note);
    this.write(flowId, file);
    return note;
  }

  get(flowId: string, noteId: string): ReviewNote | undefined {
    return this.read(flowId).notes.find((n) => n.id === noteId);
  }

  /** Change a note's words, or move a sticky note. */
  update(flowId: string, noteId: string, patch: NotePatch): ReviewNote | undefined {
    const file = this.read(flowId);
    const note = file.notes.find((n) => n.id === noteId);
    if (!note) return undefined;
    if (patch.text !== undefined) note.text = patch.text;
    if (patch.sticky && patch.frame && note.sticky) {
      note.sticky = patch.sticky;
      note.frame = patch.frame;
    }
    this.write(flowId, file);
    return note;
  }

  /** Mark a note as dealt with. An agent says what it did in `reply`. */
  resolve(flowId: string, noteId: string, by: "person" | "agent", reply?: string): ReviewNote | undefined {
    const file = this.read(flowId);
    const note = file.notes.find((n) => n.id === noteId);
    if (!note) return undefined;
    note.done = { at: new Date().toISOString(), by };
    const said = clip(reply, 400);
    if (said) note.done.reply = said;
    this.write(flowId, file);
    return note;
  }

  reopen(flowId: string, noteId: string): ReviewNote | undefined {
    const file = this.read(flowId);
    const note = file.notes.find((n) => n.id === noteId);
    if (!note) return undefined;
    delete note.done;
    this.write(flowId, file);
    return note;
  }

  remove(flowId: string, noteId: string): boolean {
    const file = this.read(flowId);
    const index = file.notes.findIndex((n) => n.id === noteId);
    if (index === -1) return false;
    file.notes.splice(index, 1);
    this.write(flowId, file);
    return true;
  }
}
