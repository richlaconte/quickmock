// The flow spec: one file that both the board and the prototype are drawn from.

export type Scalar = string | number | boolean;
export type Data = Record<string, Scalar>;

/** A component instance. `type` must be a component from the design system. */
export interface FlowNode {
  type: string;
  id?: string;
  grow?: number;
  [prop: string]: unknown;
}

export interface FlowState {
  id: string;
  /** One line saying what this state is for. Shown under its frame. */
  note?: string;
  /** Marks an intended end of the flow, so lint does not call it a dead end. */
  end?: boolean;
  /** Data applied when this state is shown directly (board frames, jumps). */
  preview?: Data;
  /** Open questions and assumptions, drawn as margin notes. */
  questions?: string[];
  /**
   * For a modal state: the frame whose page is drawn behind the modal. The
   * layout then holds only the modal, so the page is written once.
   */
  over?: string;
  layout: FlowNode[];
}

export interface FlowScreen {
  id: string;
  title?: string;
  states: FlowState[];
}

export interface FlowTransition {
  /** "screen.state", "screen.*" (any state of a screen) or "*" (anywhere). */
  from: string;
  /** Event name fired by a component, or "change:<variable>". */
  on?: string;
  /** Milliseconds; fires by itself after the state is entered. */
  after?: number;
  /** Guard expression over the flow's data. */
  when?: string;
  /** Data to write when the transition runs. */
  set?: Data;
  /** "screen.state", or "screen" for that screen's first state. */
  to: string;
  /** Overrides the arrow label on the board. */
  label?: string;
}

export type Device = "desktop" | "mobile";

export interface Flow {
  name: string;
  description?: string;
  device?: Device;
  /** Where the prototype starts: "screen.state" or "screen". */
  start: string;
  /** Initial values for variables that are not bound to an input. */
  data?: Data;
  screens: FlowScreen[];
  transitions: FlowTransition[];
}

export type Severity = "error" | "warning" | "info";

export interface Issue {
  severity: Severity;
  /** Stable rule id, e.g. "dead-end". */
  code: string;
  message: string;
  /** Where in the spec, e.g. "screens[1].states[0].layout[2]". */
  path?: string;
  /** The frame it belongs to, e.g. "reason.default". */
  frame?: string;
  /** What to do about it. */
  fix?: string;
}

export interface FlowMeta {
  rev: number;
  updatedAt: string;
  lastChange?: {
    summary: string;
    added: string[];
    changed: string[];
    removed: string[];
    at: string;
  };
}

export interface FlowSummary {
  id: string;
  name: string;
  description?: string;
  device: Device;
  rev: number;
  updatedAt: string;
  screens: number;
  states: number;
  transitions: number;
  errors: number;
  warnings: number;
}

export interface FlowPayload {
  id: string;
  spec: Flow;
  meta: FlowMeta;
  issues: Issue[];
}

/**
 * A note the person wrote in the viewer, about a frame or about one component
 * on it. Notes are kept beside the flows, not inside them, so an agent that
 * rewrites a state cannot lose them.
 */
export interface ReviewNote {
  /** Short and stable, so an agent can refer to it: "n1", "n2" and so on. */
  id: string;
  /** The frame it is about, as "screen.state". */
  frame: string;
  /** The component it is about, when the person pointed at one. */
  target?: { path: string; type: string; summary?: string };
  /**
   * Set for a sticky note: where it sits on the board, as an offset from the
   * top-left corner of its frame, in board units. It follows that frame when
   * the board is laid out again.
   */
  sticky?: { dx: number; dy: number };
  text: string;
  /** Who wrote it, as they named themselves in the viewer. */
  author?: string;
  /** True when it came in over the share link, not from the workspace's owner. */
  guest?: boolean;
  at: string;
  /** Set once the note has been dealt with, by the person or by an agent. */
  done?: { at: string; by: "person" | "agent"; reply?: string };
}

/** Who a viewer is to a workspace: the person who made it, or someone who opened the share link. */
export type Role = "owner" | "guest";

/** Someone who has the viewer open right now. */
export interface Person {
  /** Public id, given out by the server. */
  pid: string;
  name: string;
  /** Their pencil colour, as everyone else sees it. */
  color: string;
  guest: boolean;
  /** The flow they have open, if any. */
  flowId?: string;
  /** The frame their prototype is on. */
  frame?: string;
}

/** Sharing: whether other people can open this workspace, and the link that lets them. */
export interface ShareStatus {
  on: boolean;
  /** The guest link, while sharing is on. */
  link?: string;
}

/** Whether the owner's agent has been in touch: when it last used the workspace's key. */
export interface AgentStatus {
  lastSeen?: string;
}

/** What the server pushes to every open viewer. */
export type ServerEvent =
  | { type: "flow"; id?: string; rev?: number }
  | { type: "list" }
  | { type: "notes"; id: string }
  | { type: "share" }
  /** The owner's agent made a request after being quiet. Owners only. */
  | { type: "agent" }
  | { type: "hello"; you: string; role: Role; people: Person[]; cursors: { pid: string; x: number; y: number }[] }
  | { type: "person"; person: Person }
  | { type: "left"; pid: string }
  /** Someone's pointer on the board, in board units. No position means it left the board. */
  | { type: "cursor"; pid: string; x?: number; y?: number };

/** What the person is looking at in the viewer, so an agent can resolve "this". */
export interface ViewState {
  flowId: string;
  selectedFrame?: string;
  selectedNode?: { frame: string; path: string; type: string; summary: string };
  prototype?: { current: string; path: string[]; data: Data };
  at: string;
}
