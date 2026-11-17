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

const PRESSES = "input, textarea, select, button, a, video, dialog"
const TYPES = "input, textarea, select, video, dialog"
const MOVES_ITSELF = ".handle"
const STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }

const inside = (event: KeyboardEvent, selector: string): boolean => event.target instanceof Element && event.target.closest(selector) !== null

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
  return !inside(event, MOVES_ITSELF) && open !== undefined && actOnOpen(event, open, placed, actions)
}

export const onKeys = (anchor: HTMLElement, now: () => Now, actions: KeyActions): void => {
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
