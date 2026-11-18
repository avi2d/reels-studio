import type { Placed, Take } from "../shared/timeline.ts"

export const KEYS: ReadonlyArray<readonly [string, string]> = [
  ["Пробел", "смотреть с блока"],
  ["← →", "блок"],
  ["1–9", "дубль"],
  ["Delete", "удалить блок"],
  ["Z", "отменить"]
]

export interface KeyActions {
  readonly toggle: () => void
  readonly step: (block: string) => void
  readonly choose: (block: string, take: Take) => void
  readonly setDeleted: (block: string, deleted: boolean) => void
  readonly undo: () => void
}

interface Now {
  readonly placed: ReadonlyArray<Placed>
  readonly open: Placed | undefined
}

const TYPES = "input, textarea, select, video, dialog, wa-select, wa-textarea"
const PRESSES = `${TYPES}, button, a, wa-button, wa-tab`
const MOVES_ITSELF = ".handle"
const STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }

const inside = (event: KeyboardEvent, selector: string): boolean => event.target instanceof Element && event.target.closest(selector) !== null

const handleOf = (event: KeyboardEvent, placed: ReadonlyArray<Placed>): Placed | undefined => {
  const handle = event.target instanceof Element ? event.target.closest(MOVES_ITSELF) : undefined
  const raw = handle instanceof Element ? handle.getAttribute("data-key") : undefined
  const id = raw !== null && raw !== undefined && raw.startsWith("handle:") ? raw.slice("handle:".length) : undefined
  return id === undefined ? undefined : placed.find((one) => one.block.id === id)
}

const actOnOpen = (event: KeyboardEvent, open: Placed, placed: ReadonlyArray<Placed>, actions: KeyActions): boolean => {
  const step = STEPS[event.key]
  if (step !== undefined) {
    const next = placed[placed.findIndex((one) => one.block.id === open.block.id) + step]
    if (next !== undefined) actions.step(next.block.id)
    return true
  }
  const take = /^[1-9]$/.test(event.key) ? open.block.takes[Number(event.key) - 1] : undefined
  if (take !== undefined) actions.choose(open.block.id, take)
  else if (event.key === "Delete") actions.setDeleted(open.block.id, true)
  else return false
  return true
}

const act = (event: KeyboardEvent, { open, placed }: Now, actions: KeyActions): boolean => {
  if (event.defaultPrevented) return false
  if (event.code === "Space") {
    if (inside(event, PRESSES)) return false
    actions.toggle()
    return true
  }
  if (inside(event, TYPES)) return false
  if (event.code === "KeyZ") {
    actions.undo()
    return true
  }
  if (inside(event, MOVES_ITSELF)) {
    if (event.key in STEPS) return false
    const handle = handleOf(event, placed)
    if (handle === undefined) return false
    return actOnOpen(event, handle, placed, actions)
  }
  if (open === undefined) return false
  return actOnOpen(event, open, placed, actions)
}

export const onKeys = (anchor: { readonly isConnected: boolean }, now: () => Now, actions: KeyActions): void => {
  const listen = (event: KeyboardEvent): void => {
    if (!anchor.isConnected) {
      document.removeEventListener("keydown", listen)
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (act(event, now(), actions)) event.preventDefault()
  }
  document.addEventListener("keydown", listen)
}
