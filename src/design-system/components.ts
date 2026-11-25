// The component registry: everything an agent is allowed to draw with.
// The validator, the agent reference, the React kit and the style-guide page
// all read this one list, so they cannot drift apart.

import type { Data, FlowNode } from "../shared/types";

export type PropType =
  | { kind: "text" } // shown to people; supports {variable} interpolation
  | { kind: "name" } // a plain identifier-like string, never shown
  | { kind: "number"; min: number; max: number }
  | { kind: "boolean" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "event" } // an event name that transitions listen for
  | { kind: "bind" } // two-way bound variable; also fires "change:<variable>"
  | { kind: "var" } // a variable the component writes to
  | { kind: "strings" } // string[]
  | { kind: "rows" } // string[][]
  | { kind: "set" } // { variable: value }
  | { kind: "children" } // nested components
  | { kind: "items"; shape: Record<string, PropDef> } // array of objects
  | { kind: "object"; shape: Record<string, PropDef> }; // one nested object

export interface PropDef {
  type: PropType;
  required?: boolean;
  default?: string | number | boolean;
  doc: string;
}

export type ComponentGroup =
  | "Layout"
  | "Text"
  | "Actions"
  | "Inputs"
  | "Data"
  | "Navigation"
  | "Feedback";

export interface ComponentDef {
  type: string;
  group: ComponentGroup;
  summary: string;
  props: Record<string, PropDef>;
  /** Usage rules, written for whoever is composing a screen. */
  rules: string[];
  /** Only valid directly in a state's `layout`, not nested. */
  topLevelOnly?: boolean;
  /** A valid instance, drawn on the style-guide page and checked by tests. */
  example: FlowNode;
}

// ── prop builders ───────────────────────────────────────────────────────────

const text = (doc: string, required = false): PropDef => ({ type: { kind: "text" }, required, doc });
const bool = (doc: string): PropDef => ({ type: { kind: "boolean" }, default: false, doc });
const num = (doc: string, min: number, max: number, def?: number, required = false): PropDef => ({
  type: { kind: "number", min, max },
  default: def,
  required,
  doc,
});
const oneOf = (values: readonly string[], doc: string, def: string = values[0]): PropDef => ({
  type: { kind: "enum", values },
  default: def,
  doc,
});
const event = (doc: string, required = false): PropDef => ({ type: { kind: "event" }, required, doc });
const bind = (doc: string): PropDef => ({ type: { kind: "bind" }, required: true, doc });
const strings = (doc: string): PropDef => ({ type: { kind: "strings" }, required: true, doc });
const children = (doc = "Components inside, top to bottom."): PropDef => ({
  type: { kind: "children" },
  required: true,
  doc,
});
const setProp = (): PropDef => ({
  type: { kind: "set" },
  doc: "Variables to write when the event fires, before transitions are checked.",
});
const action = (doc: string): PropDef => ({
  type: {
    kind: "object",
    shape: {
      label: text("Button label.", true),
      event: event("Event fired on click.", true),
    },
  },
  doc,
});

/** Props every component accepts. */
export const COMMON_PROPS: Record<string, PropDef> = {
  id: { type: { kind: "name" }, doc: "Optional stable name for this component, so it can be referred to later." },
  grow: num("Inside a `row`: share of the spare width this child takes.", 1, 12),
};

// ── the components ──────────────────────────────────────────────────────────

