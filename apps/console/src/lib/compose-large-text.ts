/** Above this length the expand overlay switches to uncontrolled input. */
export const COMPOSE_LARGE_TEXT_THRESHOLD = 8192

export function isLargeComposeText(text: string): boolean {
  return text.length >= COMPOSE_LARGE_TEXT_THRESHOLD
}
