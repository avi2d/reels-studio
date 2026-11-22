import { Effect } from "effect"
import { jumpsOf, previewDb, type PartGains, type SoundCheck } from "../shared/reel.ts"
import * as Api from "./api.ts"
import { h } from "./dom.ts"
import { verdictWords } from "./sound-verdict.ts"
import { POLL_MS } from "./timeline-save.ts"

const CHECKING = "Проверяем звук монтажа…"
const FAILED = "Не удалось проверить звук монтажа. Подробности в журнале студии."
const CHANGED = "Монтаж изменился, звук проверяется заново."

export type SoundLine =
  | { readonly kind: "none" }
  | { readonly kind: "checking"; readonly done: number | undefined }
  | { readonly kind: "failed" }
  | { readonly kind: "heard"; readonly level: "good" | "check" | "bad"; readonly label: string; readonly notes: ReadonlyArray<string>; readonly stale: boolean }

export const soundLineOf = (check: SoundCheck): SoundLine => {
  const { heard, job } = check
  if (heard?.fresh !== true) {
    if (job.state === "running") return { kind: "checking", done: job.done }
    if (job.state === "waiting") return { kind: "checking", done: undefined }
    if (job.state === "failed") return { kind: "failed" }
  }
  if (heard === undefined) return { kind: "none" }
  const words = verdictWords(heard.levelling.after, jumpsOf(heard.levelling.series.after, heard.seconds))
  return { kind: "heard", ...words, stale: !heard.fresh }
}

export interface MontageSound {
  readonly node: HTMLElement
  readonly dbAt: (video: string, time: number) => number
  readonly refresh: () => void
}

const percent = (done: number | undefined): string => done === undefined ? "" : ` ${Math.round(done * 100)}%`

const paint = (node: HTMLElement, line: SoundLine): void => {
  node.hidden = line.kind === "none"
  node.dataset.level = line.kind === "heard" ? line.level : ""
  if (line.kind === "checking") node.replaceChildren(h("span", { class: "muted" }, CHECKING + percent(line.done)))
  if (line.kind === "failed") node.replaceChildren(h("span", { class: "muted" }, FAILED))
  if (line.kind !== "heard") return
  node.replaceChildren(h("details", {},
    h("summary", {}, h("strong", {}, line.label)),
    ...(line.stale ? [h("p", { class: "muted" }, CHANGED)] : []),
    ...line.notes.map((note) => h("p", { class: "muted" }, note))))
}

// The montage hears the gains the build will apply, so a quiet part plays at the level it gets in the built file.
export const montageSound = (projectId: string): MontageSound => {
  const node = h("div", { class: "sound-line", role: "status", hidden: true })
  const state: { parts: ReadonlyArray<PartGains>; timer: number } = { parts: [], timer: 0 }
  const refresh = (): void => {
    globalThis.clearTimeout(state.timer)
    Effect.runFork(Api.getSound(projectId).pipe(
      Effect.map((check) => {
        state.parts = check.heard?.parts ?? []
        const line = soundLineOf(check)
        const open = node.querySelector("details")?.open ?? false
        paint(node, line)
        if (open) node.querySelector("details")?.setAttribute("open", "")
        if (line.kind === "checking" && node.isConnected) state.timer = Number(globalThis.setTimeout(refresh, POLL_MS))
      }),
      Effect.catchTag("Failed", () => Effect.void)
    ))
  }
  return { node, dbAt: (video, time) => previewDb(state.parts, video, time), refresh }
}
