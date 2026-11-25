// Drawing with a pen: every outline, rule and fill in the kit goes through here.
// Strokes come from rough.js and are seeded, so a drawing never jitters between
// renders: the same component always gets the same wobble.

import rough from "roughjs";
import type { Options } from "roughjs/bin/core";
import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { tokens, type InkColor, type PenName, type RoughName } from "../../design-system/tokens";

const generator = rough.generator();

/** Stroke-width multiplier, raised inside scaled-down board frames so lines stay visible. */
export const InkScale = createContext(1);

/** A stable positive integer for a string, used as the rough.js seed. */
export function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2147483646) + 1;
}

export const INK: Record<InkColor, string> = {
  ink: tokens.color.ink,
  graphite: tokens.color.graphite,
  red: tokens.color.red,
  blue: tokens.color.blue,
  paper: tokens.color.paper,
  highlight: tokens.color.highlight,
  sticky: tokens.color.sticky,
};

export type InkShape = "box" | "underline" | "overline" | "rule" | "ellipse" | "cross" | "edge";

export interface InkStyle {
  pen?: PenName;
  color?: InkColor;
  /** Fill colour; omit for no fill. */
  fill?: InkColor;
  fillStyle?: "solid" | "hachure" | "cross-hatch";
  rough?: RoughName;
  dash?: boolean;
}

export interface PathSpec {
  d: string;
  stroke: string;
  strokeWidth: number;
  fill: string;
}

function options(seed: number, style: InkStyle, scale: number): Options {
  const strokeWidth = tokens.pen[style.pen ?? "regular"] * scale;
  const o: Options = {
    seed,
    roughness: tokens.rough[style.rough ?? "tight"],
    bowing: 1,
    stroke: INK[style.color ?? "ink"],
    strokeWidth,
    preserveVertices: false,
  };
  if (style.fill) {
    o.fill = INK[style.fill];
    o.fillStyle = style.fillStyle ?? "solid";
    o.fillWeight = strokeWidth * 0.7;
    o.hachureGap = 5 * scale;
  }
  if (style.dash) o.strokeLineDash = [6 * scale, 5 * scale];
  return o;
}

function toSpecs(drawables: ReturnType<typeof generator.rectangle>[]): PathSpec[] {
  return drawables.flatMap((drawable) =>
    generator.toPaths(drawable).map((p) => ({
      d: p.d,
      stroke: p.stroke,
      strokeWidth: p.strokeWidth,
      fill: p.fill ?? "none",
    })),
  );
}

/** Paths for a shape that fills a w × h box. */
export function shapePaths(shape: InkShape, w: number, h: number, seed: number, style: InkStyle, scale = 1): PathSpec[] {
  const o = options(seed, style, scale);
  const m = Math.max(1, (o.strokeWidth ?? 1) / 2 + 0.5);
  switch (shape) {
    case "box":
      return toSpecs([generator.rectangle(m, m, w - 2 * m, h - 2 * m, o)]);
    case "ellipse":
      return toSpecs([generator.ellipse(w / 2, h / 2, w - 2 * m, h - 2 * m, o)]);
    case "underline":
      return toSpecs([generator.line(0, h - m, w, h - m, o)]);
    case "overline":
      return toSpecs([generator.line(0, m, w, m, o)]);
    case "rule":
      return toSpecs([generator.line(0, h / 2, w, h / 2, o)]);
    case "edge":
      return toSpecs([generator.line(w - m, 0, w - m, h, o)]);
    case "cross": {
      const thin = { ...o, strokeWidth: (o.strokeWidth ?? 1) * 0.7, seed: seed + 1 };
      return toSpecs([
        generator.rectangle(m, m, w - 2 * m, h - 2 * m, o),
        generator.line(m, m, w - m, h - m, thin),
        generator.line(w - m, m, m, h - m, { ...thin, seed: seed + 2 }),
      ]);
    }
  }
}

