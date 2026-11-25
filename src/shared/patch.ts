// Changing a flow in place: the operations behind the patch_flow tool, and the
// diff that tells the viewer which frames a change touched.

import { frameRefs, pageBehind } from "./machine";
import type { Flow, FlowScreen, FlowState, FlowTransition } from "./types";

export const PATCH_OPS_DOC = `Operations (applied in order, all or nothing):
- {"op": "set_state", "screen": "confirm", "state": "failed", "value": {…state without its id…}, "screen_title"?: "…"}
    Add or replace one state. Creates the screen when it does not exist yet.
- {"op": "remove_state", "screen": "confirm", "state": "failed"}
    Also removes the transitions that start from it. Retarget the ones that lead to it in the same patch.
- {"op": "set_screen", "screen": "offer", "value": {"title"?: "…", "states": [ …states… ]}, "before"?: "confirm"}
    Add or replace a whole screen. "before" places a new screen ahead of another.
- {"op": "remove_screen", "screen": "offer"}
    Also removes the transitions that start from it.
- {"op": "set_transitions", "from": "confirm.default", "value": [ {"on": "confirm", "to": "confirm.submitting"}, … ]}
    Replace every transition whose "from" is exactly this string ("screen.state", "screen.*" or "*").
    The transitions in "value" are written without "from". An empty list removes them.
- {"op": "set_flow", "name"?: "…", "description"?: "…", "device"?: "desktop"|"mobile", "start"?: "screen.state", "data"?: {…}}
    Change the flow's own fields. "data" replaces the whole data object.`;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export type PatchResult = { ok: true; flow: Flow } | { ok: false; error: string };

function fail(index: number, message: string): PatchResult {
  return { ok: false, error: `Operation ${index + 1}: ${message}` };
}

