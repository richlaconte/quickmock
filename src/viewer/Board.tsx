// The board: every state of every screen as a frame, laid out left to right in
// flow order, with the transitions drawn as labelled arrows.

import * as dagre from "@dagrejs/dagre";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from "react";

import { layoutFacts } from "../design-system/components";
import { tokens } from "../design-system/tokens";
import { activeLayer, dataForFrame, describeTransition, findFrame, pageBehind, resolveRef } from "../shared/machine";
import type { Flow, Issue, Person, ReviewNote, Role } from "../shared/types";
import { LiveCursors, STICKY_WIDTH, Stickies, initials } from "./BoardLive";
import { Ink, InkScale, Paths, linePaths, seedOf } from "./kit/ink";
import { Device, STATIC_CONTEXT, StateLayout, cx } from "./kit/render";
import { announce } from "./live";
import type { Notes } from "./ReviewNotes";

// ── layout ──────────────────────────────────────────────────────────────────

const HEAD = 30;
const NOTE_LINE = 17;
const QUESTION_LINE = 22;
const LOOP_LINE = 18;

export interface BoardFrame {
  ref: string;
  x: number;
  y: number;
  w: number;
  h: number;
  thumbH: number;
  noteLines: number;
  note?: string;
  questions: string[];
  /** The person's open notes on this frame, as many as are written out under it. */
  mine: string[];
  /** How many more open notes there are than the ones written out. */
  moreMine: number;
  /** Transitions that stay on this frame. */
  loops: string[];
  /** Transitions that lead back to an earlier frame: listed here instead of drawn across the board. */
  returns: { label: string; to: string }[];
}

export interface BoardEdge {
  index: number;
  from: string;
  to: string;
  points: [number, number][];
  label: string;
  full: string;
  lx: number;
  ly: number;
}

export interface BoardModel {
  width: number;
  height: number;
  scale: number;
  /** Desktop frames are wide, so the flow runs top to bottom; phone frames are tall, so it runs left to right. */
  direction: "TB" | "LR";
  frames: BoardFrame[];
  edges: BoardEdge[];
  /** Transitions from "*": listed in the title block instead of drawn from every frame. */
  globals: { index: number; label: string; to: string }[];
}

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** How many steps each frame is from the start, following transitions and ignoring guards. */
function depths(flow: Flow, arrows: { from: string; to: string }[]): Map<string, number> {
  const depth = new Map<string, number>();
  const start = resolveRef(flow, flow.start);
  if (!start) return depth;
  depth.set(start, 0);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift()!;
    for (const arrow of arrows) {
      if (arrow.from !== current || depth.has(arrow.to)) continue;
      depth.set(arrow.to, depth.get(current)! + 1);
      queue.push(arrow.to);
    }
  }
  return depth;
}

