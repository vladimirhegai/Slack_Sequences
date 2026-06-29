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
  createdAt: string;
  updatedAt: string;
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
