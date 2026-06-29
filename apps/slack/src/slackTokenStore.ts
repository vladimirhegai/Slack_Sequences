import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./engine/projectTemplates.ts";

interface EncryptedToken {
  iv: string;
  ciphertext: string;
  tag: string;
  scopes: string[];
  updatedAt: string;
}

type TokenFile = Record<string, EncryptedToken>;

function tokenFilePath(): string {
  return path.join(dataDir(), "slack-user-tokens.json");
}

function encryptionKey(): Buffer {
  const raw = process.env.SLACK_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("SLACK_TOKEN_ENCRYPTION_KEY is not configured");
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SLACK_TOKEN_ENCRYPTION_KEY must be 32 bytes (base64 or 64 hex characters)");
  }
  return key;
}

function recordKey(teamId: string, userId: string): string {
  return `${teamId}:${userId}`;
}

function readFile(): TokenFile {
  const file = tokenFilePath();
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8")) as TokenFile;
}

function writeFile(contents: TokenFile): void {
  const file = tokenFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(contents, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function storeSlackUserToken(input: {
  teamId: string;
  userId: string;
  token: string;
  scopes?: string[];
}): void {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(input.token, "utf8"),
    cipher.final(),
  ]);
  const records = readFile();
  records[recordKey(input.teamId, input.userId)] = {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    scopes: input.scopes ?? [],
    updatedAt: new Date().toISOString(),
  };
  writeFile(records);
}

export function getSlackUserToken(teamId: string, userId: string): string | undefined {
  const record = readFile()[recordKey(teamId, userId)];
  if (!record) return undefined;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(record.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
