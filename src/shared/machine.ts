// The state machine behind a flow. Pure functions, used by the server (lint)
// and by the viewer (running the prototype), so both agree on what happens.

import { layoutFacts, walkNodes, factsOf } from "../design-system/components";
import { passes } from "./expr";
import type { Data, Flow, FlowNode, FlowScreen, FlowState, FlowTransition } from "./types";

/** What people can act on: the modal when a state has one, otherwise the whole layout. */
export function activeLayer(layout: FlowNode[]): FlowNode[] {
  const modal = layout.find((node) => node.type === "modal");
  return modal ? [modal] : layout;
}

export function splitRef(ref: string): { screen: string; state?: string } {
  const dot = ref.indexOf(".");
  if (dot === -1) return { screen: ref };
  return { screen: ref.slice(0, dot), state: ref.slice(dot + 1) };
}

/** Every frame in the flow as "screen.state", in spec order. */
export function frameRefs(flow: Flow): string[] {
  return flow.screens.flatMap((screen) => screen.states.map((state) => `${screen.id}.${state.id}`));
}

/** Normalise "screen" or "screen.state" to "screen.state". Undefined when it does not exist. */
export function resolveRef(flow: Flow, ref: string): string | undefined {
  const { screen, state } = splitRef(ref);
  const found = flow.screens.find((s) => s.id === screen);
  if (!found || found.states.length === 0) return undefined;
  if (state === undefined) return `${found.id}.${found.states[0].id}`;
  return found.states.some((s) => s.id === state) ? `${found.id}.${state}` : undefined;
}

export function findFrame(
  flow: Flow,
  ref: string,
): { screen: FlowScreen; state: FlowState; ref: string } | undefined {
  const full = resolveRef(flow, ref);
  if (!full) return undefined;
  const { screen: screenId, state: stateId } = splitRef(full);
  const screen = flow.screens.find((s) => s.id === screenId)!;
  const state = screen.states.find((s) => s.id === stateId)!;
  return { screen, state, ref: full };
}

/**
 * The page drawn behind a state that uses `over`: the layout of the frame it
 * names, without any modal of its own. Undefined for a state that stands alone.
 */
export function pageBehind(flow: Flow, state: FlowState): FlowNode[] | undefined {
  if (typeof state.over !== "string") return undefined;
  const base = findFrame(flow, state.over);
  if (!base || base.state === state) return undefined;
  return base.state.layout.filter((node) => node.type !== "modal");
}

/** Does a transition's `from` cover this frame? */
export function fromMatches(from: string, current: string): boolean {
  if (from === "*") return true;
  if (from.endsWith(".*")) return splitRef(current).screen === from.slice(0, -2);
  return from === current;
}

function specificity(from: string): number {
  if (from === "*") return 0;
  if (from.endsWith(".*")) return 1;
  return 2;
}

export interface Indexed {
  transition: FlowTransition;
  /** Position in flow.transitions; identifies the arrow on the board. */
  index: number;
}

/**
 * Transitions that can leave a frame. The most specific `from` comes first
 * (exact, then "screen.*", then "*"), and spec order breaks ties.
 */
export function outgoing(flow: Flow, current: string): Indexed[] {
  return flow.transitions
    .map((transition, index) => ({ transition, index }))
    .filter(({ transition }) => fromMatches(transition.from, current))
    .sort((a, b) => specificity(b.transition.from) - specificity(a.transition.from) || a.index - b.index);
}

/** The transition an event triggers from a frame, or undefined when nothing handles it. */
export function pickTransition(flow: Flow, current: string, event: string, data: Data): Indexed | undefined {
  return outgoing(flow, current).find(
    ({ transition }) => transition.on === event && passes(transition.when, data),
  );
}

/** Timed transitions out of a frame, grouped by delay, in the order they should be tried. */
export function timedTransitions(flow: Flow, current: string): { after: number; candidates: Indexed[] }[] {
  const byDelay = new Map<number, Indexed[]>();
  for (const item of outgoing(flow, current)) {
    const after = item.transition.after;
    if (typeof after !== "number") continue;
    const list = byDelay.get(after) ?? [];
    list.push(item);
    byDelay.set(after, list);
  }
  return [...byDelay.entries()].sort((a, b) => a[0] - b[0]).map(([after, candidates]) => ({ after, candidates }));
}

/** Starting values: every bound or written variable gets a default, then flow.data applies. */
export function initialData(flow: Flow): Data {
  const data: Data = {};
  for (const screen of flow.screens) {
    for (const state of screen.states) {
      const facts = layoutFacts(state.layout);
      for (const b of facts.binds) if (!(b.variable in data)) data[b.variable] = b.boolean ? false : "";
      for (const w of facts.writes) if (!(w in data)) data[w] = "";
    }
  }
  for (const t of flow.transitions) {
    if (t.set) for (const key of Object.keys(t.set)) if (!(key in data)) data[key] = "";
  }
  return { ...data, ...(flow.data ?? {}) };
}

/** Data for showing a frame directly: the base data plus that state's `preview`. */
export function dataForFrame(flow: Flow, ref: string, base?: Data): Data {
  const frame = findFrame(flow, ref);
  return { ...(base ?? initialData(flow)), ...(frame?.state.preview ?? {}) };
}

const INTERPOLATION = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Replace {variable} with its value. Unknown variables are left as written. */
export function interpolate(text: string, data: Data): string {
  return text.replace(INTERPOLATION, (whole, name: string) => (name in data ? String(data[name]) : whole));
}

export function interpolationVariables(text: string): string[] {
  return [...text.matchAll(INTERPOLATION)].map((m) => m[1]);
}

/** Frames reachable from the start by following transitions, ignoring guards. */
export function reachableFrames(flow: Flow): Set<string> {
  const start = resolveRef(flow, flow.start);
  const seen = new Set<string>();
  if (!start) return seen;
  const queue = [start];
  seen.add(start);
  while (queue.length) {
    const current = queue.shift()!;
    for (const { transition } of outgoing(flow, current)) {
      const target = resolveRef(flow, transition.to);
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

function formatDelay(ms: number): string {
  return ms >= 1000 ? `${Number((ms / 1000).toFixed(1))}s` : `${ms}ms`;
}

/**
 * Arrow label for the board, in the words a person would use: the label of the
 * control that fires the event when there is one, otherwise the event name.
 */
export function describeTransition(flow: Flow, t: FlowTransition): string {
  if (t.label) return t.label;
  let base: string;
  if (typeof t.after === "number") {
    base = `after ${formatDelay(t.after)}`;
  } else if (t.on?.startsWith("change:")) {
    base = `${t.on.slice("change:".length)} changes`;
  } else {
    base = t.on ?? "";
    const sources = t.from === "*" ? frameRefs(flow) : frameRefs(flow).filter((f) => fromMatches(t.from, f));
    outer: for (const ref of sources) {
      const frame = findFrame(flow, ref);
      if (!frame) continue;
      let label: string | undefined;
      walkNodes(frame.state.layout, (node) => {
        if (label) return;
        const hit = factsOf(node).events.find((e) => e.event === t.on);
        if (hit?.label) label = hit.label;
      });
      if (label) {
        base = `“${label}”`;
        break outer;
      }
    }
  }
  return t.when ? `${base} if ${t.when}` : base;
}
