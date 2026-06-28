/**
 * StepTemplate IR — the format Forge authors export and the engine interprets
 * (FORGE.md §2). It is the law-3 / law-8 bridge: a human hand-builds motion in
 * raw GSAP, then a "lift" step turns each concrete value into a token-pure,
 * parameterized template. The compiler interprets these templates into the same
 * `GsapStep[]` a hand-written primitive would emit, so authored extensions are
 * *data the engine interprets*, never code it runs.
 *
 * A `TemplateValue` is one of:
 *   - a literal `number` / `boolean` — passed through verbatim
 *   - a literal `string` not starting with `$` and containing no `${…}` — passed
 *     through verbatim (e.g. CSS like `blur(0px)` or `var(--c-accent)`)
 *   - an expression string starting with `$` — the text after `$` is evaluated
 *     in the template environment (e.g. `$distancePx`, `$round(1/scale,3)`)
 *   - an interpolation string containing `${…}` — each `${expr}` is evaluated and
 *     stitched back into the surrounding text (e.g. `blur(${blurPx}px)`)
 *
 * The environment is built from the compiler's `EmitContext` (see
 * `emitContextEnv`) plus any `constants` the bundle resolved from its tokens
 * (a knob bound to a token id) plus per-step `let` locals. There is no raw
 * numeric literal escape: every value either comes from the environment or is a
 * literal the author typed for a non-motion field. CI's easing-whitelist rule
 * still backstops the emitted eases.
 */
import type { EmitContext, GsapStep, MotionPrimitive, PrimitiveKindT } from "./types.ts";
import type { DistanceToken, DurationToken, EasingToken, ScaleToken } from "../tokens.ts";

export type TemplateValue = number | boolean | string;
export type TemplateVars = Record<string, TemplateValue>;

interface TemplateBase {
  /** Locals evaluated in order, added to scope for this step's fields. */
  let?: Record<string, string>;
}

export interface FromToTemplate extends TemplateBase {
  kind: "fromTo";
  target: string;
  from: TemplateVars;
  to: TemplateVars;
  durationSec: TemplateValue;
  ease: TemplateValue;
  atSec: TemplateValue;
}

export interface ToTemplate extends TemplateBase {
  kind: "to";
  target: string;
  vars: TemplateVars;
  durationSec: TemplateValue;
  ease: TemplateValue;
  atSec: TemplateValue;
}

export interface SetTemplate extends TemplateBase {
  kind: "set";
  target: string;
  vars: TemplateVars;
  atSec: TemplateValue;
}

/** Escape hatch for imperative motion (counters, per-char splits). `code` is an
 *  interpolated template referencing the in-scope GSAP `tl`; every ease it uses
 *  must be declared in `easesUsed` so the easing-whitelist linter can see them. */
export interface CustomTemplate extends TemplateBase {
  kind: "custom";
  code: string;
  easesUsed: TemplateValue[];
}

export type StepTemplate = FromToTemplate | ToTemplate | SetTemplate | CustomTemplate;

export type TemplateEnv = Record<string, number | string | boolean>;

/** JSON-string-escaping identical to the primitives' emit path, so custom
 *  templates can embed selectors/strings into code byte-for-byte. */
export function jsEscape(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// ── tiny safe expression evaluator (no eval/Function) ──────────────────────
// Grammar: additive → multiplicative → unary → primary
//   primary := number | ident | ident '(' args ')' | '(' expr ')'
// Identifiers resolve from the environment; bare identifiers may be strings,
// arithmetic operands must be numbers.

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

const FUNCS: Record<string, (args: number[]) => number> = {
  round: (args) => {
    const x = args[0] ?? 0;
    const f = 10 ** (args[1] ?? 0);
    return Math.round(x * f) / f;
  },
  min: (args) => Math.min(...args),
  max: (args) => Math.max(...args),
  abs: (args) => Math.abs(args[0] ?? 0),
  floor: (args) => Math.floor(args[0] ?? 0),
  ceil: (args) => Math.ceil(args[0] ?? 0),
};

const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isIdentStart = (c: string): boolean =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const at = (k: number): string => src[k] ?? "";
  while (i < src.length) {
    const c = at(i);
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(at(i + 1)))) {
      let j = i + 1;
      while (j < src.length && (isDigit(at(j)) || at(j) === ".")) j++;
      toks.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdentPart(at(j))) j++;
      toks.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/(),".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`stepTemplate: bad character '${c}' in expression '${src}'`);
  }
  return toks;
}

type ExprValue = number | string | boolean;

