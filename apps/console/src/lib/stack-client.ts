import { invoke } from "@tauri-apps/api/core"

export type StackService = "driver" | "memory" | "agent" | "all"
export type StackHealthService = Exclude<StackService, "all">
export type StackAction = "start" | "stop" | "status"

export function stackCommand(
  service: StackService,
  action: StackAction,
): Promise<string> {
  return invoke<string>("stack_command", { service, action })
}

export function readCococatToken(): Promise<string> {
  return invoke<string>("read_cococat_token_cmd")
}
