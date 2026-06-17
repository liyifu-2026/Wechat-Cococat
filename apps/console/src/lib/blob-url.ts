/** Revoke a blob object URL when safe to do so. */
export function revokeObjectUrlIfBlob(url: string | null | undefined): void {
  if (!url?.startsWith("blob:")) return
  try {
    URL.revokeObjectURL(url)
  } catch {
    // ignore
  }
}
