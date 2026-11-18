import { Effect, Option, Schema } from "effect"
import * as Api from "./api.ts"
import { h } from "./dom.ts"
import { modelName, parseEventBlock } from "./format.ts"
import { run } from "./run.ts"

const EFFORTS: ReadonlyArray<readonly [Api.Effort, string]> = [["low", "низкая"], ["medium", "средняя"], ["high", "высокая"]]
const CHOICE_HINT = "Выбранная модель делает в чате всю работу: смотрит материал, планирует нарезку и запускает инструменты. "
  + "Средняя глубина подходит для обычной нарезки, высокая нужна для трудных случаев."
const NO_MESSAGES = "Напишите, что оставить в ролике и что убрать. Студия слышит загруженные видео и сначала покажет план."

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

const effortOf = (value: string): readonly [Api.Effort, string] => EFFORTS.find(([id]) => id === value) ?? ["medium", "средняя"]

interface Talk {
  readonly log: HTMLElement
  readonly empty: HTMLElement
  readonly text: HTMLTextAreaElement
  readonly model: HTMLSelectElement
  readonly effort: HTMLSelectElement
}

const talk = (projectId: string, { effort, empty, log, model, text }: Talk, message: string): Effect.Effect<void, Api.Failed> =>
  Effect.gen(function*() {
    const words = h("span")
    const answer = h("div", { class: "bubble assistant" }, words)
    const step = h("p", { class: "muted step", role: "status" }, "Студия думает…")
    const state = { done: false, text: "", base: "" }
    const fail = (reason: string): void => { answer.append(h("span", { class: "note" }, `Ответ не дошёл: ${reason}`)) }
    const response = yield* Api.postChat(projectId, message, model.value, effortOf(effort.value)[0]).pipe(
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
  })

const drawerOf = (log: HTMLElement, form: HTMLElement, text: HTMLElement) => {
  const opener = h("button", { type: "button", "aria-expanded": "false" }, "Чат")
  const close = h("button", { type: "button", class: "ghost", "aria-label": "Закрыть чат" }, "✕")
  const node = h("aside", { class: "drawer", "aria-label": "Чат", inert: true }, h("header", {}, h("b", {}, "Чат"), close), log, form)
  const setOpen = (open: boolean): void => {
    node.classList.toggle("open", open)
    node.inert = !open
    opener.setAttribute("aria-expanded", String(open))
    if (!open) {
      opener.focus()
      return
    }
    log.scrollTop = log.scrollHeight
    if (globalThis.matchMedia("(hover: hover) and (pointer: fine)").matches) text.focus()
  }
  opener.addEventListener("click", () => { setOpen(node.inert) })
  close.addEventListener("click", () => { setOpen(false) })
  node.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return
    event.stopPropagation()
    setOpen(false)
  })
  return { node, opener, setOpen }
}

export interface ChatDrawer {
  readonly node: HTMLElement
  readonly opener: HTMLElement
  readonly ask: (message: string) => void
}

export const chatDrawer = (
  project: Api.ProjectView,
  messages: ReadonlyArray<Api.Message>,
  models: ReadonlyArray<string>,
  onReply: () => void
): ChatDrawer => {
  const empty = h("p", { class: "muted" }, NO_MESSAGES)
  const log = h("div", { class: "thread" }, ...(messages.length === 0 ? [empty] : messages.map(bubble)))
  const text = h("textarea", { name: "text", rows: "1", required: true, "aria-label": "Сообщение", placeholder: "Сообщение студии" })
  const model = h("select", { name: "model" }, ...models.map((id) => h("option", { value: id, selected: id === project.model }, modelName(id))))
  const chosen = project.effort ?? "medium"
  const effort = h("select", { name: "effort" }, ...EFFORTS.map(([id, name]) => h("option", { value: id, selected: id === chosen }, name)))
  const engine = h("summary")
  const nameEngine = (): void => { engine.textContent = `${modelName(model.value)} · глубина ${effortOf(effort.value)[1]}` }
  model.addEventListener("change", nameEngine)
  effort.addEventListener("change", nameEngine)
  nameEngine()
  const button = h("button", { type: "submit", class: "send", "aria-label": "Отправить", title: "Отправить" }, "↑")
  const problem = h("p", { class: "error", role: "alert" })
  const form = h("form", {
    class: "say",
    submit: (event) => {
      event.preventDefault()
      const message = text.value.trim()
      if (message === "") return
      button.disabled = true
      problem.textContent = ""
      const finish = (): void => { button.disabled = false }
      run(Effect.map(talk(project.id, { log, empty, text, model, effort }, message), () => {
        finish()
        onReply()
      }), (failure) => {
        problem.textContent = failure
        finish()
      })
    }
  },
    h("details", { class: "engine" }, engine,
      h("div", { class: "row" }, h("label", { class: "grow" }, "Модель", model), h("label", { class: "grow" }, "Глубина размышления", effort)),
      h("p", { class: "muted" }, CHOICE_HINT)),
    h("div", { class: "composer" }, text, button), problem)
  const drawer = drawerOf(log, form, text)
  const ask = (message: string): void => {
    if (button.disabled) return
    drawer.setOpen(true)
    text.value = message
    form.requestSubmit()
    log.scrollTop = log.scrollHeight
  }
  return { node: drawer.node, opener: drawer.opener, ask }
}