export const COMPONENTS: ComponentDef[] = [
  // Layout
  {
    type: "stack",
    group: "Layout",
    summary: "Vertical group. A state's layout is already a stack; use this to group things inside a row or card.",
    props: {
      children: children(),
      gap: oneOf(["md", "sm", "lg"], "Space between children."),
      align: oneOf(["stretch", "start", "center", "end"], "Horizontal alignment of children.", "stretch"),
    },
    rules: [],
    example: {
      type: "stack",
      gap: "sm",
      children: [
        { type: "heading", level: 3, text: "Billing address" },
        { type: "text", text: "221B Baker Street, London" },
        { type: "link", text: "Change address", event: "edit-address" },
      ],
    },
  },
  {
    type: "row",
    group: "Layout",
    summary: "Horizontal group. Children sit side by side; give one `grow` to take the spare width.",
    props: {
      children: children("Components inside, left to right."),
      gap: oneOf(["md", "sm", "lg"], "Space between children."),
      align: oneOf(["center", "start", "end"], "Vertical alignment of children.", "center"),
      justify: oneOf(["start", "center", "end", "between"], "How children spread across the width.", "start"),
      wrap: bool("Let children wrap onto a second line when they do not fit."),
    },
    rules: ["Put the main action last in a row of buttons."],
    example: {
      type: "row",
      justify: "between",
      children: [
        { type: "heading", level: 3, text: "Team members" },
        { type: "button", label: "Invite someone", event: "invite", variant: "primary" },
      ],
    },
  },
  {
    type: "card",
    group: "Layout",
    summary: "Outlined box that groups related content.",
    props: {
      title: text("Heading drawn at the top of the card."),
      children: children(),
    },
    rules: ["Do not put a card inside a card."],
    example: {
      type: "card",
      title: "Current plan",
      children: [
        { type: "text", text: "Pro, billed monthly" },
        { type: "text", text: "Renews on 14 January", tone: "muted", size: "sm" },
      ],
    },
  },
  {
    type: "divider",
    group: "Layout",
    summary: "Ruled line between two groups.",
    props: {},
    rules: [],
    example: { type: "divider" },
  },
  {
    type: "modal",
    group: "Layout",
    summary: "Dialog drawn over the rest of the state. For confirmations and short forms.",
    props: {
      title: text("Dialog heading."),
      children: children(),
    },
    rules: [
      "Only directly in a state's layout, and at most one per state.",
      "When the page behind it already exists as a state, set \"over\": \"screen.state\" on this state and put only the modal in its layout. The page is then written once and drawn behind every modal over it.",
      "Without \"over\", the rest of the layout is the page behind it.",
      "Always give a way out: a Cancel or Close action.",
    ],
    topLevelOnly: true,
    example: {
      type: "modal",
      title: "Remove Dana from the team?",
      children: [
        { type: "text", text: "Dana will lose access to every project straight away." },
        {
          type: "row",
          justify: "end",
          children: [
            { type: "button", label: "Keep Dana", event: "close" },
            { type: "button", label: "Remove from team", event: "remove", variant: "danger" },
          ],
        },
      ],
    },
  },

  // Text
  {
    type: "heading",
    group: "Text",
    summary: "Title of a screen or a section.",
    props: {
      text: text("The heading.", true),
      level: num("1 for the screen title, 2 and 3 for sections.", 1, 3, 2),
    },
    rules: ["One level-1 heading per state, so people know where they are."],
    example: { type: "heading", level: 1, text: "Plan and billing" },
  },
  {
    type: "text",
    group: "Text",
    summary: "A sentence or short paragraph.",
    props: {
      text: text("The copy.", true),
      tone: oneOf(["default", "muted", "error"], "Muted is drawn in pencil, error in red pencil.", "default"),
      size: oneOf(["md", "sm"], "Small is for captions and fine print.", "md"),
      align: oneOf(["start", "center"], "Text alignment.", "start"),
    },
    rules: ["Write the real sentence. No lorem ipsum."],
    example: { type: "text", text: "You will keep access until the end of this billing period." },
  },
  {
    type: "link",
    group: "Text",
    summary: "A low-emphasis action drawn as underlined text.",
    props: {
      text: text("The link text.", true),
      event: event("Event fired on click.", true),
      set: setProp(),
    },
    rules: [],
    example: { type: "link", text: "Compare plans", event: "compare" },
  },

  // Actions
  {
    type: "button",
    group: "Actions",
    summary: "The thing people press to move the flow forward.",
    props: {
      label: text("What pressing it does, in a few words.", true),
      event: event("Event fired on click.", true),
      variant: oneOf(
        ["default", "primary", "danger", "quiet"],
        "primary is filled with ink; danger is drawn in red; quiet has no outline.",
        "default",
      ),
      disabled: bool("Drawn in pencil and not clickable."),
      full: bool("Stretch to the full width of its container."),
      set: setProp(),
    },
    rules: [
      "At most one primary button per state.",
      "The label says what happens: \"Save changes\", not \"Submit\" or \"OK\".",
      "Use danger only for destructive actions, and confirm them in a modal or a following state.",
    ],
    example: { type: "button", label: "Save changes", event: "save", variant: "primary" },
  },

  // Inputs
  {
    type: "input",
    group: "Inputs",
    summary: "Text field. What is typed is stored in a variable.",
    props: {
      bind: bind("Variable that holds the typed value."),
      label: text("Label above the field."),
      placeholder: text("Pencilled example of what to type."),
      kind: oneOf(["text", "email", "password", "number", "search", "multiline"], "Field type.", "text"),
      hint: text("Help text under the field."),
      error: text("Validation message under the field, in red. Only in an invalid state."),
    },
    rules: [
      "Always give a label. A placeholder is not a label.",
      "Show validation by adding `error` in a separate `invalid` state.",
    ],
    example: {
      type: "input",
      bind: "exampleEmail",
      label: "Work email",
      placeholder: "you@company.com",
      kind: "email",
      hint: "We send the invite here.",
    },
  },
  {
    type: "select",
    group: "Inputs",
    summary: "Pick one from a dropdown. For five or more options; fewer reads better as a radio group.",
    props: {
      bind: bind("Variable that holds the chosen option."),
      label: text("Label above the field."),
      options: strings("The choices, in order."),
      placeholder: text("Shown while nothing is chosen."),
    },
    rules: ["Always give a label."],
    example: {
      type: "select",
      bind: "exampleRole",
      label: "Role",
      options: ["Viewer", "Editor", "Admin", "Billing", "Owner"],
      placeholder: "Choose a role",
    },
  },
  {
    type: "radio",
    group: "Inputs",
    summary: "Pick one from a short visible list.",
    props: {
      bind: bind("Variable that holds the chosen option."),
      label: text("Question or label above the options."),
      options: strings("The choices, in order."),
    },
    rules: ["Always give a label."],
    example: {
      type: "radio",
      bind: "exampleReason",
      label: "Why are you leaving?",
      options: ["Too expensive", "Missing a feature", "Something else"],
    },
  },
  {
    type: "checkbox",
    group: "Inputs",
    summary: "A single yes or no.",
    props: {
      bind: bind("Variable that holds true or false."),
      label: text("What ticking the box means.", true),
    },
    rules: [],
    example: { type: "checkbox", bind: "exampleDigest", label: "Email me a weekly summary" },
  },

  // Data
  {
    type: "list",
    group: "Data",
    summary: "Rows of items. A row with an `event` is clickable.",
    props: {
      items: {
        type: {
          kind: "items",
          shape: {
            title: text("Main line.", true),
            subtitle: text("Second line, in pencil."),
            meta: text("Short text at the right edge, such as a status or date."),
            event: event("Event fired when the row is clicked."),
            set: setProp(),
          },
        },
        required: true,
        doc: "The rows.",
      },
    },
    rules: ["For no items, draw a separate state that uses `empty`."],
    example: {
      type: "list",
      items: [
        { title: "Dana Whitfield", subtitle: "dana@northwind.co", meta: "Admin", event: "open-member" },
        { title: "Sam Okafor", subtitle: "sam@northwind.co", meta: "Editor", event: "open-member" },
        { title: "Lena Fischer", subtitle: "lena@northwind.co", meta: "Invited", event: "open-member" },
      ],
    },
  },
  {
    type: "table",
    group: "Data",
    summary: "Rows and columns of text.",
    props: {
      columns: strings("Column headings."),
      rows: { type: { kind: "rows" }, required: true, doc: "One array of cell texts per row, matching the columns." },
      rowEvent: event("Event fired when a row is clicked."),
      rowBind: { type: { kind: "var" }, doc: "Variable that receives the first cell of the clicked row." },
    },
    rules: [
      "Every row has one cell per column.",
      "For no rows, draw a separate state that uses `empty`.",
    ],
    example: {
      type: "table",
      columns: ["Invoice", "Date", "Amount", "Status"],
      rows: [
        ["INV-1042", "14 Dec", "$29.00", "Paid"],
        ["INV-1031", "14 Nov", "$29.00", "Paid"],
        ["INV-1019", "14 Oct", "$29.00", "Refunded"],
      ],
      rowEvent: "open-invoice",
      rowBind: "exampleInvoice",
    },
  },
  {
    type: "image",
    group: "Data",
    summary: "Stand-in for a picture, chart, map or avatar, drawn as a crossed box.",
    props: {
      label: text("What the real thing would show."),
      height: num("Height in px.", 40, 600, 140),
      shape: oneOf(["box", "circle"], "Circle is for avatars.", "box"),
    },
    rules: ["Say what it stands for in `label`."],
    example: { type: "image", label: "Usage chart, last 30 days", height: 120 },
  },
  {
    type: "badge",
    group: "Data",
    summary: "Small outlined tag for a status or count.",
    props: {
      text: text("One or two words.", true),
      tone: oneOf(["default", "muted", "error"], "Muted is drawn in pencil, error in red pencil.", "default"),
    },
    rules: [],
    example: { type: "badge", text: "Past due", tone: "error" },
  },

  // Navigation
  {
    type: "nav",
    group: "Navigation",
    summary: "App-level navigation: a top bar, tabs, a sidebar or a bottom bar.",
    props: {
      brand: text("Product or section name."),
      items: {
        type: {
          kind: "items",
          shape: {
            label: text("Destination name.", true),
            event: event("Event fired on click."),
            active: bool("Marks where the person is now."),
          },
        },
        required: true,
        doc: "The destinations.",
      },
      kind: oneOf(["top", "tabs", "side", "bottom"], "Where and how it is drawn.", "top"),
    },
    rules: [
      "Mark the current item `active`.",
      "Handle nav events with a transition from \"*\", so they work from every state.",
      "A `side` nav goes inside a `row`, next to a `stack` with `grow`.",
    ],
    example: {
      type: "nav",
      brand: "Northwind",
      items: [
        { label: "Projects", event: "nav-projects" },
        { label: "Team", event: "nav-team", active: true },
        { label: "Billing", event: "nav-billing" },
      ],
    },
  },
  {
    type: "steps",
    group: "Navigation",
    summary: "Progress through a multi-step flow.",
    props: {
      items: strings("Name of each step."),
      current: num("The step the person is on, counting from 1.", 1, 12, undefined, true),
    },
    rules: ["Use the same `items` on every screen of the flow."],
    example: { type: "steps", items: ["Reason", "Offer", "Confirm"], current: 2 },
  },

  // Feedback
  {
    type: "alert",
    group: "Feedback",
    summary: "Message about something that happened or needs attention.",
    props: {
      text: text("What happened and what to do next.", true),
      tone: oneOf(["info", "success", "warning", "error"], "Error is drawn in red pencil.", "info"),
      action: action("Optional button inside the alert, such as Try again."),
    },
    rules: ["An error says what went wrong and how to fix it, and offers the next step."],
    example: {
      type: "alert",
      tone: "error",
      text: "We could not reach the billing provider. Your plan has not changed.",
      action: { label: "Try again", event: "retry" },
    },
  },
  {
    type: "loading",
    group: "Feedback",
    summary: "Something is in progress.",
    props: {
      text: text("What is happening."),
    },
    rules: ["Give the state an `after` transition for each outcome, including the failure."],
    example: { type: "loading", text: "Cancelling your plan" },
  },
  {
    type: "skeleton",
    group: "Feedback",
    summary: "Pencilled placeholder lines while content loads.",
    props: {
      lines: num("How many lines.", 1, 8, 3),
    },
    rules: [],
    example: { type: "skeleton", lines: 3 },
  },
  {
    type: "empty",
    group: "Feedback",
    summary: "Empty state: says what will be here and offers the first action.",
    props: {
      title: text("What is missing.", true),
      text: text("One line on how to fill it."),
      action: action("The first thing to do."),
    },
    rules: ["An empty screen is an invitation to act: include the `action` when there is one."],
    example: {
      type: "empty",
      title: "No one on the team yet",
      text: "Invite a teammate to share projects with them.",
      action: { label: "Invite someone", event: "invite" },
    },
  },
];

