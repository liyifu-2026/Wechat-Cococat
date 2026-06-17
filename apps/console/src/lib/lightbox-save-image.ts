/** Save an image from a data URL, blob URL, or fetchable src. */
export async function saveLightboxImage(
  src: string,
  filename: string,
): Promise<void> {
  const safeName = filename.trim() || "image.jpg"
  const blob = await fetch(src).then((res) => res.blob())
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = safeName.includes(".") ? safeName : `${safeName}.jpg`
    anchor.rel = "noopener"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
