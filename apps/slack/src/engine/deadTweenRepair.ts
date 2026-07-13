import { parseHTML } from "linkedom";

export interface DeadTweenRepairResult {
  html: string;
  repairs: number;
  removed: number;
  neutralized: number;
  selectors: string[];
}

export interface DeadGsapDataflowAuditResult {
  readonly findings: readonly string[];
}

type DomDocument = {
  querySelector(selector: string): unknown;
};

function findCallEnd(source: string, open: number): number {
  let depth = 1;
  let quote: string | undefined;
  let escaped = false;
  for (let index = open + 1; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) return index;
  }
  return -1;
}

interface ArgumentRange {
  start: number;
  end: number;
  text: string;
}

function firstArgument(call: string): ArgumentRange | undefined {
  const open = call.indexOf("(");
  if (open < 0) return undefined;
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = open + 1; index < call.length; index += 1) {
    const char = call[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") quote = char;
    else if (char === "(" || char === "{" || char === "[") depth += 1;
    else if (char === ")" || char === "}" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      let start = open + 1;
      let end = index;
      while (/\s/.test(call[start] ?? "")) start += 1;
      while (end > start && /\s/.test(call[end - 1] ?? "")) end -= 1;
      return { start, end, text: call.slice(start, end) };
    }
  }
  return undefined;
}

