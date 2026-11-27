export interface MontageKeys {
  readonly toggle: () => void
  readonly undo: () => void
}

const TYPES = "input, textarea, select, [contenteditable], dialog"
const PRESSES = `${TYPES}, button, a, summary, video`

const inside = (event: KeyboardEvent, selector: string): boolean => event.target instanceof Element && event.target.closest(selector) !== null

const isUndo = (event: KeyboardEvent): boolean => event.code === "KeyZ" && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey

// A field keeps its own undo, so the montage undoes only when the focus is outside one.
export const onMontageKeys = (keys: MontageKeys): () => void => {
  const listen = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || document.querySelector("dialog[open]") !== null) return
    if (isUndo(event) && !inside(event, TYPES)) {
      event.preventDefault()
      keys.undo()
    } else if (event.code === "Space" && !event.metaKey && !event.ctrlKey && !event.altKey && !inside(event, PRESSES)) {
      event.preventDefault()
      keys.toggle()
    }
  }
  document.addEventListener("keydown", listen)
  return () => { document.removeEventListener("keydown", listen) }
}
