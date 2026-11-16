import { Effect, Option, Schema } from "effect"
import * as Api from "./api.ts"
import { h } from "./dom.ts"
import { formatDay, formatSize, modelName, parseEventBlock } from "./format.ts"
import { libraryPicker } from "./library.ts"
import { oneAfterAnother } from "./queue.ts"
import { askToRemove } from "./remove.ts"
import { upload, type Progress } from "./upload.ts"
import { videosCard } from "./videos.ts"

const app = document.querySelector("#app") ?? document.body

const run = (effect: Effect.Effect<void, Api.Failed>, onFailure: (message: string) => void): void => {
  Effect.runFork(effect.pipe(Effect.catch((error) => Effect.sync(() => { onFailure(error.message) }))))
}

const show = (...nodes: ReadonlyArray<Node>): void => { app.replaceChildren(...nodes) }

const showFailure = (message: string): void => {
  show(h("p", { class: "error", role: "alert" }, message), h("a", { class: "back", href: "#/" }, "← Все ролики"))
}

const STAGES = { created: "Ждёт видео", uploaded: "Видео загружено" }

const EFFORTS: ReadonlyArray<readonly [Api.Effort, string]> = [["low", "Низкая"], ["medium", "Средняя"], ["high", "Высокая"]]
const CHOICE_HINT = "Выбранная модель делает в чате всю работу: смотрит материал, планирует нарезку и запускает инструменты. "
  + "Средняя глубина подходит для обычной нарезки, высокая нужна для трудных случаев."

const projectItem = (project: Api.ProjectView): HTMLElement =>
  h("li", { class: "entry" },
    h("a", { class: "item", href: `#/p/${project.id}` },
      h("strong", {}, project.title),
      h("span", { class: "muted" }, formatDay(project.createdAt)),
      h("span", { class: project.stage === "uploaded" ? "badge ready" : "badge" }, STAGES[project.stage])),
    h("button", {
      type: "button",
      class: "secondary",
      "aria-label": `Удалить ролик «${project.title}»`,
      click: () => { askToRemove(project, route) }
    }, "Удалить"))

const listView = (projects: ReadonlyArray<Api.ProjectView>): void => {
  const title = h("input", { type: "text", name: "title", maxlength: "120", required: true, autocomplete: "off", placeholder: "Например: нотариальный осмотр сайта" })
  const problem = h("p", { class: "error", role: "alert" })
  const button = h("button", { type: "submit" }, "Создать ролик")
  const form = h("form", {
    class: "card",
    submit: (event) => {
      event.preventDefault()
      button.disabled = true
      problem.textContent = ""
      run(
        Effect.map(Api.createProject(title.value), ({ project }) => { location.hash = `#/p/${project.id}` }),
        (message) => {
          problem.textContent = message
          button.disabled = false
        }
      )
    }
  }, h("h2", {}, "Новый ролик"), h("div", { class: "row" }, h("label", { class: "grow" }, "Название", title), button), problem)
  const list = projects.length === 0
    ? h("p", { class: "muted" }, "Роликов пока нет. Назовите первый и нажмите «Создать ролик».")
    : h("ul", { class: "list" }, ...projects.map(projectItem))
  show(h("h1", {}, "Ролики"), form, list)
}

const fileList = (project: Api.ProjectView): HTMLElement =>
  project.files.length === 0
    ? h("p", { class: "muted" }, "Видео ещё не загружено.")
    : h("ul", { class: "files" }, ...project.files.map((file) => h("li", {}, h("span", {}, file.name), h("span", {}, formatSize(file.size)))))

const PICK_FIRST = "Загрузить видео"
const PICK_MORE = "Добавить ещё видео"

const enqueue = oneAfterAnother((work: Effect.Effect<void>) => work)
const uploadsByProject = new Map<string, Array<HTMLElement>>()
const refreshByProject = new Map<string, () => Effect.Effect<void, Api.Failed>>()

const uploadKey = (file: File): string => `${file.name}:${file.size}:${file.lastModified}`

