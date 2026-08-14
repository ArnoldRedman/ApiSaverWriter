import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const SCHEMA_VERSION = 1;
const MAX_ENTRIES = 180;
const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

interface CacheRecord<T> {
  version: number;
  key: string;
  savedAt: string;
  expiresAt: number;
  value: T;
}

function cacheDirectory(): string {
  return process.env.APISAVERWRITER_CONTEXT_CACHE_DIR
    || join(homedir(), ".apisaverwriter", "context-cache");
}

function fileFor(key: string): string {
  // Keys are SHA-256 hashes produced by stableHash; keep the filesystem name strict.
  return join(cacheDirectory(), `${key.replace(/[^a-f0-9-]/gi, "")}.json`);
}

function documentFor(key: string): string {
  return join(cacheDirectory(), `${key.replace(/[^a-f0-9-]/gi, "")}.md`);
}

export async function readPersistentDocument(key: string): Promise<string | undefined> {
  try {
    return (await readFile(documentFor(key), "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function writePersistentDocument(key: string, content: string): Promise<void> {
  try {
    const directory = cacheDirectory();
    await mkdir(directory, { recursive: true });
    const path = documentFor(key);
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, content.trim() + "\n", "utf8");
    await rename(temporary, path);
  } catch {
    // Summary documents are best-effort and never block generation.
  }
}

export async function readPersistentContext<T>(key: string): Promise<T | undefined> {
  try {
    const path = fileFor(key);
    const record = JSON.parse(await readFile(path, "utf8")) as CacheRecord<T>;
    if (record.version !== SCHEMA_VERSION || record.key !== key || record.expiresAt < Date.now()) {
      await unlink(path).catch(() => undefined);
      return undefined;
    }
    return record.value;
  } catch {
    return undefined;
  }
}

export async function writePersistentContext<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): Promise<void> {
  try {
    const directory = cacheDirectory();
    await mkdir(directory, { recursive: true });
    const record: CacheRecord<T> = {
      version: SCHEMA_VERSION,
      key,
      savedAt: new Date().toISOString(),
      expiresAt: Date.now() + ttlMs,
      value,
    };
    const path = fileFor(key);
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(record), "utf8");
    await rename(temporary, path);
    await prunePersistentContextCache(directory);
  } catch {
    // Cache failures must never block a writing request.
  }
}

async function prunePersistentContextCache(directory: string): Promise<void> {
  try {
    const files = (await readdir(directory)).filter(name => name.endsWith(".json"));
    const entries = await Promise.all(files.map(async name => {
      const path = join(directory, name);
      const info = await stat(path);
      return { path, modified: info.mtimeMs };
    }));
    const obsolete = entries.sort((left, right) => right.modified - left.modified).slice(MAX_ENTRIES);
    await Promise.all(obsolete.map(entry => unlink(entry.path).catch(() => undefined)));
  } catch {
    // Best-effort maintenance only.
  }
}
