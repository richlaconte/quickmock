// The React kit: one renderer per component in the design system registry.
// A test checks that this file and the registry list exactly the same types.

import {
  createContext,
  useContext,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { tokens } from "../../design-system/tokens";
import { interpolate } from "../../shared/machine";
import type { Data, Device as DeviceName, FlowNode, Scalar } from "../../shared/types";
import { Glyph, Ink } from "./ink";

export interface RenderContext {
  data: Data;
  /** False for board frames: nothing fires and nothing takes focus. */
  interactive: boolean;
  fire: (event: string, set?: Data) => void;
  change: (variable: string, value: Scalar) => void;
  /** Point mode: a click selects a component for the agent instead of using it. */
  pointing: boolean;
  pointed?: string;
  point: (path: string, node: FlowNode) => void;
  /** Prefix for stroke seeds, so each frame keeps its own stable lines. */
  seed: string;
}

const noop = (): void => {};

export const STATIC_CONTEXT: Omit<RenderContext, "data" | "seed"> = {
  interactive: false,
  fire: noop,
  change: noop,
  pointing: false,
  point: noop,
};

const Ctx = createContext<RenderContext>({ ...STATIC_CONTEXT, data: {}, seed: "" });

function useRender(): RenderContext {
  return useContext(Ctx);
}

export function cx(...parts: (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(" ");
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function useText(): (value: unknown) => string {
  const { data } = useRender();
  return (value) => (typeof value === "string" ? interpolate(value, data) : "");
}

interface ViewProps {
  node: FlowNode;
  path: string;
}

/** Root element of every component: carries its path, its grow share and point-mode clicks. */
function Box({
  node,
  path,
  className,
  style,
  children,
}: ViewProps & { className?: string; style?: CSSProperties; children?: ReactNode }): ReactElement {
  const ctx = useRender();
  const grow = typeof node.grow === "number" ? node.grow : undefined;
  const onClick = ctx.pointing
    ? (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        ctx.point(path, node);
      }
    : undefined;
  return (
    <div
      className={cx("qm-c", `qm-${node.type}`, className, ctx.pointing && "qm-pointable", ctx.pointed === path && "qm-pointed")}
      data-path={path}
      style={grow ? { flexGrow: grow, flexBasis: 0, minWidth: 0, ...style } : style}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

function Children({ nodes, path, prop = "children" }: { nodes: unknown; path: string; prop?: string }): ReactElement {
  const list = Array.isArray(nodes) ? (nodes as FlowNode[]) : [];
  return (
    <>
      {list.map((child, i) => (
        <Node key={i} node={child} path={`${path}.${prop}[${i}]`} />
      ))}
    </>
  );
}

// ── layout ──────────────────────────────────────────────────────────────────

function StackView({ node, path }: ViewProps): ReactElement {
  return (
    <Box node={node} path={path} className={cx("qm-stack", `qm-gap-${str(node.gap) ?? "md"}`, `qm-items-${str(node.align) ?? "stretch"}`)}>
      <Children nodes={node.children} path={path} />
    </Box>
  );
}

function RowView({ node, path }: ViewProps): ReactElement {
  return (
    <Box
      node={node}
      path={path}
      className={cx(
        "qm-row",
        `qm-gap-${str(node.gap) ?? "md"}`,
        `qm-items-${str(node.align) ?? "center"}`,
        `qm-justify-${str(node.justify) ?? "start"}`,
        node.wrap === true && "qm-wrap",
      )}
    >
      <Children nodes={node.children} path={path} />
    </Box>
  );
}

function CardView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  return (
    <Box node={node} path={path} className="qm-inked">
      <Ink shape="box" seed={`${ctx.seed}/${path}`} rough="loose" />
      {str(node.title) && <h3 className="qm-card-title">{t(node.title)}</h3>}
      <div className="qm-stack qm-gap-md">
        <Children nodes={node.children} path={path} />
      </div>
    </Box>
  );
}

function DividerView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  return (
    <Box node={node} path={path} className="qm-inked">
      <Ink shape="rule" seed={`${ctx.seed}/${path}`} pen="fine" />
    </Box>
  );
}

function ModalView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  const title = str(node.title);
  return (
    <Box node={node} path={path} className="qm-inked">
      <Ink shape="box" seed={`${ctx.seed}/${path}`} pen="bold" rough="loose" fill="paper" />
      <div role="dialog" aria-label={title ? t(title) : "Dialog"} className="qm-stack qm-gap-lg">
        {title && <h2 className="qm-h qm-h2">{t(title)}</h2>}
        <Children nodes={node.children} path={path} />
      </div>
    </Box>
  );
}

// ── text ────────────────────────────────────────────────────────────────────

function HeadingView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  const level = node.level === 1 || node.level === 3 ? node.level : 2;
  const Tag = `h${level}` as "h1" | "h2" | "h3";
  return (
    <Box node={node} path={path}>
      <Tag className={cx("qm-h", `qm-h${level}`, level === 1 && "qm-inked")}>
        {level === 1 && <Ink shape="underline" seed={`${ctx.seed}/${path}`} pen="bold" rough="loose" />}
        {t(node.text)}
      </Tag>
    </Box>
  );
}

function TextView({ node, path }: ViewProps): ReactElement {
  const t = useText();
  return (
    <Box node={node} path={path}>
      <p
        className={cx(
          "qm-p",
          `qm-tone-${str(node.tone) ?? "default"}`,
          str(node.size) === "sm" && "qm-small",
          str(node.align) === "center" && "qm-center",
        )}
      >
        {t(node.text)}
      </p>
    </Box>
  );
}

function LinkView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  const event = str(node.event);
  return (
    <Box node={node} path={path}>
      <button
        type="button"
        className="qm-anchor qm-inked"
        tabIndex={ctx.interactive ? 0 : -1}
        onClick={() => ctx.interactive && event && ctx.fire(event, node.set as Data | undefined)}
      >
        <Ink shape="underline" seed={`${ctx.seed}/${path}`} pen="fine" />
        {t(node.text)}
      </button>
    </Box>
  );
}