const uploadRow = (projectId: string, file: File) => {
  const bar = h("progress", { max: "1", value: "0" })
  const status = h("p", { class: "muted", role: "status" }, "Ждёт своей очереди.")
  const node = h("li", { class: "upload" },
    h("div", { class: "name" }, h("span", {}, file.name), h("span", {}, formatSize(file.size))), bar, status)
  node.dataset.key = uploadKey(file)
  const onProgress = (progress: Progress): void => {
    if (progress.waiting) {
      status.textContent = "Связь пропала. Загрузка продолжится сама, когда связь вернётся."
      return
    }
    bar.value = progress.sent / progress.total
    const percent = Math.floor((progress.sent / progress.total) * 100)
    status.textContent = `Загружено ${formatSize(progress.sent)} из ${formatSize(progress.total)}, ${percent}%`
  }
  const failUpload = (message: string): void => {
    node.dataset.failed = "true"
    status.className = "error"
    bar.hidden = file.size === 0
    status.textContent = file.size === 0
      ? message
      : `${message} Выберите тот же файл ещё раз, и загрузка продолжится с того же места.`
  }
  const work = upload(projectId, file, onProgress).pipe(
    Effect.flatMap(() => (refreshByProject.get(projectId)?.() ?? Effect.void).pipe(
      Effect.map(() => {
        for (const kept of uploadsByProject.get(projectId) ?? []) {
          if (kept === node || kept.dataset.uploaded === "true") kept.remove()
        }
        uploadsByProject.set(projectId, (uploadsByProject.get(projectId) ?? []).filter((kept) => kept !== node && kept.dataset.uploaded !== "true"))
      }),
      Effect.catchTag("Failed", () => Effect.sync(() => {
        node.dataset.uploaded = "true"
        status.textContent = "Видео загружено. Список обновится при следующей загрузке."
      }))
    )),
    Effect.catch((error) => Effect.sync(() => {
      failUpload(error.message)
    })),
    Effect.catchDefect(() => Effect.sync(() => {
      failUpload("Не получилось загрузить.")
    }))
  )
  return { node, work }
}

const videoCard = (project: Api.ProjectView, onUploaded: () => void): HTMLElement => {
  const files = h("div", {}, fileList(project))
  const rows = h("ul", { class: "uploads" })
  if (!uploadsByProject.has(project.id)) uploadsByProject.set(project.id, [])
  rows.append(...(uploadsByProject.get(project.id) ?? []))
  const input = h("input", { class: "file-input", type: "file", accept: "video/*", multiple: true })
  const label = h("span", {}, project.files.length === 0 ? PICK_FIRST : PICK_MORE)
  const refresh = (): Effect.Effect<void, Api.Failed> =>
    Effect.map(Api.getProject(project.id), (fresh) => {
      files.replaceChildren(fileList(fresh.project))
      label.textContent = PICK_MORE
      onUploaded()
    })
  refreshByProject.set(project.id, refresh)
  const picker = libraryPicker(project.id, refresh)
  picker.reload()
  const add = (chosen: ReadonlyArray<File>): void => {
    const made: Array<{ node: HTMLElement; work: Effect.Effect<void> }> = []
    for (const file of chosen) {
      const key = uploadKey(file)
      const live = uploadsByProject.get(project.id) ?? []
      if (live.some((candidate) => candidate.dataset.key === key && candidate.dataset.failed !== "true")) continue
      const row = uploadRow(project.id, file)
      const stale = live.filter((candidate) => candidate.dataset.key === key && candidate.dataset.failed === "true")
      for (const old of stale) old.remove()
      uploadsByProject.set(project.id, [...(uploadsByProject.get(project.id) ?? []).filter((candidate) => !stale.includes(candidate)), row.node])
      made.push(row)
    }
    if (made.length === 0) return
    rows.append(...made.map((row) => row.node))
    enqueue(made.map((row) => row.work))
  }
  input.addEventListener("change", () => {
    add([...(input.files ?? [])])
    input.value = ""
  })
  return h("section", { class: "card" }, h("h2", {}, "Видео"), files, rows,
    h("div", { class: "row" }, h("label", { class: "button" }, label, input), picker.open), picker.panel,
    h("p", { class: "muted" }, "Можно выбрать сразу несколько видео: они загрузятся по очереди. Не закрывайте страницу, пока идёт загрузка. Исходные видео студия не меняет."))
}

const bubble = (message: Api.Message): HTMLElement => {
  const node = h("div", { class: `bubble ${message.role}` }, message.text)
  if (message.failed !== undefined) node.append(h("span", { class: "note" }, `Ответ не дошёл: ${message.failed}`))
  return node
}

const decodeEvent = Schema.decodeUnknownOption(Api.ChatEvent)

const readReply = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: Api.ChatEvent) => void
): Effect.Effect<void> => {
  const decoder = new TextDecoder()
  const pump = (rest: string): Effect.Effect<void> =>
    Effect.gen(function*() {
      const chunk = yield* Effect.tryPromise({ try: () => reader.read(), catch: () => new Api.Offline() }).pipe(
        Effect.catchTag("Offline", () => Effect.succeed({ done: true as const, value: undefined }))
      )
      if (chunk.done) return
      const blocks = (rest + decoder.decode(chunk.value, { stream: true })).split("\n\n")
      for (const block of blocks.slice(0, -1)) {
        const event = Option.getOrUndefined(decodeEvent(parseEventBlock(block)))
        if (event !== undefined) onEvent(event)
      }
      yield* pump(blocks.at(-1) ?? "")
    })
  return pump("")
}

