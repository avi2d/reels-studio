import { Effect } from "effect"
import type { UploadedVideo } from "../../shared/library.ts"
import * as Api from "../api.ts"
import { h } from "../dom.ts"
import { run } from "../run.ts"
import { rowList, showKeepingFocus } from "./record-list.ts"
import { stillUploading, type UploadHandlers, uploadRows } from "./record-rows.ts"
import { button, confirmRemoval } from "./ui.ts"
import { dropTake, onTakesChanged, resend, sendingNow, sendTakes } from "./uploads.ts"

const POLL_MS = 4000

const layout = () => {
  const input = h("input", { type: "file", name: "records", accept: "video/*", multiple: true, hidden: true, tabindex: "-1" })
  const heading = h("h2", { id: "uploads-title", tabindex: "-1" }, "Записи")
  const choose = button("quiet", "Загрузить видео", { click: () => { input.click() } }, "upload")
  const list = rowList({ "aria-label": "Загруженные записи" })
  const problem = h("p", { class: "error", role: "alert" })
  const loadProblem = h("p", { class: "error", role: "alert" })
  const section = h("section", { class: "uploads", "aria-labelledby": "uploads-title" },
    h("div", { class: "head" }, heading, choose),
    h("p", { class: "hint" }, "Загрузите дубли один раз и добавляйте их в любой ролик на шаге «Записи». Можно выбрать все дубли сразу."),
    list.node, problem, loadProblem, input)
  return { input, heading, list, problem, loadProblem, section }
}

interface Live {
  readonly view: ReturnType<typeof layout>
  uploaded: ReadonlyArray<UploadedVideo>
  timer: number
  generation: number
}

const act = (live: Live, work: Effect.Effect<unknown, Api.Failed>): void => {
  live.view.problem.textContent = ""
  run(Effect.map(work, () => { refresh(live) }), (message) => { live.view.problem.textContent = message })
}

const removeUploaded = (live: Live, name: string): void => {
  confirmRemoval({
    title: `Удалить запись «${name}»?`,
    what: "Запись пропадёт из загруженных. Вернуть её не получится.",
    note: "Ролики, в которые вы уже добавили эту запись, сохранят её. Исходный файл на вашем устройстве студия не трогает.",
    label: "Удалить запись",
    remove: Api.removeUploaded(name),
    onRemoved: () => {
      refresh(live)
      live.view.heading.focus()
    }
  })
}

const handlersOf = (live: Live): UploadHandlers => ({
  resend: (key) => { resend(key) },
  drop: (key) => { dropTake(key) },
  retry: (name) => { act(live, Api.retryUploaded(name)) },
  remove: (name) => { removeUploaded(live, name) }
})

const render = (live: Live): void => {
  showKeepingFocus(live.view.heading, [[live.view.list, uploadRows(sendingNow(), live.uploaded, handlersOf(live))]])
}

const later = (live: Live): void => {
  globalThis.clearTimeout(live.timer)
  live.timer = Number(globalThis.setTimeout(() => { refresh(live) }, POLL_MS))
}

const settle = (live: Live, uploaded: ReadonlyArray<UploadedVideo>): void => {
  live.view.loadProblem.textContent = ""
  live.uploaded = uploaded
  render(live)
  if (stillUploading(uploaded)) later(live)
  else globalThis.clearTimeout(live.timer)
}

function refresh(live: Live): void {
  globalThis.clearTimeout(live.timer)
  if (!live.view.section.isConnected) return
  live.generation += 1
  const generation = live.generation
  run(Effect.map(Api.getUploaded, ({ videos }) => {
    if (generation === live.generation) settle(live, videos)
  }), (message) => {
    if (generation !== live.generation) return
    live.view.loadProblem.textContent = message
    later(live)
  })
}

const listen = (live: Live): void => {
  const { input, problem, section } = live.view
  const stop = onTakesChanged((change) => {
    if (!section.isConnected) {
      stop()
      return
    }
    switch (change.kind) {
      case "moved": return render(live)
      case "listed":
        live.generation += 1
        return settle(live, change.uploaded)
      case "unlisted": return refresh(live)
    }
  })
  input.addEventListener("change", () => {
    const videos = [...input.files ?? []]
    input.value = ""
    problem.textContent = ""
    sendTakes(videos)
  })
}

export const uploaderSection = (uploaded: ReadonlyArray<UploadedVideo>): HTMLElement => {
  const live: Live = { view: layout(), uploaded, timer: 0, generation: 0 }
  listen(live)
  render(live)
  if (stillUploading(uploaded)) later(live)
  return live.view.section
}
