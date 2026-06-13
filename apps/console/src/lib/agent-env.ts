export type EnvLine =
  | { kind: "comment" | "blank"; raw: string }
  | { kind: "var"; key: string; value: string; raw: string }

export function parseEnvFile(content: string): EnvLine[] {
  const lines: EnvLine[] = []
  for (const raw of content.split("\n")) {
    const trimmed = raw.trim()
    if (!trimmed) {
      lines.push({ kind: "blank", raw })
      continue
    }
    if (trimmed.startsWith("#")) {
      lines.push({ kind: "comment", raw })
      continue
    }
    const eq = raw.indexOf("=")
    if (eq <= 0) {
      lines.push({ kind: "comment", raw })
      continue
    }
    const key = raw.slice(0, eq).trim()
    let value = raw.slice(eq + 1)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    lines.push({ kind: "var", key, value, raw })
  }
  return lines
}

export function getEnvVar(lines: EnvLine[], key: string): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line?.kind === "var" && line.key === key) return line.value
  }
  return undefined
}

export function setEnvVar(lines: EnvLine[], key: string, value: string): EnvLine[] {
  const next = [...lines]
  let replaced = false
  for (let i = 0; i < next.length; i++) {
    const line = next[i]
    if (line?.kind === "var" && line.key === key) {
      if (value.trim() === "") {
        next.splice(i, 1)
        return next
      }
      next[i] = { kind: "var", key, value, raw: `${key}=${value}` }
      replaced = true
      break
    }
  }
  if (!replaced && value.trim() !== "") {
    if (next.length > 0 && next[next.length - 1]?.kind !== "blank") {
      next.push({ kind: "blank", raw: "" })
    }
    next.push({ kind: "var", key, value, raw: `${key}=${value}` })
  }
  return next
}

export function serializeEnvFile(lines: EnvLine[]): string {
  const body = lines.map((l) => l.raw).join("\n")
  return body.endsWith("\n") || body.length === 0 ? body : `${body}\n`
}

export type AgentLlmValues = {
  provider: string
  model: string
  apiKeyVar: string
  apiKey: string
}

export function applyAgentEnvVars(
  content: string,
  envVars: Record<string, string>,
): string {
  let lines = parseEnvFile(content)
  for (const [key, value] of Object.entries(envVars)) {
    lines = setEnvVar(lines, key, value)
  }
  return serializeEnvFile(lines)
}

export function applyAgentLlmToEnv(
  content: string,
  values: AgentLlmValues,
): string {
  const patch: Record<string, string> = {
    PI_PROVIDER: values.provider.trim(),
    PI_MODEL: values.model.trim(),
  }
  if (values.apiKeyVar.trim()) {
    patch[values.apiKeyVar.trim()] = values.apiKey.trim()
  }
  return applyAgentEnvVars(content, patch)
}
