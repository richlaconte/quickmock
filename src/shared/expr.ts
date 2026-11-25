// Guard expressions: a tiny, safe language for `when` on transitions.
//   reason != ''            email == 'a@b.co' && !agreed
//   len(password) >= 8      isEmail(email)      contains(name, 'x')      empty(reason)
// No eval: the source is parsed into a tree and the tree is walked.

import type { Data, Scalar } from "./types";

type BinOp = "==" | "!=" | "<" | ">" | "<=" | ">=" | "&&" | "||";

export type Ast =
  | { t: "lit"; v: Scalar }
  | { t: "var"; name: string }
  | { t: "not"; a: Ast }
  | { t: "bin"; op: BinOp; a: Ast; b: Ast }
  | { t: "call"; fn: string; args: Ast[] };

export class ExprError extends Error {}

function truthy(v: Scalar | undefined): boolean {
  return !(v === false || v === "" || v === 0 || v === undefined || v === null);
}

export const FUNCTIONS: Record<string, { arity: number; doc: string; fn: (...a: Scalar[]) => Scalar }> = {
  empty: {
    arity: 1,
    doc: "empty(x): true when x is '', false or 0",
    fn: (x) => !truthy(x),
  },
  len: {
    arity: 1,
    doc: "len(x): number of characters in x",
    fn: (x) => String(x ?? "").length,
  },
  contains: {
    arity: 2,
    doc: "contains(x, y): true when x includes y, ignoring case",
    fn: (x, y) => String(x ?? "").toLowerCase().includes(String(y ?? "").toLowerCase()),
  },
  isEmail: {
    arity: 1,
    doc: "isEmail(x): true when x looks like an email address",
    fn: (x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x ?? "")),
  },
};

