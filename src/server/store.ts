// Flows live in Postgres, one row per flow per workspace. This store tracks
// revisions and tells every open viewer when something changed.

import { frameRefs } from "../shared/machine";
import { diffFlows } from "../shared/patch";
import type { Flow, FlowMeta, FlowPayload, FlowSummary, Issue } from "../shared/types";
import { countIssues } from "../shared/validate";
import { query } from "./db";
import { send } from "./hub";

interface Row {
  id: string;
  spec: Flow;
  issues: Issue[];
  rev: number;
  updated_at: Date;
  last_change: FlowMeta["lastChange"] | null;
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug || "flow";
}

function payloadOf(row: Row): FlowPayload {
  const meta: FlowMeta = { rev: row.rev, updatedAt: row.updated_at.toISOString() };
  if (row.last_change) meta.lastChange = row.last_change;
  return { id: row.id, spec: row.spec, meta, issues: row.issues };
}

/** Someone else saved the flow between reading it and writing it back. */
export class StaleFlowError extends Error {}

export class FlowStore {
  constructor(readonly ws: string) {}

  async ids(): Promise<string[]> {
    return (await query<{ id: string }>("select id from flows where ws = $1 order by id", [this.ws])).map((r) => r.id);
  }

  async has(id: string): Promise<boolean> {
    return (await query("select 1 from flows where ws = $1 and id = $2", [this.ws, id])).length > 0;
  }

  async count(): Promise<number> {
    return Number((await query<{ n: string }>("select count(*) as n from flows where ws = $1", [this.ws]))[0].n);
  }

  /** An id that is not taken yet, based on the flow's name. */
  async freeId(base: string): Promise<string> {
    const taken = new Set(await this.ids());
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  async get(id: string): Promise<FlowPayload | undefined> {
    const rows = await query<Row>("select id, spec, issues, rev, updated_at, last_change from flows where ws = $1 and id = $2", [this.ws, id]);
    return rows[0] ? payloadOf(rows[0]) : undefined;
  }

  async list(): Promise<FlowSummary[]> {
    const rows = await query<Row>(
      "select id, spec, issues, rev, updated_at, last_change from flows where ws = $1 order by updated_at desc, id",
      [this.ws],
    );
    return rows.map((row) => {
      const counts = countIssues(row.issues);
      const summary: FlowSummary = {
        id: row.id,
        name: row.spec.name,
        device: row.spec.device ?? "desktop",
        rev: row.rev,
        updatedAt: row.updated_at.toISOString(),
        screens: row.spec.screens.length,
        states: frameRefs(row.spec).length,
        transitions: row.spec.transitions.length,
        errors: counts.errors,
        warnings: counts.warnings,
      };
      if (row.spec.description) summary.description = row.spec.description;
      return summary;
    });
  }

  /**
   * Save a flow that has already passed validation. Bumps the revision and
   * records which frames changed so the viewer can mark them. `previous` is the
   * version the change was made from; if the flow has moved on since, nothing
   * is written and StaleFlowError is thrown.
   */
  async save(id: string, spec: Flow, issues: Issue[], summary: string, previous?: FlowPayload, quiet = false): Promise<FlowPayload> {
    const now = new Date();
    const diff = previous ? diffFlows(previous.spec, spec) : { added: [], changed: [], removed: [] };
    const lastChange = { summary, ...diff, at: now.toISOString() };
    const values = [this.ws, id, JSON.stringify(spec), JSON.stringify(issues), now, JSON.stringify(lastChange)];
    let rows: Row[];
    if (previous) {
      rows = await query<Row>(
        `update flows set spec = $3, issues = $4, rev = rev + 1, updated_at = $5, last_change = $6
         where ws = $1 and id = $2 and rev = $7
         returning id, spec, issues, rev, updated_at, last_change`,
        [...values, previous.meta.rev],
      );
      if (!rows[0]) throw new StaleFlowError();
    } else {
      rows = await query<Row>(
        `insert into flows (ws, id, spec, issues, rev, updated_at, last_change) values ($1, $2, $3, $4, 1, $5, $6)
         on conflict (ws, id) do nothing
         returning id, spec, issues, rev, updated_at, last_change`,
        values,
      );
      if (!rows[0]) throw new StaleFlowError();
    }
    const payload = payloadOf(rows[0]);
    if (!quiet) {
      await send(this.ws, { type: "flow", id, rev: payload.meta.rev });
      if (!previous) await send(this.ws, { type: "list" });
    }
    return payload;
  }
}
