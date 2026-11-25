// What one workspace may hold. Everyone gets the same today; when there are
// plans, this is the one place that decides what each of them allows.

export interface Limits {
  flows: number;
  notesPerFlow: number;
  /** The largest flow spec, in characters of JSON. */
  specSize: number;
}

const FREE: Limits = { flows: 50, notesPerFlow: 500, specSize: 1_000_000 };

export function limitsFor(_ws: string): Limits {
  return FREE;
}

/** New workspaces one address may make in an hour. */
export const WORKSPACES_PER_HOUR = 10;