// ── actions ─────────────────────────────────────────────────────────────────

function ActionButton({
  label,
  event,
  set,
  variant = "default",
  disabled = false,
  seed,
}: {
  label: string;
  event?: string;
  set?: Data;
  variant?: string;
  disabled?: boolean;
  seed: string;
}): ReactElement {
  const ctx = useRender();
  const color = disabled ? "graphite" : variant === "danger" ? "red" : "ink";
  return (
    <button
      type="button"
      className={cx("qm-btn", "qm-inked", `qm-btn-${variant}`, disabled && "qm-disabled")}
      disabled={disabled}
      tabIndex={ctx.interactive ? 0 : -1}
      onClick={() => ctx.interactive && !disabled && event && ctx.fire(event, set)}
    >
      {variant !== "quiet" && (
        <Ink shape="box" seed={seed} color={color} fill={variant === "primary" && !disabled ? "ink" : undefined} dash={disabled} />
      )}
      <span>{label}</span>
    </button>
  );
}

function ButtonView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  return (
    <Box node={node} path={path} className={cx(node.full === true && "qm-full")}>
      <ActionButton
        label={t(node.label)}
        event={str(node.event)}
        set={node.set as Data | undefined}
        variant={str(node.variant)}
        disabled={node.disabled === true}
        seed={`${ctx.seed}/${path}`}
      />
    </Box>
  );
}

// ── inputs ──────────────────────────────────────────────────────────────────

