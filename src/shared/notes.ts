// Helpers for the notes a person writes in the viewer, shared by the server
// (MCP tools, build brief) and the viewer so they describe a note the same way.

import { frameRefs } from "./machine";
import type { Flow, ReviewNote } from "./types";

/** Where a note points, in words: 'team.default, the button "Invite someone"', or 'a sticky note near team.default'. */
export function noteWhere(note: ReviewNote): string {
  if (note.sticky) return `a sticky note near ${note.frame}`;
  if (!note.target) return note.frame;
  const { type, summary } = note.target;
  return `${note.frame}, the ${type}${summary ? ` "${summary}"` : ""}`;
}

/** Who wrote a note, for a list: "Lena (guest)", "Lena", "a guest", or nothing for the owner's unnamed notes. */
export function noteAuthor(note: ReviewNote): string {
  if (note.guest) return note.author ? `${note.author} (guest)` : "a guest";
  return note.author ?? "";
}

export function openNotes(notes: ReviewNote[]): ReviewNote[] {
  return notes.filter((note) => !note.done);
}

/** Notes whose frame has since been removed or renamed still matter; this says which they are. */
export function orphanedNotes(flow: Flow, notes: ReviewNote[]): Set<string> {
  const frames = new Set(frameRefs(flow));
  return new Set(notes.filter((note) => !frames.has(note.frame)).map((note) => note.id));
}
