#!/usr/bin/env node
/**
 * Inbox voice transcription — uses agent captionVoice + caption.env / agent.env.
 * Usage: node scripts/caption-inbox-voice.mjs "<audioDataUrl>"
 * stdout: JSON { text?: string, error?: string }
 */
import { readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}

const audioDataUrl = process.argv[2]?.trim()
if (!audioDataUrl) {
  console.error("usage: caption-inbox-voice.mjs <audioDataUrl>")
  process.exit(1)
}

const home = process.env.HOME ?? ""
const configDir =
  process.env.COCOCAT_CONFIG_DIR?.trim() || join(home, ".config/cococat")
loadEnvFile(join(configDir, "agent.env"))
loadEnvFile(join(configDir, "caption.env"))

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const agentCaption = join(repoRoot, "packages/agent/dist/caption-llm.js")

const { captionVoice, loadCaptionLlmConfig } = await import(agentCaption)

const config = loadCaptionLlmConfig()
if (!config) {
  console.log(JSON.stringify({ error: "caption LLM not configured" }))
  process.exit(1)
}

try {
  const text = await captionVoice(config, audioDataUrl)
  console.log(JSON.stringify({ text: text?.trim() ?? null }))
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.log(JSON.stringify({ error: message }))
  process.exit(1)
}
