// Validation and lint for a flow spec.
//   errors   - the spec is outside the design system or refers to things that do not exist; rejected
//   warnings - the flow or the design has a hole (dead end, unlabelled input, two primary buttons)
//   info     - worth a look (no empty state, vague label)

import {
  COMMON_PROPS,
  COMPONENT_TYPES,
  componentDef,
  factsOf,
  layoutFacts,
  walkNodes,
  type ComponentDef,
  type PropDef,
} from "../design-system/components";
import { ExprError, exprVariables, parseExpr } from "./expr";
import {
  activeLayer,
  findFrame,
  frameRefs,
  fromMatches,
  initialData,
  interpolationVariables,
  outgoing,
  pageBehind,
  reachableFrames,
  resolveRef,
  splitRef,
} from "./machine";
import type { Flow, FlowNode, FlowState, Issue, Severity } from "./types";

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EVENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const FLOW_KEYS = ["name", "description", "device", "start", "data", "screens", "transitions"];
const SCREEN_KEYS = ["id", "title", "states"];
const STATE_KEYS = ["id", "note", "end", "preview", "questions", "over", "layout"];
const TRANSITION_KEYS = ["from", "on", "after", "when", "set", "to", "label"];

/** Names people reach for that this system spells differently. */
const COMPONENT_ALIASES: Record<string, string> = {
  column: "stack",
  col: "stack",
  container: "stack",
  box: "card",
  section: "card",
  form: "stack",
  group: "stack",
  columns: "row",
  grid: "row (with wrap)",
  hstack: "row",
  vstack: "stack",
  dialog: "modal",
  popup: "modal",
  title: "heading",
  h1: "heading (level 1)",
  h2: "heading (level 2)",
  paragraph: "text",
  label: "text",
  caption: "text (size \"sm\", tone \"muted\")",
  textfield: "input",
  "text-input": "input",
  textinput: "input",
  field: "input",
  textarea: "input (kind \"multiline\")",
  search: "input (kind \"search\")",
  dropdown: "select",
  combobox: "select",
  "radio-group": "radio",
  radiogroup: "radio",
  toggle: "checkbox",
  switch: "checkbox",
  navbar: "nav",
  topbar: "nav",
  header: "nav",
  tabs: "nav (kind \"tabs\")",
  sidebar: "nav (kind \"side\")",
  tabbar: "nav (kind \"bottom\")",
  stepper: "steps",
  progress: "steps or loading",
  spinner: "loading",
  banner: "alert",
  toast: "alert",
  notice: "alert",
  error: "alert (tone \"error\")",
  placeholder: "image or skeleton",
  avatar: "image (shape \"circle\")",
  chart: "image (say what it shows in label)",
  icon: "nothing: there are no icons, use words",
  tag: "badge",
  chip: "badge",
  pill: "badge",
  separator: "divider",
  hr: "divider",
  spacer: "gap on the surrounding stack or row",
  "empty-state": "empty",
};

const STYLE_PROPS = new Set([
  "color",
  "colour",
  "background",
  "style",
  "className",
  "class",
  "width",
  "padding",
  "margin",
  "font",
  "fontSize",
  "bold",
  "border",
  "radius",
  "shadow",
  "icon",
]);

