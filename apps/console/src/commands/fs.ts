import { invoke } from "@tauri-apps/api/core"
import type { FileNode, WikiProject } from "@/types/wiki"
import { ensureProjectId, upsertProjectInfo } from "@/lib/project-identity"

/** Raw shape returned by the Rust commands — id is attached client-side. */
interface RawProject {
  name: string
  path: string
}

function invokeWithTimeout<T>(
  command: string,
  args?: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`IPC command "${command}" timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
  return Promise.race([invoke<T>(command, args), timer]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

export async function readFile(path: string): Promise<string> {
  return invokeWithTimeout<string>("read_file", { path })
}

export async function writeFile(path: string, contents: string): Promise<void> {
  return invokeWithTimeout<void>("write_file", { path, contents })
}

export async function writeFileAtomic(path: string, contents: string): Promise<void> {
  return invokeWithTimeout<void>("write_file_atomic", { path, contents })
}

export async function listDirectory(path: string): Promise<FileNode[]> {
  return invokeWithTimeout<FileNode[]>("list_directory", { path })
}

export async function copyFile(
  source: string,
  destination: string
): Promise<void> {
  return invokeWithTimeout<void>("copy_file", { source, destination })
}

export async function copyDirectory(
  source: string,
  destination: string
): Promise<string[]> {
  return invokeWithTimeout<string[]>("copy_directory", { source, destination })
}

export async function preprocessFile(path: string): Promise<string> {
  return invokeWithTimeout<string>("preprocess_file", { path })
}

export async function deleteFile(path: string): Promise<void> {
  return invokeWithTimeout<void>("delete_file", { path })
}

export async function findRelatedWikiPages(
  projectPath: string,
  sourceName: string
): Promise<string[]> {
  return invokeWithTimeout<string[]>("find_related_wiki_pages", { projectPath, sourceName })
}

export async function createDirectory(path: string): Promise<void> {
  return invokeWithTimeout<void>("create_directory", { path })
}

export async function fileExists(path: string): Promise<boolean> {
  return invokeWithTimeout<boolean>("file_exists", { path })
}

export async function getFileModifiedTime(path: string): Promise<number> {
  return invokeWithTimeout<number>("get_file_modified_time", { path })
}

export async function getFileSize(path: string): Promise<number> {
  return invokeWithTimeout<number>("get_file_size", { path })
}

export async function getFileMd5(path: string): Promise<string> {
  return invokeWithTimeout<string>("get_file_md5", { path })
}

/** Mirror of `commands::fs::FileBase64` (Rust side). */
export interface FileBase64 {
  base64: string
  mimeType: string
}

/**
 * Read any file off disk as base64 + a guessed mime type. The
 * vision-caption pipeline uses this to pick up extracted images
 * without having to read them as UTF-8 strings (PNG bytes aren't
 * valid UTF-8 — `readFile` would corrupt them).
 */
export async function readFileAsBase64(path: string): Promise<FileBase64> {
  return invokeWithTimeout<FileBase64>("read_file_as_base64", { path })
}

export async function createProject(
  name: string,
  path: string,
): Promise<WikiProject> {
  const raw = await invokeWithTimeout<RawProject>("create_project", { name, path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function openProject(path: string): Promise<WikiProject> {
  const raw = await invokeWithTimeout<RawProject>("open_project", { path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function openProjectFolder(path: string): Promise<void> {
  return invokeWithTimeout<void>("open_project_folder", { path })
}

export async function apiServerStatus(): Promise<string> {
  return invokeWithTimeout<string>("api_server_status")
}

export async function apiServerReloadConfig(): Promise<string> {
  return invokeWithTimeout<string>("api_server_reload_config")
}
