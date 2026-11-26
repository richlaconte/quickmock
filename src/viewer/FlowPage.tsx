// One flow: the board on the left, the running prototype on the right, both
// drawn from the same spec and kept in step with each other.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { tokens } from "../design-system/tokens";
import { describeTransition, findFrame, frameRefs, outgoing, pageBehind, resolveRef } from "../shared/machine";
import type { FlowNode, FlowPayload, Issue, Role, Scalar } from "../shared/types";
import { countIssues } from "../shared/validate";
import { AgentButton } from "./AgentPanel";
import { getFlow, postView, useServerEvents } from "./api";
import { Board, computeBoard, type BoardModel } from "./Board";
import { Device, StateLayout, cx, type RenderContext } from "./kit/render";
import { announce, usePresence } from "./live";
import { PeopleBar } from "./People";
import { rememberFlow } from "./recent";
import { ReviewNotes, useNotes, type Notes } from "./ReviewNotes";
import { links } from "./router";
import { ShareButton } from "./SharePanel";
import { usePrototype, type Prototype } from "./usePrototype";
import { WORKSPACE } from "./workspace";

/** Load a flow and keep it fresh as the server reports changes. */
export function useFlow(id: string): { payload: FlowPayload | null; error: string | null } {
  const [payload, setPayload] = useState<FlowPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getFlow(id).then(
      (next) => {
        setPayload(next);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [id]);

  useEffect(() => {
    setPayload(null);
    load();
  }, [load]);

  useServerEvents((event) => {
    if (event.type === "flow" && (!event.id || event.id === id)) load();
  });

  return { payload, error };
}

export function FlowPage({ id, at }: { id: string; at?: string }): ReactElement {
  const { payload, error } = useFlow(id);
  if (error && !payload) {
    return (
      <div className="page">
        <header className="flowbar">
          <a className="wordmark" href={links.list}>
            lowfi.design
          </a>
        </header>
        <main className="notice">
          <p>{error}</p>
          <a href={links.list}>See all flows</a>
        </main>
      </div>
    );
  }
  if (!payload) return <div className="page loading-page">Opening the flow</div>;
  return <Workspace key={payload.id} payload={payload} at={at} />;
}

interface Pointed {
  frame: string;
  path: string;
  type: string;
  summary: string;
}

function summarise(node: FlowNode): string {
  for (const key of ["label", "text", "title", "brand"]) {
    const value = node[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function Workspace({ payload, at }: { payload: FlowPayload; at?: string }): ReactElement {
  const flow = payload.spec;
  const proto = usePrototype(flow, at);
  const [selected, setSelected] = useState<string | undefined>(() => (at ? resolveRef(flow, at) : undefined));
  const [pointing, setPointing] = useState(false);
  const [pointed, setPointed] = useState<Pointed | undefined>();
  const [mode, setMode] = useState<"split" | "board">("split");

  const notes = useNotes(payload.id);
  const openNotes = useMemo(() => notes.all.filter((note) => !note.done), [notes.all]);
  // The board is only laid out again when the lines written under its frames change,
  // not every time someone moves a sticky note.
  const written = useMemo(() => openNotes.filter((note) => !note.sticky), [openNotes]);
  const writtenKey = JSON.stringify(written.map((note) => [note.frame, note.text]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => computeBoard(flow, written), [flow, writtenKey]);
  const { others, role } = usePresence();
  const people = useMemo(() => others.filter((person) => person.flowId === payload.id), [others, payload.id]);

  // So the landing page can list the flows opened lately in this browser.
  useEffect(() => rememberFlow(WORKSPACE, payload.id, flow.name), [payload.id, flow.name]);

  // Tell everyone else which flow and frame this page is on.
  useEffect(() => {
    announce({ flowId: payload.id, frame: proto.current });
  }, [payload.id, proto.current]);
  useEffect(() => () => announce({ flowId: null, frame: null, cursor: null }), []);
  const start = resolveRef(flow, flow.start) ?? "";
  const visited = useMemo(() => new Set(proto.history.map((step) => step.frame)), [proto.history]);
  const taken = useMemo(() => {
    const set = new Set<string>();
    proto.history.forEach((step, i) => {
      if (i > 0 && step.via !== undefined) set.add(`${step.via}|${proto.history[i - 1].frame}`);
    });
    return set;
  }, [proto.history]);
  const changed = useMemo(
    () => ({ added: payload.meta.lastChange?.added ?? [], changed: payload.meta.lastChange?.changed ?? [] }),
    [payload.meta.lastChange],
  );

  const { jump } = proto;
  const select = useCallback(
    (ref: string) => {
      setSelected(ref);
      setPointed(undefined);
      jump(ref);
    },
    [jump],
  );

  const point = useCallback(
    (path: string, node: FlowNode) => {
      setPointed({ frame: proto.current, path, type: node.type, summary: summarise(node) });
    },
    [proto.current],
  );

  // Report what is on screen, so the agent's get_selection tool can answer "this".
  // Only for the workspace's owner: a guest's clicks are not what their agent means by "this".
  useEffect(() => {
    if (role === "guest") return;
    const timer = setTimeout(() => {
      postView({
        flowId: payload.id,
        selectedFrame: selected,
        selectedNode: pointed,
        prototype: { current: proto.current, path: proto.history.map((step) => step.frame), data: proto.data },
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [payload.id, selected, pointed, proto.current, proto.history, proto.data, role]);

  return (
    <div className="page workspace">
      <header className="flowbar">
        <a className="wordmark" href={links.list}>
          lowfi.design
        </a>
        <h1 className="flow-name">{flow.name}</h1>
        <span className="grow" />
        <PeopleBar flowId={payload.id} onGoTo={select} />
        <div className="segmented" role="group" aria-label="Layout">
          <button type="button" aria-pressed={mode === "split"} onClick={() => setMode("split")}>
            Board and prototype
          </button>
          <button type="button" aria-pressed={mode === "board"} onClick={() => setMode("board")}>
            Board only
          </button>
        </div>
        <a className="bar-link" href={links.play(payload.id, proto.current)} target="_blank" rel="noreferrer">
          Open prototype alone
        </a>
        <a className="bar-link" href={links.brief(payload.id)}>
          Build brief
        </a>
        <a className="bar-link" href={links.system}>
          Design system
        </a>
        {role === "owner" && <AgentButton />}
        {role === "owner" && <ShareButton flowId={payload.id} />}
      </header>
      <div className={cx("workspace-main", mode === "board" && "is-board-only")}>
        <div className="board-wrap">
          <div className="board-area">
            <Board
              flowId={payload.id}
              flow={flow}
              model={model}
              issues={payload.issues}
              start={start}
              current={proto.current}
              visited={visited}
              taken={taken}
              selected={selected}
              changed={changed}
              onSelect={select}
              notes={notes}
              role={role}
              people={people}
            />
          </div>
          <TitleBlock payload={payload} model={model} openNotes={openNotes.length} />
        </div>
        {mode === "split" && (
          <PrototypePanel
            payload={payload}
            proto={proto}
            pointing={pointing}
            setPointing={(on) => {
              setPointing(on);
              if (!on) setPointed(undefined);
            }}
            pointed={pointed}
            onPoint={point}
            onOpenFrame={select}
            notes={notes}
            role={role}
          />
        )}
      </div>
    </div>
  );
}

/** The drawing's title strip: printed labels, hand-written values. */
function TitleBlock({ payload, model, openNotes }: { payload: FlowPayload; model: BoardModel; openNotes: number }): ReactElement {
  const { spec, meta, issues } = payload;
  const counts = countIssues(issues);
  const lint = counts.warnings === 0 && counts.infos === 0 ? "clean" : `${counts.warnings} to fix, ${counts.infos} to weigh`;
  const everywhere = model.globals.map((g) => `${g.label} → ${g.to}`).join("; ");
  return (
    <aside className="titleblock" aria-label="About this flow">
      <dl>
        <div className="tb-name">
          <dt>Flow</dt>
          <dd title={spec.description ?? spec.name}>{spec.name}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{meta.rev}</dd>
        </div>
        <div>
          <dt>Frames</dt>
          <dd>{frameRefs(spec).length}</dd>
        </div>
        <div>
          <dt>Arrows</dt>
          <dd>{spec.transitions.length}</dd>
        </div>
        <div>
          <dt>Lint</dt>
          <dd>{lint}</dd>
        </div>
        <div>
          <dt>Notes</dt>
          <dd>{openNotes === 0 ? "none open" : `${openNotes} open`}</dd>
        </div>
        <div className="tb-wide">
          <dt>Last change</dt>
          <dd title={meta.lastChange?.summary}>{meta.lastChange?.summary ?? "none yet"}</dd>
        </div>
        {everywhere && (
          <div className="tb-wide">
            <dt>From any frame</dt>
            <dd title={everywhere}>{everywhere}</dd>
          </div>
        )}
      </dl>
    </aside>
  );
}

// ── prototype panel ─────────────────────────────────────────────────────────

interface PanelProps {
  payload: FlowPayload;
  proto: Prototype;
  pointing: boolean;
  setPointing: (on: boolean) => void;
  pointed?: Pointed;
  onPoint: (path: string, node: FlowNode) => void;
  onOpenFrame: (ref: string) => void;
  notes: Notes;
  role?: Role;
}

function PrototypePanel({ payload, proto, pointing, setPointing, pointed, onPoint, onOpenFrame, notes, role }: PanelProps): ReactElement {
  const flow = payload.spec;
  const device = flow.device ?? "desktop";
  const size = tokens.device[device];
  const found = findFrame(flow, proto.current);
  const [tab, setTab] = useState<"notes" | "lint" | "data">("notes");

  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = (): void => setScale(Math.min(1, (el.clientWidth - 2) / size.width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [size.width]);

  const { fire, change } = proto;
  const pointedPath = pointed && pointed.frame === proto.current ? pointed.path : undefined;
  const context = useMemo<RenderContext>(
    () => ({
      data: proto.data,
      interactive: !pointing,
      fire,
      change,
      pointing,
      pointed: pointedPath,
      point: onPoint,
      seed: proto.current,
    }),
    [proto.data, proto.current, pointing, pointedPath, onPoint, fire, change],
  );

  const counts = countIssues(payload.issues);
  const notesHere = notes.all.filter((note) => note.frame === proto.current && !note.done).length;
  // A note is about the pointed component when there is one on this frame, otherwise about the frame.
  const noteTarget = pointed && pointed.frame === proto.current ? { path: pointed.path, type: pointed.type, summary: pointed.summary || undefined } : undefined;

  return (
    <aside className="proto" aria-label="Prototype">
      <div className="proto-bar">
        <span className="proto-where" title="The frame the prototype is on">
          {proto.current}
        </span>
        <span className="grow" />
        <button type="button" onClick={proto.back} disabled={proto.history.length < 2}>
          Back
        </button>
        <button type="button" onClick={proto.restart}>
          Start over
        </button>
        <button type="button" aria-pressed={pointing} onClick={() => setPointing(!pointing)} title="Select a component so your agent knows what “this” is">
          Point
        </button>
      </div>
      {pointing && (
        <p className="proto-hint">
          {pointed
            ? `Pointing at the ${pointed.type}${pointed.summary ? ` “${pointed.summary}”` : ""}. Write a note about it below, or tell your agent what to do with “this”.`
            : "Click a component below, then write a note about it or tell your agent what to do with “this”."}
        </p>
      )}
      {proto.miss && !pointing && (
        <p className="proto-miss" key={proto.miss.n} role="status">
          Nothing listens for “{proto.miss.event}” on this frame.
        </p>
      )}
      <div className={cx("proto-stage", pointing && "is-pointing")} ref={stage}>
        {/* The device keeps its real size and is scaled; this box takes up the scaled size so it can be centred. */}
        <div className="proto-fit" style={{ width: size.width * scale, height: size.height * scale }}>
          <div className="proto-scale" style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}>
            {found && (
              <Device key={proto.current} device={device} seed={proto.current}>
                <StateLayout layout={found.state.layout} behind={pageBehind(flow, found.state)} context={context} />
              </Device>
            )}
          </div>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="About this frame">
        <button type="button" role="tab" aria-selected={tab === "notes"} onClick={() => setTab("notes")}>
          Notes{notesHere > 0 ? ` (${notesHere})` : ""}
        </button>
        <button type="button" role="tab" aria-selected={tab === "lint"} onClick={() => setTab("lint")}>
          Lint{counts.warnings + counts.infos > 0 ? ` (${counts.warnings + counts.infos})` : ""}
        </button>
        <button type="button" role="tab" aria-selected={tab === "data"} onClick={() => setTab("data")}>
          Data
        </button>
      </div>
      <div className="tab-body" role="tabpanel">
        {tab === "notes" && found && (
          <NotesTab
            payload={payload}
            current={proto.current}
            note={found.state.note}
            questions={found.state.questions ?? []}
            notes={notes}
            target={noteTarget}
            role={role}
            onOpenFrame={onOpenFrame}
          />
        )}
        {tab === "lint" && <LintTab issues={payload.issues} current={proto.current} onOpenFrame={onOpenFrame} />}
        {tab === "data" && <DataTab data={proto.data} setData={proto.setData} />}
      </div>
    </aside>
  );
}

function NotesTab({
  payload,
  current,
  note,
  questions,
  notes,
  target,
  role,
  onOpenFrame,
}: {
  payload: FlowPayload;
  current: string;
  note?: string;
  questions: string[];
  notes: Notes;
  target?: { path: string; type: string; summary?: string };
  role?: Role;
  onOpenFrame: (ref: string) => void;
}): ReactElement {
  const flow = payload.spec;
  const exits = outgoing(flow, current);
  const frames = useMemo(() => frameRefs(flow), [flow]);
  return (
    <div className="notes">
      {note && <p className="note-text">{note}</p>}
      {questions.length > 0 && (
        <ul className="questions" aria-label="Open questions">
          {questions.map((question, i) => (
            <li key={i}>{question}</li>
          ))}
        </ul>
      )}
      <ReviewNotes notes={notes} frame={current} frames={frames} target={target} role={role} onOpenFrame={onOpenFrame} />
      <h3 className="mini-head">From here</h3>
      {exits.length === 0 ? (
        <p className="quiet">Nothing leads out of this frame.</p>
      ) : (
        <ul className="exits">
          {exits.map(({ transition, index }) => (
            <li key={index}>
              <span className="exit-label">{describeTransition(flow, transition)}</span>
              <span className="exit-arrow" aria-hidden="true">
                →
              </span>
              <span className="exit-to">{resolveRef(flow, transition.to)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LintTab({
  issues,
  current,
  onOpenFrame,
}: {
  issues: Issue[];
  current: string;
  onOpenFrame: (ref: string) => void;
}): ReactElement {
  if (issues.length === 0) return <p className="quiet">Nothing to report. The flow and every state pass lint.</p>;
  const ordered = [...issues].sort((a, b) => Number(b.frame === current) - Number(a.frame === current));
  return (
    <ul className="lint">
      {ordered.map((issue, i) => (
        <li key={i} className={`lint-${issue.severity}`}>
          <p className="lint-message">{issue.message}</p>
          {issue.fix && <p className="lint-fix">{issue.fix}</p>}
          <p className="lint-meta">
            <span>{issue.severity === "warning" ? "Fix" : issue.severity === "info" ? "Weigh" : "Error"}</span>
            <span>{issue.code}</span>
            {issue.frame && (
              <button type="button" className="text-button" onClick={() => onOpenFrame(issue.frame!)}>
                {issue.frame}
              </button>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}

function DataTab({ data, setData }: { data: Record<string, Scalar>; setData: (variable: string, value: Scalar) => void }): ReactElement {
  const names = Object.keys(data).sort();
  if (names.length === 0) return <p className="quiet">This flow has no variables.</p>;
  return (
    <div className="data">
      <p className="quiet">The prototype's variables. Change one to steer a branch, for example simulateFailure.</p>
      {names.map((name) => {
        const value = data[name];
        return (
          <label key={name} className="data-row">
            <span>{name}</span>
            {typeof value === "boolean" ? (
              <input type="checkbox" checked={value} onChange={(e) => setData(name, e.target.checked)} />
            ) : (
              <input type="text" value={String(value)} onChange={(e) => setData(name, e.target.value)} />
            )}
          </label>
        );
      })}
    </div>
  );
}