const PLACEHOLDER_COPY = /lorem ipsum|dolor sit|placeholder text|text here|your text here|sample text|\btodo\b|\btbd\b/i;
const VAGUE_LABELS = new Set(["submit", "ok", "okay", "click here", "here", "button", "go", "yes", "no", "done"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

function closest(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const d = editDistance(name.toLowerCase(), c.toLowerCase());
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best !== undefined && bestDistance <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined;
}

class Report {
  issues: Issue[] = [];
  errors = 0;

  add(severity: Severity, code: string, message: string, at: { path?: string; frame?: string; fix?: string } = {}): void {
    if (severity === "error") this.errors++;
    const issue: Issue = { severity, code, message };
    if (at.path) issue.path = at.path;
    if (at.frame) issue.frame = at.frame;
    if (at.fix) issue.fix = at.fix;
    this.issues.push(issue);
  }
  error(code: string, message: string, at?: { path?: string; frame?: string; fix?: string }): void {
    this.add("error", code, message, at);
  }
  warn(code: string, message: string, at?: { path?: string; frame?: string; fix?: string }): void {
    this.add("warning", code, message, at);
  }
  info(code: string, message: string, at?: { path?: string; frame?: string; fix?: string }): void {
    this.add("info", code, message, at);
  }
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function sorted(issues: Issue[]): Issue[] {
  return issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => SEVERITY_ORDER[a.issue.severity] - SEVERITY_ORDER[b.issue.severity] || a.i - b.i)
    .map((x) => x.issue);
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function checkKeys(obj: Record<string, unknown>, allowed: string[], path: string, what: string, r: Report): void {
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;
    const near = closest(key, allowed);
    r.error("unknown-field", `Unknown field "${key}" on ${what}.`, {
      path: join(path, key),
      fix: near ? `Did you mean "${near}"? Allowed: ${allowed.join(", ")}.` : `Allowed: ${allowed.join(", ")}.`,
    });
  }
}

function checkData(value: unknown, path: string, what: string, r: Report): void {
  if (!isRecord(value)) {
    r.error("bad-data", `${what} must be an object of variable names to values.`, { path });
    return;
  }
  for (const [key, v] of Object.entries(value)) {
    if (!IDENT.test(key)) {
      r.error("bad-variable", `"${key}" is not a valid variable name.`, {
        path: join(path, key),
        fix: "Use letters, digits and underscores, starting with a letter: planName, seats, agreed.",
      });
    }
    if (!isScalar(v)) {
      r.error("bad-data", `Variable "${key}" must be a string, number or boolean.`, { path: join(path, key) });
    }
  }
}

// ── components ──────────────────────────────────────────────────────────────

function propHint(def: ComponentDef, key: string): string {
  const allowed = [...Object.keys(def.props), ...Object.keys(COMMON_PROPS)];
  const list = `Props of ${def.type}: ${Object.keys(def.props).join(", ") || "none"}.`;
  if (STYLE_PROPS.has(key)) return `There are no styling props or icons: ink is the design. ${list}`;
  if (["onClick", "onPress", "href", "to", "action", "onChange", "click"].includes(key)) {
    return def.props.event ? `Use "event" and add a transition that listens for it. ${list}` : `${def.type} is not clickable. ${list}`;
  }
  if (key === "text" && def.props.label) return `Use "label". ${list}`;
  if ((key === "label" || key === "title" || key === "content" || key === "value") && def.props.text) {
    return `Use "text". ${list}`;
  }
  if (["name", "variable", "field", "model"].includes(key) && def.props.bind) return `Use "bind". ${list}`;
  if (["value", "defaultValue", "checked", "selected"].includes(key) && def.props.bind) {
    return `Set starting values in the flow's "data", keyed by the "bind" variable. ${list}`;
  }
  if (key === "children") return `${def.type} has no children. ${list}`;
  const near = closest(key, allowed);
  return near ? `Did you mean "${near}"? ${list}` : list;
}

interface StateContext {
  frame: string;
  ids: Map<string, string>;
  modals: number;
}

function checkValue(value: unknown, def: PropDef, path: string, r: Report, ctx: StateContext, insideCard: boolean): void {
  const at = { path, frame: ctx.frame };
  const t = def.type;
  switch (t.kind) {
    case "text":
      if (typeof value !== "string") r.error("bad-prop", `Expected text.`, at);
      else if (def.required && !value.trim()) r.error("bad-prop", `This text cannot be empty.`, at);
      break;
    case "name":
      if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
        r.error("bad-prop", `Expected a short name made of letters, digits, "-" and "_".`, at);
      }
      break;
    case "number":
      if (typeof value !== "number" || !Number.isInteger(value) || value < t.min || value > t.max) {
        r.error("bad-prop", `Expected a whole number from ${t.min} to ${t.max}.`, at);
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") r.error("bad-prop", `Expected true or false.`, at);
      break;
    case "enum":
      if (typeof value !== "string" || !t.values.includes(value)) {
        r.error("bad-prop", `Expected one of: ${t.values.join(", ")}.`, at);
      }
      break;
    case "event":
      if (typeof value !== "string" || !EVENT.test(value)) {
        r.error("bad-event", `An event is a short name such as "continue" or "open-invoice".`, at);
      }
      break;
    case "bind":
    case "var":
      if (typeof value !== "string" || !IDENT.test(value)) {
        r.error("bad-variable", `Expected a variable name such as email or planName.`, at);
      }
      break;
    case "strings":
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        r.error("bad-prop", `Expected a list of texts.`, at);
      } else if (def.required && value.length === 0) {
        r.error("bad-prop", `This list cannot be empty.`, at);
      }
      break;
    case "rows":
      if (!Array.isArray(value) || value.some((row) => !Array.isArray(row) || row.some((c) => !isScalar(c)))) {
        r.error("bad-prop", `Expected a list of rows, each a list of cell texts.`, at);
      }
      break;
    case "set":
      checkData(value, path, `"set"`, r);
      break;
    case "children":
      if (!Array.isArray(value)) {
        r.error("bad-prop", `Expected a list of components.`, at);
      } else if (value.length === 0) {
        r.error("bad-prop", `This needs at least one component inside.`, at);
      } else {
        value.forEach((child, i) => checkNode(child, `${path}[${i}]`, r, ctx, false, insideCard));
      }
      break;
    case "items":
      if (!Array.isArray(value)) {
        r.error("bad-prop", `Expected a list of items.`, at);
      } else if (def.required && value.length === 0) {
        r.error("bad-prop", `This list cannot be empty.`, {
          ...at,
          fix: `For no items, draw a separate state that uses the "empty" component.`,
        });
      } else {
        value.forEach((item, i) => checkShape(item, t.shape, `${path}[${i}]`, "item", r, ctx));
      }
      break;
    case "object":
      checkShape(value, t.shape, path, "object", r, ctx);
      break;
  }
}

function checkShape(
  value: unknown,
  shape: Record<string, PropDef>,
  path: string,
  what: string,
  r: Report,
  ctx: StateContext,
): void {
  if (!isRecord(value)) {
    r.error("bad-prop", `Expected an object with: ${Object.keys(shape).join(", ")}.`, { path, frame: ctx.frame });
    return;
  }
  for (const key of Object.keys(value)) {
    const p = shape[key];
    if (!p) {
      const near = closest(key, Object.keys(shape));
      r.error("unknown-prop", `Unknown field "${key}" on this ${what}.`, {
        path: join(path, key),
        frame: ctx.frame,
        fix: near ? `Did you mean "${near}"? Allowed: ${Object.keys(shape).join(", ")}.` : `Allowed: ${Object.keys(shape).join(", ")}.`,
      });
      continue;
    }
    checkValue(value[key], p, join(path, key), r, ctx, false);
  }
  for (const [key, p] of Object.entries(shape)) {
    if (p.required && value[key] === undefined) {
      r.error("missing-prop", `This ${what} needs "${key}".`, { path, frame: ctx.frame, fix: p.doc });
    }
  }
}

function checkNode(
  node: unknown,
  path: string,
  r: Report,
  ctx: StateContext,
  topLevel: boolean,
  insideCard: boolean,
): void {
  const at = { path, frame: ctx.frame };
  if (!isRecord(node)) {
    r.error("bad-component", `Expected a component object such as {"type": "text", "text": "..."}.`, at);
    return;
  }
  const type = node.type;
  if (typeof type !== "string" || !type) {
    r.error("missing-type", `This component has no "type".`, { ...at, fix: `Types: ${COMPONENT_TYPES.join(", ")}.` });
    return;
  }
  const def = componentDef(type);
  if (!def) {
    const alias = COMPONENT_ALIASES[type.toLowerCase()];
    const near = closest(type, COMPONENT_TYPES);
    const hint = alias ? `Use ${alias}.` : near ? `Did you mean "${near}"?` : "";
    r.error("unknown-component", `"${type}" is not in the design system.`, {
      ...at,
      fix: `${hint} Components: ${COMPONENT_TYPES.join(", ")}.`.trim(),
    });
    return;
  }
  if (def.topLevelOnly && !topLevel) {
    r.error("misplaced-component", `A ${type} can only sit directly in a state's layout, not inside another component.`, at);
  }
  if (type === "modal") ctx.modals++;
  if (type === "card" && insideCard) {
    r.warn("nested-card", `A card inside a card. Flatten it, or use a stack or divider inside the outer card.`, at);
  }
  if (typeof node.id === "string") {
    const seen = ctx.ids.get(node.id);
    if (seen) r.error("duplicate-id", `The id "${node.id}" is used twice in this state (also at ${seen}).`, at);
    else ctx.ids.set(node.id, path);
  }

  for (const key of Object.keys(node)) {
    if (key === "type") continue;
    const p = def.props[key] ?? COMMON_PROPS[key];
    if (!p) {
      r.error("unknown-prop", `${type} has no "${key}" prop.`, {
        path: join(path, key),
        frame: ctx.frame,
        fix: propHint(def, key),
      });
      continue;
    }
    checkValue(node[key], p, join(path, key), r, ctx, insideCard || type === "card");
  }
  for (const [key, p] of Object.entries(def.props)) {
    if (p.required && node[key] === undefined) {
      r.error("missing-prop", `${type} needs "${key}".`, { ...at, fix: p.doc });
    }
  }

  if (type === "table" && Array.isArray(node.columns) && Array.isArray(node.rows)) {
    const columns = node.columns.length;
    (node.rows as unknown[]).forEach((row, i) => {
      if (Array.isArray(row) && row.length !== columns) {
        r.error("table-shape", `Row ${i + 1} has ${row.length} cells but the table has ${columns} columns.`, {
          path: `${path}.rows[${i}]`,
          frame: ctx.frame,
        });
      }
    });
  }
  if (type === "steps" && Array.isArray(node.items) && typeof node.current === "number") {
    if (node.current > node.items.length) {
      r.error("steps-range", `"current" is ${node.current} but there are only ${node.items.length} steps.`, at);
    }
  }
}

// ── structure ───────────────────────────────────────────────────────────────

function checkState(state: unknown, path: string, screenId: string, r: Report): void {
  if (!isRecord(state)) {
    r.error("bad-state", `A state must be an object.`, { path });
    return;
  }
  checkKeys(state, STATE_KEYS, path, "a state", r);
  const id = state.id;
  if (typeof id !== "string" || !SLUG.test(id)) {
    r.error("bad-id", `A state needs an "id" in lowercase-with-dashes, such as default, empty or failed.`, { path: join(path, "id") });
    return;
  }
  const frame = `${screenId}.${id}`;
  if (state.note !== undefined && typeof state.note !== "string") {
    r.error("bad-field", `"note" must be text.`, { path: join(path, "note"), frame });
  }
  if (state.end !== undefined && typeof state.end !== "boolean") {
    r.error("bad-field", `"end" must be true or false.`, { path: join(path, "end"), frame });
  }
  if (state.preview !== undefined) checkData(state.preview, join(path, "preview"), `"preview"`, r);
  if (state.questions !== undefined) {
    if (!Array.isArray(state.questions) || state.questions.some((q) => typeof q !== "string" || !q.trim())) {
      r.error("bad-field", `"questions" must be a list of texts.`, { path: join(path, "questions"), frame });
    }
  }
  if (!Array.isArray(state.layout) || state.layout.length === 0) {
    r.error("empty-layout", `State ${frame} needs a "layout" with at least one component.`, { path: join(path, "layout"), frame });
    return;
  }
  const ctx: StateContext = { frame, ids: new Map(), modals: 0 };
  state.layout.forEach((node, i) => checkNode(node, `${path}.layout[${i}]`, r, ctx, true, false));
  if (ctx.modals > 1) {
    r.error("many-modals", `State ${frame} has ${ctx.modals} modals. Draw one modal per state.`, { path: join(path, "layout"), frame });
  }
  if (state.over !== undefined) {
    if (typeof state.over !== "string" || !state.over) {
      r.error("bad-field", `"over" must name a frame, such as "team.default".`, { path: join(path, "over"), frame });
    } else if (state.layout.length !== 1 || !isRecord(state.layout[0]) || state.layout[0].type !== "modal") {
      r.error("over-needs-modal", `State ${frame} uses "over", so its layout must be exactly one modal.`, {
        path: join(path, "layout"),
        frame,
        fix: `"over" draws another frame's page behind this state. Keep only the modal here; the page comes from "${state.over}".`,
      });
    }
  }
}

function checkStructure(input: Record<string, unknown>, r: Report): void {
  checkKeys(input, FLOW_KEYS, "", "the flow", r);

  if (typeof input.name !== "string" || !input.name.trim()) {
    r.error("missing-name", `The flow needs a "name".`, { path: "name" });
  }
  if (input.description !== undefined && typeof input.description !== "string") {
    r.error("bad-field", `"description" must be text.`, { path: "description" });
  }
  if (input.device !== undefined && input.device !== "desktop" && input.device !== "mobile") {
    r.error("bad-field", `"device" must be "desktop" or "mobile".`, { path: "device" });
  }
  if (typeof input.start !== "string" || !input.start) {
    r.error("missing-start", `The flow needs a "start": the frame the prototype opens on, as "screen.state".`, { path: "start" });
  }
  if (input.data !== undefined) checkData(input.data, "data", `"data"`, r);

  if (!Array.isArray(input.screens) || input.screens.length === 0) {
    r.error("no-screens", `The flow needs "screens": a list with at least one screen.`, { path: "screens" });
  } else {
    const screenIds = new Set<string>();
    input.screens.forEach((screen, si) => {
      const path = `screens[${si}]`;
      if (!isRecord(screen)) {
        r.error("bad-screen", `A screen must be an object.`, { path });
        return;
      }
      checkKeys(screen, SCREEN_KEYS, path, "a screen", r);
      const id = screen.id;
      if (typeof id !== "string" || !SLUG.test(id)) {
        r.error("bad-id", `A screen needs an "id" in lowercase-with-dashes, such as billing or invite-member.`, { path: join(path, "id") });
        return;
      }
      if (screenIds.has(id)) r.error("duplicate-id", `Two screens are called "${id}".`, { path: join(path, "id") });
      screenIds.add(id);
      if (screen.title !== undefined && typeof screen.title !== "string") {
        r.error("bad-field", `"title" must be text.`, { path: join(path, "title") });
      }
      if (!Array.isArray(screen.states) || screen.states.length === 0) {
        r.error("no-states", `Screen "${id}" needs "states": a list with at least one state.`, { path: join(path, "states") });
        return;
      }
      const stateIds = new Set<string>();
      screen.states.forEach((state, sti) => {
        const statePath = `${path}.states[${sti}]`;
        if (isRecord(state) && typeof state.id === "string") {
          if (stateIds.has(state.id)) {
            r.error("duplicate-id", `Screen "${id}" has two states called "${state.id}".`, { path: join(statePath, "id") });
          }
          stateIds.add(state.id);
        }
        checkState(state, statePath, id, r);
      });
    });
  }

  if (!Array.isArray(input.transitions)) {
    r.error("no-transitions", `The flow needs "transitions": a list (it can be empty for a single static screen).`, { path: "transitions" });
    return;
  }
  input.transitions.forEach((t, i) => {
    const path = `transitions[${i}]`;
    if (!isRecord(t)) {
      r.error("bad-transition", `A transition must be an object.`, { path });
      return;
    }
    checkKeys(t, TRANSITION_KEYS, path, "a transition", r);
    if (typeof t.from !== "string" || !(t.from === "*" || /^[a-z0-9][a-z0-9-]*\.(\*|[a-z0-9][a-z0-9-]*)$/.test(t.from))) {
      r.error("bad-from", `"from" must be "screen.state", "screen.*" or "*".`, { path: join(path, "from") });
    }
    if (typeof t.to !== "string" || !/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)?$/.test(t.to)) {
      r.error("bad-to", `"to" must be "screen.state", or "screen" for that screen's first state.`, { path: join(path, "to") });
    }
    const hasOn = t.on !== undefined;
    const hasAfter = t.after !== undefined;
    if (hasOn === hasAfter) {
      r.error("bad-trigger", `A transition needs exactly one trigger: "on" (an event) or "after" (milliseconds).`, { path });
    }
    if (hasOn) {
      const on = t.on;
      const ok =
        typeof on === "string" &&
        (on.startsWith("change:") ? IDENT.test(on.slice("change:".length)) : EVENT.test(on));
      if (!ok) {
        r.error("bad-event", `"on" must be an event name such as "continue", or "change:<variable>".`, { path: join(path, "on") });
      }
    }
    if (hasAfter && (typeof t.after !== "number" || !Number.isInteger(t.after) || t.after < 0 || t.after > 60000)) {
      r.error("bad-trigger", `"after" must be a whole number of milliseconds from 0 to 60000.`, { path: join(path, "after") });
    }
    if (t.when !== undefined) {
      if (typeof t.when !== "string") {
        r.error("bad-guard", `"when" must be an expression in a string.`, { path: join(path, "when") });
      } else {
        try {
          parseExpr(t.when);
        } catch (e) {
          const message = e instanceof ExprError ? e.message : String(e);
          r.error("bad-guard", `Cannot read the guard "${t.when}": ${message}.`, {
            path: join(path, "when"),
            fix: `Examples: reason != '', len(password) >= 8, isEmail(email) && agreed.`,
          });
        }
      }
    }
    if (t.set !== undefined) checkData(t.set, join(path, "set"), `"set"`, r);
    if (t.label !== undefined && typeof t.label !== "string") {
      r.error("bad-field", `"label" must be text.`, { path: join(path, "label") });
    }
  });
}

