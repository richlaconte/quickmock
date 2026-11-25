// Notes the person writes in the viewer. They live in their own table, beside
// the flows instead of inside them: they belong to the reviewer, and an agent
// replacing a state must not be able to lose them.

import type { ReviewNote } from "../shared/types";
import { query } from "./db";
import { send } from "./hub";
import { limitsFor } from "./limits";

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

export class NoteStore {
  constructor(readonly ws: string) {}

  private async write(flowId: string, note: ReviewNote): Promise<ReviewNote> {
    await query("update notes set body = $4 where ws = $1 and flow_id = $2 and id = $3", [this.ws, flowId, note.id, JSON.stringify(note)]);
    await send(this.ws, { type: "notes", id: flowId });
    return note;
  }

  /** Every note on a flow, oldest first. */
  async list(flowId: string): Promise<ReviewNote[]> {
    const rows = await query<{ body: ReviewNote }>("select body from notes where ws = $1 and flow_id = $2 order by seq", [this.ws, flowId]);
    return rows.map((r) => r.body);
  }

  async open(flowId: string): Promise<ReviewNote[]> {
    return (await this.list(flowId)).filter((note) => !note.done);
  }

  /** How many open notes each flow in the workspace has. */
  async openCounts(): Promise<Map<string, number>> {
    const rows = await query<{ flow_id: string; n: string }>(
      "select flow_id, count(*) as n from notes where ws = $1 and (body->>'done') is null group by flow_id",
      [this.ws],
    );
    return new Map(rows.map((r) => [r.flow_id, Number(r.n)]));
  }

  /** `guest` marks a note that came in over the share link. Returns undefined when the flow has too many notes. */
  async add(flowId: string, input: NoteInput, guest = false): Promise<ReviewNote | undefined> {
    const count = await query<{ n: string }>("select count(*) as n from notes where ws = $1 and flow_id = $2", [this.ws, flowId]);
    if (Number(count[0].n) >= limitsFor(this.ws).notesPerFlow) return undefined;
    // The flow keeps the counter, so an id is never given out twice, even after a note is deleted.
    const next = await query<{ note_seq: number }>("update flows set note_seq = note_seq + 1 where ws = $1 and id = $2 returning note_seq", [this.ws, flowId]);
    if (!next[0]) return undefined;
    const seq = next[0].note_seq;
    const note: ReviewNote = { id: `n${seq}`, frame: input.frame, text: input.text, at: new Date().toISOString() };
    if (input.target && !input.sticky) note.target = input.target;
    if (input.sticky) note.sticky = input.sticky;
    if (input.author) note.author = input.author;
    if (guest) note.guest = true;
    await query("insert into notes (ws, flow_id, id, seq, body) values ($1, $2, $3, $4, $5)", [this.ws, flowId, note.id, seq, JSON.stringify(note)]);
    await send(this.ws, { type: "notes", id: flowId });
    return note;
  }

  async get(flowId: string, noteId: string): Promise<ReviewNote | undefined> {
    const rows = await query<{ body: ReviewNote }>("select body from notes where ws = $1 and flow_id = $2 and id = $3", [this.ws, flowId, noteId]);
    return rows[0]?.body;
  }

  /** Change a note's words, or move a sticky note. */
  async update(flowId: string, noteId: string, patch: NotePatch): Promise<ReviewNote | undefined> {
    const note = await this.get(flowId, noteId);
    if (!note) return undefined;
    if (patch.text !== undefined) note.text = patch.text;
    if (patch.sticky && patch.frame && note.sticky) {
      note.sticky = patch.sticky;
      note.frame = patch.frame;
    }
    return this.write(flowId, note);
  }

  /** Mark a note as dealt with. An agent says what it did in `reply`. */
  async resolve(flowId: string, noteId: string, by: "person" | "agent", reply?: string): Promise<ReviewNote | undefined> {
    const note = await this.get(flowId, noteId);
    if (!note) return undefined;
    note.done = { at: new Date().toISOString(), by };
    const said = clip(reply, 400);
    if (said) note.done.reply = said;
    return this.write(flowId, note);
  }

  async reopen(flowId: string, noteId: string): Promise<ReviewNote | undefined> {
    const note = await this.get(flowId, noteId);
    if (!note) return undefined;
    delete note.done;
    return this.write(flowId, note);
  }

  async remove(flowId: string, noteId: string): Promise<boolean> {
    const rows = await query("delete from notes where ws = $1 and flow_id = $2 and id = $3 returning id", [this.ws, flowId, noteId]);
    if (rows.length) await send(this.ws, { type: "notes", id: flowId });
    return rows.length > 0;
  }
}
