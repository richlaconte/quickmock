// The design system as a page: everything an agent may use, drawn with the
// same kit that draws the flows. It reads the registry, so it cannot go stale.

import { useMemo, useState, type ReactElement } from "react";

import { COMMON_PROPS, COMPONENTS, GROUPS, type ComponentDef, type PropDef } from "../design-system/components";
import { PATTERNS } from "../design-system/patterns";
import { signature } from "../design-system/reference";
import { RULES } from "../design-system/rules";
import { materials, principles, tokens, type InkColor, type PenName, type RoughName } from "../design-system/tokens";
import type { Data, FlowNode } from "../shared/types";
import { Ink } from "./kit/ink";
import { StateLayout, cx, type RenderContext } from "./kit/render";
import { links } from "./router";

/** A live sample drawn on its own sheet. Inputs work; events are shown, not followed. */
function Specimen({ layout, seed }: { layout: FlowNode[]; seed: string }): ReactElement {
  const [data, setData] = useState<Data>({});
  const [fired, setFired] = useState<string | null>(null);
  const context = useMemo<RenderContext>(
    () => ({
      data,
      interactive: true,
      fire: (event) => setFired(event),
      change: (variable, value) => setData((d) => ({ ...d, [variable]: value })),
      pointing: false,
      point: () => undefined,
      seed,
    }),
    [data, seed],
  );
  const hasModal = layout.some((node) => node.type === "modal");
  return (
    <div className={cx("specimen", "qm-device", "qm-inked", hasModal && "specimen-modal")}>
      <Ink shape="box" seed={`${seed}/sheet`} pen="fine" color="graphite" rough="loose" />
      <StateLayout layout={layout} context={context} />
      {fired && (
        <p className="specimen-fired" role="status">
          fired the event “{fired}”
        </p>
      )}
    </div>
  );
}