/** Paths for a free line through points, optionally ending in an arrowhead. */
export function linePaths(
  points: [number, number][],
  seed: number,
  style: InkStyle,
  opts: { curve?: boolean; arrow?: boolean; scale?: number } = {},
): PathSpec[] {
  const o = options(seed, style, opts.scale ?? 1);
  const drawables = [opts.curve && points.length > 2 ? generator.curve(points, o) : generator.linearPath(points, o)];
  if (opts.arrow && points.length >= 2) {
    const [x2, y2] = points[points.length - 1];
    // Aim the head along the last stretch of the line, looking back far enough to be stable.
    let back = points[points.length - 2];
    for (let i = points.length - 2; i >= 0; i--) {
      back = points[i];
      if (Math.hypot(x2 - back[0], y2 - back[1]) > 12) break;
    }
    const angle = Math.atan2(y2 - back[1], x2 - back[0]);
    const size = 11;
    const spread = 0.42;
    const head = { ...o, roughness: 0.5, seed: seed + 7 };
    drawables.push(
      generator.linearPath(
        [
          [x2 - size * Math.cos(angle - spread), y2 - size * Math.sin(angle - spread)],
          [x2, y2],
          [x2 - size * Math.cos(angle + spread), y2 - size * Math.sin(angle + spread)],
        ],
        head,
      ),
    );
  }
  return toSpecs(drawables);
}

export function Paths({ specs }: { specs: PathSpec[] }): ReactElement {
  return (
    <>
      {specs.map((p, i) => (
        <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill={p.fill} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </>
  );
}

export interface InkProps extends InkStyle {
  shape: InkShape;
  /** Any stable string; the same seed always draws the same line. */
  seed: string;
}

/**
 * Draws a shape behind its parent, sized to the parent. The parent needs the
 * class "qm-inked" (position: relative; isolation: isolate).
 */
export function Ink({ shape, seed, pen, color, fill, fillStyle, rough: roughName, dash }: InkProps): ReactElement {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const scale = useContext(InkScale);

  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const measure = (): void => {
      const w = host.offsetWidth;
      const h = host.offsetHeight;
      setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const w = size?.w ?? 0;
  const h = size?.h ?? 0;
  const specs = useMemo(
    () => (w > 0 && h > 0 ? shapePaths(shape, w, h, seedOf(seed), { pen, color, fill, fillStyle, rough: roughName, dash }, scale) : []),
    [w, h, shape, seed, pen, color, fill, fillStyle, roughName, dash, scale],
  );

  return (
    <svg ref={ref} className="qm-ink" width={w} height={h} aria-hidden="true" focusable="false">
      <Paths specs={specs} />
    </svg>
  );
}

/** A small fixed-size drawing, such as a tick or a chevron. */
export function Glyph({
  kind,
  size = 16,
  seed,
  color = "ink",
}: {
  kind: "check" | "chevron" | "dot" | "spinner";
  size?: number;
  seed: string;
  color?: InkColor;
}): ReactElement {
  const scale = useContext(InkScale);
  const specs = useMemo(() => {
    const s = seedOf(seed);
    switch (kind) {
      case "check":
        return linePaths(
          [
            [size * 0.18, size * 0.55],
            [size * 0.42, size * 0.8],
            [size * 0.86, size * 0.2],
          ],
          s,
          { pen: "bold", color, rough: "tight" },
          { scale },
        );
      case "chevron":
        return linePaths(
          [
            [size * 0.2, size * 0.36],
            [size * 0.5, size * 0.68],
            [size * 0.8, size * 0.36],
          ],
          s,
          { pen: "regular", color, rough: "tight" },
          { scale },
        );
      case "dot":
        return shapePaths("ellipse", size, size, s, { pen: "fine", color, fill: color, fillStyle: "solid", rough: "tight" }, scale);
      case "spinner": {
        const o = options(s, { pen: "bold", color, rough: "tight" }, scale);
        const r = size - 4;
        return toSpecs([generator.arc(size / 2, size / 2, r, r, 0.4, Math.PI * 1.55, false, o)]);
      }
    }
  }, [kind, size, seed, color, scale]);
  return (
    <svg className={`qm-glyph qm-glyph-${kind}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      <Paths specs={specs} />
    </svg>
  );
}