function InputView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  const bind = str(node.bind) ?? "";
  const kind = str(node.kind) ?? "text";
  const value = String(ctx.data[bind] ?? "");
  const error = str(node.error);
  const shared = {
    value,
    placeholder: t(node.placeholder),
    readOnly: !ctx.interactive,
    tabIndex: ctx.interactive ? 0 : -1,
    "aria-invalid": error ? true : undefined,
  };
  return (
    <Box node={node} path={path}>
      <label className="qm-field">
        {str(node.label) && <span className="qm-label">{t(node.label)}</span>}
        <span className={cx("qm-control", "qm-inked", kind === "multiline" && "qm-control-tall")}>
          <Ink shape="box" seed={`${ctx.seed}/${path}`} color={error ? "red" : "ink"} />
          {kind === "multiline" ? (
            <textarea rows={3} {...shared} onChange={(e) => ctx.interactive && ctx.change(bind, e.target.value)} />
          ) : (
            <input
              type={kind === "number" || kind === "search" ? "text" : kind}
              inputMode={kind === "number" ? "numeric" : undefined}
              autoComplete="off"
              {...shared}
              onChange={(e) => ctx.interactive && ctx.change(bind, e.target.value)}
            />
          )}
        </span>
        {str(node.hint) && <span className="qm-hint">{t(node.hint)}</span>}
        {error && <span className="qm-error">{t(error)}</span>}
      </label>
    </Box>
  );
}

function SelectView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  const bind = str(node.bind) ?? "";
  const value = String(ctx.data[bind] ?? "");
  const options = Array.isArray(node.options) ? (node.options as string[]) : [];
  return (
    <Box node={node} path={path}>
      <label className="qm-field">
        {str(node.label) && <span className="qm-label">{t(node.label)}</span>}
        <span className="qm-control qm-select-wrap qm-inked">
          <Ink shape="box" seed={`${ctx.seed}/${path}`} />
          <select
            value={value}
            className={cx(!value && "qm-unset")}
            disabled={!ctx.interactive}
            tabIndex={ctx.interactive ? 0 : -1}
            onChange={(e) => ctx.interactive && ctx.change(bind, e.target.value)}
          >
            {!options.includes(value) && <option value={value}>{value ? value : t(node.placeholder)}</option>}
            {options.map((option) => (
              <option key={option} value={option}>
                {t(option)}
              </option>
            ))}
          </select>
          <Glyph kind="chevron" seed={`${ctx.seed}/${path}/chevron`} />
        </span>
      </label>
    </Box>
  );
}

function RadioView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  const bind = str(node.bind) ?? "";
  const value = String(ctx.data[bind] ?? "");
  const options = Array.isArray(node.options) ? (node.options as string[]) : [];
  const name = `${ctx.seed}/${path}`;
  return (
    <Box node={node} path={path}>
      <fieldset className="qm-fieldset">
        {str(node.label) && <legend className="qm-label">{t(node.label)}</legend>}
        {options.map((option, i) => (
          <label key={option} className="qm-option">
            <input
              type="radio"
              className="qm-sr"
              name={name}
              checked={value === option}
              disabled={!ctx.interactive}
              onChange={() => ctx.interactive && ctx.change(bind, option)}
            />
            <span className="qm-mark qm-inked">
              <Ink shape="ellipse" seed={`${name}/${i}`} />
              {value === option && <Glyph kind="dot" size={10} seed={`${name}/${i}/dot`} />}
            </span>
            <span>{t(option)}</span>
          </label>
        ))}
      </fieldset>
    </Box>
  );
}

function CheckboxView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  const bind = str(node.bind) ?? "";
  const checked = ctx.data[bind] === true || ctx.data[bind] === "true";
  const seed = `${ctx.seed}/${path}`;
  return (
    <Box node={node} path={path}>
      <label className="qm-option">
        <input
          type="checkbox"
          className="qm-sr"
          checked={checked}
          disabled={!ctx.interactive}
          onChange={(e) => ctx.interactive && ctx.change(bind, e.target.checked)}
        />
        <span className="qm-mark qm-inked">
          <Ink shape="box" seed={seed} />
          {checked && <Glyph kind="check" size={16} seed={`${seed}/check`} />}
        </span>
        <span>{t(node.label)}</span>
      </label>
    </Box>
  );
}

// ── data ────────────────────────────────────────────────────────────────────

