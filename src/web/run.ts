import { Effect } from "effect"
import type { Failed } from "./api.ts"

export const run = (effect: Effect.Effect<void, Failed>, onFailure: (message: string) => void): void => {
  Effect.runFork(effect.pipe(Effect.catch((error) => Effect.sync(() => { onFailure(error.message) }))))
}