/** `notes` are the person's open notes: they are written under their frames, so they take part in the layout. */
export function computeBoard(flow: Flow, notes: ReviewNote[] = []): BoardModel {
  const deviceName = flow.device ?? "desktop";
  const device = tokens.device[deviceName];
  const scale = device.boardScale;
  const direction = deviceName === "mobile" ? "LR" : "TB";
  const tw = Math.round(device.width * scale);
  const th = Math.round(device.height * scale);

  // Work out the arrows first: a frame's height depends on what is listed under it.
  const arrows: { index: number; from: string; to: string; label: string }[] = [];
  const loops = new Map<string, string[]>();
  const globals: BoardModel["globals"] = [];

  flow.transitions.forEach((t, index) => {
    const to = resolveRef(flow, t.to);
    if (!to) return;
    const label = describeTransition(flow, t);
    if (t.from === "*") {
      globals.push({ index, label, to });
      return;
    }
    let sources: string[];
    if (t.from.endsWith(".*")) {
      const screen = flow.screens.find((s) => s.id === t.from.slice(0, -2));
      const all = screen ? screen.states.map((s) => `${screen.id}.${s.id}`) : [];
      // Draw the arrow only from the states that can actually trigger it.
      const able = all.filter((ref) => {
        if (t.on === undefined) return true;
        const facts = layoutFacts(activeLayer(findFrame(flow, ref)!.state.layout));
        return t.on.startsWith("change:")
          ? facts.binds.some((b) => `change:${b.variable}` === t.on)
          : facts.events.some((e) => e.event === t.on);
      });
      sources = able.length ? able : all.slice(0, 1);
    } else {
      sources = [t.from];
    }
    for (const from of sources) {
      if (from === to) loops.set(from, [...(loops.get(from) ?? []), label]);
      else arrows.push({ index, from, to, label });
    }
  });

  // An arrow that leads back towards the start (Back, Cancel, Try again) would
  // cross the whole board, so it becomes a line of text under its frame instead.
  const depth = depths(flow, arrows);
  const forward: typeof arrows = [];
  const returns = new Map<string, { label: string; to: string }[]>();
  for (const arrow of arrows) {
    const a = depth.get(arrow.from);
    const b = depth.get(arrow.to);
    if (a !== undefined && b !== undefined && b < a) {
      returns.set(arrow.from, [...(returns.get(arrow.from) ?? []), { label: arrow.label, to: arrow.to }]);
    } else {
      forward.push(arrow);
    }
  }

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: direction, nodesep: 64, ranksep: 86, edgesep: 34, marginx: 56, marginy: 56 });
  g.setDefaultEdgeLabel(() => ({}));

  const frames = new Map<string, Omit<BoardFrame, "x" | "y">>();
  const charsPerLine = Math.max(20, Math.floor(tw / 6.4));
  for (const screen of flow.screens) {
    for (const state of screen.states) {
      const ref = `${screen.id}.${state.id}`;
      const questions = (state.questions ?? []).slice(0, 3);
      const own = loops.get(ref) ?? [];
      const back = returns.get(ref) ?? [];
      const noteLines = state.note ? Math.min(2, Math.ceil(state.note.length / charsPerLine)) : 0;
      const written = notes.filter((note) => note.frame === ref && !note.done && !note.sticky).map((note) => note.text);
      const mine = written.slice(0, 3);
      const moreMine = written.length - mine.length;
      const h =
        HEAD +
        th +
        (noteLines ? noteLines * NOTE_LINE + 8 : 0) +
        (own.length + back.length) * LOOP_LINE +
        (questions.length + mine.length + (moreMine ? 1 : 0)) * QUESTION_LINE +
        6;
      frames.set(ref, { ref, w: tw, h, thumbH: th, noteLines, note: state.note, questions, mine, moreMine, loops: own, returns: back });
      g.setNode(ref, { width: tw, height: h });
    }
  }

  forward.forEach((arrow, k) => {
    const label = shorten(arrow.label, 30);
    g.setEdge(arrow.from, arrow.to, { width: label.length * 7.4 + 14, height: 24, labelpos: "c" }, `e${k}`);
  });

  dagre.layout(g);

  const placed: BoardFrame[] = [];
  for (const [ref, frame] of frames) {
    const node = g.node(ref) as { x: number; y: number };
    placed.push({ ...frame, x: node.x - frame.w / 2, y: node.y - frame.h / 2 });
  }

  const edges: BoardEdge[] = [];
  for (const e of g.edges()) {
    const arrow = forward[Number(String(e.name).slice(1))];
    const laid = g.edge(e) as { points: { x: number; y: number }[]; x?: number; y?: number };
    if (!arrow || !laid?.points?.length) continue;
    const mid = laid.points[Math.floor(laid.points.length / 2)];
    edges.push({
      ...arrow,
      points: laid.points.map((p) => [p.x, p.y]),
      label: shorten(arrow.label, 30),
      full: arrow.label,
      lx: laid.x ?? mid.x,
      ly: laid.y ?? mid.y,
    });
  }

  const graph = g.graph() as { width?: number; height?: number };
  return { width: graph.width ?? 800, height: graph.height ?? 600, scale, direction, frames: placed, edges, globals };
}

// ── frames ──────────────────────────────────────────────────────────────────

interface FrameCardProps {
  flow: Flow;
  frame: BoardFrame;
  scale: number;
  isStart: boolean;
  isCurrent: boolean;
  isVisited: boolean;
  isSelected: boolean;
  change?: "new" | "changed";
  issues: Issue[];
  /** Other people whose prototype is on this frame. */
  people: Person[];
  onPress: (ref: string) => void;
}