function ListView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  const items = Array.isArray(node.items) ? (node.items as Record<string, unknown>[]) : [];
  return (
    <Box node={node} path={path}>
      <ul className="qm-list-items">
        {items.map((item, i) => {
          const event = str(item.event);
          const body = (
            <>
              <span className="qm-list-main">
                <span>{t(item.title)}</span>
                {str(item.subtitle) && <span className="qm-list-sub">{t(item.subtitle)}</span>}
              </span>
              {str(item.meta) && <span className="qm-list-meta">{t(item.meta)}</span>}
              {event && (
                <span className="qm-list-go" aria-hidden="true">
                  &rsaquo;
                </span>
              )}
            </>
          );
          return (
            <li key={i} className="qm-inked">
              <Ink shape="underline" seed={`${ctx.seed}/${path}/${i}`} pen="fine" color="graphite" />
              {event ? (
                <button
                  type="button"
                  className="qm-list-row"
                  tabIndex={ctx.interactive ? 0 : -1}
                  onClick={() => ctx.interactive && ctx.fire(event, item.set as Data | undefined)}
                >
                  {body}
                </button>
              ) : (
                <div className="qm-list-row">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Box>
  );
}

function TableView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  const columns = Array.isArray(node.columns) ? (node.columns as string[]) : [];
  const rows = Array.isArray(node.rows) ? (node.rows as unknown[][]) : [];
  const rowEvent = str(node.rowEvent);
  const rowBind = str(node.rowBind);
  const template: CSSProperties = { gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))` };
  const press = (row: unknown[]): void => {
    if (!ctx.interactive || !rowEvent) return;
    ctx.fire(rowEvent, rowBind ? { [rowBind]: String(row[0] ?? "") } : undefined);
  };
  return (
    <Box node={node} path={path}>
      <div role="table" className="qm-table-grid">
        <div role="row" className="qm-tr qm-th qm-inked" style={template}>
          <Ink shape="underline" seed={`${ctx.seed}/${path}/head`} />
          {columns.map((column, i) => (
            <span key={i} role="columnheader">
              {t(column)}
            </span>
          ))}
        </div>
        {rows.map((row, r) => (
          <div
            key={r}
            role="row"
            className={cx("qm-tr", "qm-inked", rowEvent && "qm-tr-press")}
            style={template}
            tabIndex={rowEvent && ctx.interactive ? 0 : undefined}
            onClick={() => press(row)}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                press(row);
              }
            }}
          >
            <Ink shape="underline" seed={`${ctx.seed}/${path}/${r}`} pen="fine" color="graphite" />
            {row.map((cell, c) => (
              <span key={c} role="cell">
                {t(String(cell))}
              </span>
            ))}
          </div>
        ))}
      </div>
    </Box>
  );
}

function ImageView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  const height = typeof node.height === "number" ? node.height : 140;
  const circle = str(node.shape) === "circle";
  return (
    <Box node={node} path={path}>
      <div
        className={cx("qm-image-box", "qm-inked", circle && "qm-image-circle")}
        style={circle ? { width: height, height } : { height }}
        role="img"
        aria-label={str(node.label) ? t(node.label) : "Image placeholder"}
      >
        <Ink shape={circle ? "ellipse" : "cross"} seed={`${ctx.seed}/${path}`} pen="fine" />
        {str(node.label) && !circle && <span className="qm-image-label">{t(node.label)}</span>}
      </div>
    </Box>
  );
}

function BadgeView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  const tone = str(node.tone) ?? "default";
  return (
    <Box node={node} path={path}>
      <span className={cx("qm-badge-tag", "qm-inked", `qm-tone-${tone}`)}>
        <Ink shape="box" seed={`${ctx.seed}/${path}`} pen="fine" color={tone === "error" ? "red" : tone === "muted" ? "graphite" : "ink"} />
        {t(node.text)}
      </span>
    </Box>
  );
}

// ── navigation ──────────────────────────────────────────────────────────────

function NavView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  const kind = str(node.kind) ?? "top";
  const items = Array.isArray(node.items) ? (node.items as Record<string, unknown>[]) : [];
  const seed = `${ctx.seed}/${path}`;
  const frameShape = kind === "side" ? "edge" : kind === "bottom" ? "overline" : "underline";
  return (
    <Box node={node} path={path} className={cx(`qm-nav-${kind}`)}>
      <nav className="qm-nav-bar qm-inked">
        <Ink shape={frameShape} seed={seed} />
        {str(node.brand) && <span className="qm-brand">{t(node.brand)}</span>}
        <span className="qm-nav-items">
          {items.map((item, i) => {
            const event = str(item.event);
            const active = item.active === true;
            return (
              <button
                key={i}
                type="button"
                className={cx("qm-nav-item", "qm-inked", active && "qm-active", !event && "qm-inert")}
                aria-current={active ? "page" : undefined}
                tabIndex={ctx.interactive && event ? 0 : -1}
                onClick={() => ctx.interactive && event && ctx.fire(event)}
              >
                {active && <Ink shape={kind === "side" ? "box" : "underline"} seed={`${seed}/${i}`} pen="bold" />}
                {t(item.label)}
              </button>
            );
          })}
        </span>
      </nav>
    </Box>
  );
}

function StepsView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  const items = Array.isArray(node.items) ? (node.items as string[]) : [];
  const current = typeof node.current === "number" ? node.current : 1;
  const seed = `${ctx.seed}/${path}`;
  return (
    <Box node={node} path={path}>
      <ol className="qm-steps-list">
        {items.map((item, i) => {
          const n = i + 1;
          const state = n === current ? "current" : n < current ? "done" : "todo";
          return (
            <li key={i} className={cx("qm-step", `qm-step-${state}`)} aria-current={state === "current" ? "step" : undefined}>
              {i > 0 && (
                <span className="qm-step-line qm-inked">
                  <Ink shape="rule" seed={`${seed}/line${i}`} pen="fine" color={state === "todo" ? "graphite" : "ink"} />
                </span>
              )}
              <span className="qm-step-dot qm-inked">
                <Ink
                  shape="ellipse"
                  seed={`${seed}/${i}`}
                  color={state === "todo" ? "graphite" : "ink"}
                  fill={state === "current" ? "ink" : undefined}
                />
                {state === "done" ? <Glyph kind="check" size={14} seed={`${seed}/${i}/check`} /> : n}
              </span>
              <span className="qm-step-label">{t(item)}</span>
            </li>
          );
        })}
      </ol>
    </Box>
  );
}

// ── feedback ────────────────────────────────────────────────────────────────

function AlertView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  const tone = str(node.tone) ?? "info";
  const seed = `${ctx.seed}/${path}`;
  const color = tone === "error" ? "red" : "ink";
  const action = typeof node.action === "object" && node.action !== null ? (node.action as Record<string, unknown>) : undefined;
  return (
    <Box node={node} path={path} className={cx("qm-inked", `qm-alert-${tone}`)}>
      <Ink shape="box" seed={seed} color={color} rough="loose" dash={tone === "info"} />
      <div className="qm-alert-body" role={tone === "error" ? "alert" : "status"}>
        <span className="qm-alert-mark qm-inked" aria-hidden="true">
          <Ink shape="ellipse" seed={`${seed}/mark`} color={color} pen="fine" />
          {tone === "success" ? <Glyph kind="check" size={14} seed={`${seed}/check`} /> : tone === "info" ? "i" : "!"}
        </span>
        <span className="qm-alert-text">{t(node.text)}</span>
        {action && (
          <ActionButton label={t(action.label)} event={str(action.event)} variant={tone === "error" ? "danger" : "default"} seed={`${seed}/action`} />
        )}
      </div>
    </Box>
  );
}

function LoadingView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  return (
    <Box node={node} path={path}>
      <div className="qm-loading-row" role="status">
        <Glyph kind="spinner" size={24} seed={`${ctx.seed}/${path}`} />
        <span>{str(node.text) ? t(node.text) : "Loading"}</span>
      </div>
    </Box>
  );
}

const SKELETON_WIDTHS = ["100%", "92%", "78%", "96%", "64%", "88%", "72%", "94%"];

function SkeletonView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const lines = typeof node.lines === "number" ? node.lines : 3;
  return (
    <Box node={node} path={path}>
      <div className="qm-skeleton-lines" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="qm-skeleton-line qm-inked" style={{ width: SKELETON_WIDTHS[i % SKELETON_WIDTHS.length] }}>
            <Ink shape="rule" seed={`${ctx.seed}/${path}/${i}`} pen="bold" color="graphite" rough="loose" />
          </span>
        ))}
      </div>
    </Box>
  );
}

function EmptyView({ node, path }: ViewProps): ReactElement {
  const ctx = useRender();
  const t = useText();
  const seed = `${ctx.seed}/${path}`;
  const action = typeof node.action === "object" && node.action !== null ? (node.action as Record<string, unknown>) : undefined;
  return (
    <Box node={node} path={path}>
      <div className="qm-empty-block">
        <span className="qm-empty-mark qm-inked" aria-hidden="true">
          <Ink shape="ellipse" seed={seed} color="graphite" dash />
        </span>
        <strong className="qm-empty-title">{t(node.title)}</strong>
        {str(node.text) && <p className="qm-p qm-tone-muted qm-center">{t(node.text)}</p>}
        {action && <ActionButton label={t(action.label)} event={str(action.event)} seed={`${seed}/action`} />}
      </div>
    </Box>
  );
}

// ── registry of renderers ───────────────────────────────────────────────────

export const RENDERERS: Record<string, (props: ViewProps) => ReactElement> = {
  stack: StackView,
  row: RowView,
  card: CardView,
  divider: DividerView,
  modal: ModalView,
  heading: HeadingView,
  text: TextView,
  link: LinkView,
  button: ButtonView,
  input: InputView,
  select: SelectView,
  radio: RadioView,
  checkbox: CheckboxView,
  list: ListView,
  table: TableView,
  image: ImageView,
  badge: BadgeView,
  nav: NavView,
  steps: StepsView,
  alert: AlertView,
  loading: LoadingView,
  skeleton: SkeletonView,
  empty: EmptyView,
};

export function Node({ node, path }: ViewProps): ReactElement {
  const View = RENDERERS[node.type];
  if (!View) return <div className="qm-unknown">Unknown component “{String(node.type)}”</div>;
  return <View node={node} path={path} />;
}

/**
 * A state's layout: the page, and the modal over it when there is one. `behind`
 * is the page of another frame, for a state that is drawn over it.
 */
export function StateLayout({
  layout,
  behind,
  context,
}: {
  layout: FlowNode[];
  behind?: FlowNode[];
  context: RenderContext;
}): ReactElement {
  const modalIndex = layout.findIndex((node) => node.type === "modal");
  const hasModal = modalIndex !== -1;
  return (
    <Ctx.Provider value={context}>
      <div className="qm-screen">
        <div className={cx("qm-layout", hasModal && "qm-behind")} inert={hasModal ? true : undefined}>
          {behind
            ? behind.map((node, i) => <Node key={i} node={node} path={`behind[${i}]`} />)
            : layout.map((node, i) => (node.type === "modal" ? null : <Node key={i} node={node} path={`layout[${i}]`} />))}
        </div>
      </div>
      {hasModal && (
        <div className="qm-modal-layer">
          <Node node={layout[modalIndex]} path={`layout[${modalIndex}]`} />
        </div>
      )}
    </Ctx.Provider>
  );
}

/** The sheet a state is drawn on, at the device's real size. */
export function Device({
  device,
  seed,
  children,
}: {
  device: DeviceName;
  seed: string;
  children: ReactNode;
}): ReactElement {
  const size = tokens.device[device];
  return (
    <div className={cx("qm-device", "qm-inked", `qm-device-${device}`)} style={{ width: size.width, height: size.height }}>
      <Ink shape="box" seed={`${seed}/device`} rough="loose" />
      {children}
    </div>
  );
}