interface Tok {
  t: "num" | "str" | "id" | "op" | "eof";
  v: string;
  pos: number;
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      toks.push({ t: "num", v: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let out = "";
      while (j < src.length && src[j] !== ch) {
        if (src[j] === "\\" && j + 1 < src.length) {
          out += src[j + 1];
          j += 2;
        } else {
          out += src[j];
          j++;
        }
      }
      if (j >= src.length) throw new ExprError(`unterminated string starting at position ${i}`);
      toks.push({ t: "str", v: out, pos: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push({ t: "id", v: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    const three = src.slice(i, i + 3);
    if (three === "===" || three === "!==") {
      toks.push({ t: "op", v: three.slice(0, 2), pos: i });
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) {
      toks.push({ t: "op", v: two, pos: i });
      i += 2;
      continue;
    }
    if ("<>!(),-".includes(ch)) {
      toks.push({ t: "op", v: ch, pos: i });
      i++;
      continue;
    }
    if (ch === "=") throw new ExprError(`use == to compare, not = (position ${i})`);
    throw new ExprError(`unexpected "${ch}" at position ${i}`);
  }
  toks.push({ t: "eof", v: "", pos: src.length });
  return toks;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i];
  }
  private next(): Tok {
    return this.toks[this.i++];
  }
  private isOp(v: string): boolean {
    const tok = this.peek();
    return tok.t === "op" && tok.v === v;
  }
  private isWord(v: string): boolean {
    const tok = this.peek();
    return tok.t === "id" && tok.v === v;
  }

  parse(): Ast {
    const ast = this.or();
    const tok = this.peek();
    if (tok.t !== "eof") throw new ExprError(`unexpected "${tok.v}" at position ${tok.pos}`);
    return ast;
  }

  private or(): Ast {
    let a = this.and();
    while (this.isOp("||") || this.isWord("or")) {
      this.next();
      a = { t: "bin", op: "||", a, b: this.and() };
    }
    return a;
  }

  private and(): Ast {
    let a = this.not();
    while (this.isOp("&&") || this.isWord("and")) {
      this.next();
      a = { t: "bin", op: "&&", a, b: this.not() };
    }
    return a;
  }

  private not(): Ast {
    if (this.isOp("!") || this.isWord("not")) {
      this.next();
      return { t: "not", a: this.not() };
    }
    return this.cmp();
  }

  private cmp(): Ast {
    const a = this.primary();
    const tok = this.peek();
    if (tok.t === "op" && ["==", "!=", "<", ">", "<=", ">="].includes(tok.v)) {
      this.next();
      return { t: "bin", op: tok.v as BinOp, a, b: this.primary() };
    }
    return a;
  }

  private primary(): Ast {
    const tok = this.next();
    if (tok.t === "num") {
      const n = Number(tok.v);
      if (Number.isNaN(n)) throw new ExprError(`bad number "${tok.v}" at position ${tok.pos}`);
      return { t: "lit", v: n };
    }
    if (tok.t === "str") return { t: "lit", v: tok.v };
    if (tok.t === "op" && tok.v === "-") {
      const inner = this.primary();
      if (inner.t === "lit" && typeof inner.v === "number") return { t: "lit", v: -inner.v };
      throw new ExprError(`"-" can only come before a number (position ${tok.pos})`);
    }
    if (tok.t === "op" && tok.v === "(") {
      const inner = this.or();
      const close = this.next();
      if (!(close.t === "op" && close.v === ")")) throw new ExprError(`missing ")" at position ${close.pos}`);
      return inner;
    }
    if (tok.t === "id") {
      if (tok.v === "true") return { t: "lit", v: true };
      if (tok.v === "false") return { t: "lit", v: false };
      if (this.isOp("(")) {
        const def = FUNCTIONS[tok.v];
        if (!def) {
          throw new ExprError(`unknown function "${tok.v}" (available: ${Object.keys(FUNCTIONS).join(", ")})`);
        }
        this.next();
        const args: Ast[] = [];
        if (!this.isOp(")")) {
          args.push(this.or());
          while (this.isOp(",")) {
            this.next();
            args.push(this.or());
          }
        }
        const close = this.next();
        if (!(close.t === "op" && close.v === ")")) throw new ExprError(`missing ")" at position ${close.pos}`);
        if (args.length !== def.arity) {
          throw new ExprError(`${tok.v}() takes ${def.arity} argument${def.arity === 1 ? "" : "s"}, got ${args.length}`);
        }
        return { t: "call", fn: tok.v, args };
      }
      return { t: "var", name: tok.v };
    }
    if (tok.t === "eof") throw new ExprError("expression ends too early");
    throw new ExprError(`unexpected "${tok.v}" at position ${tok.pos}`);
  }
}

const cache = new Map<string, Ast>();

/** Parse a guard. Throws ExprError with a message meant to be shown to whoever wrote it. */
export function parseExpr(src: string): Ast {
  const hit = cache.get(src);
  if (hit) return hit;
  if (!src.trim()) throw new ExprError("expression is empty");
  const ast = new Parser(tokenize(src)).parse();
  cache.set(src, ast);
  return ast;
}

function looseEquals(a: Scalar, b: Scalar): boolean {
  if (typeof a === typeof b) return a === b;
  return String(a) === String(b);
}

function toNumber(v: Scalar): number {
  return typeof v === "number" ? v : Number(v);
}

function evaluate(ast: Ast, data: Data): Scalar {
  switch (ast.t) {
    case "lit":
      return ast.v;
    case "var":
      return data[ast.name] ?? "";
    case "not":
      return !truthy(evaluate(ast.a, data));
    case "call":
      return FUNCTIONS[ast.fn].fn(...ast.args.map((a) => evaluate(a, data)));
    case "bin": {
      if (ast.op === "&&") return truthy(evaluate(ast.a, data)) && truthy(evaluate(ast.b, data));
      if (ast.op === "||") return truthy(evaluate(ast.a, data)) || truthy(evaluate(ast.b, data));
      const a = evaluate(ast.a, data);
      const b = evaluate(ast.b, data);
      switch (ast.op) {
        case "==":
          return looseEquals(a, b);
        case "!=":
          return !looseEquals(a, b);
        case "<":
          return toNumber(a) < toNumber(b);
        case ">":
          return toNumber(a) > toNumber(b);
        case "<=":
          return toNumber(a) <= toNumber(b);
        case ">=":
          return toNumber(a) >= toNumber(b);
      }
    }
  }
}

/** True when the guard passes. A missing guard always passes; a broken one never does. */
export function passes(when: string | undefined, data: Data): boolean {
  if (when === undefined || when === "") return true;
  try {
    return truthy(evaluate(parseExpr(when), data));
  } catch {
    return false;
  }
}

/** Variable names a guard reads. */
export function exprVariables(src: string): string[] {
  const names = new Set<string>();
  const visit = (ast: Ast): void => {
    switch (ast.t) {
      case "var":
        names.add(ast.name);
        break;
      case "not":
        visit(ast.a);
        break;
      case "bin":
        visit(ast.a);
        visit(ast.b);
        break;
      case "call":
        ast.args.forEach(visit);
        break;
      default:
        break;
    }
  };
  visit(parseExpr(src));
  return [...names];
}
