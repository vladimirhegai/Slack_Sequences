/**
 * Seed content — Foundation B of the plugin system: a DETERMINISTIC seeded
 * generator of believable SaaS data (metric tiles, task/PR rows, names,
 * notification copy, log lines), flavored by the brief/scene topic. This is
 * the generalization of `topUpRowsMarkup`'s label-derivation from scavenged
 * plan strings into a real generator: it kills "Item 1 / Item 2 / Item 3"
 * filler without asking the author model to invent content it is reliably
 * bad at. Everything here is a pure function of (seed text, topic terms), so
 * host-injected plugin markup stays byte-identical across repair passes.
 */
import type { SeededRandom } from "./pluginKernel.ts";

/* ---------------------------------------------------------------- topics */

export type SeedDomain =
  | "devtools"
  | "analytics"
  | "comms"
  | "commerce"
  | "design"
  | "ai"
  | "generic";

export interface SeedTopic {
  /** Title-cased content words scavenged from the brief/scene text. */
  terms: string[];
  domain: SeedDomain;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "with", "that", "this", "into", "from",
  "over", "your", "our", "their", "its", "then", "when", "where", "what", "how",
  "scene", "shot", "film", "video", "launch", "product", "feature", "features",
  "new", "now", "one", "two", "three", "every", "each", "all", "more", "most",
]);

const DOMAIN_SIGNALS: Array<{ domain: SeedDomain; pattern: RegExp }> = [
  {
    domain: "devtools",
    pattern: /\b(deploy|build|ci|pipeline|pull request|pr\b|commit|merge|branch|api|latency|uptime|incident|log|terminal|cli|infra|kubernetes|docker|test)/i,
  },
  {
    domain: "analytics",
    pattern: /\b(dashboard|metric|chart|report|funnel|insight|analytics|kpi|revenue|growth|retention|conversion|churn|signups?)/i,
  },
  {
    domain: "comms",
    pattern: /\b(message|chat|thread|channel|inbox|notification|standup|meeting|team|reply|digest|summar)/i,
  },
  {
    domain: "commerce",
    pattern: /\b(order|checkout|cart|payment|invoice|subscription|billing|customer|refund|store)/i,
  },
  {
    domain: "design",
    pattern: /\b(design|figma|sketch|prototype|wireframe|mockup|artboard|handoff|typography|component)\b/i,
  },
  {
    domain: "ai",
    pattern: /\b(ai|agent|agents|prompt|prompts|llm|inference|token|tokens|completion|completions|embedding|embeddings|eval|evals|fine-tune|rag|chatbot|copilot|gpt)\b/i,
  },
];

/**
 * Derive the topic from whatever on-topic text is at hand (scene title,
 * purpose, foreground, plugin `topic` param, brief). Deterministic: term
 * order follows first appearance.
 */
