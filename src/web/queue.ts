import { Effect } from "effect"

export const oneAfterAnother = <T>(work: (item: T) => Effect.Effect<void>): (items: ReadonlyArray<T>) => void => {
  const waiting: Array<T> = []
  const state = { running: false }
  const drain: Effect.Effect<void> = Effect.suspend(() => {
    const next = waiting.shift()
    if (next === undefined) {
      state.running = false
      return Effect.void
    }
    return Effect.flatMap(Effect.exit(work(next)), () => drain)
  })
  return (items) => {
    waiting.push(...items)
    if (state.running) return
    state.running = true
    Effect.runFork(drain)
  }
}
