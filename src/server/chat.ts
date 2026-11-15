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
const UNAVAILABLE = "Чат недоступен. Отправьте сообщение ещё раз."
const INTERRUPTED = "студия остановилась раньше, чем ответила. Отправьте сообщение ещё раз."

const inPlainWords = (event: ChatEvent): Effect.Effect<ChatEvent> =>
  event.type === "error"
    ? Effect.as(Effect.logError("the model failed", event.message), { type: "error", message: MODEL_FAILED })
    : Effect.succeed(event)

const orBroken = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, ApiError> =>
  effect.pipe(
    Effect.catch((cause) =>
      Effect.as(Effect.logError("the chat failed", cause), new ApiError({ status: 500, message: UNAVAILABLE })))
  )

const brokenStream = <A>(stream: Stream.Stream<A, unknown>): Stream.Stream<A, ApiError> =>
  stream.pipe(
    Stream.tapError((cause) => Effect.logError("the chat failed", cause)),
    Stream.mapError(() => new ApiError({ status: 500, message: UNAVAILABLE }))
  )

interface RunState {
  readonly text: string
  readonly base: string
  readonly pending: string | undefined
  readonly failed: string | undefined
  readonly settled: boolean
}

const lastWords = (state: RunState): Message => {
  const failed = state.failed ?? state.pending ?? (state.settled ? undefined : INTERRUPTED)
  const text = state.text.trim()
  return failed === undefined ? { role: "assistant", text } : { role: "assistant", text, failed }
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
      const systemPrompt = yield* fs.readFileString(path.join(settings.root, "prompts", "studio.md")).pipe(orBroken)

      const append = Effect.fn("Chat.append")(function*(dir: string, message: Message) {
        const line = yield* encodeLine(message).pipe(orBroken)
        yield* fs.writeFileString(path.join(dir, "chat.jsonl"), `${line}\n`, { flag: "a" }).pipe(orBroken)
      })

      const history = Effect.fn("Chat.history")(function*(id: string) {
        const file = path.join(yield* projects.folder(id), "chat.jsonl")
        const exists = yield* fs.exists(file).pipe(orBroken)
        if (!exists) return []
        const text = yield* fs.readFileString(file).pipe(orBroken)
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
          "--no-approve",
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
          const state = yield* Ref.make<RunState>({ text: "", base: "", pending: undefined, failed: undefined, settled: false })
          yield* Effect.addFinalizer(() =>
            Ref.get(state).pipe(Effect.flatMap((last) => append(dir, lastWords(last))),
              Effect.catchTag("ApiError", (error) => Effect.logError("the reply was not saved", error.message))
            ))
          const handle = yield* command(dir, text, model).pipe(orBroken)
          const complaints = yield* handle.stderr.pipe(Stream.decodeText(), Stream.mkString, Effect.forkScoped)
          const expand = (event: ChatEvent): Effect.Effect<ReadonlyArray<ChatEvent>> =>
            Effect.gen(function*() {
              const current = yield* Ref.get(state)
              if (event.type === "start") {
                if (current.pending !== undefined) {
                  yield* Effect.logError("the model recovered after an error", current.pending)
                }
                if (current.text === "") {
                  if (current.pending === undefined) return [event]
                  yield* Ref.set(state, { ...current, pending: undefined })
                  return [event]
                }
                yield* Ref.set(state, { ...current, base: current.text, pending: undefined, text: `${current.text}\n\n` })
                return [event, { type: "delta" as const, text: "\n\n" }]
              }
              if (event.type === "delta") {
                const next = { ...current, text: current.text + event.text }
                if (current.pending !== undefined) {
                  yield* Ref.set(state, { ...next, failed: current.pending, pending: undefined })
                  return [{ type: "error" as const, message: current.pending }, event]
                }
                yield* Ref.set(state, next)
                return [event]
              }
              if (event.type === "step") {
                if (current.pending !== undefined) {
                  yield* Ref.set(state, { ...current, failed: current.pending, pending: undefined })
                  return [{ type: "error" as const, message: current.pending }, event]
                }
                return [event]
              }
              if (event.type === "retry") {
                yield* Ref.set(state, { ...current, text: current.base, pending: undefined, failed: undefined })
                return [event]
              }
              if (event.type === "error") {
                yield* Effect.logError("the model failed", event.message)
                yield* Ref.set(state, { ...current, pending: MODEL_FAILED })
                return []
              }
              yield* Ref.set(state,
                current.pending !== undefined
                  ? { ...current, failed: current.pending, pending: undefined, settled: true }
                  : { ...current, settled: true })
              return current.pending !== undefined
                ? [{ type: "error" as const, message: current.pending }, event]
                : [event]
            })
          const stopped = Stream.unwrap(Effect.gen(function*() {
            const last = yield* Ref.get(state)
            if (last.settled) return Stream.empty
            yield* Effect.logError("pi stopped before it settled", yield* Fiber.join(complaints))
            yield* Ref.update(state, (current) => ({ ...current, failed: current.failed ?? current.pending ?? STOPPED, pending: undefined, settled: true }))
            return Stream.make<Array<ChatEvent>>({ type: "error", message: STOPPED }, { type: "done" })
          }))
          return handle.stdout.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.flatMap((line) => Stream.fromIterable(toChatEvents(line))),
            Stream.mapEffect(expand),
            Stream.flatMap((events) => Stream.fromIterable(events)),
            Stream.takeUntil((event) => event.type === "done"),
            Stream.mapEffect(inPlainWords),
            Stream.concat(stopped)
          )
        })).pipe(brokenStream, Stream.provideContext(context))

      const send = Effect.fn("Chat.send")(function*(id: string, text: string, model: string) {
        const trimmed = text.trim()
        if (trimmed === "") return yield* badRequest("Напишите сообщение")
        if (!settings.models.includes(model)) return yield* badRequest("Такой модели в студии нет")
        const dir = yield* projects.folder(id)
        const taken = yield* Ref.modify(busy, (set) => [set.has(id), new Set([...set, id])])
        if (taken) return yield* new ApiError({ status: 409, message: "Дождитесь ответа на прошлое сообщение" })
        const release = Ref.update(busy, (set) => new Set([...set].filter((other) => other !== id)))
        yield* Effect.gen(function*() {
          yield* fs.makeDirectory(path.join(dir, "chat"), { recursive: true }).pipe(orBroken)
          yield* projects.setModel(id, model)
          yield* append(dir, { role: "user", text: trimmed })
        }).pipe(Effect.onError(() => release))
        return run(dir, trimmed, model).pipe(Stream.ensuring(release))
      })

      return Chat.of({ history, send })
    })
  )
}