function checkReferences(flow: Flow, r: Report): void {
  const frames = frameRefs(flow);
  const screens = flow.screens.map((s) => s.id);
  const describe = (ref: string): string => {
    const { screen } = splitRef(ref);
    if (!screens.includes(screen)) {
      const near = closest(screen, screens);
      return `There is no screen "${screen}". ${near ? `Did you mean "${near}"? ` : ""}Screens: ${screens.join(", ")}.`;
    }
    const states = flow.screens.find((s) => s.id === screen)!.states.map((s) => s.id);
    return `Screen "${screen}" has these states: ${states.join(", ")}.`;
  };

  if (!resolveRef(flow, flow.start)) {
    r.error("unknown-frame", `"start" points at "${flow.start}", which does not exist.`, { path: "start", fix: describe(flow.start) });
  }
  flow.screens.forEach((screen, si) => {
    screen.states.forEach((state, sti) => {
      if (state.over === undefined) return;
      const frame = `${screen.id}.${state.id}`;
      const path = `screens[${si}].states[${sti}].over`;
      const target = findFrame(flow, state.over);
      if (!target) {
        r.error("unknown-frame", `${frame} is drawn over "${state.over}", which does not exist.`, { path, frame, fix: describe(state.over) });
      } else if (target.state === state) {
        r.error("bad-over", `${frame} is drawn over itself.`, { path, frame, fix: `Point "over" at the frame that holds the page behind this modal.` });
      } else if (target.state.over !== undefined) {
        r.error("bad-over", `${frame} is drawn over ${target.ref}, which is itself drawn over another frame.`, {
          path,
          frame,
          fix: `Point "over" straight at the page: "${target.state.over}".`,
        });
      } else if (target.state.layout.some((node) => isRecord(node) && node.type === "modal")) {
        r.error("bad-over", `${frame} is drawn over ${target.ref}, which has a modal of its own.`, {
          path,
          frame,
          fix: `Point "over" at a frame that is a plain page.`,
        });
      }
    });
  });
  flow.transitions.forEach((t, i) => {
    const path = `transitions[${i}]`;
    if (t.from !== "*") {
      const { screen, state } = splitRef(t.from);
      const exists = state === "*" ? screens.includes(screen) : frames.includes(t.from);
      if (!exists) {
        r.error("unknown-frame", `Transition ${i + 1} starts from "${t.from}", which does not exist.`, {
          path: join(path, "from"),
          fix: describe(t.from),
        });
      }
    }
    if (!resolveRef(flow, t.to)) {
      r.error("unknown-frame", `Transition ${i + 1} goes to "${t.to}", which does not exist.`, {
        path: join(path, "to"),
        fix: describe(t.to),
      });
    }
  });
}

