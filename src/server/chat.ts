import { Array as Arr, Context, Deferred, Effect, Fiber, FileSystem, Layer, Path, Ref, Schema, Stream } from "effect"
import { ChildProcess, type ChildProcessSpawner } from "effect/process"
import { ApiError, badRequest, orUnavailable } from "./api-error.ts"
import { Media } from "./media.ts"
import type { VideoView } from "../shared/plan.ts"
import type { TimelineView } from "../shared/timeline.ts"
import { toChatEvents, type ChatEvent } from "./pi-events.ts"
import { Projects, type Effort } from "./projects.ts"
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

const videoLine = (video: VideoView): string =>
  video.state === "ready" && video.plan === "unreadable"
    ? `- source/${video.name}: heard, its words are in transcripts/${video.name}.txt, but plan.json is not valid and must be rewritten in the format the skill gives`
    : video.state === "ready"
    ? `- source/${video.name}: heard, its words are in transcripts/${video.name}.txt`
    : video.state === "failed"
      ? `- source/${video.name}: the studio could not hear it; the person can press «Попробовать ещё раз» under the video to have the studio listen to it again`
      : `- source/${video.name}: the studio is still listening to it, no transcript yet`

const LOOK_NOTES = {
  measured: (name: string) => `  Where the speaker looks during each stretch of it is in gaze/${name}.txt.`,
  waiting: () => "  The studio is still measuring where the speaker looks in it, so rank its takes by speech alone and say so.",
  failed: () => "  The studio could not measure where the speaker looks in it, so rank its takes by speech alone and say so."
}

const blocksLine = (timeline: TimelineView["timeline"]): ReadonlyArray<string> => {
  if (timeline.state === "unreadable") return ["blocks.json is not valid and must be rewritten in the format the skill gives."]
  if (timeline.state === "ready" && timeline.dropped > 0) {
    return [`blocks.json names ${timeline.dropped} take(s) with a video or word numbers that do not exist, and the page leaves them out.`]
  }
  return []
}

export const videoLines = (videos: ReadonlyArray<VideoView>, view: TimelineView): string => {
  if (videos.length === 0) return "No video is uploaded yet."
  const lines = videos.flatMap((video) => {
    const look = view.looks.find((one) => one.video === video.name)
    return look === undefined ? [videoLine(video)] : [videoLine(video), LOOK_NOTES[look.state](video.name)]
  })
  return [...lines, ...blocksLine(view.timeline)].join("\n")
}

const inPlainWords = (event: ChatEvent): Effect.Effect<ChatEvent> =>
  event.type === "error"
    ? Effect.as(Effect.logError("the model failed", event.message), { type: "error", message: MODEL_FAILED })
    : Effect.succeed(event)

const orBroken = orUnavailable("the chat failed", UNAVAILABLE)

const brokenStream = <A, E, R>(stream: Stream.Stream<A, E, R>): Stream.Stream<A, ApiError, R> =>
  stream.pipe(
    Stream.tapError((cause) => Effect.logError("the chat failed", cause)),
    Stream.mapError(() => new ApiError({ status: 500, message: UNAVAILABLE }))
  )

interface Turn {
  readonly stop: Deferred.Deferred<void>
  readonly finished: Deferred.Deferred<void>
}

const makeTurn = Effect.all({ stop: Deferred.make<void>(), finished: Deferred.make<void>() })

