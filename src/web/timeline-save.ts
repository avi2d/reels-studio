import { Effect } from "effect"
import type { Edits } from "../shared/timeline.ts"
import * as Api from "./api.ts"

export const POLL_MS = 4000
const NOT_SAVED = "Изменение не сохранилось. Проверьте Wi-Fi: студия попробует сохранить его ещё раз сама."

export const saver = (projectId: string, problem: HTMLElement, edits: () => Edits, settled?: (ok: boolean) => void): { readonly save: () => void; readonly busy: () => boolean; readonly flush: () => Promise<boolean> } => {
  const state = { saving: false, unsaved: false }
  const idle = (): Promise<void> => {
    if (!state.saving) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const check = (): void => {
        if (!state.saving) resolve()
        else globalThis.setTimeout(check, 25)
      }
      check()
    })
  }
  const save = (): void => {
    if (state.saving) {
      state.unsaved = true
      return
    }
    state.saving = true
    state.unsaved = false
    Effect.runFork(Api.saveEdits(projectId, edits()).pipe(
      Effect.map(() => { problem.textContent = "" }),
      Effect.catchTag("Failed", () => Effect.sync(() => {
        problem.textContent = NOT_SAVED
        state.unsaved = true
      })),
      Effect.map(() => {
        state.saving = false
        if (!state.unsaved) {
          settled?.(true)
          return
        }
        settled?.(false)
        if (!problem.isConnected) return
        if (problem.textContent === "") save()
        else globalThis.setTimeout(save, POLL_MS)
      })
    ))
  }
  const flush = async (): Promise<boolean> => {
    if (state.unsaved && !state.saving) save()
    if (state.saving) await idle()
    if (state.unsaved) {
      if (!problem.isConnected) return false
      save()
      if (state.saving) await idle()
    }
    return !state.saving && !state.unsaved
  }
  return { save, busy: () => state.saving || state.unsaved, flush }
}
