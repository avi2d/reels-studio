import { Effect, Option, Schema } from "effect"
import * as Api from "./api.ts"
import type WaSelect from "@awesome.me/webawesome/dist/components/select/select.js"
import type WaTextarea from "@awesome.me/webawesome/dist/components/textarea/textarea.js"
import { attachTray, sentFiles, type Tray } from "./attach.ts"
import { button, iconButton, setExpanded, tooltip } from "./controls.ts"
import { h } from "./dom.ts"
import { modelName, parseEventBlock } from "./format.ts"
import { run } from "./run.ts"

const EFFORTS: ReadonlyArray<readonly [Api.Effort, string]> = [["low", "низкая"], ["medium", "средняя"], ["high", "высокая"]]
const CHOICE_HINT = "Выбранная модель делает в чате всю работу: смотрит материал, планирует нарезку и запускает инструменты. "
  + "Средняя глубина подходит для обычной нарезки, высокая нужна для трудных случаев."
const NO_MESSAGES = "Напишите, что оставить в ролике и что убрать. Студия слышит загруженные видео и сначала покажет план. "
  + "К сообщению можно приложить картинки, скриншоты, документы, видео и звук."

const bubble = (message: Api.Message, files: HTMLElement | undefined): HTMLElement => {
  const node = h("div", { class: `bubble ${message.role}` })
  if (files !== undefined) node.append(files)
  if (message.text !== "") node.append(h("span", {}, message.text))
  if (message.failed !== undefined) node.append(h("span", { class: "note" }, `Ответ не дошёл: ${message.failed}`))
  return node
}

const savedBubble = (projectId: string) => (message: Api.Message): HTMLElement =>
  bubble(message, message.files === undefined ? undefined : sentFiles(projectId, message.files))

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

const chosenOf = (select: WaSelect): string => typeof select.value === "string" ? select.value : ""

const effortOf = (value: string): readonly [Api.Effort, string] => EFFORTS.find(([id]) => id === value) ?? ["medium", "средняя"]

interface Talk {
  readonly log: HTMLElement
  readonly empty: HTMLElement
  readonly text: WaTextarea
  readonly model: WaSelect
  readonly effort: WaSelect
  readonly tray: Tray
}

const talk = (projectId: string, { effort, empty, log, model, text, tray }: Talk, message: string): Effect.Effect<void, Api.Failed> =>
  Effect.gen(function*() {
    const files = yield* tray.send
    const words = h("span")
    const answer = h("div", { class: "bubble assistant" }, words)
    const step = h("p", { class: "muted step", role: "status" }, "Студия думает…")
    const state = { done: false, text: "", base: "" }
    const fail = (reason: string): void => { answer.append(h("span", { class: "note" }, `Ответ не дошёл: ${reason}`)) }
    const response = yield* Api.postChat(projectId, message, files, chosenOf(model), effortOf(chosenOf(effort))[0]).pipe(
      Effect.catchTag("Offline", () => Effect.fail(new Api.Failed({ message: "Нет связи со студией. Проверьте Wi-Fi." })))
    )
    if (!response.ok || response.body === null) return yield* Effect.flatMap(Api.failure(response), Effect.fail)
    empty.remove()
    log.append(bubble({ role: "user", text: message }, files.length === 0 ? undefined : tray.sentView()), step)
    text.value = ""
    tray.clear()
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
  const opener = button("normal", {}, "Чат")
  setExpanded(opener, false)
  const close = iconButton("plain", "close", "Закрыть чат")
  const node = h("aside", { class: "drawer", "aria-label": "Чат", inert: true }, h("header", {}, h("b", {}, "Чат"), close), log, form)
  const setOpen = (open: boolean): void => {
    node.classList.toggle("open", open)
    node.inert = !open
    setExpanded(opener, open)
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
  const log = h("div", { class: "thread" }, ...(messages.length === 0 ? [empty] : messages.map(savedBubble(project.id))))
  const text = h("wa-textarea", { name: "text", rows: "1", resize: "auto", placeholder: "Сообщение студии" },
    h("span", { slot: "label", class: "visually-hidden" }, "Сообщение"))
  const firstModel = models.find((id) => id === project.model) ?? models[0] ?? ""
  const firstEffort = project.effort ?? "medium"
  const model = h("wa-select", { name: "model", class: "grow", label: "Модель", value: firstModel },
    ...models.map((id) => h("wa-option", { value: id }, modelName(id))))
  const effort = h("wa-select", { name: "effort", class: "grow", label: "Глубина размышления", value: firstEffort },
    ...EFFORTS.map(([id, name]) => h("wa-option", { value: id }, name)))
  const engine = h("summary")
  const nameEngine = (modelId: string, effortId: string): void => {
    engine.textContent = `${modelName(modelId)} · глубина ${effortOf(effortId)[1]}`
  }
  const renameEngine = (): void => { nameEngine(chosenOf(model), chosenOf(effort)) }
  model.addEventListener("change", renameEngine)
  effort.addEventListener("change", renameEngine)
  nameEngine(firstModel, firstEffort)
  const send = iconButton("primary", "send", "Отправить", { type: "submit", pill: true })
  const sendTip = tooltip(send, "chat-send", "Отправить")
  const problem = h("p", { class: "error", role: "alert" })
  const tray = attachTray(project.id, (message) => { problem.textContent = message })
  const attachTip = tooltip(tray.opener, "chat-attach", "Приложить файлы")
  text.addEventListener("paste", (event) => {
    const pasted = [...(event.clipboardData?.files ?? [])]
    if (pasted.length === 0) return
    event.preventDefault()
    tray.add(pasted)
  })
  const form = h("form", {
    class: "say",
    submit: (event) => {
      event.preventDefault()
      const message = (text.value ?? "").trim()
      if (message === "" && tray.count() === 0) return
      if (send.disabled) return
      send.disabled = true
      tray.lock(true)
      problem.textContent = ""
      const finish = (): void => {
        send.disabled = false
        tray.lock(false)
      }
      run(Effect.map(talk(project.id, { log, empty, text, model, effort, tray }, message), () => {
        finish()
        onReply()
      }), (failure) => {
        problem.textContent = failure
        finish()
      })
    }
  },
    h("details", { class: "engine" }, engine,
      h("div", { class: "row" }, model, effort),
      h("p", { class: "muted" }, CHOICE_HINT)),
    tray.node,
    h("div", { class: "composer" }, tray.opener, attachTip, tray.input, text, send, sendTip), problem)
  const drawer = drawerOf(log, form, text)
  const ask = (message: string): void => {
    if (send.disabled) return
    drawer.setOpen(true)
    text.value = message
    form.requestSubmit()
    log.scrollTop = log.scrollHeight
  }
  return { node: drawer.node, opener: drawer.opener, ask }
}
