// Flows live as plain JSON files in ./flows, one per flow, so they can be read,
// diffed and edited by hand. This store validates them, tracks revisions and
// tells the viewer when something changed, whoever changed it.

import { EventEmitter } from "node:events";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { join } from "node:path";

import { frameRefs } from "../shared/machine";
import { diffFlows } from "../shared/patch";
import type { Flow, FlowMeta, FlowPayload, FlowSummary, Issue } from "../shared/types";
import { countIssues, formatIssue, validateFlow } from "../shared/validate";

interface Entry {
  spec: Flow;
  /** File content as last read or written, to tell our own writes from outside edits. */
  raw: string;
  meta: FlowMeta;
  issues: Issue[];
  diskError?: string;
}

export interface StoreEvent {
  type: "flow" | "list";
  id?: string;
  rev?: number;
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

export class FlowStore extends EventEmitter {
  private entries = new Map<string, Entry>();
  /** Files that have never had a valid version. */
  private broken = new Map<string, string>();
  private watcher?: FSWatcher;
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    readonly dir: string,
    private readonly examplesDir?: string,
  ) {
    super();
  }

  /** Load every flow, seeding the examples into an empty folder, and start watching for edits. */
  init(): void {
    mkdirSync(join(this.dir, ".meta"), { recursive: true });
    if (this.flowFiles().length === 0 && this.examplesDir && existsSync(this.examplesDir)) {
      for (const file of readdirSync(this.examplesDir).filter((f) => f.endsWith(".json"))) {
        copyFileSync(join(this.examplesDir, file), join(this.dir, file));
      }
    }
    for (const file of this.flowFiles()) this.load(file.slice(0, -".json".length), true);

    this.watcher = watch(this.dir, (_event, filename) => {
      const names = filename ? [String(filename)] : this.flowFiles();
      for (const name of names) {
        if (!name.endsWith(".json") || name.startsWith(".")) continue;
        const id = name.slice(0, -".json".length);
        clearTimeout(this.timers.get(id));
        this.timers.set(
          id,
          setTimeout(() => {
            this.timers.delete(id);
            this.load(id, false);
          }, 120),
        );
      }
    });
  }

  close(): void {
    this.watcher?.close();
    for (const timer of this.timers.values()) clearTimeout(timer);
  }

  private flowFiles(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => f.endsWith(".json") && !f.startsWith("."));
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private metaPath(id: string): string {
    return join(this.dir, ".meta", `${id}.json`);
  }

  private readMeta(id: string): FlowMeta | undefined {
    try {
      const meta = JSON.parse(readFileSync(this.metaPath(id), "utf8")) as FlowMeta;
      return typeof meta.rev === "number" ? meta : undefined;
    } catch {
      return undefined;
    }
  }

  private writeMeta(id: string, meta: FlowMeta): void {
    try {
      writeFileSync(this.metaPath(id), `${JSON.stringify(meta, null, 2)}\n`);
    } catch {
      // Revision history is a convenience; losing it must not break a save.
    }
  }

  /** Read one flow from disk. Called at startup and whenever its file changes. */
  private load(id: string, initial: boolean): void {
    const path = this.filePath(id);
    const entry = this.entries.get(id);

    if (!existsSync(path)) {
      const known = this.entries.delete(id) || this.broken.delete(id);
      if (known) this.emit("change", { type: "list" } satisfies StoreEvent);
      return;
    }

    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      return;
    }
    if (entry && entry.raw === raw) return;

    const problem = (message: string): void => {
      if (entry) {
        entry.diskError = message;
        entry.raw = raw;
        this.emit("change", { type: "flow", id, rev: entry.meta.rev } satisfies StoreEvent);
      } else {
        this.broken.set(id, message);
        this.emit("change", { type: "list" } satisfies StoreEvent);
      }
    };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      problem(`${id}.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const result = validateFlow(parsed);
    if (!result.flow) {
      const errors = result.issues.filter((i) => i.severity === "error");
      problem(`${id}.json has ${errors.length} error${errors.length === 1 ? "" : "s"}. First: ${formatIssue(errors[0])}`);
      return;
    }

    this.broken.delete(id);
    const now = new Date().toISOString();
    let meta: FlowMeta;
    if (initial) {
      meta = this.readMeta(id) ?? { rev: 1, updatedAt: now };
    } else {
      const diff = diffFlows(entry?.spec, result.flow);
      meta = {
        rev: (entry?.meta.rev ?? this.readMeta(id)?.rev ?? 0) + 1,
        updatedAt: now,
        lastChange: entry
          ? { summary: "Edited on disk", ...diff, at: now }
          : { summary: "Added on disk", added: [], changed: [], removed: [], at: now },
      };
      this.writeMeta(id, meta);
    }
    this.entries.set(id, { spec: result.flow, raw, meta, issues: result.issues });
    if (!initial) {
      this.emit("change", { type: "flow", id, rev: meta.rev } satisfies StoreEvent);
      if (!entry) this.emit("change", { type: "list" } satisfies StoreEvent);
    }
  }

  has(id: string): boolean {
    return this.entries.has(id) || this.broken.has(id);
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  /** An id that is not taken yet, based on the flow's name. */
  freeId(base: string): string {
    if (!this.has(base)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}`;
      if (!this.has(candidate)) return candidate;
    }
  }

  get(id: string): FlowPayload | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    const payload: FlowPayload = { id, spec: entry.spec, meta: entry.meta, issues: entry.issues };
    if (entry.diskError) payload.diskError = entry.diskError;
    return payload;
  }

  list(): FlowSummary[] {
    const summaries: FlowSummary[] = [];
    for (const [id, entry] of this.entries) {
      const counts = countIssues(entry.issues);
      const summary: FlowSummary = {
        id,
        name: entry.spec.name,
        device: entry.spec.device ?? "desktop",
        rev: entry.meta.rev,
        updatedAt: entry.meta.updatedAt,
        screens: entry.spec.screens.length,
        states: frameRefs(entry.spec).length,
        transitions: entry.spec.transitions.length,
        errors: counts.errors,
        warnings: counts.warnings,
      };
      if (entry.spec.description) summary.description = entry.spec.description;
      if (entry.diskError) summary.diskError = entry.diskError;
      summaries.push(summary);
    }
    for (const [id, message] of this.broken) {
      summaries.push({
        id,
        name: id,
        device: "desktop",
        rev: 0,
        updatedAt: "",
        screens: 0,
        states: 0,
        transitions: 0,
        errors: 1,
        warnings: 0,
        diskError: message,
      });
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  /**
   * Save a flow that has already passed validation. Bumps the revision and
   * records which frames changed so the viewer can mark them.
   */
  save(id: string, spec: Flow, issues: Issue[], summary: string): FlowPayload {
    const previous = this.entries.get(id);
    const now = new Date().toISOString();
    const diff = previous ? diffFlows(previous.spec, spec) : { added: [], changed: [], removed: [] };
    const meta: FlowMeta = {
      rev: (previous?.meta.rev ?? 0) + 1,
      updatedAt: now,
      lastChange: { summary, ...diff, at: now },
    };
    const raw = `${JSON.stringify(spec, null, 2)}\n`;
    // Remember the content before writing, so the file watcher sees nothing new.
    this.entries.set(id, { spec, raw, meta, issues });
    this.broken.delete(id);
    writeFileSync(this.filePath(id), raw);
    this.writeMeta(id, meta);
    this.emit("change", { type: "flow", id, rev: meta.rev } satisfies StoreEvent);
    if (!previous) this.emit("change", { type: "list" } satisfies StoreEvent);
    return this.get(id)!;
  }
}