// ── lint ────────────────────────────────────────────────────────────────────

function statePath(flow: Flow, frame: string): string {
  const { screen, state } = splitRef(frame);
  const si = flow.screens.findIndex((s) => s.id === screen);
  const sti = flow.screens[si].states.findIndex((s) => s.id === state);
  return `screens[${si}].states[${sti}]`;
}

function lintDesign(flow: Flow, frame: string, state: FlowState, r: Report): void {
  const base = statePath(flow, frame);
  // Only the layer people can act on counts: the modal when there is one, otherwise the page.
  const layer: FlowNode[] = activeLayer(state.layout);
  const hasTimer = outgoing(flow, frame).some(({ transition }) => transition.after !== undefined);

  let primaries = 0;
  let nodes = 0;
  let controls = 0;
  let hasTitle = false;

  for (const node of pageBehind(flow, state) ?? []) {
    walkNodes([node], (inner) => {
      if (inner.type === "heading" || (inner.type === "nav" && typeof inner.brand === "string")) hasTitle = true;
    });
  }

  walkNodes(layer, (node) => {
    if (node.type === "button" && node.variant === "primary") primaries++;
  });

  walkNodes(state.layout, (node, path) => {
    nodes++;
    const at = { path: `${base}.${path}`, frame };
    const facts = factsOf(node);
    if (facts.events.length || facts.binds.length) controls++;
    if (node.type === "heading") hasTitle = true;
    if (node.type === "modal" && typeof node.title === "string") hasTitle = true;
    if (node.type === "nav" && typeof node.brand === "string") hasTitle = true;

    if (["input", "select", "radio"].includes(node.type) && !(typeof node.label === "string" && node.label.trim())) {
      r.warn("unlabelled-input", `This ${node.type} has no label.`, {
        ...at,
        fix: `Add "label". A placeholder is not a label: it disappears as soon as someone types.`,
      });
    }
    if (node.type === "modal") {
      let exits = 0;
      walkNodes([node], (inner) => {
        exits += factsOf(inner).events.length;
      });
      if (exits === 0 && !hasTimer) {
        r.warn("modal-trap", `This modal has no way out.`, { ...at, fix: `Add a button, such as Cancel or Close, with an event and a transition.` });
      }
    }
    for (const text of facts.texts) {
      if (PLACEHOLDER_COPY.test(text)) {
        r.warn("placeholder-copy", `Placeholder copy: "${text.slice(0, 60)}".`, { ...at, fix: `Write the words the product would really use; they are part of what gets tested.` });
        break;
      }
    }
    for (const fired of facts.events) {
      if (!fired.label) continue;
      const label = fired.label.trim();
      if (VAGUE_LABELS.has(label.toLowerCase())) {
        r.info("vague-label", `"${label}" does not say what happens.`, { ...at, fix: `Name the outcome: "Save changes", "Send invite", "Cancel plan".` });
      } else if (node.type === "button" && label.length > 28) {
        r.info("long-label", `Button label is ${label.length} characters: "${label}".`, { ...at, fix: `Keep buttons to a few words and move the rest into text beside them.` });
      }
    }
  });

  if (primaries > 1) {
    r.warn("one-primary", `${frame} has ${primaries} primary buttons.`, {
      path: `${base}.layout`,
      frame,
      fix: `Keep one primary action per state and make the others "default" or "quiet".`,
    });
  }
  if (!hasTitle) {
    r.info("no-title", `${frame} has no heading, so it is not clear where you are.`, { path: `${base}.layout`, frame, fix: `Add a heading with level 1.` });
  }
  if (nodes > 45 || controls > 14) {
    r.info("dense", `${frame} is dense: ${nodes} components, ${controls} of them interactive.`, { path: `${base}.layout`, frame, fix: `Consider splitting it into steps or moving detail to a second screen.` });
  }
}

