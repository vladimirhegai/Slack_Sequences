/**
 * The one piece of new persistence the plan calls for: a tiny JSON map from a
 * Slack interaction to its Sequences project directory + the message we update
 * in place. Everything else lives in the project folder (project.json,
 * events.log, renders/). Single-process hackathon scope → naive read/modify/write.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./engine/projectTemplates.ts";

export type JobStatus = "building" | "ready" | "error";

export type StoredCreateTone = "crisp-saas" | "warm-startup" | "bold-launch";

/**
 * The minimum user-authored create request needed to start a fresh build.
 *
 * This is deliberately an allowlist rather than a serialized `CreateArgs`:
 * callbacks, OAuth tokens, retrieved Slack context, model output, and preset
 * functions must never land in jobs.json. The invoking user/team IDs are safe
 * handles used to retrieve the already-encrypted OAuth token again.
 */
export interface StoredCreateRequestV1 {
  version: 1;
  teamId?: string;
  userId?: string;
  product: string;
  brandName?: string;
  whatShipped: string;
  audience?: string;
  tone?: StoredCreateTone;
  lengthSec?: number;
  context?: string;
}

export interface Job {
  id: string;
  projectDir: string;
  channel: string;
  threadTs?: string;
  /** The bot message we chat.update in place. */
  messageTs?: string;
  status: JobStatus;
  title: string;
  mp4Path?: string;
  /** Canonical artifact used by Approve & share. */
  renderQuality?: "draft" | "high";
  /** Allowlisted original brief for a fresh create after a fail-loud result. */
  createRequest?: StoredCreateRequestV1;
  /** An explicit proof film was published; revision and fresh-create retry differ. */
  publishedFallback?: boolean;
  createdAt: string;
  updatedAt: string;
}

const TONES = new Set<StoredCreateTone>(["crisp-saas", "warm-startup", "bold-launch"]);

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, maxLength);
  return text || undefined;
}

/**
 * Pick and validate only retry-safe fields from an arbitrary create-shaped
 * value. This also treats an old/corrupt jobs.json entry as non-retryable
 * instead of passing unchecked persisted bytes into the authoring pipeline.
 */
export function normalizeStoredCreateRequest(value: unknown): StoredCreateRequestV1 | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const product = boundedString(input.product, 80);
  const whatShipped = boundedString(input.whatShipped, 2_000);
  if (!product || !whatShipped) return undefined;
  const tone = typeof input.tone === "string" && TONES.has(input.tone as StoredCreateTone)
    ? input.tone as StoredCreateTone
    : undefined;
  const lengthSec = typeof input.lengthSec === "number" && Number.isFinite(input.lengthSec)
    && input.lengthSec >= 1 && input.lengthSec <= 600
    ? input.lengthSec
    : undefined;

  const teamId = boundedString(input.teamId, 128);
  const userId = boundedString(input.userId, 128);
  const brandName = boundedString(input.brandName, 200);
  const audience = boundedString(input.audience, 200);
  const context = boundedString(input.context, 2_000);
  return {
    version: 1,
    ...(teamId ? { teamId } : {}),
    ...(userId ? { userId } : {}),
    product,
    ...(brandName ? { brandName } : {}),
    whatShipped,
    ...(audience ? { audience } : {}),
    ...(tone ? { tone } : {}),
    ...(lengthSec !== undefined ? { lengthSec } : {}),
    ...(context ? { context } : {}),
  };
}

/** Return a defensive, runtime-validated retry request for this job. */
export function retryCreateRequest(job: Job): StoredCreateRequestV1 | undefined {
  return normalizeStoredCreateRequest(job.createRequest);
}

/**
 * Bind a fresh retry to the human who actually triggered it. The saved user ID
 * proves provenance only; it must never silently lend the original invoker's
 * hosted-Slack-MCP permissions to another channel member.
 */
export function retryCreateRequestForActor(
  job: Job,
  actorUserId: string,
): StoredCreateRequestV1 | undefined {
  const request = retryCreateRequest(job);
  const userId = boundedString(actorUserId, 128);
  if (!request || !userId) return undefined;
  return { ...request, userId };
}

export type ConversationalJobAction = "busy" | "retry-create" | "revise" | "unavailable";

/** The deterministic owner for interpreting a human reply to a job thread. */
export function conversationalJobAction(job: Job): ConversationalJobAction {
  if (job.status === "building") return "busy";
  if (job.status === "error") return "retry-create";
  return job.projectDir ? "revise" : "unavailable";
}

function jobsFile(): string {
  return path.join(dataDir(), "jobs.json");
}

function readAll(): Record<string, Job> {
  const file = jobsFile();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Job>;
  } catch {
    return {};
  }
}

function writeAll(jobs: Record<string, Job>): void {
  const file = jobsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(jobs, null, 2) + "\n");
}

export function createJob(job: Omit<Job, "createdAt" | "updatedAt">): Job {
  const now = new Date().toISOString();
  const full: Job = { ...job, createdAt: now, updatedAt: now };
  const jobs = readAll();
  jobs[full.id] = full;
  writeAll(jobs);
  return full;
}

export function getJob(id: string): Job | undefined {
  return readAll()[id];
}

/** Every persisted job. Used at startup to find jobs orphaned by a restart. */
export function listJobs(): Job[] {
  return Object.values(readAll());
}

export function updateJob(id: string, patch: Partial<Job>): Job | undefined {
  const jobs = readAll();
  const existing = jobs[id];
  if (!existing) return undefined;
  const next: Job = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  jobs[id] = next;
  writeAll(jobs);
  return next;
}

/** Find the most recent job tied to a thread (for in-thread "revise" replies). */
export function findJobByThread(channel: string, threadTs: string): Job | undefined {
  const jobs = Object.values(readAll())
    .filter((job) => job.channel === channel && (job.threadTs === threadTs || job.messageTs === threadTs))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return jobs[0];
}
