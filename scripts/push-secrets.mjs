#!/usr/bin/env bun
/**
 * Upload the secrets in .env to Cloudflare, skipping names that the Wrangler config
 * already defines as plain `vars` (e.g. BROKER_PROVIDER). `wrangler secret bulk .env`
 * uploads every line and Cloudflare rejects a secret that shadows a var (code 10053).
 *
 * Usage:
 *   bun scripts/push-secrets.mjs                       # wrangler.json / wrangler.jsonc
 *   bun scripts/push-secrets.mjs --config wrangler.deploy.json
 *   bun scripts/push-secrets.mjs --env production
 *   bun scripts/push-secrets.mjs --dry-run              # list names only, upload nothing
 *
 * Secret values are never printed; only names are listed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const argValue = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const envName = argValue("--env");
const configPath = argValue("--config") ?? ["wrangler.json", "wrangler.jsonc"].find((file) => existsSync(file));
const envFile = argValue("--file") ?? ".env";

if (!existsSync(envFile)) {
  console.error(`No ${envFile} file found.`);
  process.exit(1);
}
if (!configPath) {
  console.error("No wrangler.json / wrangler.jsonc found; pass --config <file>.");
  process.exit(1);
}

/** Minimal .env parser: KEY=VALUE lines, # comments, optional surrounding quotes. */
function parseDotEnv(text) {
  const entries = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries[match[1]] = value;
  }
  return entries;
}

/** Strip // and /* *\/ comments outside strings, then trailing commas, so JSONC parses. */
function parseJsonc(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === "\\") out += text[++i] ?? "";
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (char === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      out += char;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

// Secrets belong to the Worker, and the local and deploy configs target the same Worker,
// so a name that is a plain var in ANY of them must not be uploaded as a secret.
const config = parseJsonc(readFileSync(configPath, "utf8"));
const varNames = new Set();
for (const file of new Set([configPath, "wrangler.json", "wrangler.jsonc", "wrangler.deploy.json"])) {
  if (!existsSync(file)) continue;
  const parsed = file === configPath ? config : parseJsonc(readFileSync(file, "utf8"));
  if (parsed.name !== config.name) continue;
  for (const name of Object.keys(parsed.vars ?? {})) varNames.add(name);
  for (const name of Object.keys((envName && parsed.env?.[envName]?.vars) || {})) varNames.add(name);
}

const all = parseDotEnv(readFileSync(envFile, "utf8"));
const secrets = {};
const skippedVars = [];
const skippedEmpty = [];
for (const [name, value] of Object.entries(all)) {
  if (varNames.has(name)) skippedVars.push(name);
  else if (!value) skippedEmpty.push(name);
  else secrets[name] = value;
}

if (skippedVars.length) {
  console.log(`Skipping (plain vars in ${configPath}, not secrets): ${skippedVars.join(", ")}`);
}
if (skippedEmpty.length) console.log(`Skipping (empty in ${envFile}): ${skippedEmpty.join(", ")}`);
if (Object.keys(secrets).length === 0) {
  console.log("Nothing to upload.");
  process.exit(0);
}
console.log(`Uploading ${Object.keys(secrets).length} secrets: ${Object.keys(secrets).join(", ")}`);
if (args.includes("--dry-run")) {
  console.log("--dry-run: nothing uploaded.");
  process.exit(0);
}

// Temp file in a private directory, removed even if wrangler fails.
const dir = mkdtempSync(join(tmpdir(), "secrets-"));
const file = join(dir, "secrets.json");
try {
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  const wranglerArgs = ["wrangler", "secret", "bulk", file, "--config", configPath];
  if (envName) wranglerArgs.push("--env", envName);
  const result = spawnSync("bunx", wranglerArgs, { stdio: "inherit", shell: process.platform === "win32" });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
