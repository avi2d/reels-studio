import { Effect } from "effect"
import { insertKey, replyKey, type Edits } from "../shared/timeline.ts"
import * as Api from "./api.ts"

export const POLL_MS = 4000
const NOT_SAVED = "Изменение не сохранилось. Проверьте Wi-Fi: студия попробует сохранить его ещё раз сама."

export const saver = (projectId: string, problem: HTMLElement, edits: () => Edits, base: () => Edits, adopt: (sent: Edits, merged: Edits) => void, settled?: (ok: boolean) => void): { readonly save: () => void; readonly busy: () => boolean; readonly flush: () => Promise<boolean> } => {
  const state = { saving: false, unsaved: false }
  const idle: Effect.Effect<void> = Effect.suspend(() =>
    state.saving ? Effect.flatMap(Effect.sleep("25 millis"), () => idle) : Effect.void)
  const save = (): void => {
    if (state.saving) {
      state.unsaved = true
      return
    }
    state.saving = true
    state.unsaved = false
    const sent = edits()
    Effect.runFork(Api.saveEdits(projectId, base(), sent).pipe(
      Effect.map((merged) => {
        problem.textContent = ""
        adopt(sent, merged)
      }),
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
  const settleUnsaved: Effect.Effect<boolean> = Effect.suspend(() => {
    if (!state.unsaved) return Effect.succeed(!state.saving && !state.unsaved)
    if (!problem.isConnected) return Effect.succeed(false)
    save()
    return Effect.map(idle, () => !state.saving && !state.unsaved)
  })
  const flush = (): Promise<boolean> =>
    Effect.runPromise(Effect.suspend(() => {
      if (state.unsaved && !state.saving) save()
      return Effect.flatMap(idle, () => settleUnsaved)
    }))
  return { save, busy: () => state.saving || state.unsaved, flush }
}

export interface Ticket { readonly changes: number; readonly busy: boolean }

const editKey = (edits: Edits): string => JSON.stringify([
  edits.order,
  edits.deleted,
  edits.chosen.map((one) => [one.block, one.video, one.from]),
  edits.pauses.map((one) => [one.video, one.after]),
  (edits.kept ?? []).map((one) => [one.video, one.after]),
  edits.joins.map((one) => [one.end.video, one.end.at, one.start.video, one.start.at, replyKey(one)]),
  edits.inserts.map((one) => [one.id, insertKey(one)]),
  (edits.subtitles ?? []).map((one) => [one.block, one.video, one.index, one.text]),
  edits.zooms.map((one) => [one.id, one.level])
])

const adoptServer = (local: Edits, acked: Edits, server: Edits): boolean =>
  editKey(server) === editKey(local) || editKey(local) === editKey(acked)

export const takeServer = (local: Edits, acked: Edits, server: Edits, ticket: Ticket, changes: number, busy: boolean): boolean =>
  !busy && !ticket.busy && ticket.changes === changes && adoptServer(local, acked, server)