function evalExpr(src: string, env: TemplateEnv): ExprValue {
  const toks = tokenize(src);
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];
  const eat = (): Tok => {
    const tk = toks[pos++];
    if (!tk) throw new Error(`stepTemplate: unexpected end of '${src}'`);
    return tk;
  };

  const expect = (v: string): void => {
    const tk = eat();
    if (!tk || tk.t !== "op" || tk.v !== v) throw new Error(`stepTemplate: expected '${v}' in '${src}'`);
  };

  const num = (val: ExprValue): number => {
    if (typeof val !== "number") throw new Error(`stepTemplate: '${src}' uses non-number in arithmetic`);
    return val;
  };

  function primary(): ExprValue {
    const tk = peek();
    if (!tk) throw new Error(`stepTemplate: unexpected end of '${src}'`);
    if (tk.t === "num") {
      eat();
      return tk.v;
    }
    if (tk.t === "op" && tk.v === "(") {
      eat();
      const v = additive();
      expect(")");
      return v;
    }
    if (tk.t === "id") {
      eat();
      if (peek()?.t === "op" && (peek() as Tok).v === "(") {
        eat();
        const args: number[] = [];
        if (!(peek()?.t === "op" && (peek() as Tok).v === ")")) {
          args.push(num(additive()));
          while (peek()?.t === "op" && (peek() as Tok).v === ",") {
            eat();
            args.push(num(additive()));
          }
        }
        expect(")");
        const fn = FUNCS[tk.v];
        if (!fn) throw new Error(`stepTemplate: unknown function '${tk.v}' in '${src}'`);
        return fn(args);
      }
      const val = env[tk.v];
      if (val === undefined) throw new Error(`stepTemplate: unknown identifier '${tk.v}' in '${src}'`);
      return val;
    }
    throw new Error(`stepTemplate: unexpected token in '${src}'`);
  }

  function unary(): ExprValue {
    if (peek()?.t === "op" && (peek() as Tok).v === "-") {
      eat();
      return -num(unary());
    }
    return primary();
  }

  function multiplicative(): ExprValue {
    let left = unary();
    while (peek()?.t === "op" && ((peek() as Tok).v === "*" || (peek() as Tok).v === "/")) {
      const op = (eat() as Tok).v;
      const right = num(unary());
      left = op === "*" ? num(left) * right : num(left) / right;
    }
    return left;
  }

  function additive(): ExprValue {
    let left = multiplicative();
    while (peek()?.t === "op" && ((peek() as Tok).v === "+" || (peek() as Tok).v === "-")) {
      const op = (eat() as Tok).v;
      const right = num(multiplicative());
      left = op === "+" ? num(left) + right : num(left) - right;
    }
    return left;
  }

  const result = additive();
  if (pos !== toks.length) throw new Error(`stepTemplate: trailing tokens in '${src}'`);
  return result;
}

/** Resolve one TemplateValue against the environment. */
export function resolveValue(value: TemplateValue, env: TemplateEnv): string | number | boolean {
  if (typeof value !== "string") return value;
  if (value.includes("${")) {
    return value.replace(/\$\{([^}]*)\}/g, (_m, expr) => String(evalExpr(expr, env)));
  }
  if (value.startsWith("$")) return evalExpr(value.slice(1), env);
  return value;
}

function resolveVars(vars: TemplateVars, env: TemplateEnv): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(vars)) out[k] = resolveValue(v, env);
  return out;
}

function withLocals(step: StepTemplate, env: TemplateEnv): TemplateEnv {
  if (!step.let) return env;
  const scope: TemplateEnv = { ...env };
  for (const [name, expr] of Object.entries(step.let)) scope[name] = evalExpr(expr, scope);
  return scope;
}

function asString(value: string | number | boolean, field: string): string {
  if (typeof value !== "string") throw new Error(`stepTemplate: '${field}' must resolve to a string`);
  return value;
}

function asNumber(value: string | number | boolean, field: string): number {
  if (typeof value !== "number") throw new Error(`stepTemplate: '${field}' must resolve to a number`);
  return value;
}

/** Interpret a skeleton into concrete GsapSteps for one layer's emit context. */
export function resolveTemplate(skeleton: StepTemplate[], baseEnv: TemplateEnv): GsapStep[] {
  return skeleton.map((step) => {
    const env = withLocals(step, baseEnv);
    if (step.kind === "custom") {
      return {
        kind: "custom",
        code: String(resolveValue(step.code, env)),
        easesUsed: step.easesUsed.map((e) => asString(resolveValue(e, env), "easesUsed")),
      };
    }
    const target = asString(resolveValue(step.target, env), "target");
    const atSec = asNumber(resolveValue(step.atSec, env), "atSec");
    if (step.kind === "set") {
      return { kind: "set", target, vars: resolveVars(step.vars, env), atSec };
    }
    const durationSec = asNumber(resolveValue(step.durationSec, env), "durationSec");
    const ease = asString(resolveValue(step.ease, env), "ease");
    if (step.kind === "fromTo") {
      return {
        kind: "fromTo",
        target,
        from: resolveVars(step.from, env),
        to: resolveVars(step.to, env),
        durationSec,
        ease,
        atSec,
      };
    }
    return { kind: "to", target, vars: resolveVars(step.vars, env), durationSec, ease, atSec };
  });
}

