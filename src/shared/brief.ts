// The build brief: a flow written out for the agent or person who builds the
// real product from it. Structure, states, behaviour and words carry over; the
// sketch look does not.

import { COMPONENTS, childrenOf, factsOf, layoutFacts, walkNodes } from "../design-system/components";
import { buildTarget, type BuildTarget } from "../design-system/targets";
import { exprVariables } from "./expr";
import { findFrame, fromMatches, frameRefs, initialData, resolveRef } from "./machine";
import { noteAuthor, noteWhere } from "./notes";
import type { Flow, FlowNode, FlowTransition, ReviewNote } from "./types";

function q(value: unknown): string {
  return typeof value === "string" && value ? `"${value}"` : "";
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function assignments(set: unknown, skip?: Set<string>): string[] {
  const values = record(set);
  if (!values) return [];
  return Object.entries(values)
    .filter(([k]) => !skip?.has(k))
    .map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
}

function fires(event: unknown, set?: unknown): string {
  if (!str(event)) return "";
  const writes = assignments(set);
  return ` → fires ${event as string}${writes.length ? ` (sets ${writes.join(", ")})` : ""}`;
}

function join(parts: (string | undefined | false)[], sep = " "): string {
  return parts.filter(Boolean).join(sep);
}

function marks(...parts: (string | undefined | false)[]): string {
  const kept = parts.filter(Boolean);
  return kept.length ? ` (${kept.join(", ")})` : "";
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** One component as one or more outline lines, without its nested components. */
function describeNode(node: FlowNode): string[] {
  const options = Array.isArray(node.options) ? (node.options as unknown[]).map(String).join(" | ") : "";
  const tone = str(node.tone);
  switch (node.type) {
    case "stack":
      return ["stack"];
    case "row":
      return [`row${marks(str(node.justify) !== "start" && str(node.justify))}`];
    case "card":
      return [join(["card", q(node.title)])];
    case "divider":
      return ["divider"];
    case "modal":
      return [join(["modal", q(node.title)])];
    case "heading":
      return [`heading ${typeof node.level === "number" ? node.level : 2}: ${q(node.text)}`];
    case "text":
      return [`text${marks(tone !== "default" && tone, str(node.size) === "sm" && "small")}: ${q(node.text)}`];
    case "link":
      return [`link ${q(node.text)}${fires(node.event, node.set)}`];
    case "button": {
      const variant = str(node.variant);
      return [
        `button${marks(variant !== "default" && variant, node.disabled === true && "disabled", node.full === true && "full width")} ${q(node.label)}${fires(node.event, node.set)}`,
      ];
    }
    case "input": {
      const kind = str(node.kind);
      return [
        join([
          `input${marks(kind !== "text" && kind)}`,
          q(node.label),
          `↔ ${String(node.bind)}`,
          str(node.placeholder) && `· placeholder ${q(node.placeholder)}`,
          str(node.hint) && `· hint ${q(node.hint)}`,
          str(node.error) && `· error ${q(node.error)}`,
        ]),
      ];
    }
    case "select":
      return [join(["select", q(node.label), `↔ ${String(node.bind)}:`, options, str(node.placeholder) && `· placeholder ${q(node.placeholder)}`])];
    case "radio":
      return [join(["radio", q(node.label), `↔ ${String(node.bind)}:`, options])];
    case "checkbox":
      return [`checkbox ${q(node.label)} ↔ ${String(node.bind)}`];
    case "list": {
      const items = Array.isArray(node.items) ? (node.items as unknown[]).map(record).filter((i) => i !== undefined) : [];
      return [
        `list, ${count(items.length, "item")}:`,
        ...items.map(
          (item) =>
            join([`· ${q(item.title)}`, str(item.subtitle) && `/ ${q(item.subtitle)}`, str(item.meta) && `[${item.meta as string}]`]) +
            fires(item.event, item.set),
        ),
      ];
    }
    case "table": {
      const columns = Array.isArray(node.columns) ? (node.columns as unknown[]).map(String) : [];
      const rows = Array.isArray(node.rows) ? (node.rows as unknown[]).filter(Array.isArray) : [];
      const press = str(node.rowEvent)
        ? `; pressing a row fires ${node.rowEvent as string}${str(node.rowBind) ? ` and stores its first cell in ${node.rowBind as string}` : ""}`
        : "";
      return [
        `table: ${columns.join(" | ")} (${count(rows.length, "row")}${press})`,
        ...rows.slice(0, 3).map((row) => `· ${(row as unknown[]).map(String).join(" | ")}`),
        ...(rows.length > 3 ? [`· and ${rows.length - 3} more`] : []),
      ];
    }
    case "image":
      return [`${str(node.shape) === "circle" ? "image (avatar)" : "image"}${q(node.label) ? `: ${q(node.label)}` : ""}`];
    case "badge":
      return [`badge${marks(tone !== "default" && tone)}: ${q(node.text)}`];
    case "nav": {
      const items = Array.isArray(node.items) ? (node.items as unknown[]).map(record).filter((i) => i !== undefined) : [];
      const listed = items
        .map((item) => `${String(item.label)}${item.active === true ? " (current)" : ""}${str(item.event) ? ` → fires ${item.event as string}` : ""}`)
        .join(", ");
      return [`${join([`nav (${str(node.kind) ?? "top"})`, q(node.brand)])}: ${listed}`];
    }
    case "steps": {
      const items = Array.isArray(node.items) ? (node.items as unknown[]).map(String) : [];
      return [`steps: ${items.join(" > ")} (on step ${String(node.current)})`];
    }
    case "alert": {
      const action = record(node.action);
      return [`alert (${tone ?? "info"}): ${q(node.text)}${action ? `, with button ${q(action.label)}${fires(action.event)}` : ""}`];
    }
    case "loading":
      return [`loading${q(node.text) ? `: ${q(node.text)}` : ""}`];
    case "skeleton":
      return [`skeleton (${count(typeof node.lines === "number" ? node.lines : 3, "line")})`];
    case "empty": {
      const action = record(node.action);
      return [
        join([`empty: ${q(node.title)}`, str(node.text) && `/ ${q(node.text)}`]) +
          (action ? `, with button ${q(action.label)}${fires(action.event)}` : ""),
      ];
    }
    default:
      return [node.type];
  }
}

function outline(nodes: FlowNode[], depth: number, out: string[]): void {
  const pad = "  ".repeat(depth);
  for (const node of nodes) {
    const [first, ...rest] = describeNode(node);
    out.push(`${pad}- ${first}`);
    for (const line of rest) out.push(`${pad}  ${line}`);
    const children = childrenOf(node).map((c) => c.node);
    if (children.length) outline(children, depth + 1, out);
  }
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function delay(ms: number): string {
  return ms >= 1000 ? `${Number((ms / 1000).toFixed(1))} s` : `${ms} ms`;
}

/** The labels of every control that fires this transition's event, in the frames it applies from. */
function pressed(flow: Flow, t: FlowTransition): string[] {
  const labels: string[] = [];
  for (const ref of frameRefs(flow)) {
    if (!fromMatches(t.from, ref)) continue;
    const frame = findFrame(flow, ref);
    if (!frame) continue;
    walkNodes(frame.state.layout, (node) => {
      for (const fired of factsOf(node).events) {
        if (fired.event === t.on && fired.label && !labels.includes(fired.label)) labels.push(fired.label);
      }
    });
  }
  return labels;
}

/** What sets a transition off, as a clause: "“Cancel plan” is pressed (event: cancel)". */
function trigger(flow: Flow, t: FlowTransition): string {
  if (typeof t.after === "number") return `the wait ends (${delay(t.after)} in the prototype)`;
  if (t.on?.startsWith("change:")) return `${t.on.slice("change:".length)} changes`;
  const labels = pressed(flow, t);
  if (labels.length === 0) return `the event ${t.on ?? ""} fires`;
  return `${labels.map((label) => `“${label}”`).join(" or ")} is pressed (event: ${t.on ?? ""})`;
}

function fromText(from: string): string {
  if (from === "*") return "any frame";
  if (from.endsWith(".*")) return `any state of ${from.slice(0, -2)}`;
  return from;
}

function summarise(nodes: FlowNode[]): string {
  const headings: string[] = [];
  const actions: string[] = [];
  const fields: string[] = [];
  const messages: string[] = [];
  walkNodes(nodes, (node) => {
    if (node.type === "heading" && str(node.text)) headings.push(q(node.text));
    if (node.type === "button" && str(node.label)) actions.push(`${q(node.label)}${node.disabled === true ? " (disabled)" : ""}`);
    if (node.type === "link" && str(node.text)) actions.push(q(node.text));
    if (["input", "select", "radio", "checkbox"].includes(node.type) && str(node.label)) fields.push(q(node.label));
    if (node.type === "alert" && str(node.text)) messages.push(`the ${str(node.tone) ?? "info"} message ${q(node.text)}`);
    if (node.type === "input" && str(node.error)) messages.push(`the field error ${q(node.error)}`);
    if (node.type === "text" && str(node.tone) === "error" && str(node.text)) messages.push(`the error ${q(node.text)}`);
    if (node.type === "loading") messages.push(q(node.text) ? `progress ${q(node.text)}` : "a progress indicator");
    if (node.type === "skeleton") messages.push("placeholder lines while loading");
    if (node.type === "empty" && str(node.title)) messages.push(`the empty state ${q(node.title)}`);
    if (node.type === "table" && Array.isArray(node.columns)) {
      messages.push(`a table with the columns ${(node.columns as unknown[]).map(String).join(", ")}`);
    }
    if (node.type === "list" && Array.isArray(node.items)) messages.push(`a list of ${count(node.items.length, "item")}`);
  });
  return [
    headings.length && headings.slice(0, 2).join(" and "),
    fields.length && `the field${fields.length === 1 ? "" : "s"} ${fields.join(", ")}`,
    actions.length && `the action${actions.length === 1 ? "" : "s"} ${actions.join(", ")}`,
    messages.length && [...new Set(messages)].join("; "),
  ]
    .filter(Boolean)
    .join("; ");
}

/** What a state must show, in a few words, for its acceptance check. A modal is what counts when there is one. */
function essentials(layout: FlowNode[]): string {
  const modal = layout.find((node) => node.type === "modal");
  if (!modal) return summarise(layout);
  const inside = summarise(childrenOf(modal).map((child) => child.node));
  return `${q(modal.title) ? `the modal ${q(modal.title)}` : "a modal"} over the page, which cannot be used behind it${inside ? `; in the modal: ${inside}` : ""}`;
}

export interface BriefOptions {
  /** Build target id: "ui-sdk", "shadcn" or "none". Default "ui-sdk". */
  target?: string;
  /** Limit the brief to one screen and the transitions that touch it. */
  screen?: string;
  /** Link to the live prototype. */
  url?: string;
  /** Notes the person wrote in the viewer that are still open. */
  notes?: ReviewNote[];
}

/** Write the flow out as Markdown for whoever builds the real thing. */
export function renderBuildBrief(flow: Flow, options: BriefOptions = {}): string {
  const target: BuildTarget = buildTarget(options.target) ?? buildTarget(undefined)!;
  const only = options.screen;
  const screens = only ? flow.screens.filter((s) => s.id === only) : flow.screens;
  const touches = (ref: string): boolean => ref === only || ref.startsWith(`${only}.`);
  const transitions = only
    ? flow.transitions.filter((t) => t.from === "*" || touches(t.from) || touches(resolveRef(flow, t.to) ?? t.to))
    : flow.transitions;
  const start = resolveRef(flow, flow.start) ?? flow.start;
  const stateCount = screens.reduce((n, s) => n + s.states.length, 0);
  const out: string[] = [];

  // What this is
  out.push(`# Build brief: ${flow.name}${only ? ` (screen: ${only})` : ""}`, "");
  if (flow.description) out.push(flow.description, "");
  out.push(
    "This brief comes from a quickmock flow: a lo-fi, pen-and-ink prototype used to settle layout, wording and behaviour before any visual design. Build the real thing from it.",
    "",
    "- Keep every screen and state below, the wording, and the behaviour table. They were reviewed as they are.",
    "- Do not copy the look. The sketch style is deliberate and carries no visual decisions; take those from the product's design system.",
    "- Build every state, not only the happy path. Each state below is a frame someone looked at.",
    "- The open questions at the end were not settled in the prototype. Ask before deciding them.",
    `- Device: ${flow.device ?? "desktop"}. The flow starts on ${start}.`,
  );
  if (options.url) out.push(`- The live prototype, to click through: ${options.url}`);
  if (only) out.push(`- This brief covers one screen of ${flow.screens.length}. The others are: ${flow.screens.filter((s) => s.id !== only).map((s) => s.id).join(", ") || "none"}.`);
  out.push("");

  // Screens and states
  out.push(`## Screens and states (${count(screens.length, "screen")}, ${count(stateCount, "state")})`, "");
  out.push('Each state is listed as "screen.state" with its components in order, top to bottom. "↔ name" binds a control to a variable. Text written as {name} shows that variable\'s value.', "");
  // The page behind a modal is usually one that was already listed: point at it instead of repeating it.
  const pages = new Map<string, string>();
  for (const screen of flow.screens) {
    for (const state of screen.states) {
      if (state.over !== undefined) continue;
      const key = JSON.stringify(state.layout.filter((node) => node.type !== "modal"));
      if (!pages.has(key)) pages.set(key, `${screen.id}.${state.id}`);
    }
  }
  const listed = new Set(screens.flatMap((screen) => screen.states.map((state) => `${screen.id}.${state.id}`)));
  for (const screen of screens) {
    out.push(`### ${screen.id}${screen.title ? `: ${screen.title}` : ""}`, "");
    for (const state of screen.states) {
      const ref = `${screen.id}.${state.id}`;
      out.push(`#### ${ref}${marks(ref === start && "start", state.end === true && "an end of the flow")}`);
      if (state.note) out.push(state.note);
      out.push("");
      const lines: string[] = [];
      const behind = state.layout.filter((node) => node.type !== "modal");
      const same = pages.get(JSON.stringify(behind));
      if (state.over !== undefined) {
        lines.push(`- over ${resolveRef(flow, state.over) ?? state.over}: that page stays visible behind the modal and cannot be used`);
        outline(state.layout, 0, lines);
      } else if (behind.length < state.layout.length && behind.length > 0 && same && same !== ref && listed.has(same)) {
        lines.push(`- behind the modal: the same page as ${same}`);
        outline(state.layout.filter((node) => node.type === "modal"), 0, lines);
      } else {
        outline(state.layout, 0, lines);
      }
      out.push(...lines, "");
    }
  }

  // Behaviour
  out.push("## Behaviour", "");
  const data = initialData(flow);
  const entered = new Set<string>();
  for (const screen of flow.screens) {
    for (const state of screen.states) for (const bind of layoutFacts(state.layout).binds) entered.add(bind.variable);
  }
  const written = new Set<string>();
  for (const screen of flow.screens) {
    for (const state of screen.states) for (const name of layoutFacts(state.layout).writes) written.add(name);
  }
  for (const t of flow.transitions) for (const name of Object.keys(t.set ?? {})) written.add(name);
  // A guard on a timed transition stands for how the wait turned out, which the prototype cannot know.
  const outcomes = new Set<string>();
  for (const t of flow.transitions) {
    if (typeof t.after !== "number" || !t.when) continue;
    try {
      for (const name of exprVariables(t.when)) if (!entered.has(name)) outcomes.add(name);
    } catch {
      // A guard that does not parse was already reported by lint.
    }
  }
  const names = Object.keys(data);
  if (names.length) {
    out.push("Variables:", "");
    for (const name of names) {
      const role = entered.has(name)
        ? "entered by the person"
        : outcomes.has(name)
          ? `a switch for trying a branch in the prototype. It stands in for how a wait turns out; in the product, use the real result${written.has(name) ? ", and ignore where the prototype resets it" : ""}`
          : "set by the flow";
      out.push(`- ${name}: starts as ${JSON.stringify(data[name])}; ${role}`);
    }
    out.push("");
  }
  out.push(
    "Transitions. Rows are in order: where rows share a source and a trigger, the first whose condition holds wins. A row from one frame beats a row from any state of its screen, which beats a row from any frame.",
  );
  if (transitions.some((t) => typeof t.after === "number")) {
    out.push(
      "A wait stands for work finishing, such as a request or a save. In the product, replace the timer with the real work, and the condition on it with the real outcome.",
    );
  }
  out.push("", "| From | When | If | Goes to | Also |", "| --- | --- | --- | --- | --- |");
  const sameTrigger = (a: FlowTransition, b: FlowTransition): boolean => a.from === b.from && a.on === b.on && a.after === b.after;
  /** Guards of the rows above this one that share its source and trigger: it only runs when none of them hold. */
  const earlierGuards = (t: FlowTransition): string[] => {
    const guards: string[] = [];
    for (const other of flow.transitions) {
      if (other === t) break;
      if (sameTrigger(other, t) && other.when) guards.push(other.when);
    }
    return guards;
  };
  for (const t of transitions) {
    const condition = t.when ?? (earlierGuards(t).length ? "otherwise" : "");
    out.push(
      `| ${cell(fromText(t.from))} | ${cell(trigger(flow, t))} | ${cell(condition)} | ${cell(resolveRef(flow, t.to) ?? t.to)} | ${cell(assignments(t.set, outcomes).map((a) => `sets ${a}`).join(", "))} |`,
    );
  }
  out.push("");
  const wide = [...new Set(transitions.map((t) => t.from).filter((from) => from === "*" || from.endsWith(".*")))];
  if (wide.length) {
    out.push("Sources that cover more than one frame:", "");
    for (const from of wide) {
      const frames = frameRefs(flow).filter((ref) => fromMatches(from, ref));
      out.push(`- ${fromText(from)}: ${frames.join(", ")}`);
    }
    out.push("");
  }

  // Acceptance checks
  out.push("## Acceptance checks", "", "One per state, then one per transition. Each is something to see or do in the built product.", "");
  for (const screen of screens) {
    for (const state of screen.states) {
      out.push(`- [ ] ${screen.id}.${state.id} shows ${essentials(state.layout) || "its layout as listed above"}.`);
    }
  }
  for (const t of transitions) {
    const writes = assignments(t.set, outcomes);
    const conditions = [...earlierGuards(t).map((guard) => `not (${guard})`), ...(t.when ? [t.when] : [])];
    out.push(
      `- [ ] From ${fromText(t.from)}, when ${trigger(flow, t)}${conditions.length ? ` and ${conditions.join(" and ")}` : ""}, the app shows ${resolveRef(flow, t.to) ?? t.to}${writes.length ? ` and ${writes.join(", ")}` : ""}.`,
    );
  }
  out.push("");

  // Component mapping
  const used = new Set<string>();
  for (const screen of screens) for (const state of screen.states) walkNodes(state.layout, (node) => void used.add(node.type));
  out.push(`## Building it with ${target.name}`, "", ...target.intro.map((line) => `- ${line}`), "");
  if (Object.keys(target.map).length) {
    out.push("| In the sketch | Build with | Note |", "| --- | --- | --- |");
    for (const def of COMPONENTS) {
      if (!used.has(def.type)) continue;
      const entry = target.map[def.type];
      out.push(`| ${def.type} | ${cell(entry?.use ?? "the closest component")} | ${cell(entry?.note ?? "")} |`);
    }
  } else {
    out.push("| In the sketch | What it is |", "| --- | --- |");
    for (const def of COMPONENTS) {
      if (used.has(def.type)) out.push(`| ${def.type} | ${cell(def.summary)} |`);
    }
  }
  out.push("");

  // Open questions
  const questions: string[] = [];
  for (const screen of screens) {
    for (const state of screen.states) {
      for (const question of state.questions ?? []) questions.push(`- ${screen.id}.${state.id}: ${question}`);
    }
  }
  out.push("## Open questions", "", ...(questions.length ? questions : ["None were recorded in the prototype."]), "");

  // Notes the reviewer left that nobody has dealt with yet are unfinished design work.
  const open = (options.notes ?? []).filter((note) => !note.done && (!only || touches(note.frame)));
  if (open.length) {
    out.push(
      "## Review notes still open",
      "",
      "People reviewing the prototype wrote these and they have not been dealt with. Settle them before building the frames they are on.",
      "",
      ...open.map((note) => `- ${noteWhere(note)}${noteAuthor(note) ? ` (${noteAuthor(note)})` : ""}: ${note.text}`),
      "",
    );
  }

  return out.join("\n");
}