const chatCard = (project: Api.ProjectView, messages: ReadonlyArray<Api.Message>, models: ReadonlyArray<string>, onReply: () => void): HTMLElement => {
  const empty = h("p", { class: "muted" }, "Напишите, что оставить в ролике и что убрать. Студия слышит загруженные видео и сначала покажет план.")
  const log = h("div", { class: "chat" }, ...(messages.length === 0 ? [empty] : messages.map(bubble)))
  const text = h("textarea", { name: "text", rows: "3", required: true })
  const model = h("select", { name: "model" }, ...models.map((id) => h("option", { value: id, selected: id === project.model }, modelName(id))))
  const chosen = project.effort ?? "medium"
  const effort = h("select", { name: "effort" }, ...EFFORTS.map(([id, name]) => h("option", { value: id, selected: id === chosen }, name)))
  const button = h("button", { type: "submit" }, "Отправить")
  const talk = (message: string): Effect.Effect<void, Api.Failed> =>
    Effect.gen(function*() {
      const words = h("span")
      const answer = h("div", { class: "bubble assistant" }, words)
      const step = h("p", { class: "muted step", role: "status" }, "Студия думает…")
      const state = { done: false, text: "", base: "" }
      const fail = (reason: string): void => { answer.append(h("span", { class: "note" }, `Ответ не дошёл: ${reason}`)) }
      const response = yield* Api.postChat(project.id, message, model.value, EFFORTS.find(([id]) => id === effort.value)?.[0] ?? "medium").pipe(
        Effect.catchTag("Offline", () => Effect.fail(new Api.Failed({ message: "Нет связи со студией. Проверьте Wi-Fi." })))
      )
      if (!response.ok || response.body === null) return yield* Effect.flatMap(Api.failure(response), Effect.fail)
      empty.remove()
      log.append(bubble({ role: "user", text: message }), step)
      text.value = ""
      step.scrollIntoView({ block: "nearest" })
      yield* readReply(response.body.getReader(), (event) => {
        if (event.type === "step") step.textContent = `${event.text}…`
        if (event.type === "start") {
          state.base = state.text
        }
        if (event.type === "retry") {
          state.text = state.base
          words.textContent = state.base
          answer.querySelector(".note")?.remove()
        }
        if (event.type === "delta") {
          if (!answer.isConnected) step.before(answer)
          state.text += event.text
          words.textContent = state.text
        }
        if (event.type === "error") {
          if (!answer.isConnected) step.before(answer)
          fail(event.message)
        }
        if (event.type === "done") state.done = true
      })
      if (!state.done) {
        if (!answer.isConnected) step.before(answer)
        fail("связь оборвалась. Отправьте сообщение ещё раз.")
      }
      step.remove()
      onReply()
    })
  const problem = h("p", { class: "error", role: "alert" })
  const form = h("form", {
    submit: (event) => {
      event.preventDefault()
      const message = text.value.trim()
      if (message === "") return
      button.disabled = true
      problem.textContent = ""
      const finish = (): void => { button.disabled = false }
      run(Effect.map(talk(message), finish), (failure) => {
        problem.textContent = failure
        finish()
      })
    }
  }, h("label", {}, "Сообщение", text), h("div", { class: "row" }, h("label", { class: "grow" }, "Модель", model), h("label", { class: "grow" }, "Глубина размышления", effort)),
    h("p", { class: "muted" }, CHOICE_HINT), button, problem)
  form.className = "chat"
  return h("section", { class: "card" }, h("h2", {}, "Чат"), log, form)
}

const projectView = (id: string): Effect.Effect<void, Api.Failed> =>
  Effect.gen(function*() {
    const [{ project }, { messages }, { models }] = yield* Effect.all([Api.getProject(id), Api.getChat(id), Api.getModels], { concurrency: 3 })
    document.title = `${project.title} · Студия Reels`
    const videos = videosCard(project.id)
    const chat = chatCard(project, messages, models, videos.refresh)
    const remove = h("button", {
      type: "button",
      class: "secondary end",
      click: () => { askToRemove(project, () => { location.hash = "#/" }) }
    }, "Удалить ролик")
    show(h("a", { class: "back", href: "#/" }, "← Все ролики"), h("h1", {}, project.title), videoCard(project, videos.refresh), videos.node, chat, remove)
    videos.refresh()
    if (messages.length > 0) chat.scrollIntoView({ block: "end" })
  })

const route = (): void => {
  const match = /^#\/p\/([a-z0-9-]+)$/.exec(location.hash)
  document.title = "Студия Reels"
  const view = match?.[1] === undefined ? Effect.map(Api.listProjects, ({ projects }) => { listView(projects) }) : projectView(match[1])
  run(view, showFailure)
}

globalThis.addEventListener("hashchange", route)
route()
