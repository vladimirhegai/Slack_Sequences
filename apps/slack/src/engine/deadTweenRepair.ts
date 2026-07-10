import { parseHTML } from "linkedom";

export interface DeadTweenRepairResult {
  html: string;
  removed: number;
  selectors: string[];
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

function firstArgument(call: string): string | undefined {
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
    else if (char === "," && depth === 0) return call.slice(open + 1, index).trim();
  }
  return undefined;
}

function literalSelector(argument: string | undefined): string | undefined {
  if (!argument || argument.length < 2) return undefined;
  const quote = argument[0];
  if ((quote !== "\"" && quote !== "'") || argument.at(-1) !== quote) return undefined;
  const body = argument.slice(1, -1);
  // CSS selector literals almost never need escaping. Leave uncommon escape
  // forms alone rather than risk changing a valid authored binding.
  if (/\\(?![\\'\"])/.test(body)) return undefined;
  return body.replace(/\\([\\'\"])/g, "$1");
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

function repairScript(source: string, document: DomDocument): {
  source: string;
  removed: number;
  selectors: string[];
} {
  const callStart = /\b(?:gsap|[A-Za-z_$][\w$]*)\s*\.\s*(?:to|from|fromTo|set)\s*\(/g;
  let result = "";
  let cursor = 0;
  let removed = 0;
  const selectors: string[] = [];

  for (const match of source.matchAll(callStart)) {
    const start = match.index ?? 0;
    // Only standalone calls are safe to erase. Chained calls or calls embedded
    // in expressions can have meaningful surrounding syntax, so leave them to
    // the existing browser backstop.
    const prior = source.slice(0, start).trimEnd().at(-1);
    if (prior && !";{}".includes(prior)) continue;
    const open = source.indexOf("(", start);
    const end = open < 0 ? -1 : findCallEnd(source, open);
    if (end < 0) continue;
    const selector = literalSelector(firstArgument(source.slice(start, end + 1)));
    if (selector === undefined || !selectorMissing(document, selector)) continue;

    let statementEnd = end + 1;
    while (/\s/.test(source[statementEnd] ?? "")) statementEnd += 1;
    if (source[statementEnd] === ";") statementEnd += 1;
    result += source.slice(cursor, start);
    cursor = statementEnd;
    removed += 1;
    selectors.push(selector);
  }
  return removed ? { source: result + source.slice(cursor), removed, selectors } : {
    source,
    removed,
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
    return { html, removed: 0, selectors: [] };
  }

  let removed = 0;
  const selectors: string[] = [];
  const result = html.replace(
    /<script\b(?![^>]*\bsrc\s*=)(?![^>]*\bdata-sequences-host\b)[^>]*>([\s\S]*?)<\/script>/gi,
    (block, source: string) => {
      const repaired = repairScript(source, document);
      removed += repaired.removed;
      selectors.push(...repaired.selectors);
      return repaired.removed ? block.replace(source, repaired.source) : block;
    },
  );
  return { html: result, removed, selectors: [...new Set(selectors)] };
}
