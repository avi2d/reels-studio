import { Effect } from "effect"
import type { Edits } from "../shared/timeline.ts"
import * as Api from "./api.ts"

export const POLL_MS = 4000
const NOT_SAVED = "Изменение не сохранилось. Проверьте Wi-Fi: студия попробует сохранить его ещё раз сама."

export const saver = (projectId: string, problem: HTMLElement, edits: () => Edits): { readonly save: () => void; readonly busy: () => boolean } => {
  const state = { saving: false, unsaved: false }
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
        if (!state.unsaved || !problem.isConnected) return
        if (problem.textContent === "") save()
        else globalThis.setTimeout(save, POLL_MS)
      })
    ))
  }
  return { save, busy: () => state.saving || state.unsaved }
}
