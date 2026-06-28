import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Asset } from "@sequences/core";
import { contentAssetId, extractAssetMetadata, sha256File } from "./assetMetadata.ts";

const MEDIA_EXT: Record<string, "image" | "video" | "audio"> = {
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".svg": "image",
  ".mp4": "video",
  ".webm": "video",
  ".mp3": "audio",
  ".wav": "audio",
  ".ogg": "audio",
};

export function mediaKind(file: string): "image" | "video" | "audio" | null {
  return MEDIA_EXT[path.extname(file).toLowerCase()] ?? null;
}

export interface FsRoot {
  name: string;
  path: string;
}

export function fsRoots(workspaceDir: string): FsRoot[] {
  const roots: FsRoot[] = [
    { name: "Workspace", path: path.resolve(workspaceDir) },
    { name: "Home", path: os.homedir() },
  ];
  if (process.platform === "win32") {
    for (let c = 67; c <= 90; c++) {
      const drive = `${String.fromCharCode(c)}:\\`;
      if (fs.existsSync(drive)) roots.push({ name: drive, path: drive });
    }
  } else {
    roots.push({ name: "/", path: "/" });
  }
  const seen = new Set<string>();
  return roots.filter((root) =>
    seen.has(root.path) ? false : (seen.add(root.path), true),
  );
}

export interface FsListing {
  path: string;
  parent: string | null;
  dirs: Array<{ name: string; path: string }>;
  files: Array<{
    name: string;
    path: string;
    size: number;
    mtime: string;
    kind: string;
  }>;
}

export function listDisk(target: string): FsListing {
  const abs = path.resolve(target);
  const dirs: FsListing["dirs"] = [];
  const files: FsListing["files"] = [];
  for (const name of fs.readdirSync(abs)) {
    if (name.startsWith(".") || name.startsWith("$")) continue;
    const file = path.join(abs, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      dirs.push({ name, path: file });
    } else {
      const kind = mediaKind(name);
      if (kind) {
        files.push({
          name,
          path: file,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          kind,
        });
      }
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(abs);
  return { path: abs, parent: parent === abs ? null : parent, dirs, files };
}

export interface ImportedAsset {
  id: string;
  relPath: string;
  kind: "image" | "video" | "audio";
  contentHash: string;
  metadata: Asset["metadata"];
}

export function placeAsset(
  workspaceDir: string,
  fileName: string,
  folder: string,
  _existingIds: ReadonlySet<string>,
  write: (destination: string) => void,
): ImportedAsset {
  const kind = mediaKind(fileName);
  if (!kind) {
    throw new Error(
      `unsupported media type: ${path.extname(fileName) || fileName}`,
    );
  }
  const assetsRoot = path.join(workspaceDir, "assets");
  const folderParts = folder.replace(/\\/g, "/").split("/").filter(Boolean);
  if (
    folderParts.some(
      (part) => part === "." || part === ".." || /[<>:"|?*\0]/.test(part),
    )
  ) {
    throw new Error("invalid asset folder");
  }
  const cleanFolder = folderParts.join("/");
  const destDir = cleanFolder
    ? containedPath(assetsRoot, cleanFolder)
    : assetsRoot;
  fs.mkdirSync(destDir, { recursive: true });

  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let name = `${base}${ext}`;
  let n = 2;
  while (fs.existsSync(path.join(destDir, name))) {
    name = `${base}-${n++}${ext}`;
  }
  const relPath = [
    "assets",
    ...(cleanFolder ? [cleanFolder] : []),
    name,
  ].join("/");
  const destination = path.join(destDir, name);
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  try {
    write(temporary);
    const handle = fs.openSync(temporary, "r+");
    try {
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  const contentHash = sha256File(destination);
  return {
    id: contentAssetId(contentHash),
    relPath,
    kind,
    contentHash,
    metadata: extractAssetMetadata(destination, kind),
  };
}

function containedPath(root: string, relative: string): string {
  const rootPath = path.resolve(root);
  const target = path.resolve(rootPath, relative);
  if (target !== rootPath && !target.startsWith(rootPath + path.sep)) {
    throw new Error(`path escapes ${rootPath}: ${relative}`);
  }
  return target;
}
