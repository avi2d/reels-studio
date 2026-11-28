import { Effect } from "effect"
import * as Api from "../api.ts"

const POLL_MS = 1000

export interface QueuedOptions<View> {
  readonly node: HTMLElement
  readonly problem: HTMLElement
  readonly isBusy: (view: View) => boolean
  readonly show: (view: View) => void
  readonly load: Effect.Effect<View, Api.Failed>
}

export interface Queued<View> {
  readonly ask: (call: Effect.Effect<View, Api.Failed>) => void
  readonly poll: () => void
  readonly stop: () => void
  readonly view: () => View | undefined
}

export const queued = <View>({ node, problem, isBusy, show, load }: QueuedOptions<View>): Queued<View> => {
  const state: { timer: number; asked: number; view: View | undefined } = { timer: 0, asked: 0, view: undefined }

  const stop = (): void => { globalThis.clearTimeout(state.timer) }

  const showView = (view: View): void => {
    state.view = view
    show(view)
  }

  function poll(): void {
    stop()
    if (!node.isConnected) return
    ask(load)
  }

  const pollLater = (): void => {
    stop()
    if (node.isConnected && state.view !== undefined && isBusy(state.view)) state.timer = Number(globalThis.setTimeout(poll, POLL_MS))
  }

  const apply = (asked: number) => (view: View): void => {
    if (asked !== state.asked) return
    showView(view)
    pollLater()
  }

  const fail = (asked: number) => (error: Api.Failed) => Effect.sync(() => {
    if (asked !== state.asked) return
    if (state.view !== undefined) showView(state.view)
    problem.textContent = error.message
    pollLater()
  })

  function ask(call: Effect.Effect<View, Api.Failed>): void {
    state.asked += 1
    const asked = state.asked
    Effect.runFork(call.pipe(Effect.map(apply(asked)), Effect.catchTag("Failed", fail(asked))))
  }

  return { ask, poll, stop, view: () => state.view }
}
