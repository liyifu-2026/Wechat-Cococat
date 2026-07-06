#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = join(repoRoot, "apps", "console", "src-tauri", "runtime");
const agentTarget = join(runtimeRoot, "packages", "agent");

function copyFileOrDir(from, to) {
  const src = join(repoRoot, from);
  if (!existsSync(src)) {
    throw new Error(`Missing runtime source: ${from}`);
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(src, to, { recursive: true });
}

rmSync(runtimeRoot, { recursive: true, force: true });
mkdirSync(join(runtimeRoot, "packages"), { recursive: true });

copyFileOrDir("docker-compose.yml", join(runtimeRoot, "docker-compose.yml"));
copyFileOrDir("config/agent.env.example", join(runtimeRoot, "config", "agent.env.example"));
copyFileOrDir("config/caption.env.example", join(runtimeRoot, "config", "caption.env.example"));
copyFileOrDir(
  "config/tencentdb-memory.env.example",
  join(runtimeRoot, "config", "tencentdb-memory.env.example"),
);

for (const script of [
  "caption-inbox-voice.mjs",
  "cococat-stack.ps1",
  "install-windows.ps1",
  "preview-agent-reply.mjs",
  "start-tencentdb-gateway.sh",
]) {
  copyFileOrDir(`scripts/${script}`, join(runtimeRoot, "scripts", script));
}

const deploy = spawnSync(
  "corepack",
  ["pnpm", "--filter", "@cococat/agent", "deploy", "--prod", agentTarget],
  {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (deploy.status !== 0) {
  process.exit(deploy.status ?? 1);
}

console.log(`CocoCat Console runtime prepared at ${runtimeRoot}`);