function PropRows({ props }: { props: Record<string, PropDef> }): ReactElement {
  return (
    <>
      {Object.entries(props).map(([name, prop]) => (
        <tr key={name}>
          <th scope="row">{signature(name, prop)}</th>
          <td>
            {prop.doc}
            {(prop.type.kind === "items" || prop.type.kind === "object") && (
              <span className="prop-shape">
                {Object.entries(prop.type.shape).map(([k, v]) => (
                  <span key={k}>
                    <b>{signature(k, v)}</b> {v.doc}
                  </span>
                ))}
              </span>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}

function ComponentEntry({ def }: { def: ComponentDef }): ReactElement {
  // A modal only shows over a page, so give its sample one.
  const layout: FlowNode[] = def.topLevelOnly
    ? [{ type: "heading", level: 1, text: "The page behind" }, { type: "skeleton", lines: 4 }, def.example]
    : [def.example];
  return (
    <article className="entry" id={`component-${def.type}`}>
      <header>
        <h4>{def.type}</h4>
        <p>{def.summary}</p>
      </header>
      <Specimen layout={layout} seed={`guide/${def.type}`} />
      <table className="props">
        <tbody>{Object.keys(def.props).length ? <PropRows props={def.props} /> : null}</tbody>
      </table>
      {def.rules.length > 0 && (
        <ul className="rules">
          {def.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

function Stroke({ pen, color = "ink", rough = "tight", seed }: { pen: PenName; color?: InkColor; rough?: RoughName; seed: string }): ReactElement {
  return (
    <span className="stroke qm-inked">
      <Ink shape="rule" seed={seed} pen={pen} color={color} rough={rough} />
    </span>
  );
}

const SECTIONS = [
  ["principles", "Principles"],
  ["materials", "Materials"],
  ["type", "Type"],
  ["components", "Components"],
  ["patterns", "Patterns"],
  ["lint", "What lint checks"],
] as const;

export function StyleGuide(): ReactElement {
  const jump = (id: string): void => {
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  };
  return (
    <div className="page">
      <header className="flowbar">
        <a className="wordmark" href={links.list}>
          lowfi.design
        </a>
        <h1 className="flow-name">Design system</h1>
        <span className="grow" />
        <a className="bar-link" href={links.list}>
          Flows
        </a>
      </header>
      <div className="guide">
        <nav className="guide-nav" aria-label="Sections">
          {SECTIONS.map(([id, label]) => (
            <button key={id} type="button" className="text-button" onClick={() => jump(id)}>
              {label}
            </button>
          ))}
          <span className="guide-nav-sub">
            {COMPONENTS.map((c) => (
              <button key={c.type} type="button" className="text-button" onClick={() => jump(`component-${c.type}`)}>
                {c.type}
              </button>
            ))}
          </span>
        </nav>
        <main className="guide-main">
          <p className="guide-lede">
            Everything an agent may draw with. A flow that uses anything else is rejected, with a note on what to use instead.
            There are {COMPONENTS.length} components and nothing to style: the sketch look is the point, so that people judge
            layout, wording and flow.
          </p>

          <section id="principles">
            <h2>Principles</h2>
            <ol className="principles">
              {principles.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
          </section>

          <section id="materials">
            <h2>Materials</h2>
            <p className="section-note">Each material means one thing. Flows are drawn only in ink; the rest belong to the tool and the people using it.</p>
            <ul className="materials">
              {materials.map((m) => (
                <li key={m.token}>
                  {m.token === "highlight" ? (
                    <span className="swatch qm-inked">
                      <Ink shape="box" seed="guide/highlight" color="highlight" fill="highlight" rough="loose" />
                    </span>
                  ) : m.token === "sticky" ? (
                    <span className="swatch qm-inked">
                      <Ink shape="box" seed="guide/sticky" color="graphite" fill="sticky" pen="fine" rough="loose" />
                    </span>
                  ) : m.token === "people" ? (
                    <span className="swatch pencils" aria-hidden="true">
                      {tokens.people.map((color) => (
                        <i key={color} style={{ background: color }} />
                      ))}
                    </span>
                  ) : (
                    <Stroke pen="bold" color={m.token as InkColor} rough="loose" seed={`guide/material/${m.token}`} />
                  )}
                  <strong>{m.name}</strong>
                  <span>{m.meaning}</span>
                </li>
              ))}
            </ul>
            <div className="pens">
              <div>
                <h3>Pens</h3>
                {(Object.keys(tokens.pen) as PenName[]).map((pen) => (
                  <p key={pen} className="pen-row">
                    <Stroke pen={pen} seed={`guide/pen/${pen}`} />
                    <span>
                      {pen}, {tokens.pen[pen]}px
                    </span>
                  </p>
                ))}
              </div>
              <div>
                <h3>Wobble</h3>
                {(Object.keys(tokens.rough) as RoughName[]).map((rough) => (
                  <p key={rough} className="pen-row">
                    <span className="wobble qm-inked">
                      <Ink shape="box" seed={`guide/rough/${rough}`} rough={rough} />
                    </span>
                    <span>{rough === "tight" ? "tight, for controls" : "loose, for containers and arrows"}</span>
                  </p>
                ))}
              </div>
            </div>
          </section>

          <section id="type">
            <h2>Type</h2>
            <p className="section-note">Three hands, one for each voice.</p>
            <div className="faces">
              <div>
                <p className="face-hand">Why are you leaving?</p>
                <p className="face-caption">The design, lettered by hand. Sizes: {Object.values(tokens.type).join(", ")}px.</p>
              </div>
              <div>
                <p className="face-scrawl">? Is the free text required</p>
                <p className="face-caption">Critique, scrawled in the margin in red pencil.</p>
              </div>
              <div>
                <p className="face-print">reason.default, revision 4</p>
                <p className="face-caption">The tool, printed like the title block of a drawing.</p>
              </div>
            </div>
          </section>

          <section id="components">
            <h2>Components</h2>
            <p className="section-note">
              A prop marked * is required. For a choice, the first value is the default. Every component also accepts{" "}
              {Object.entries(COMMON_PROPS)
                .map(([name, prop]) => signature(name, prop))
                .join(" and ")}
              .
            </p>
            {GROUPS.map((group) => (
              <div key={group} className="group">
                <h3>{group}</h3>
                <div className="entries">
                  {COMPONENTS.filter((c) => c.group === group).map((def) => (
                    <ComponentEntry key={def.type} def={def} />
                  ))}
                </div>
              </div>
            ))}
          </section>

          <section id="patterns">
            <h2>Patterns</h2>
            <p className="section-note">Compositions that come up in almost every flow, with the states each one needs.</p>
            <div className="entries">
              {PATTERNS.map((pattern) => (
                <article key={pattern.id} className="entry">
                  <header>
                    <h4>{pattern.name}</h4>
                    <p>{pattern.when}</p>
                  </header>
                  <Specimen layout={pattern.example} seed={`guide/pattern/${pattern.id}`} />
                  <h5>States</h5>
                  <ul className="rules">
                    {pattern.states.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                  <h5>Wiring</h5>
                  <ul className="rules">
                    {pattern.wiring.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section id="lint">
            <h2>What lint checks</h2>
            <p className="section-note">
              Anything outside this system is an error and is rejected. These are the findings that come back with every change.
            </p>
            <div className="lint-columns">
              {(["flow", "design"] as const).map((kind) => (
                <div key={kind}>
                  <h3>{kind === "flow" ? "Does the flow hold together?" : "Is each state well made?"}</h3>
                  <ul className="rule-list">
                    {RULES.filter((r) => r.kind === kind).map((rule) => (
                      <li key={rule.code} className={`lint-${rule.severity}`}>
                        <span className="rule-code">{rule.code}</span>
                        <span>{rule.summary}</span>
                        <span className="rule-level">{rule.severity === "warning" ? "fix" : "weigh"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