const FrameCard = memo(function FrameCard({
  flow,
  frame,
  scale,
  isStart,
  isCurrent,
  isVisited,
  isSelected,
  change,
  issues,
  people,
  onPress,
}: FrameCardProps): ReactElement {
  const found = findFrame(flow, frame.ref)!;
  const device = flow.device ?? "desktop";
  const size = tokens.device[device];
  const data = useMemo(() => dataForFrame(flow, frame.ref), [flow, frame.ref]);
  const context = useMemo(() => ({ ...STATIC_CONTEXT, data, seed: frame.ref }), [data, frame.ref]);
  const worst = issues.some((i) => i.severity === "warning") ? "warning" : "info";

  return (
    <div
      className={cx("frame", isCurrent && "is-current", isSelected && "is-selected", isVisited && "is-visited", frame.w < 260 && "is-narrow")}
      style={{ left: frame.x, top: frame.y, width: frame.w }}
      role="button"
      tabIndex={0}
      aria-label={`${frame.ref}: open in the prototype`}
      onClick={() => onPress(frame.ref)}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPress(frame.ref);
        }
      }}
    >
      <div className="frame-head">
        <span className={cx("frame-name", change && "qm-inked")}>
          {change && <Ink shape="box" seed={`mark/${frame.ref}`} color="highlight" fill="highlight" pen="fine" rough="loose" />}
          {frame.ref}
        </span>
        {isSelected && <span className="frame-tag frame-picked">selected</span>}
        {isStart && <span className="frame-tag">start</span>}
        {change && <span className="frame-tag">{change}</span>}
        {isVisited && !isCurrent && <span className="frame-dot" title="Visited in this prototype session" />}
        {people.map((person) => (
          <span key={person.pid} className="frame-person" style={{ background: person.color }} title={`${person.name} is on this frame`}>
            {initials(person.name)}
          </span>
        ))}
        {issues.length > 0 && (
          <span className={cx("frame-lint", `is-${worst}`)} title={issues.map((i) => i.message).join("\n")}>
            {issues.length}
          </span>
        )}
      </div>
      <div className="frame-thumb" style={{ width: frame.w, height: frame.thumbH }}>
        <div className="frame-scale qm-static" style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}>
          <InkScale.Provider value={Math.min(2.4, 0.8 / scale)}>
            <Device device={device} seed={frame.ref}>
              <StateLayout layout={found.state.layout} behind={pageBehind(flow, found.state)} context={context} />
            </Device>
          </InkScale.Provider>
        </div>
        {isCurrent && (
          <div className="frame-ring qm-inked">
            <Ink shape="box" seed={`ring/${frame.ref}`} color="blue" pen="bold" rough="loose" />
          </div>
        )}
        {isCurrent && <span className="frame-here">you are here</span>}
      </div>
      {frame.note && (
        <p className="frame-note" style={{ WebkitLineClamp: frame.noteLines }}>
          {frame.note}
        </p>
      )}
      {frame.loops.map((loop, i) => (
        <p key={`loop${i}`} className="frame-loop" title={`${loop}: stays on this frame`}>
          ↻ {loop}
        </p>
      ))}
      {frame.returns.map((back, i) => (
        <p key={`back${i}`} className="frame-loop" title={`${back.label}: back to ${back.to}`}>
          ↩ {back.label} <span className="frame-to">{back.to}</span>
        </p>
      ))}
      {frame.questions.map((question, i) => (
        <p key={i} className="frame-question" title={question}>
          ? {question}
        </p>
      ))}
      {frame.mine.map((text, i) => (
        <p key={`mine${i}`} className="frame-question frame-mine" title={`Your note: ${text}`}>
          {text}
        </p>
      ))}
      {frame.moreMine > 0 && <p className="frame-question frame-mine is-more">and {frame.moreMine} more of your notes</p>}
    </div>
  );
});