function lintFlow(flow: Flow, r: Report): void {
  const frames = frameRefs(flow);
  const known = new Set(Object.keys(initialData(flow)));
  // `everything` is all a frame shows; `facts` is only the layer people can act on.
  const everything = new Map<string, ReturnType<typeof layoutFacts>>();
  const facts = new Map<string, ReturnType<typeof layoutFacts>>();
  for (const frame of frames) {
    const layout = findFrame(flow, frame)!.state.layout;
    everything.set(frame, layoutFacts(layout));
    facts.set(frame, layoutFacts(activeLayer(layout)));
  }

  // Per-frame design rules, plus copy that refers to unknown variables.
  for (const frame of frames) {
    const state = findFrame(flow, frame)!.state;
    lintDesign(flow, frame, state, r);
    const unknown = new Set<string>();
    for (const text of everything.get(frame)!.texts) {
      for (const name of interpolationVariables(text)) if (!known.has(name)) unknown.add(name);
    }
    for (const name of unknown) {
      r.warn("unknown-variable", `${frame} shows {${name}}, but no variable has that name.`, {
        path: statePath(flow, frame),
        frame,
        fix: `Bind an input to "${name}", write it with "set", or give it a value in the flow's "data".`,
      });
    }
  }

  // Guards that read variables nothing defines.
  flow.transitions.forEach((t, i) => {
    if (!t.when) return;
    for (const name of exprVariables(t.when)) {
      if (!known.has(name)) {
        r.warn("unknown-variable", `The guard "${t.when}" reads "${name}", but no variable has that name.`, {
          path: `transitions[${i}].when`,
          fix: `Bind an input to "${name}", write it with "set", or give it a value in the flow's "data".`,
        });
      }
    }
  });

  // Reachability.
  const reached = reachableFrames(flow);
  for (const frame of frames) {
    const state = findFrame(flow, frame)!.state;
    const base = statePath(flow, frame);
    if (!reached.has(frame)) {
      r.warn("unreachable", `Nothing leads to ${frame}.`, { path: base, frame, fix: `Add a transition whose "to" is "${frame}", or remove the state.` });
      continue;
    }
    if (outgoing(flow, frame).length === 0 && !state.end) {
      r.warn("dead-end", `${frame} is a dead end: nothing leads out of it.`, {
        path: base,
        frame,
        fix: `Add a transition from "${frame}", or set "end": true on the state if the flow is meant to finish here.`,
      });
    }
  }

  // Controls that do nothing.
  for (const frame of frames) {
    const fired = new Map<string, string | undefined>();
    for (const e of facts.get(frame)!.events) if (!fired.has(e.event)) fired.set(e.event, e.label);
    const listening = new Set(outgoing(flow, frame).map(({ transition }) => transition.on));
    for (const [event, label] of fired) {
      if (listening.has(event)) continue;
      r.warn("unhandled-event", `${label ? `"${label}"` : `A control`} in ${frame} fires "${event}", but nothing listens for it.`, {
        path: statePath(flow, frame),
        frame,
        fix: `Add a transition {"from": "${frame}", "on": "${event}", "to": ...}.`,
      });
    }
  }

  // Transitions that can never run.
  flow.transitions.forEach((t, i) => {
    if (t.on === undefined) return;
    const sources = frames.filter((f) => fromMatches(t.from, f));
    const path = `transitions[${i}]`;
    if (t.on.startsWith("change:")) {
      const variable = t.on.slice("change:".length);
      if (!sources.some((f) => facts.get(f)!.binds.some((b) => b.variable === variable))) {
        r.warn("never-fires", `Transition ${i + 1} waits for "${t.on}", but no input in ${t.from} is bound to "${variable}".`, { path });
      }
    } else if (!sources.some((f) => facts.get(f)!.events.some((e) => e.event === t.on))) {
      r.warn("never-fires", `Transition ${i + 1} waits for "${t.on}", but nothing in ${t.from} fires it.`, {
        path,
        fix: `Give a button, link or list item in ${t.from} the event "${t.on}", or remove the transition.`,
      });
    }
  });

  // Groups of transitions sharing a source and trigger.
  const groups = new Map<string, { index: number; guarded: boolean }[]>();
  flow.transitions.forEach((t, index) => {
    const key = `${t.from}|${t.on !== undefined ? `on:${t.on}` : `after:${t.after}`}`;
    const list = groups.get(key) ?? [];
    list.push({ index, guarded: Boolean(t.when) });
    groups.set(key, list);
  });
  for (const [key, list] of groups) {
    const firstOpen = list.findIndex((x) => !x.guarded);
    if (firstOpen !== -1 && firstOpen < list.length - 1) {
      for (const later of list.slice(firstOpen + 1)) {
        r.warn("shadowed", `Transition ${later.index + 1} can never run: transition ${list[firstOpen].index + 1} has the same source and trigger and no guard, so it always wins.`, {
          path: `transitions[${later.index}]`,
          fix: `Put guarded transitions first and the unguarded fallback last.`,
        });
      }
    }
    if (firstOpen === -1) {
      const [from, trigger] = key.split("|");
      const first = flow.transitions[list[0].index];
      const covered =
        from !== "*" &&
        !from.endsWith(".*") &&
        outgoing(flow, from).some(
          ({ transition }) =>
            !transition.when &&
            ((first.on !== undefined && transition.on === first.on) ||
              (first.after !== undefined && transition.after !== undefined)),
        );
      if (covered) continue;
      if (trigger.startsWith("after:")) {
        r.warn("timer-no-fallback", `Every timed transition out of ${from} is guarded, so the prototype can get stuck there.`, {
          path: `transitions[${list[0].index}]`,
          fix: `Add a last timed transition with no "when" as the fallback.`,
        });
      } else if (!trigger.startsWith("on:change:")) {
        r.info("guard-no-fallback", `From ${from}, "${first.on}" does nothing when its guard${list.length > 1 ? "s fail" : " fails"}.`, {
          path: `transitions[${list[0].index}]`,
          fix: `If that is a validation failure, add an unguarded transition to an invalid state that explains what is wrong.`,
        });
      }
    }
  }

  // Async steps need more than one outcome.
  for (const frame of frames) {
    if (!reached.has(frame)) continue;
    const timed = outgoing(flow, frame).filter(({ transition }) => transition.after !== undefined);
    const hasLoading = everything.get(frame)!.types.has("loading");
    const base = statePath(flow, frame);
    if (hasLoading && timed.length === 0 && outgoing(flow, frame).length > 0) {
      r.warn("loading-never-ends", `${frame} shows a loading indicator but never finishes by itself.`, { path: base, frame, fix: `Add "after" transitions for each outcome.` });
    }
    if (timed.length > 0) {
      const targets = new Set(timed.map(({ transition }) => resolveRef(flow, transition.to)));
      if (targets.size < 2 && hasLoading) {
        r.warn("no-failure-path", `${frame} only ever succeeds.`, {
          path: base,
          frame,
          fix: `Add a guarded "after" transition to a failed state (for example "when": "simulateFailure", with simulateFailure: false in the flow's "data") before the success one.`,
        });
      }
    }
  }

  // A page copied behind a modal goes stale as soon as the page changes.
  const pages = new Map<string, string>();
  for (const frame of frames) {
    const state = findFrame(flow, frame)!.state;
    if (state.over !== undefined || state.layout.some((node) => node.type === "modal")) continue;
    const key = JSON.stringify(state.layout);
    if (!pages.has(key)) pages.set(key, frame);
  }
  for (const frame of frames) {
    const state = findFrame(flow, frame)!.state;
    if (state.over !== undefined) continue;
    const behind = state.layout.filter((node) => node.type !== "modal");
    if (behind.length === state.layout.length || behind.length === 0) continue;
    const same = pages.get(JSON.stringify(behind));
    if (!same) continue;
    r.info("repeated-page", `${frame} repeats the page of ${same} behind its modal.`, {
      path: statePath(flow, frame),
      frame,
      fix: `Set "over": "${same}" on this state and keep only the modal in its layout, so the page is written once.`,
    });
  }

  // Screen-level gaps.
  flow.screens.forEach((screen, si) => {
    const types = new Set<string>();
    let listsThings = false;
    let showsError = false;
    for (const state of screen.states) {
      walkNodes(activeLayer(state.layout), (node) => {
        types.add(node.type);
        if (node.type === "table") listsThings = true;
        if (node.type === "list" && factsOf(node).events.length > 0) listsThings = true;
        if (node.type === "input" && typeof node.error === "string") showsError = true;
        if ((node.type === "alert" || node.type === "text") && node.tone === "error") showsError = true;
      });
    }
    const first = `${screen.id}.${screen.states[0].id}`;
    if (listsThings && !types.has("empty")) {
      r.info("no-empty-state", `Screen "${screen.id}" lists things but has no empty state.`, {
        path: `screens[${si}]`,
        frame: first,
        fix: `Add a state that uses the "empty" component for when there is nothing to list.`,
      });
    }
    const hasForm = ["input", "select", "radio"].some((t) => types.has(t)) && types.has("button");
    if (hasForm && !showsError) {
      r.info("no-invalid-state", `Screen "${screen.id}" collects input but never shows a validation error.`, {
        path: `screens[${si}]`,
        frame: first,
        fix: `Add an invalid state: the same form with "error" on the field that is wrong.`,
      });
    }
  });
}

