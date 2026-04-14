import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { envKeyFor } from "./project-ids.js";

export interface ProjectConfig {
  id: string;
  githubRepo: string;
  repoPath: string;
  workersPath: string;
  webhookSecret: string;
  githubBase: string;
  maxParallel: number;
  maxPerHour: number;
  maxPerDay: number;
}

interface ProjectEntry {
  id: string;
  githubRepo: string;
  githubBase?: string;
  maxParallel?: number;
  maxPerHour?: number;
  maxPerDay?: number;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = resolve(ROOT, "projects.local.json");

function loadEntries(): ProjectEntry[] {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf8");
  } catch {
    throw new Error(
      `Missing ${CONFIG_PATH}. Copy projects.local.json.example and list your projects.`
    );
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${CONFIG_PATH} must be a JSON array`);
  }
  for (const entry of parsed) {
    if (!entry.id || !entry.githubRepo) {
      throw new Error(
        `Each entry in ${CONFIG_PATH} needs "id" and "githubRepo"`
      );
    }
  }
  return parsed;
}

function toConfig(entry: ProjectEntry): ProjectConfig {
  const envKey = envKeyFor(entry.id);
  const webhookSecret = process.env[`${envKey}_LINEAR_SECRET`];
  if (!webhookSecret) {
    throw new Error(`Missing env: ${envKey}_LINEAR_SECRET`);
  }
  return {
    id: entry.id,
    githubRepo: entry.githubRepo,
    githubBase: entry.githubBase ?? "main",
    maxParallel: entry.maxParallel ?? 2,
    maxPerHour: entry.maxPerHour ?? 10,
    maxPerDay: entry.maxPerDay ?? 50,
    repoPath: resolve(ROOT, "repos", entry.id),
    workersPath: resolve(ROOT, "workers", entry.id),
    webhookSecret,
  };
}

export const PROJECTS: Record<string, ProjectConfig> = Object.fromEntries(
  loadEntries().map((entry) => [entry.id, toConfig(entry)])
);