function literalSelector(argument: string | undefined): string | undefined {
  if (!argument || argument.length < 2) return undefined;
  const quote = argument[0];
  if ((quote !== "\"" && quote !== "'" && quote !== "`") || argument.at(-1) !== quote) {
    return undefined;
  }
  const body = argument.slice(1, -1);
  if (quote === "`" && body.includes("${")) return undefined;
  // CSS selector literals almost never need escaping. Leave uncommon escape
  // forms alone rather than risk changing a valid authored binding.
  if (/\\(?![\\'\"])/.test(body)) return undefined;
  return body.replace(/\\([\\'\"])/g, "$1");
}

function missingTargetLabel(argument: string, document: DomDocument): string | undefined {
  const selector = literalSelector(argument);
  if (selector !== undefined) return selectorMissing(document, selector) ? selector : undefined;
  if (/^(?:null|undefined|\[\s*\])$/.test(argument)) return argument;

  // A literal querySelector/querySelectorAll call can be decided against the
  // final parsed document too. This covers the common authored form
  // `tl.to(document.querySelector("#late-node"), ...)`: at runtime it becomes a
  // null target and GSAP reports the unhelpful blank "target not found" warning.
  const query = argument.match(
    /^(?:document|[A-Za-z_$][\w$]*)\s*\.\s*querySelector(?:All)?\s*\(\s*((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`))\s*\)$/,
  );
  const queriedSelector = literalSelector(query?.[1]);
  return queriedSelector !== undefined && selectorMissing(document, queriedSelector)
    ? queriedSelector
    : undefined;
}

function standaloneStatement(source: string, start: number, end: number): boolean {
  const lineStart = Math.max(source.lastIndexOf("\n", start - 1), source.lastIndexOf("\r", start - 1)) + 1;
  const linePrefix = source.slice(lineStart, start);
  const beginsStatement = /^\s*$/.test(linePrefix) || (() => {
    const prior = source.slice(0, start).trimEnd().at(-1);
    return !prior || ";{}".includes(prior);
  })();
  if (!beginsStatement) return false;
  // Erasing the first link of `tl.to(...).to(...)` would leave a leading dot.
  let next = end + 1;
  while (/\s/.test(source[next] ?? "")) next += 1;
  return source[next] !== ".";
}

function codePosition(source: string, index: number): boolean {
  let state: "code" | "single" | "double" | "template" | "line-comment" | "block-comment" = "code";
  let escaped = false;
  for (let cursor = 0; cursor < index; cursor += 1) {
    const char = source[cursor]!;
    const next = source[cursor + 1];
    if (state === "line-comment") {
      if (char === "\n" || char === "\r") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "code";
        cursor += 1;
      }
      continue;
    }
    if (state !== "code") {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (
        (state === "single" && char === "'") ||
        (state === "double" && char === "\"") ||
        (state === "template" && char === "`")
      ) {
        state = "code";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      state = "line-comment";
      cursor += 1;
    } else if (char === "/" && next === "*") {
      state = "block-comment";
      cursor += 1;
    } else if (char === "'") state = "single";
    else if (char === "\"") state = "double";
    else if (char === "`") state = "template";
  }
  return state === "code";
}

function selectorMissing(document: DomDocument, selector: string): boolean {
  if (!selector.trim()) return true;
  try {
    return !document.querySelector(selector);
  } catch {
    // Invalid CSS selectors are GSAP no-ops with a console warning too.
    return true;
  }
}

const IDENTIFIER = "[A-Za-z_$][\\w$]*";
const PSEUDO_ELEMENT = /(^|[^\\]):{1,2}(?:before|after|first-line|first-letter|selection|backdrop|marker|placeholder|file-selector-button|part|slotted)\b/i;

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function variableQueryAssignments(source: string): Array<{
  variable: string;
  selector: string;
  start: number;
  end: number;
}> {
  const assignments: Array<{
    variable: string;
    selector: string;
    start: number;
    end: number;
  }> = [];
  const assignment = new RegExp(
    `(?:\\b(?:const|let|var)\\s+)?(${IDENTIFIER})\\s*=\\s*${IDENTIFIER}\\s*\\.\\s*querySelector(?:All)?\\s*\\(\\s*((?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\\x60(?:\\\\.|[^\\x60\\\\])*\\x60))\\s*\\)`,
    "g",
  );
  for (const match of source.matchAll(assignment)) {
    const start = match.index ?? 0;
    if (!codePosition(source, start)) continue;
    const selector = literalSelector(match[2]);
    if (selector === undefined) continue;
    assignments.push({
      variable: match[1]!,
      selector,
      start,
      end: start + match[0].length,
    });
  }
  return assignments;
}

function gsapUsesVariable(source: string, variable: string, from: number): boolean {
  const use = new RegExp(
    `(?:${IDENTIFIER})\\s*\\.\\s*(?:to|from|fromTo|set)\\s*\\(\\s*${escapedRegExp(variable)}\\s*(?=,|\\))`,
    "g",
  );
  for (const match of source.matchAll(use)) {
    const start = match.index ?? 0;
    if (start >= from && codePosition(source, start)) return true;
  }
  return false;
}

function auditScriptDeadGsapDataflow(source: string, document: DomDocument): string[] {
  const findings: string[] = [];
  for (const assignment of variableQueryAssignments(source)) {
    if (!gsapUsesVariable(source, assignment.variable, assignment.end)) continue;
    const reason = PSEUDO_ELEMENT.test(assignment.selector)
      ? "querySelector cannot produce a DOM element for a pseudo-element selector"
      : selectorMissing(document, assignment.selector)
        ? "the literal selector matches no element in the parsed document"
        : undefined;
    if (!reason) continue;
    findings.push(
      `dead_gsap_target: variable "${assignment.variable}" receives ` +
      `querySelector(${JSON.stringify(assignment.selector)}) and is passed to GSAP; ${reason}`,
    );
  }
  return findings;
}

/**
 * L3 static audit for the shallow query-result -> GSAP-target dataflow.
 * This intentionally understands only one direct variable assignment: it is
 * an AST-lite backstop, not a general JavaScript parser or rewriter.
 */
export function auditDeadGsapDataflow(html: string): DeadGsapDataflowAuditResult {
  let document: DomDocument;
  try {
    document = parseHTML(html).document as unknown as DomDocument;
  } catch {
    return { findings: [] };
  }
  const findings: string[] = [];
  html.replace(
    /<script\b(?![^>]*\bsrc\s*=)(?![^>]*\bdata-sequences-host\b)[^>]*>([\s\S]*?)<\/script>/gi,
    (_block, source: string) => {
      findings.push(...auditScriptDeadGsapDataflow(source, document));
      return _block;
    },
  );
  return { findings: [...new Set(findings)] };
}

function repairScript(source: string, document: DomDocument): {
  source: string;
  removed: number;
  neutralized: number;
  selectors: string[];
} {
  const callStart = /\b(?:gsap|[A-Za-z_$][\w$]*)\s*\.\s*(?:to|from|fromTo|set)\s*\(/g;
  let result = "";
  let cursor = 0;
  let removed = 0;
  let neutralized = 0;
  const selectors: string[] = [];

  for (const match of source.matchAll(callStart)) {
    const start = match.index ?? 0;
    if (start < cursor) continue;
    if (!codePosition(source, start)) continue;
    const open = source.indexOf("(", start);
    const end = open < 0 ? -1 : findCallEnd(source, open);
    if (end < 0) continue;
    const call = source.slice(start, end + 1);
    const argument = firstArgument(call);
    const selector = argument ? missingTargetLabel(argument.text, document) : undefined;
    if (selector === undefined) continue;

    if (standaloneStatement(source, start, end)) {
      let statementEnd = end + 1;
      while (/\s/.test(source[statementEnd] ?? "")) statementEnd += 1;
      if (source[statementEnd] === ";") statementEnd += 1;
      result += source.slice(cursor, start);
      cursor = statementEnd;
      removed += 1;
    } else {
      // Calls embedded in an assignment, return, conditional, or GSAP chain
      // cannot be erased without changing the surrounding program. Retarget the
      // no-op tween to an inert detached element instead: callbacks and timeline
      // duration remain intact, CSS/attr vars stay valid, and no visible DOM or
      // console warning is produced.
      result += source.slice(cursor, start) + call.slice(0, argument!.start) +
        'document.createElement("i")' +
        call.slice(argument!.end);
      cursor = end + 1;
      neutralized += 1;
    }
    selectors.push(selector);
  }
  return removed || neutralized
    ? { source: result + source.slice(cursor), removed, neutralized, selectors }
    : {
    source,
    removed,
    neutralized,
    selectors,
  };
}

/**
 * L2: strip authored GSAP calls whose literal selector cannot bind in the
 * parsed document. Such tweens are browser-runtime no-ops; removing them is
 * behavior-identical while preserving moment/motion checks for real work.
 */
export function stripDeadGsapTweens(html: string): DeadTweenRepairResult {
  let document: DomDocument;
  try {
    document = parseHTML(html).document as unknown as DomDocument;
  } catch {
    return { html, repairs: 0, removed: 0, neutralized: 0, selectors: [] };
  }

  let removed = 0;
  let neutralized = 0;
  const selectors: string[] = [];
  const result = html.replace(
    /<script\b(?![^>]*\bsrc\s*=)(?![^>]*\bdata-sequences-host\b)[^>]*>([\s\S]*?)<\/script>/gi,
    (block, source: string) => {
      const repaired = repairScript(source, document);
      removed += repaired.removed;
      neutralized += repaired.neutralized;
      selectors.push(...repaired.selectors);
      return repaired.removed || repaired.neutralized ? block.replace(source, repaired.source) : block;
    },
  );
  return {
    html: result,
    repairs: removed + neutralized,
    removed,
    neutralized,
    selectors: [...new Set(selectors)],
  };
}
