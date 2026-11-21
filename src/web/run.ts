import { Effect } from "effect"
import type { Failed } from "./api.ts"

export const BROKEN = "Не получилось из-за ошибки в коде студии. Подробности есть в консоли браузера."

export const run = (effect: Effect.Effect<void, Failed>, onFailure: (message: string) => void): (() => void) =>
  Effect.runCallback(effect.pipe(
    Effect.catch((error) => Effect.sync(() => { onFailure(error.message) })),
    Effect.catchDefect((defect) => Effect.sync(() => {
      console.error(defect)
      onFailure(BROKEN)
    }))
  ))
