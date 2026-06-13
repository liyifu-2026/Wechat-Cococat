import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function getCococatConfigDir(): string {
  return (
    process.env.COCOCAT_CONFIG_DIR?.trim() ||
    join(homedir(), ".config", "cococat")
  );
}

export function getCococatDataRoot(): string {
  return (
    process.env.COCOCAT_DATA_DIR?.trim() ||
    join(homedir(), ".local", "share", "cococat")
  );
}

/** Host root for Driver bind mounts (WeChat home + agent DB). */
export function getAgentWeChatDataRoot(): string {
  if (process.env.AGENT_WECHAT_DATA_ROOT?.trim()) {
    return process.env.AGENT_WECHAT_DATA_ROOT.trim();
  }

  const cococat = getCococatDataRoot();
  const legacy = join(homedir(), ".local", "share", "agent-wechat");

  if (
    existsSync(join(cococat, "wechat-home")) ||
    existsSync(join(cococat, "data"))
  ) {
    return cococat;
  }
  if (
    existsSync(join(legacy, "wechat-home")) ||
    existsSync(join(legacy, "data"))
  ) {
    return legacy;
  }
  return cococat;
}

export function getWeChatHomeHostPath(): string {
  return join(getAgentWeChatDataRoot(), "wechat-home");
}

export function getAgentDataHostPath(): string {
  return join(getAgentWeChatDataRoot(), "data");
}

export function getArtifactsHostPath(): string {
  return join(getAgentDataHostPath(), "artifacts");
}

/** Create host directories for bind mounts. Safe to call repeatedly. */
export function ensureHostDataDirs(): void {
  for (const dir of [
    getWeChatHomeHostPath(),
    getAgentDataHostPath(),
    getArtifactsHostPath(),
  ]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/** Resolve driver artifact ref (relative to /data) to a host filesystem path. */
export function resolveArtifactPath(artifactRef: string): string {
  const dataDir = getAgentDataHostPath();
  const normalized = artifactRef.replace(/^\/+/, "");
  if (normalized.startsWith("artifacts/")) {
    return join(dataDir, normalized);
  }
  return join(dataDir, "artifacts", normalized);
}