/** Flatten an EmitContext into the template environment the interpreter reads. */
export function emitContextEnv(ctx: EmitContext): TemplateEnv {
  const num = ctx.layer.content.number ?? { value: 0, prefix: "", suffix: "" };
  return {
    inner: ctx.innerSel,
    container: ctx.containerSel,
    startSec: ctx.startSec,
    durationSec: ctx.durationSec,
    ease: ctx.ease,
    distancePx: ctx.distancePx,
    scale: ctx.scale,
    sceneStartSec: ctx.sceneStartSec,
    sceneDurationSec: ctx.sceneDurationSec,
    fps: ctx.fps,
    stageWidth: ctx.stageWidth,
    stageHeight: ctx.stageHeight,
    // Pre-escaped helpers for `custom` templates that build GSAP code strings.
    innerJs: jsEscape(ctx.innerSel),
    containerJs: jsEscape(ctx.containerSel),
    easeJs: jsEscape(ctx.ease),
    numberValue: num.value,
    numberPrefixJs: jsEscape(num.prefix),
    numberSuffixJs: jsEscape(num.suffix),
  };
}

/** Identifier names `emitContextEnv` always provides — the baseline an authored
 *  bundle's expressions may reference without declaring a token/knob. */
export const EMIT_ENV_NAMES: readonly string[] = [
  "inner",
  "container",
  "startSec",
  "durationSec",
  "ease",
  "distancePx",
  "scale",
  "sceneStartSec",
  "sceneDurationSec",
  "fps",
  "stageWidth",
  "stageHeight",
  "innerJs",
  "containerJs",
  "easeJs",
  "numberValue",
  "numberPrefixJs",
  "numberSuffixJs",
];

function collectExprIdentifiers(src: string, out: Set<string>): void {
  const toks = tokenize(src);
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (!tk || tk.t !== "id") continue;
    const next = toks[k + 1];
    if (next && next.t === "op" && next.v === "(") continue; // function call name
    if (tk.v in FUNCS) continue;
    out.add(tk.v);
  }
}

function collectValueIdentifiers(value: TemplateValue, out: Set<string>): void {
  if (typeof value !== "string") return;
  if (value.includes("${")) {
    for (const m of value.matchAll(/\$\{([^}]*)\}/g)) collectExprIdentifiers(m[1] ?? "", out);
    return;
  }
  if (value.startsWith("$")) collectExprIdentifiers(value.slice(1), out);
}

/** Every environment identifier a skeleton references (minus locals it defines).
 *  Used by install-time validation to prove a bundle resolves against the
 *  emit env plus its own declared tokens/knobs. */
export function collectIdentifiers(skeleton: StepTemplate[]): Set<string> {
  const used = new Set<string>();
  const locals = new Set<string>();
  for (const step of skeleton) {
    if (step.let) {
      for (const [name, expr] of Object.entries(step.let)) {
        collectExprIdentifiers(expr, used);
        locals.add(name);
      }
    }
    if (step.kind === "custom") {
      collectValueIdentifiers(step.code, used);
      for (const e of step.easesUsed) collectValueIdentifiers(e, used);
      continue;
    }
    collectValueIdentifiers(step.target, used);
    collectValueIdentifiers(step.atSec, used);
    if (step.kind !== "set") {
      collectValueIdentifiers(step.durationSec, used);
      collectValueIdentifiers(step.ease, used);
    }
    const varGroups = step.kind === "fromTo" ? [step.from, step.to] : [step.vars];
    for (const group of varGroups) {
      for (const v of Object.values(group)) collectValueIdentifiers(v, used);
    }
  }
  for (const l of locals) used.delete(l);
  return used;
}

/** A primitive authored as a token-pure skeleton instead of a TS `emit`. This
 *  is the shape Forge publishes inside a `.seqext` and the engine consumes. */
export interface TemplatePrimitiveDef {
  id: string;
  kind: PrimitiveKindT;
  summary: string;
  tags: { energy: "calm" | "punchy"; style: "organic" | "mechanical" };
  defaults: {
    duration: DurationToken;
    easing: EasingToken;
    distance?: DistanceToken;
    scale?: ScaleToken;
  };
  needsMask?: boolean;
  /** Knob values resolved from the bundle's tokens (knob name → value). Merged
   *  into the environment so skeleton expressions reference them by name. */
  constants?: Record<string, number | string>;
  skeleton: StepTemplate[];
}

/** Build a registry-shaped MotionPrimitive backed by a StepTemplate skeleton. */
export function templatePrimitive(def: TemplatePrimitiveDef): MotionPrimitive {
  return {
    id: def.id,
    kind: def.kind,
    summary: def.summary,
    tags: def.tags,
    defaults: def.defaults,
    ...(def.needsMask ? { needsMask: true } : {}),
    emit(ctx: EmitContext): GsapStep[] {
      const env = { ...emitContextEnv(ctx), ...(def.constants ?? {}) };
      return resolveTemplate(def.skeleton, env);
    },
  };
}