/** Apply patch operations to a copy of the flow. Shape problems are reported; validity is checked afterwards. */
export function applyOps(source: Flow, ops: unknown): PatchResult {
  if (!Array.isArray(ops) || ops.length === 0) {
    return { ok: false, error: `"ops" must be a list with at least one operation.\n${PATCH_OPS_DOC}` };
  }
  const flow: Flow = structuredClone(source);

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!isRecord(op) || typeof op.op !== "string") return fail(i, `each operation is an object with an "op".\n${PATCH_OPS_DOC}`);
    const screenId = typeof op.screen === "string" ? op.screen : undefined;
    const stateId = typeof op.state === "string" ? op.state : undefined;
    const screenIndex = screenId ? flow.screens.findIndex((s) => s.id === screenId) : -1;

    switch (op.op) {
      case "set_state": {
        if (!screenId || !stateId) return fail(i, `set_state needs "screen" and "state".`);
        if (!isRecord(op.value)) return fail(i, `set_state needs "value": the state as an object with a "layout".`);
        const { id: _ignored, ...rest } = op.value as Record<string, unknown>;
        const state = { id: stateId, ...rest } as unknown as FlowState;
        let screen: FlowScreen;
        if (screenIndex === -1) {
          screen = { id: screenId, states: [] };
          if (typeof op.screen_title === "string") screen.title = op.screen_title;
          flow.screens.push(screen);
        } else {
          screen = flow.screens[screenIndex];
          if (typeof op.screen_title === "string") screen.title = op.screen_title;
        }
        const at = screen.states.findIndex((s) => s.id === stateId);
        if (at === -1) screen.states.push(state);
        else screen.states[at] = state;
        break;
      }
      case "remove_state": {
        if (!screenId || !stateId) return fail(i, `remove_state needs "screen" and "state".`);
        if (screenIndex === -1) return fail(i, `there is no screen "${screenId}".`);
        const screen = flow.screens[screenIndex];
        const at = screen.states.findIndex((s) => s.id === stateId);
        if (at === -1) return fail(i, `screen "${screenId}" has no state "${stateId}".`);
        screen.states.splice(at, 1);
        const ref = `${screenId}.${stateId}`;
        flow.transitions = flow.transitions.filter((t) => t.from !== ref);
        if (screen.states.length === 0) {
          flow.screens.splice(screenIndex, 1);
          flow.transitions = flow.transitions.filter((t) => t.from !== `${screenId}.*`);
        }
        break;
      }
      case "set_screen": {
        if (!screenId) return fail(i, `set_screen needs "screen".`);
        if (!isRecord(op.value) || !Array.isArray(op.value.states)) {
          return fail(i, `set_screen needs "value": {"title"?, "states": [...]}.`);
        }
        const { id: _ignored, ...rest } = op.value as Record<string, unknown>;
        const screen = { id: screenId, ...rest } as unknown as FlowScreen;
        if (screenIndex !== -1) {
          flow.screens[screenIndex] = screen;
        } else {
          const before = typeof op.before === "string" ? flow.screens.findIndex((s) => s.id === op.before) : -1;
          if (before === -1) flow.screens.push(screen);
          else flow.screens.splice(before, 0, screen);
        }
        break;
      }
      case "remove_screen": {
        if (!screenId) return fail(i, `remove_screen needs "screen".`);
        if (screenIndex === -1) return fail(i, `there is no screen "${screenId}".`);
        flow.screens.splice(screenIndex, 1);
        flow.transitions = flow.transitions.filter((t) => t.from !== `${screenId}.*` && !t.from.startsWith(`${screenId}.`));
        break;
      }
      case "set_transitions": {
        if (typeof op.from !== "string" || !op.from) return fail(i, `set_transitions needs "from".`);
        if (!Array.isArray(op.value)) return fail(i, `set_transitions needs "value": a list of transitions without "from".`);
        const from = op.from;
        const fresh: FlowTransition[] = [];
        for (const item of op.value) {
          if (!isRecord(item)) return fail(i, `each transition in "value" is an object.`);
          const { from: _drop, ...rest } = item;
          fresh.push({ from, ...rest } as unknown as FlowTransition);
        }
        const first = flow.transitions.findIndex((t) => t.from === from);
        const kept = flow.transitions.filter((t) => t.from !== from);
        const insertAt = first === -1 ? kept.length : flow.transitions.slice(0, first).filter((t) => t.from !== from).length;
        kept.splice(insertAt, 0, ...fresh);
        flow.transitions = kept;
        break;
      }
      case "set_flow": {
        const target = flow as unknown as Record<string, unknown>;
        let touched = false;
        for (const key of ["name", "description", "device", "start", "data"]) {
          if (op[key] !== undefined) {
            target[key] = op[key];
            touched = true;
          }
        }
        if (!touched) return fail(i, `set_flow needs at least one of: name, description, device, start, data.`);
        break;
      }
      default:
        return fail(i, `unknown op "${op.op}".\n${PATCH_OPS_DOC}`);
    }
  }
  return { ok: true, flow };
}

export interface FlowDiff {
  added: string[];
  changed: string[];
  removed: string[];
}

function signatures(flow: Flow): Map<string, string> {
  const out = new Map<string, string>();
  for (const screen of flow.screens) {
    for (const state of screen.states) {
      const ref = `${screen.id}.${state.id}`;
      const leaving = flow.transitions.filter((t) => t.from === ref);
      // A modal state looks different when the page behind it changes, so that counts too.
      out.set(ref, JSON.stringify([state, pageBehind(flow, state) ?? null, leaving]));
    }
  }
  return out;
}

/** Which frames a change added, changed (content or the transitions leaving them) or removed. */
export function diffFlows(prev: Flow | undefined, next: Flow): FlowDiff {
  if (!prev) return { added: frameRefs(next), changed: [], removed: [] };
  const before = signatures(prev);
  const after = signatures(next);
  const diff: FlowDiff = { added: [], changed: [], removed: [] };
  for (const [ref, sig] of after) {
    if (!before.has(ref)) diff.added.push(ref);
    else if (before.get(ref) !== sig) diff.changed.push(ref);
  }
  for (const ref of before.keys()) if (!after.has(ref)) diff.removed.push(ref);
  return diff;
}
