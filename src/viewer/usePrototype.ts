// Runs a flow as a prototype: where you are, the data so far, and how you got here.
// All the decisions come from the shared state machine, so the prototype does
// exactly what lint reasons about.

import { useEffect, useMemo, useReducer, useRef } from "react";

import { passes } from "../shared/expr";
import {
  dataForFrame,
  findFrame,
  initialData,
  pickTransition,
  resolveRef,
  timedTransitions,
  type Indexed,
} from "../shared/machine";
import type { Data, Flow, Scalar } from "../shared/types";

export interface Step {
  frame: string;
  /** Index of the transition that led here; undefined for the start or a jump. */
  via?: number;
}

interface State {
  current: string;
  data: Data;
  history: Step[];
  /** The last event nothing listened for, so the panel can say so. */
  miss?: { event: string; n: number };
}

type Action =
  | { type: "fire"; flow: Flow; event: string; set?: Data }
  | { type: "change"; flow: Flow; variable: string; value: Scalar }
  | { type: "timer"; flow: Flow; from: string; after: number; stamp: number }
  | { type: "jump"; flow: Flow; frame: string }
  | { type: "back"; flow: Flow }
  | { type: "restart"; flow: Flow }
  | { type: "sync"; flow: Flow }
  | { type: "set"; variable: string; value: Scalar };

function begin(flow: Flow, at?: string): State {
  const first = `${flow.screens[0].id}.${flow.screens[0].states[0].id}`;
  const frame = (at ? resolveRef(flow, at) : undefined) ?? resolveRef(flow, flow.start) ?? first;
  return { current: frame, data: dataForFrame(flow, frame), history: [{ frame }] };
}

function follow(state: State, flow: Flow, pick: Indexed | undefined, data: Data): State {
  const target = pick ? resolveRef(flow, pick.transition.to) : undefined;
  if (!pick || !target) return { ...state, data };
  return {
    current: target,
    data: { ...data, ...(pick.transition.set ?? {}) },
    history: [...state.history, { frame: target, via: pick.index }],
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "fire": {
      const data = { ...state.data, ...(action.set ?? {}) };
      const pick = pickTransition(action.flow, state.current, action.event, data);
      if (!pick) return { ...state, data, miss: { event: action.event, n: (state.miss?.n ?? 0) + 1 } };
      return follow(state, action.flow, pick, data);
    }
    case "change": {
      const data = { ...state.data, [action.variable]: action.value };
      const pick = pickTransition(action.flow, state.current, `change:${action.variable}`, data);
      return follow({ ...state, miss: undefined }, action.flow, pick, data);
    }
    case "timer": {
      // Ignore a timer that belongs to an earlier visit.
      if (state.current !== action.from || state.history.length !== action.stamp) return state;
      const group = timedTransitions(action.flow, state.current).find((g) => g.after === action.after);
      const pick = group?.candidates.find((c) => passes(c.transition.when, state.data));
      return pick ? follow(state, action.flow, pick, state.data) : state;
    }
    case "jump": {
      const frame = resolveRef(action.flow, action.frame);
      if (!frame) return state;
      return { current: frame, data: dataForFrame(action.flow, frame, state.data), history: [...state.history, { frame }] };
    }
    case "back": {
      if (state.history.length < 2) return state;
      // Undo one step, and keep going past frames that moved on by themselves:
      // stopping on one would start its timer and send us straight forward again.
      let history = state.history;
      while (history.length > 1) {
        const left = history[history.length - 1];
        history = history.slice(0, -1);
        const timed = left.via !== undefined && action.flow.transitions[left.via]?.after !== undefined;
        if (!timed) break;
      }
      return { ...state, current: history[history.length - 1].frame, history, miss: undefined };
    }
    case "restart":
      return begin(action.flow);
    case "sync": {
      // The spec changed under a running prototype: stay put if the frame still exists.
      if (!findFrame(action.flow, state.current)) return begin(action.flow);
      return { ...state, data: { ...initialData(action.flow), ...state.data } };
    }
    case "set":
      return { ...state, data: { ...state.data, [action.variable]: action.value } };
  }
}

export interface Prototype extends State {
  fire: (event: string, set?: Data) => void;
  change: (variable: string, value: Scalar) => void;
  jump: (frame: string) => void;
  back: () => void;
  restart: () => void;
  setData: (variable: string, value: Scalar) => void;
}

export function usePrototype(flow: Flow, at?: string): Prototype {
  const [state, dispatch] = useReducer(reducer, undefined, () => begin(flow, at));

  const seen = useRef(flow);
  useEffect(() => {
    if (seen.current !== flow) {
      seen.current = flow;
      dispatch({ type: "sync", flow });
    }
  }, [flow]);

  // Timed transitions: one timer per delay, restarted on every arrival.
  const stamp = state.history.length;
  useEffect(() => {
    const timers = timedTransitions(flow, state.current).map((group) =>
      setTimeout(() => dispatch({ type: "timer", flow, from: state.current, after: group.after, stamp }), group.after),
    );
    return () => timers.forEach(clearTimeout);
  }, [flow, state.current, stamp]);

  // The actions read the latest flow through a ref, so their identity never
  // changes and the board does not redraw on every keystroke.
  const latest = useRef(flow);
  latest.current = flow;
  const actions = useMemo(
    () => ({
      fire: (event: string, set?: Data) => dispatch({ type: "fire", flow: latest.current, event, set }),
      change: (variable: string, value: Scalar) => dispatch({ type: "change", flow: latest.current, variable, value }),
      jump: (frame: string) => dispatch({ type: "jump", flow: latest.current, frame }),
      back: () => dispatch({ type: "back", flow: latest.current }),
      restart: () => dispatch({ type: "restart", flow: latest.current }),
      setData: (variable: string, value: Scalar) => dispatch({ type: "set", variable, value }),
    }),
    [],
  );

  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}