// ── public API ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  /** Present when there are no errors. */
  flow?: Flow;
  issues: Issue[];
}

/** Check a spec against the design system and lint the flow. */
export function validateFlow(input: unknown): ValidationResult {
  const r = new Report();
  if (!isRecord(input)) {
    r.error("not-an-object", "A flow must be a JSON object.");
    return { issues: r.issues };
  }
  checkStructure(input, r);
  if (r.errors > 0) return { issues: sorted(r.issues) };

  const flow = input as unknown as Flow;
  checkReferences(flow, r);
  if (r.errors > 0) return { issues: sorted(r.issues) };

  lintFlow(flow, r);
  return { flow, issues: sorted(r.issues) };
}

export function countIssues(issues: Issue[]): { errors: number; warnings: number; infos: number } {
  return {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    infos: issues.filter((i) => i.severity === "info").length,
  };
}

/** One readable line per issue, for agents and logs. */
export function formatIssue(issue: Issue): string {
  const where = issue.frame ?? issue.path;
  const head = `${issue.severity} [${issue.code}]${where ? ` ${where}` : ""}: ${issue.message}`;
  const detail = issue.frame && issue.path ? ` (${issue.path})` : "";
  return issue.fix ? `${head}${detail} → ${issue.fix}` : `${head}${detail}`;
}