export function deriveTopic(...texts: Array<string | undefined>): SeedTopic {
  const joined = texts.filter(Boolean).join(" ");
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of joined.split(/[^A-Za-z0-9'-]+/)) {
    const word = raw.trim();
    if (word.length < 3 || word.length > 24) continue;
    const lower = word.toLowerCase();
    if (STOPWORDS.has(lower) || seen.has(lower) || /^\d+$/.test(word)) continue;
    seen.add(lower);
    terms.push(word[0]!.toUpperCase() + word.slice(1));
    if (terms.length >= 12) break;
  }
  const domain = DOMAIN_SIGNALS.find((signal) => signal.pattern.test(joined))?.domain ?? "generic";
  return { terms, domain };
}

function term(topic: SeedTopic, rng: SeededRandom, fallback: string): string {
  return topic.terms.length ? rng.pick(topic.terms) : fallback;
}

/* ---------------------------------------------------------------- metrics */

export interface SeedMetric {
  label: string;
  /** Final display text (what the markup carries — the count-up target). */
  text: string;
  /** Numeric part of `text` (the `count` beat's value). */
  value: number;
  /** Delta chip copy, e.g. "▲ 23%". */
  delta: string;
  /** Whether the delta reads as good news (styling hook). */
  up: boolean;
}

interface MetricShape {
  label: string;
  min: number;
  max: number;
  decimals?: number;
  grouped?: boolean;
  suffix?: string;
  prefix?: string;
  /** A falling number is the good direction (latency, errors). */
  invert?: boolean;
}

const METRIC_SHAPES: Record<SeedDomain, MetricShape[]> = {
  devtools: [
    { label: "Deploys this week", min: 24, max: 96 },
    { label: "P95 latency", min: 84, max: 420, suffix: "ms", invert: true },
    { label: "Build time", min: 1.4, max: 6.8, decimals: 1, suffix: "s", invert: true },
    { label: "Uptime", min: 99.9, max: 99.99, decimals: 2, suffix: "%" },
    { label: "PRs merged", min: 18, max: 140 },
    { label: "Test pass rate", min: 96, max: 100, decimals: 1, suffix: "%" },
    { label: "Incidents open", min: 0, max: 3, invert: true },
  ],
  analytics: [
    { label: "Active users", min: 1800, max: 64000, grouped: true },
    { label: "Conversion", min: 2.4, max: 8.9, decimals: 1, suffix: "%" },
    { label: "Weekly signups", min: 320, max: 5200, grouped: true },
    { label: "Retention (d30)", min: 34, max: 68, suffix: "%" },
    { label: "MRR", min: 12, max: 240, prefix: "$", suffix: "k", grouped: false },
    { label: "NPS", min: 38, max: 72 },
  ],
  comms: [
    { label: "Threads resolved", min: 42, max: 380, grouped: true },
    { label: "Avg. reply time", min: 2, max: 18, suffix: "m", invert: true },
    { label: "Digests sent", min: 12, max: 96 },
    { label: "Hours saved / wk", min: 3, max: 22 },
    { label: "Channels covered", min: 8, max: 64 },
    { label: "Auto-replies sent", min: 40, max: 620, grouped: true },
  ],
  commerce: [
    { label: "Orders today", min: 140, max: 4800, grouped: true },
    { label: "AOV", min: 38, max: 240, prefix: "$" },
    { label: "Checkout rate", min: 3.1, max: 9.4, decimals: 1, suffix: "%" },
    { label: "Refund rate", min: 0.4, max: 2.1, decimals: 1, suffix: "%", invert: true },
    { label: "Repeat buyers", min: 22, max: 58, suffix: "%" },
    { label: "Revenue today", min: 4, max: 120, prefix: "$", suffix: "k" },
  ],
  design: [
    { label: "Files in review", min: 6, max: 48 },
    { label: "Components shipped", min: 12, max: 240, grouped: true },
    { label: "Handoff time", min: 1, max: 9, suffix: "d", invert: true },
    { label: "Design QA pass", min: 88, max: 99, suffix: "%" },
    { label: "Prototypes shared", min: 8, max: 120 },
    { label: "Libraries synced", min: 3, max: 40 },
  ],
  ai: [
    { label: "Tokens / run", min: 1200, max: 48000, grouped: true },
    { label: "Eval pass rate", min: 82, max: 99, decimals: 1, suffix: "%" },
    { label: "P95 response", min: 240, max: 1800, suffix: "ms", invert: true },
    { label: "Cost / 1k calls", min: 0.4, max: 6.5, decimals: 2, prefix: "$", invert: true },
    { label: "Prompts shipped", min: 12, max: 320, grouped: true },
    { label: "Agent success", min: 74, max: 98, suffix: "%" },
  ],
  generic: [
    { label: "Time saved / wk", min: 4, max: 26, suffix: "h" },
    { label: "Teams onboard", min: 12, max: 480, grouped: true },
    { label: "Tasks automated", min: 120, max: 8600, grouped: true },
    { label: "Satisfaction", min: 88, max: 99, suffix: "%" },
    { label: "Setup time", min: 2, max: 9, suffix: "min", invert: true },
    { label: "Adoption", min: 42, max: 96, suffix: "%" },
  ],
};

function formatMetric(shape: MetricShape, value: number): string {
  let fixed = value.toFixed(shape.decimals ?? 0);
  if (shape.grouped) {
    const parts = fixed.split(".");
    parts[0] = parts[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    fixed = parts.join(".");
  }
  return `${shape.prefix ?? ""}${fixed}${shape.suffix ?? ""}`;
}

export function seedMetrics(rng: SeededRandom, count: number, topic: SeedTopic): SeedMetric[] {
  const shapes = rng.take(METRIC_SHAPES[topic.domain], count);
  return shapes.map((shape) => {
    const span = shape.max - shape.min;
    const raw = shape.min + rng.next() * span;
    const value = Number(raw.toFixed(shape.decimals ?? 0));
    const deltaPct = rng.int(6, 48);
    const up = !shape.invert;
    return {
      label: shape.label,
      text: formatMetric(shape, value),
      value,
      delta: `${shape.invert ? "▼" : "▲"} ${deltaPct}%`,
      up,
    };
  });
}

/* ------------------------------------------------------------------ rows */

export interface SeedRow {
  title: string;
  meta: string;
  /** ok | busy | warn — a status chip the markup may render. */
  state: "ok" | "busy" | "warn";
}

const ROW_TEMPLATES: Record<SeedDomain, string[]> = {
  devtools: [
    "{term} pipeline green",
    "Fix flaky {term} test",
    "PR #{n}: {term} refactor",
    "Ship {term} endpoint",
    "Rollback guard for {term}",
    "Cache {term} responses",
    "Migrate {term} schema",
  ],
  analytics: [
    "{term} funnel review",
    "Weekly {term} report",
    "Segment: {term} cohort",
    "Alert: {term} spike",
    "Backfill {term} events",
    "Tag {term} conversions",
  ],
  comms: [
    "Standup: {term} team",
    "Digest: {term} thread",
    "Follow up on {term}",
    "Summarize {term} channel",
    "Escalate {term} blocker",
    "Handoff: {term} rotation",
  ],
  commerce: [
    "Order #{n} fulfilled",
    "Restock {term} SKU",
    "Refund review: #{n}",
    "Promo: {term} bundle",
    "Update {term} pricing",
    "Ship {term} order",
  ],
  design: [
    "Review {term} mockup",
    "Handoff: {term} screen",
    "Update {term} component",
    "Prototype {term} flow",
    "Publish {term} tokens",
    "Spec {term} states",
  ],
  ai: [
    "Eval {term} prompt",
    "Tune {term} agent",
    "Label {term} dataset",
    "Trace {term} completion",
    "Ship {term} model card",
    "Guardrail for {term}",
  ],
  generic: [
    "Review {term} draft",
    "Approve {term} request",
    "Schedule {term} sync",
    "Update {term} doc",
    "Assign {term} task",
    "Close {term} ticket",
  ],
};

const ROW_STATES: Array<SeedRow["state"]> = ["ok", "ok", "busy", "ok", "warn", "busy"];

export function seedRows(rng: SeededRandom, count: number, topic: SeedTopic): SeedRow[] {
  const templates = rng.take(ROW_TEMPLATES[topic.domain], count);
  const people = seedNames(rng, Math.min(count, 4));
  return templates.map((template, i) => ({
    title: template
      .replace("{term}", term(topic, rng, "release"))
      .replace("{n}", String(rng.int(1002, 4980))),
    meta: `${people[i % people.length]!.name} · ${rng.int(2, 55)}m ago`,
    state: ROW_STATES[i % ROW_STATES.length]!,
  }));
}

/* ----------------------------------------------------------------- people */

export interface SeedPerson {
  name: string;
  initials: string;
}

const FIRST_NAMES = [
  "Ava", "Noah", "Mia", "Leo", "Zoe", "Kai", "Iris", "Owen", "Nia", "Eli",
  "Luca", "Maya", "Finn", "Ruth", "Omar", "Lena", "Theo", "Anya", "Ravi", "June",
];
const LAST_NAMES = [
  "Park", "Diaz", "Chen", "Okafor", "Silva", "Novak", "Haas", "Ito", "Weber",
  "Moss", "Vega", "Khan", "Berg", "Reyes", "Lund", "Osei", "Tran", "Bell",
];

export function seedNames(rng: SeededRandom, count: number): SeedPerson[] {
  const firsts = rng.take(FIRST_NAMES, count);
  const lasts = rng.take(LAST_NAMES, count);
  return firsts.map((first, i) => ({
    name: `${first} ${lasts[i]!}`,
    initials: `${first[0]!}${lasts[i]![0]!}`,
  }));
}

/* ----------------------------------------------------------- notifications */

export interface SeedToast {
  title: string;
  meta: string;
  tone: "ok" | "warn";
}

const TOAST_TEMPLATES: Record<SeedDomain, Array<{ title: string; meta: string; tone: "ok" | "warn" }>> = {
  devtools: [
    { title: "Deploy complete", meta: "production · {s}s", tone: "ok" },
    { title: "CI green on {term}", meta: "{n} checks passed", tone: "ok" },
    { title: "PR #{n} merged", meta: "{name} · just now", tone: "ok" },
    { title: "Latency back to normal", meta: "p95 {ms}ms", tone: "ok" },
    { title: "Rollback ready", meta: "{term} · 1-click", tone: "ok" },
    { title: "Flaky test quarantined", meta: "{term} suite", tone: "warn" },
  ],
  analytics: [
    { title: "Report ready", meta: "{term} · weekly", tone: "ok" },
    { title: "Signups up {pct}%", meta: "vs last week", tone: "ok" },
    { title: "Goal reached", meta: "{term} funnel", tone: "ok" },
    { title: "Funnel improved", meta: "{term} · +{pct}%", tone: "ok" },
    { title: "Churn down {pct}%", meta: "this month", tone: "ok" },
    { title: "Anomaly detected", meta: "{term} events", tone: "warn" },
  ],
  comms: [
    { title: "Digest sent", meta: "{n} threads summarized", tone: "ok" },
    { title: "Blocker resolved", meta: "{term} · {name}", tone: "ok" },
    { title: "Standup posted", meta: "{term} team", tone: "ok" },
    { title: "Thread summarized", meta: "{n} messages", tone: "ok" },
    { title: "Meeting recapped", meta: "{term} · {name}", tone: "ok" },
    { title: "Reply needed", meta: "{term} thread", tone: "warn" },
  ],
  commerce: [
    { title: "Order #{n} shipped", meta: "{name}", tone: "ok" },
    { title: "Sales up {pct}%", meta: "today", tone: "ok" },
    { title: "Payout sent", meta: "${n} · instant", tone: "ok" },
    { title: "Refund processed", meta: "#{n} · instant", tone: "ok" },
    { title: "Cart recovered", meta: "{term} · {name}", tone: "ok" },
    { title: "Low stock", meta: "{term} SKU", tone: "warn" },
  ],
  design: [
    { title: "Handoff shipped", meta: "{term} · {name}", tone: "ok" },
    { title: "Library published", meta: "{n} components", tone: "ok" },
    { title: "Prototype shared", meta: "{term} flow", tone: "ok" },
    { title: "Design QA passed", meta: "{term} screens", tone: "ok" },
    { title: "Review requested", meta: "{term} · {name}", tone: "warn" },
  ],
  ai: [
    { title: "Eval passed", meta: "{term} · {pct}%", tone: "ok" },
    { title: "Agent deployed", meta: "{term} · {name}", tone: "ok" },
    { title: "Prompt updated", meta: "{n} tests green", tone: "ok" },
    { title: "Fine-tune complete", meta: "{term} · {s}s", tone: "ok" },
    { title: "Latency spike", meta: "{term} model", tone: "warn" },
  ],
  generic: [
    { title: "Task complete", meta: "{term} · {name}", tone: "ok" },
    { title: "{n} items automated", meta: "this week", tone: "ok" },
    { title: "Approved", meta: "{term} request", tone: "ok" },
    { title: "Sync finished", meta: "{term} · {name}", tone: "ok" },
    { title: "Reminder set", meta: "{term}", tone: "ok" },
    { title: "Review requested", meta: "{term} · {name}", tone: "warn" },
  ],
};

export function seedToasts(
  rng: SeededRandom,
  count: number,
  topic: SeedTopic,
  tone: "ok" | "warn" | "mixed" = "ok",
): SeedToast[] {
  const pool = TOAST_TEMPLATES[topic.domain].filter((toast) =>
    tone === "mixed" ? true : toast.tone === tone,
  );
  const picks = rng.take(pool.length ? pool : TOAST_TEMPLATES[topic.domain], count);
  const people = seedNames(rng, 3);
  const fill = (text: string): string =>
    text
      .replace("{term}", term(topic, rng, "release"))
      .replace("{name}", people[rng.int(0, people.length - 1)]!.name)
      .replace("{n}", String(rng.int(12, 480)))
      .replace("{s}", String(rng.int(8, 40)))
      .replace("{ms}", String(rng.int(90, 240)))
      .replace("{pct}", String(rng.int(8, 42)));
  return picks.map((toast) => ({
    title: fill(toast.title),
    meta: fill(toast.meta),
    tone: toast.tone,
  }));
}

/* -------------------------------------------------------------- log lines */

const LOG_TEMPLATES = [
  "✓ built in {s}s",
  "✓ {n} modules transformed",
  "→ deploying to production…",
  "✓ health checks passed",
  "✓ cache warmed ({n} keys)",
  "→ invalidating CDN…",
  "✓ done in {s}s",
];

export function seedLogLines(rng: SeededRandom, count: number): string[] {
  return rng.take(LOG_TEMPLATES, count).map((line) =>
    line
      .replace("{s}", (rng.next() * 8 + 1).toFixed(1))
      .replace("{n}", String(rng.int(24, 1400))),
  );
}
