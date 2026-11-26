import { Effect } from "effect"
import { CHAT_TURN_HEADER, type ChatEvent, type Message } from "../../shared/chat.ts"
import * as Api from "../api.ts"
import { sentFiles } from "../attach.ts"
import { readReply } from "../chat-stream.ts"
import { h } from "../dom.ts"
import { icon } from "./icons.ts"

const STOPPED = "Ответ остановлен."
const DISCONNECTED = "Связь прервалась. Отправьте сообщение ещё раз."

export type Reply =
  | { readonly kind: "answered" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "stopped" }

const bubble = (role: Message["role"], ...parts: ReadonlyArray<Node>): HTMLElement =>
  h("div", { class: `studio-chat__bubble studio-chat__bubble--${role}` }, ...parts)

export const attachmentIcon = (): HTMLElement => icon("file")

const note = (message: string): HTMLElement => h("p", { class: "hint" }, message)

export const savedMessage = (id: string, message: Message): HTMLElement => bubble(message.role,
  ...message.text === "" ? [] : [h("p", {}, message.text)],
  ...message.files === undefined ? [] : [sentFiles(id, message.files, attachmentIcon)],
  ...message.failed === undefined ? [] : [note(`Ответ не дошёл: ${message.failed}`)],
  ...message.stopped === true ? [note(STOPPED)] : [])

const liveReply = (thread: HTMLElement, status: HTMLElement) => {
  const words = h("p")
  const answer = bubble("assistant")
  let base = ""
  let result: Reply | undefined
  const atEnd = (): boolean => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 48
  const scroll = (): void => { thread.scrollTop = thread.scrollHeight }
  const show = (): void => { if (answer.parentNode === null) thread.append(answer) }
  const receive = (event: ChatEvent): void => {
    const follow = atEnd()
    switch (event.type) {
      case "step": status.textContent = `${event.text}…`; break
      case "start": base = words.textContent; break
      case "retry": words.textContent = base; result = undefined; break
      case "delta":
        show()
        if (words.parentNode === null) answer.append(words)
        words.append(event.text)
        break
      case "error": result = { kind: "failed", message: event.message }; break
      case "stopped": result = { kind: "stopped" }; break
      case "done": result ??= { kind: "answered" }; break
    }
    if (follow) scroll()
  }
  const finish = (): Reply => {
    const follow = atEnd()
    const outcome = result ?? { kind: "failed", message: DISCONNECTED }
    if (outcome.kind !== "answered") {
      show()
      answer.append(note(outcome.kind === "stopped" ? STOPPED : `Ответ не дошёл: ${outcome.message}`))
    }
    if (follow) scroll()
    return outcome
  }
  return { receive, finish, scroll }
}

interface Request {
  readonly projectId: string
  readonly text: string
  readonly model: string
  readonly effort: Api.Effort
  readonly files: ReadonlyArray<string>
}

interface Transcript {
  readonly thread: HTMLElement
  readonly status: HTMLElement
  readonly empty: HTMLElement
  readonly attachments: HTMLElement | undefined
  readonly accept: (token: string) => void
}

export const streamTurn = Effect.fnUntraced(function*(request: Request, transcript: Transcript) {
  const { projectId, text, model, effort, files } = request
  const response = yield* Api.postChat(projectId, text, files, model, effort).pipe(
    Effect.catchTag("Offline", () => Effect.fail(new Api.Failed({ message: "Нет связи со студией. Проверьте Wi-Fi." })))
  )
  if (!response.ok || response.body === null) return yield* Effect.flatMap(Api.failure(response), Effect.fail)
  const token = response.headers.get(CHAT_TURN_HEADER)
  if (token === null) return yield* new Api.Failed({ message: "Не удалось открыть ответ. Обновите страницу." })

  const { thread, status, empty, attachments, accept } = transcript
  const reply = liveReply(thread, status)
  empty.remove()
  thread.append(bubble("user", ...text === "" ? [] : [h("p", {}, text)], ...attachments === undefined ? [] : [attachments]))
  accept(token)
  reply.scroll()
  yield* readReply(response.body.getReader(), reply.receive)
  return reply.finish()
})
