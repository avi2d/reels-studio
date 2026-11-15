import { Array as Arr, Context, Effect, Fiber, FileSystem, Layer, Path, Ref, Schema, Stream } from "effect"
import { ChildProcess, type ChildProcessSpawner } from "effect/process"
import { ApiError, badRequest } from "./api-error.ts"
import { toChatEvents, type ChatEvent } from "./pi-events.ts"
import { Projects } from "./projects.ts"
import { Settings } from "./settings.ts"

const Message = Schema.Struct({
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  failed: Schema.optionalKey(Schema.String)
})
export type Message = typeof Message.Type

const MessageLine = Schema.fromJsonString(Message)
const decodeLine = Schema.decodeUnknownOption(MessageLine)
const encodeLine = Schema.encodeEffect(MessageLine)

const TOOLS = "read,grep,find,ls,write,edit"
const STOPPED = "чат не запустился. Отправьте сообщение ещё раз или выберите другую модель."
const MODEL_FAILED = "модель не ответила. Выберите другую модель или отправьте сообщение ещё раз."

// what a provider says goes to the log, and the person reads what to do next
const inPlainWords = (event: ChatEvent): Effect.Effect<ChatEvent> =>
  event.type === "error"
    ? Effect.as(Effect.logError("the model failed", event.message), { type: "error", message: MODEL_FAILED })
    : Effect.succeed(event)

const broken = (cause: unknown): ApiError => new ApiError({ status: 500, message: `Чат недоступен: ${String(cause)}` })

interface Reply {
  readonly text: string
  readonly failed: string | undefined
  readonly settled: boolean
}

const fold = (reply: Reply, event: ChatEvent): Reply => {
  if (event.type === "delta") return { ...reply, text: reply.text + event.text }
  if (event.type === "error") return { ...reply, failed: event.message }
  return event.type === "done" ? { ...reply, settled: true } : reply
}

const lastWords = (reply: Reply): Message => {
  const failed = reply.failed ?? (reply.settled ? undefined : "студия остановилась раньше, чем ответила. Отправьте сообщение ещё раз.")
  return failed === undefined ? { role: "assistant", text: reply.text } : { role: "assistant", text: reply.text, failed }
}

export class Chat extends Context.Service<Chat, {
  readonly history: (id: string) => Effect.Effect<ReadonlyArray<Message>, ApiError>
  readonly send: (
    id: string,
    text: string,
    model: string
  ) => Effect.Effect<Stream.Stream<ChatEvent, ApiError>, ApiError>
}>()("reels-studio/Chat") {
  static readonly layer = Layer.effect(
    Chat,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const settings = yield* Settings
      const projects = yield* Projects
      const context = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>()
      const busy = yield* Ref.make<ReadonlySet<string>>(new Set())
      const systemPrompt = yield* fs.readFileString(path.join(settings.root, "prompts", "studio.md"))

      const append = Effect.fn("Chat.append")(function*(dir: string, message: Message) {
        const line = yield* encodeLine(message)
        yield* fs.writeFileString(path.join(dir, "chat.jsonl"), `${line}\n`, { flag: "a" })
      }, Effect.mapError(broken))

      const history = Effect.fn("Chat.history")(function*(id: string) {
        const file = path.join(yield* projects.folder(id), "chat.jsonl")
        const exists = yield* fs.exists(file).pipe(Effect.mapError(broken))
        if (!exists) return []
        const text = yield* fs.readFileString(file).pipe(Effect.mapError(broken))
        return Arr.getSomes(text.split("\n").map((line) => decodeLine(line)))
      })

      const command = (dir: string, text: string, model: string) => {
        const prompt = JSON.stringify({ id: "prompt", type: "prompt", message: text })
        return ChildProcess.make(settings.pi, [
          "--mode", "rpc",
          "--model", model,
          "--session-dir", path.join(dir, "chat"),
          "--continue",
          "--tools", TOOLS,
          "--no-mcp",
          "--no-skills",
          "--skill", path.join(settings.root, "skills"),
          "--no-context-files",
          "--no-prompt-templates",
          "--extension", path.join(settings.root, "src", "pi", "project-guard.ts"),
          "--system-prompt", systemPrompt
        ], {
          cwd: dir,
          stdin: Stream.concat(Stream.make(new TextEncoder().encode(`${prompt}\n`)), Stream.never),
        })
      }

      const run = (dir: string, text: string, model: string): Stream.Stream<ChatEvent, ApiError> =>
        Stream.unwrap(Effect.gen(function*() {
          const reply = yield* Ref.make<Reply>({ text: "", failed: undefined, settled: false })
          const handle = yield* command(dir, text, model)
          yield* Effect.addFinalizer(() =>
            Ref.get(reply).pipe(Effect.flatMap((last) => append(dir, lastWords(last))),
              Effect.catchTag("ApiError", (error) => Effect.logError("the reply was not saved", error.message))
            ))
          const complaints = yield* handle.stderr.pipe(Stream.decodeText(), Stream.mkString, Effect.forkScoped)
          const stopped = Stream.unwrap(Effect.gen(function*() {
            const last = yield* Ref.get(reply)
            if (last.settled) return Stream.empty
            yield* Effect.logError("pi stopped before it settled", yield* Fiber.join(complaints))
            return Stream.make<Array<ChatEvent>>({ type: "error", message: STOPPED }, { type: "done" })
          }))
          return handle.stdout.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.flatMap((line) => Stream.fromIterable(toChatEvents(line))),
            Stream.takeUntil((event) => event.type === "done"),
            Stream.mapEffect(inPlainWords),
            Stream.concat(stopped),
            Stream.tap((event) => Ref.update(reply, (last) => fold(last, event)))
          )
        })).pipe(Stream.mapError(broken), Stream.provideContext(context))

      const send = Effect.fn("Chat.send")(function*(id: string, text: string, model: string) {
        const trimmed = text.trim()
        if (trimmed === "") return yield* badRequest("Напишите сообщение")
        if (!settings.models.includes(model)) return yield* badRequest("Такой модели в студии нет")
        const dir = yield* projects.folder(id)
        const taken = yield* Ref.modify(busy, (set) => [set.has(id), new Set([...set, id])])
        if (taken) return yield* new ApiError({ status: 409, message: "Дождитесь ответа на прошлое сообщение" })
        const release = Ref.update(busy, (set) => new Set([...set].filter((other) => other !== id)))
        yield* Effect.gen(function*() {
          yield* fs.makeDirectory(path.join(dir, "chat"), { recursive: true }).pipe(Effect.mapError(broken))
          yield* projects.setModel(id, model)
          yield* append(dir, { role: "user", text: trimmed })
        }).pipe(Effect.onError(() => release))
        return run(dir, trimmed, model).pipe(Stream.ensuring(release))
      })

      return Chat.of({ history, send })
    })
  )
}