export const GROUPS: ComponentGroup[] = ["Layout", "Text", "Actions", "Inputs", "Data", "Navigation", "Feedback"];

export const COMPONENT_TYPES = COMPONENTS.map((c) => c.type);

const BY_TYPE = new Map(COMPONENTS.map((c) => [c.type, c]));

export function componentDef(type: string): ComponentDef | undefined {
  return BY_TYPE.get(type);
}

export function propDef(def: ComponentDef, prop: string): PropDef | undefined {
  return def.props[prop] ?? COMMON_PROPS[prop];
}

// ── reading a node through the registry ─────────────────────────────────────

export interface FiredEvent {
  event: string;
  set?: Data;
  /** The label on the thing that fires it, when it has one. */
  label?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Nested components of a node, with the prop and index they sit at. */
export function childrenOf(node: FlowNode): { prop: string; index: number; node: FlowNode }[] {
  const def = BY_TYPE.get(node.type);
  if (!def) return [];
  const out: { prop: string; index: number; node: FlowNode }[] = [];
  for (const [prop, p] of Object.entries(def.props)) {
    if (p.type.kind !== "children") continue;
    const value = node[prop];
    if (!Array.isArray(value)) continue;
    value.forEach((child, index) => {
      if (isRecord(child) && typeof child.type === "string") out.push({ prop, index, node: child as FlowNode });
    });
  }
  return out;
}

/** Visit every node in a layout, depth first. Paths look like "layout[2].children[0]". */
export function walkNodes(
  nodes: FlowNode[],
  visit: (node: FlowNode, path: string, depth: number) => void,
  base = "layout",
  depth = 0,
): void {
  nodes.forEach((node, i) => {
    if (!isRecord(node)) return;
    visitNode(node as FlowNode, `${base}[${i}]`, depth, visit);
  });
}

function visitNode(
  node: FlowNode,
  path: string,
  depth: number,
  visit: (node: FlowNode, path: string, depth: number) => void,
): void {
  visit(node, path, depth);
  for (const child of childrenOf(node)) {
    visitNode(child.node, `${path}.${child.prop}[${child.index}]`, depth + 1, visit);
  }
}

function labelOf(obj: Record<string, unknown>): string | undefined {
  for (const key of ["label", "text", "title"]) {
    if (typeof obj[key] === "string") return obj[key] as string;
  }
  return undefined;
}

function collectFrom(
  obj: Record<string, unknown>,
  shape: Record<string, PropDef>,
  events: FiredEvent[],
  binds: { variable: string; boolean: boolean }[],
  writes: string[],
  texts: string[],
  isCheckbox: boolean,
): void {
  const set = isRecord(obj.set) ? (obj.set as Data) : undefined;
  for (const [prop, p] of Object.entries(shape)) {
    const value = obj[prop];
    if (value === undefined) continue;
    switch (p.type.kind) {
      case "event":
        if (typeof value === "string" && value) events.push({ event: value, set, label: labelOf(obj) });
        break;
      case "bind":
        if (typeof value === "string" && value) binds.push({ variable: value, boolean: isCheckbox });
        break;
      case "var":
        if (typeof value === "string" && value) writes.push(value);
        break;
      case "text":
        if (typeof value === "string") texts.push(value);
        break;
      case "strings":
        if (Array.isArray(value)) for (const s of value) if (typeof s === "string") texts.push(s);
        break;
      case "rows":
        if (Array.isArray(value))
          for (const row of value) if (Array.isArray(row)) for (const s of row) if (typeof s === "string") texts.push(s);
        break;
      case "set":
        if (isRecord(value)) writes.push(...Object.keys(value));
        break;
      case "items":
        if (Array.isArray(value))
          for (const item of value)
            if (isRecord(item)) collectFrom(item, p.type.shape, events, binds, writes, texts, false);
        break;
      case "object":
        if (isRecord(value)) collectFrom(value, p.type.shape, events, binds, writes, texts, false);
        break;
      default:
        break;
    }
  }
}

export interface NodeFacts {
  /** Events this node can fire, not counting its nested components. */
  events: FiredEvent[];
  /** Variables it is bound to. Each also fires "change:<variable>". */
  binds: { variable: string; boolean: boolean }[];
  /** Variables it writes without being bound to them. */
  writes: string[];
  /** Every piece of copy it shows. */
  texts: string[];
}

/** What a single node fires, binds, writes and says. Nested components are not included. */
export function factsOf(node: FlowNode): NodeFacts {
  const facts: NodeFacts = { events: [], binds: [], writes: [], texts: [] };
  const def = BY_TYPE.get(node.type);
  if (!def) return facts;
  collectFrom(node, def.props, facts.events, facts.binds, facts.writes, facts.texts, node.type === "checkbox");
  // A disabled control cannot be pressed, so it fires nothing.
  if (node.disabled === true) facts.events = [];
  return facts;
}

/** Facts for a whole layout, including nested components. */
export function layoutFacts(layout: FlowNode[]): NodeFacts & { types: Set<string> } {
  const all: NodeFacts & { types: Set<string> } = { events: [], binds: [], writes: [], texts: [], types: new Set() };
  walkNodes(layout, (node) => {
    all.types.add(node.type);
    const f = factsOf(node);
    all.events.push(...f.events);
    all.binds.push(...f.binds);
    all.writes.push(...f.writes);
    all.texts.push(...f.texts);
  });
  return all;
}