const makeTurns = Effect.gen(function*() {
  const turns = yield* Ref.make<ReadonlyMap<string, Turn>>(new Map())
  const claim = (id: string, turn: Turn): Effect.Effect<Turn | undefined> =>
    Ref.modify(turns, (map) => {
      const held = map.get(id)
      return held === undefined ? [undefined, new Map([...map, [id, turn]])] : [held, map]
    })
  const release = (id: string, turn: Turn): Effect.Effect<void> =>
    Ref.update(turns, (map) => new Map([...map].filter(([other, held]) => other !== id || held !== turn))).pipe(
      Effect.andThen(Deferred.succeed(turn.finished, undefined))
    )
  const takeOver = (id: string, turn: Turn): Effect.Effect<void> =>
    Effect.gen(function*() {
      const held = yield* claim(id, turn)
      if (held === undefined) return
      yield* Deferred.succeed(held.stop, undefined)
      yield* Deferred.await(held.finished)
      yield* takeOver(id, turn)
    })
  const withoutTurn = <A, E, R>(id: string, use: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.acquireUseRelease(
      Effect.tap(makeTurn, (turn) => takeOver(id, turn)),
      () => use,
      (turn) => release(id, turn)
    )
  return { claim, release, withoutTurn }
})

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

const expandStart = (state: Ref.Ref<RunState>): Effect.Effect<ReadonlyArray<ChatEvent>> =>
  Effect.gen(function*() {
    const current = yield* Ref.get(state)
    if (current.pending !== undefined) {
      yield* Effect.logError("the model recovered after an error", current.pending)
    }
    const started: ChatEvent = { type: "start" }
    if (current.text === "") {
      if (current.pending === undefined) return [started]
      yield* Ref.set(state, { ...current, pending: undefined })
      return [started]
    }
    yield* Ref.set(state, { ...current, base: current.text, pending: undefined, text: current.text + "\n\n" })
    return [started, { type: "delta", text: "\n\n" }]
  })

const expandDelta = (state: Ref.Ref<RunState>, text: string): Effect.Effect<ReadonlyArray<ChatEvent>> =>
  Effect.gen(function*() {
    const current = yield* Ref.get(state)
    const event: ChatEvent = { type: "delta", text }
    const next = { ...current, text: current.text + text }
    if (current.pending === undefined) {
      yield* Ref.set(state, next)
      return [event]
    }
    yield* Ref.set(state, { ...next, failed: current.pending, pending: undefined })
    const failure: ChatEvent = { type: "error", message: current.pending }
    return [failure, event]
  })

const expandStep = (state: Ref.Ref<RunState>, text: string): Effect.Effect<ReadonlyArray<ChatEvent>> =>
  Effect.gen(function*() {
    const current = yield* Ref.get(state)
    const event: ChatEvent = { type: "step", text }
    if (current.pending === undefined) return [event]
    yield* Ref.set(state, { ...current, failed: current.pending, pending: undefined })
    const failure: ChatEvent = { type: "error", message: current.pending }
    return [failure, event]
  })

const expandRetry = (state: Ref.Ref<RunState>): Effect.Effect<ReadonlyArray<ChatEvent>> =>
  Effect.gen(function*() {
    const current = yield* Ref.get(state)
    yield* Ref.set(state, { ...current, text: current.base, pending: undefined, failed: undefined })
    const event: ChatEvent = { type: "retry" }
    return [event]
  })

const expandError = (state: Ref.Ref<RunState>, message: string): Effect.Effect<ReadonlyArray<ChatEvent>> =>
  Effect.gen(function*() {
    const current = yield* Ref.get(state)
    yield* Effect.logError("the model failed", message)
    yield* Ref.set(state, { ...current, pending: MODEL_FAILED })
    return []
  })

const expandSettled = (state: Ref.Ref<RunState>, event: ChatEvent): Effect.Effect<ReadonlyArray<ChatEvent>> =>
  Effect.gen(function*() {
    const current = yield* Ref.get(state)
    if (current.pending === undefined) {
      yield* Ref.set(state, { ...current, settled: true })
      return [event]
    }
    yield* Ref.set(state, { ...current, failed: current.pending, pending: undefined, settled: true })
    const failure: ChatEvent = { type: "error", message: current.pending }
    return [failure, event]
  })

const makeExpand = (state: Ref.Ref<RunState>) => (event: ChatEvent): Effect.Effect<ReadonlyArray<ChatEvent>> => {
  if (event.type === "start") return expandStart(state)
  if (event.type === "delta") return expandDelta(state, event.text)
  if (event.type === "step") return expandStep(state, event.text)
  if (event.type === "retry") return expandRetry(state)
  if (event.type === "error") return expandError(state, event.message)
  return expandSettled(state, event)
}

const stoppedStream = <E>(
  state: Ref.Ref<RunState>,
  complaints: Fiber.Fiber<string, E>
): Stream.Stream<ChatEvent> =>
  Stream.unwrap(Effect.gen(function*() {
    const last = yield* Ref.get(state)
    if (last.settled) return Stream.make<Array<ChatEvent>>()
    yield* Effect.logError("pi stopped before it settled", yield* Effect.exit(Fiber.join(complaints)))
    yield* Ref.update(state, (current) => ({
      ...current,
      failed: current.failed ?? current.pending ?? STOPPED,
      pending: undefined,
      settled: true
    }))
    return Stream.make<Array<ChatEvent>>({ type: "error", message: STOPPED }, { type: "done" })
  }))

const piStream = <E>(
  stdout: Stream.Stream<Uint8Array, E>,
  expand: (event: ChatEvent) => Effect.Effect<ReadonlyArray<ChatEvent>>,
  stopped: Stream.Stream<ChatEvent>
): Stream.Stream<ChatEvent, E> =>
  stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.flatMap((line) => Stream.fromIterable(toChatEvents(line))),
    Stream.mapEffect(expand),
    Stream.flatMap((events) => Stream.fromIterable(events)),
    Stream.takeUntil((event) => event.type === "done"),
    Stream.mapEffect(inPlainWords),
    Stream.concat(stopped)
  )