const EdgePath = memo(function EdgePath({ edge, hot }: { edge: BoardEdge; hot: boolean }): ReactElement {
  const specs = useMemo(
    () =>
      linePaths(
        edge.points,
        seedOf(`edge/${edge.index}/${edge.from}`),
        { pen: hot ? "bold" : "regular", color: hot ? "blue" : "ink", rough: "loose" },
        { curve: true, arrow: true },
      ),
    [edge, hot],
  );
  return <Paths specs={specs} />;
});

// ── the board ───────────────────────────────────────────────────────────────

interface View {
  x: number;
  y: number;
  k: number;
}

export interface BoardProps {
  flowId: string;
  flow: Flow;
  model: BoardModel;
  issues: Issue[];
  start: string;
  current?: string;
  visited: Set<string>;
  /** Keys "transitionIndex|fromFrame" for the arrows taken in this session. */
  taken: Set<string>;
  selected?: string;
  changed: { added: string[]; changed: string[] };
  onSelect: (ref: string) => void;
  /** A click on the empty board: nothing is selected any more. */
  onDeselect: () => void;
  /** Notes on this flow: the sticky ones are drawn on the board. */
  notes: Notes;
  role?: Role;
  /** Other people who have this flow open. */
  people: Person[];
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function Board({
  flowId,
  flow,
  model,
  issues,
  start,
  current,
  visited,
  taken,
  selected,
  changed,
  onSelect,
  onDeselect,
  notes,
  role,
  people,
}: BoardProps): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 24, y: 24, k: 0.6 });
  /** Where a new sticky note is being written, in board units. */
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const dragged = useRef(false);

  const place = useCallback(
    (whole: boolean) => {
      const el = host.current;
      if (!el) return;
      const pad = 28;
      const byWidth = (el.clientWidth - pad * 2) / model.width;
      const byHeight = (el.clientHeight - pad * 2) / model.height;
      // Opening a flow: fill the board across the flow's direction and scroll along it.
      const k = whole
        ? clamp(Math.min(byWidth, byHeight), 0.12, 1)
        : clamp(model.direction === "TB" ? byWidth : byHeight, 0.45, 1);
      const centreX = (el.clientWidth - model.width * k) / 2;
      const centreY = (el.clientHeight - model.height * k) / 2;
      setView({ k, x: Math.max(pad, centreX), y: Math.max(pad, centreY) });
    },
    [model.width, model.height, model.direction],
  );
  const fit = useCallback(() => place(true), [place]);

  // Place the view when a flow is opened; keep it steady while the flow changes underneath.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => place(false), [flowId]);

  const zoomBy = useCallback((factor: number, px?: number, py?: number) => {
    const el = host.current;
    if (!el) return;
    const cx0 = px ?? el.clientWidth / 2;
    const cy0 = py ?? el.clientHeight / 2;
    setView((v) => {
      const k = clamp(v.k * factor, 0.15, 2);
      return { k, x: cx0 - ((cx0 - v.x) / v.k) * k, y: cy0 - ((cy0 - v.y) / v.k) * k };
    });
  }, []);

  // Scroll pans; pinch or Ctrl/Cmd + scroll zooms around the pointer.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  // Keep "you are here" in sight as the prototype moves.
  useEffect(() => {
    const el = host.current;
    const frame = current ? model.frames.find((f) => f.ref === current) : undefined;
    if (!el || !frame) return;
    setView((v) => {
      const left = v.x + frame.x * v.k;
      const top = v.y + frame.y * v.k;
      const right = left + frame.w * v.k;
      const bottom = top + frame.h * v.k;
      const inside = left >= 0 && top >= 0 && right <= el.clientWidth && bottom <= el.clientHeight;
      if (inside) return v;
      return {
        ...v,
        x: el.clientWidth / 2 - (frame.x + frame.w / 2) * v.k,
        y: el.clientHeight / 2 - (frame.y + frame.h / 2) * v.k,
      };
    });
  }, [current, model.frames]);

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    dragged.current = false;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  /** A point on screen, in board units. */
  const toBoard = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = host.current?.getBoundingClientRect();
    return { x: (clientX - (rect?.left ?? 0) - view.x) / view.k, y: (clientY - (rect?.top ?? 0) - view.y) / view.k };
  };

  const onPointerMove = (e: PointerEvent): void => {
    // Everyone else on this flow sees where this pointer is.
    announce({ cursor: toBoard(e.clientX, e.clientY) });
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    dragged.current = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const endDrag = (): void => {
    drag.current = null;
  };
  const onPointerLeave = (): void => {
    endDrag();
    announce({ cursor: null });
  };

  // Double-click an empty part of the board to stick a note there.
  const onDoubleClick = (e: MouseEvent): void => {
    if ((e.target as HTMLElement).closest(".frame, .sticky, .board-controls, .edge-label")) return;
    const at = toBoard(e.clientX, e.clientY);
    setDraft({ x: at.x - STICKY_WIDTH / 2, y: at.y - 24 });
  };
  // A click on an empty part of the board lets go of the selected frame. Dragging the board does not.
  const onClick = (e: MouseEvent): void => {
    if (dragged.current) return;
    if ((e.target as HTMLElement).closest(".frame, .sticky, .board-controls, .edge-label")) return;
    onDeselect();
  };
  const stickInView = (): void => {
    const el = host.current;
    if (!el) return;
    setDraft({ x: (el.clientWidth / 2 - view.x) / view.k - STICKY_WIDTH / 2, y: (el.clientHeight / 2 - view.y) / view.k - 60 });
  };

  const peopleByFrame = useMemo(() => {
    const map = new Map<string, Person[]>();
    for (const person of people) {
      if (person.frame) map.set(person.frame, [...(map.get(person.frame) ?? []), person]);
    }
    return map;
  }, [people]);
  const nobody = useMemo<Person[]>(() => [], []);

  const press = useCallback(
    (ref: string) => {
      if (dragged.current) return;
      onSelect(ref);
    },
    [onSelect],
  );

  const issuesByFrame = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) {
      if (!issue.frame) continue;
      map.set(issue.frame, [...(map.get(issue.frame) ?? []), issue]);
    }
    return map;
  }, [issues]);
  const none = useMemo<Issue[]>(() => [], []);

  return (
    <div
      className={cx("board", drag.current?.moved && "is-panning")}
      ref={host}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={onPointerLeave}
      onPointerCancel={endDrag}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.k}px ${24 * view.k}px` }}
    >
      <div
        className="board-sheet"
        style={{ width: model.width, height: model.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        <svg className="board-edges" width={model.width} height={model.height} aria-hidden="true">
          {model.edges.map((edge, i) => (
            <EdgePath key={`${edge.index}-${edge.from}-${i}`} edge={edge} hot={taken.has(`${edge.index}|${edge.from}`)} />
          ))}
        </svg>
        {model.edges.map((edge, i) => (
          <span
            key={`${edge.index}-${edge.from}-${i}`}
            className={cx("edge-label", taken.has(`${edge.index}|${edge.from}`) && "is-hot")}
            style={{ left: edge.lx, top: edge.ly }}
            title={`${edge.full}  (${edge.from} → ${edge.to})`}
          >
            {edge.label}
          </span>
        ))}
        {model.frames.map((frame) => (
          <FrameCard
            key={frame.ref}
            flow={flow}
            frame={frame}
            scale={model.scale}
            isStart={frame.ref === start}
            isCurrent={frame.ref === current}
            isVisited={visited.has(frame.ref)}
            isSelected={frame.ref === selected}
            change={changed.added.includes(frame.ref) ? "new" : changed.changed.includes(frame.ref) ? "changed" : undefined}
            issues={issuesByFrame.get(frame.ref) ?? none}
            people={peopleByFrame.get(frame.ref) ?? nobody}
            onPress={press}
          />
        ))}
        <Stickies model={model} notes={notes} role={role} k={view.k} draft={draft} onDraftDone={() => setDraft(null)} />
        <LiveCursors people={people} k={view.k} />
      </div>
      <div className="board-controls" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" className="sticky-add" onClick={stickInView} title="Stick a note on the board. Double-clicking the board does the same.">
          Sticky note
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
          −
        </button>
        <span className="board-zoom">{Math.round(view.k * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={fit}>
          Fit
        </button>
      </div>
    </div>
  );
}