export class Chat extends Context.Service<Chat, {
  readonly history: (id: string) => Effect.Effect<ReadonlyArray<Message>, ApiError>
  readonly send: (
    id: string,
    text: string,
    model: string,
    effort: Effort
  ) => Effect.Effect<Stream.Stream<ChatEvent, ApiError>, ApiError>
  readonly withoutTurn: <A, E, R>(id: string, use: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}>()("reels-studio/Chat") {
  static readonly layer = Layer.effect(
    Chat,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const settings = yield* Settings
      const projects = yield* Projects
      const media = yield* Media
      const context = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>()
      const { claim, release, withoutTurn } = yield* makeTurns
      const systemPrompt = yield* fs.readFileString(path.join(settings.root, "prompts", "studio.md")).pipe(orBroken)
      const append = Effect.fn("Chat.append")(function*(dir: string, message: Message) {
        const line = yield* encodeLine(message).pipe(orBroken)
        yield* fs.writeFileString(path.join(dir, "chat.jsonl"), line + "\n", { flag: "a" }).pipe(orBroken)
      })
      const history = Effect.fn("Chat.history")(function*(id: string) {
        const file = path.join(yield* projects.folder(id), "chat.jsonl")
        const exists = yield* fs.exists(file).pipe(orBroken)
        if (!exists) return []
        const text = yield* fs.readFileString(file).pipe(orBroken)
        return Arr.getSomes(text.split("\n").map((line) => decodeLine(line)))
      })
      const heardVideos = Effect.fn("Chat.heardVideos")(function*(id: string) {
        return videoLines(yield* media.videos(id), yield* media.timeline(id))
      }, orBroken)
      const command = (dir: string, text: string, model: string, effort: Effort, videos: string) => {
        const prompt = JSON.stringify({ id: "prompt", type: "prompt", message: text })
        return ChildProcess.make(settings.pi, [
          "--mode", "rpc",
          "--model", model,
          "--thinking", effort,
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
          "--system-prompt", `${systemPrompt}\nThe uploaded videos:\n${videos}\n`
        ], {
          cwd: dir,
          stdin: Stream.concat(Stream.make(new TextEncoder().encode(prompt + "\n")), Stream.never),
        })
      }
      const run = (id: string, dir: string, text: string, model: string, effort: Effort): Stream.Stream<ChatEvent, ApiError> =>
        Stream.unwrap(Effect.gen(function*() {
          const state = yield* Ref.make<RunState>({ text: "", base: "", pending: undefined, failed: undefined, settled: false })
          yield* Effect.addFinalizer(() =>
            Ref.get(state).pipe(Effect.flatMap((last) => append(dir, lastWords(last))),
              Effect.catchTag("ApiError", (error) => Effect.logError("the reply was not saved", error.message))
            ))
          const handle = yield* command(dir, text, model, effort, yield* heardVideos(id)).pipe(orBroken)
          const complaints = yield* handle.stderr.pipe(Stream.decodeText(), Stream.mkString, Effect.forkScoped)
          return piStream(handle.stdout, makeExpand(state), stoppedStream(state, complaints))
        })).pipe(brokenStream, Stream.provideContext(context))
      const send = Effect.fn("Chat.send")(function*(id: string, text: string, model: string, effort: Effort) {
        const trimmed = text.trim()
        if (trimmed === "") return yield* badRequest("Напишите сообщение")
        if (!settings.models.includes(model)) return yield* badRequest("Такой модели в студии нет")
        const dir = yield* projects.folder(id)
        const turn = yield* makeTurn
        if ((yield* claim(id, turn)) !== undefined) {
          return yield* new ApiError({ status: 409, message: "Дождитесь ответа на прошлое сообщение" })
        }
        yield* Effect.gen(function*() {
          yield* fs.makeDirectory(path.join(dir, "chat"), { recursive: true }).pipe(orBroken)
          yield* projects.setChoice(id, model, effort)
          yield* append(dir, { role: "user", text: trimmed })
        }).pipe(Effect.onError(() => release(id, turn)))
        return run(id, dir, trimmed, model, effort).pipe(
          Stream.interruptWhen(Deferred.await(turn.stop)),
          Stream.ensuring(release(id, turn))
        )
      })
      return Chat.of({ history, send, withoutTurn })
    })
  )
}
