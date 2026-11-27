import { Array as Arr, Context, Crypto, Deferred, Effect, Fiber, FileSystem, Layer, Option, Path, type PlatformError, Ref, Schema, Stream } from "effect"
import { type ChildProcessSpawner } from "effect/process"
import { approves } from "../shared/brief.ts"
import { type ChatEvent, Message, MAX_FILES } from "../shared/chat.ts"
import { ApiError, badRequest, orUnavailable } from "./api-error.ts"
import { Attachments } from "./attachments.ts"
import { piCommand } from "./pi-command.ts"
import { Brief } from "./brief.ts"
import { Media } from "./media.ts"
import type { VideoView } from "../shared/plan.ts"
import type { TimelineView } from "../shared/timeline.ts"
import { toChatEvents } from "./pi-events.ts"
import { Projects, type Effort } from "./projects.ts"
import { readOwnRules, rulesLine, watchRules } from "./rules.ts"
import { Settings } from "./settings.ts"
import { completedName } from "./tus.ts"

const MessageLine = Schema.fromJsonString(Message)
const decodeLine = Schema.decodeUnknownOption(MessageLine)
const encodeLine = Schema.encodeEffect(MessageLine)

const NOT_STARTED = "чат не запустился. Программа pi не найдена или не запускается на компьютере студии. Установите pi, перезапустите студию и отправьте сообщение ещё раз."
const EXITED = "программа pi завершилась с ошибкой. Подробности в журнале студии. Проверьте, что команда pi --list-models работает, и отправьте сообщение ещё раз."
const CLOSED = "программа pi закрылась раньше ответа. Отправьте сообщение ещё раз или выберите другую модель."

const modelFailed = (reason: string): string => {
  const line = reason.split("\n")[0]?.trim() ?? ""
  const stripped = line.replace(/[.!?…;:]+$/u, "")
  const detail = stripped.length > 200 ? `${stripped.slice(0, 200)}…` : stripped
  return detail === "" ? "модель не ответила. Выберите другую модель или отправьте сообщение ещё раз."
    : `модель не ответила: ${detail}. Выберите другую модель или отправьте сообщение ещё раз.`
}
const UNAVAILABLE = "Чат недоступен. Отправьте сообщение ещё раз."
const LOOKING: ChatEvent = { type: "step", text: "Смотрю приложенные файлы" }
const INTERRUPTED = "студия остановилась раньше, чем ответила. Отправьте сообщение ещё раз."
const GATHER_PROMPT = "The studio has heard every uploaded video and asks you to gather the blocks now. Write blocks.json as «Blocks and takes» in the reels-plan skill says, from every heard video. Write no plan and ask nothing. The person does not see this message or your answer."
const YES_NOTE = "\nWith this message the person agrees with the whole plan in plan.md. Follow «After the yes» in the reels-plan skill now, and leave plan.md and texts.json as they are.\n"

const briefNote = (brief: string): string => brief === ""
  ? "\nThe person has not written a brief yet. The page holds it in the field «Задание» of the stage «Видео и задание».\n"
  : `\nThe brief the person wrote in the field «Задание», also kept in brief.md:\n${brief}`

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

const insertsLine = (inserts: TimelineView["inserts"]): ReadonlyArray<string> => {
  if (inserts.state === "unreadable") return ["inserts.json is not valid and must be rewritten in the format the reels-inserts skill gives."]
  if (inserts.state === "ready" && inserts.dropped > 0) {
    return [`inserts.json names ${inserts.dropped} insert(s) with a repeated id, a missing picture, clip or document, a quote that is not on its page, a video or word numbers that do not exist, and the page leaves them out.`]
  }
  return []
}

export const videoLines = (videos: ReadonlyArray<VideoView>, view: Pick<TimelineView, "looks" | "timeline" | "inserts">): string => {
  if (videos.length === 0) return "No video is uploaded yet."
  const lines = videos.flatMap((video) => {
    const look = view.looks.find((one) => one.video === video.name)
    return look === undefined ? [videoLine(video)] : [videoLine(video), LOOK_NOTES[look.state](video.name)]
  })
  return [...lines, ...blocksLine(view.timeline), ...insertsLine(view.inserts)].join("\n")
}

const orBroken = orUnavailable("the chat failed", UNAVAILABLE)

const brokenStream = <A, E, R>(stream: Stream.Stream<A, E, R>): Stream.Stream<A, ApiError, R> =>
  stream.pipe(
    Stream.tapError((cause) => Effect.logError("the chat failed", cause)),
    Stream.mapError(() => new ApiError({ status: 500, message: UNAVAILABLE }))
  )

interface Turn {
  readonly token: string | undefined
  readonly stop: Deferred.Deferred<void>
  readonly finished: Deferred.Deferred<void>
}

const makeTurn = (token?: string): Effect.Effect<Turn> =>
  Effect.all({ stop: Deferred.make<void>(), finished: Deferred.make<void>() }).pipe(Effect.map((signals) => ({ token, ...signals })))

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
      Effect.tap(makeTurn(), (turn) => takeOver(id, turn)),
      () => use,
      (turn) => release(id, turn)
    )
  const stop = Effect.fnUntraced(function*(id: string, token: string) {
    const held = (yield* Ref.get(turns)).get(id)
    if (held?.token === token) yield* Deferred.succeed(held.stop, undefined)
  })
  return { claim, release, stop, withoutTurn }
})

interface RunState {
  readonly text: string
  readonly base: string
  readonly pending: string | undefined
  readonly failed: string | undefined
  readonly settled: boolean
}

const lastWords = (state: RunState, stopped: boolean): Message => {
  const text = state.text.trim()
  if (stopped && !state.settled) return { role: "assistant", text, stopped: true }
  const failed = state.failed ?? state.pending ?? (state.settled ? undefined : INTERRUPTED)
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
    yield* Ref.set(state, { ...current, pending: modelFailed(message) })
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
  return event.type === "done" ? expandSettled(state, event) : Effect.succeed([])
}

const endedWith = (state: Ref.Ref<RunState>, message: string): Effect.Effect<Stream.Stream<ChatEvent>> =>
  Effect.gen(function*() {
    const shown = (yield* Ref.get(state)).pending ?? message
    yield* Ref.update(state, (current) => ({
      ...current,
      failed: current.failed ?? shown,
      pending: undefined,
      settled: true
    }))
    return Stream.make<Array<ChatEvent>>({ type: "error", message: shown }, { type: "done" })
  })

const stoppedStream = <E>(
  state: Ref.Ref<RunState>,
  exited: Fiber.Fiber<ChildProcessSpawner.ExitCode, PlatformError.PlatformError>,
  complaints: Fiber.Fiber<string, E>
): Stream.Stream<ChatEvent> =>
  Stream.unwrap(Effect.gen(function*() {
    const last = yield* Ref.get(state)
    if (last.settled) return Stream.make<Array<ChatEvent>>()
    const code = yield* Fiber.join(exited).pipe(Effect.orElseSucceed(() => undefined))
    yield* Effect.logError("pi stopped before it settled", code, yield* Effect.exit(Fiber.join(complaints)))
    return yield* endedWith(state, code === 0 ? CLOSED : EXITED)
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
    Stream.concat(stopped)
  )

type Asker = { readonly kind: "person"; readonly turn: Turn } | { readonly kind: "studio" }
type Run = (id: string, dir: string, text: string, names: ReadonlyArray<string>, model: string, effort: Effort, approving: boolean, asker: Asker) => Stream.Stream<ChatEvent, ApiError>



interface GatherNeeds {
  readonly projects: Projects["Service"]
  readonly settings: Settings["Service"]
  readonly makeDirectory: (dir: string) => Effect.Effect<void, ApiError>
  readonly run: Run
}

const gatherWith = ({ projects, settings, makeDirectory, run }: GatherNeeds) =>
  Effect.fn("Chat.gather")(function*(id: string) {
    const dir = yield* projects.folder(id)
    const project = yield* projects.get(id)
    const model = project.model !== undefined && settings.models.includes(project.model) ? project.model : settings.models[0]
    if (model === undefined) return yield* new ApiError({ status: 500, message: "В студии не задана ни одна модель" })
    yield* makeDirectory(dir)
    const failed = yield* run(id, dir, GATHER_PROMPT, [], model, project.effort ?? "medium", false, { kind: "studio" }).pipe(
      Stream.runFold(() => false, (seen, event) => seen || event.type === "error")
    )
    if (failed) return yield* new ApiError({ status: 500, message: "Модель не собрала блоки" })
  })

export class Chat extends Context.Service<Chat, {
  readonly history: (id: string) => Effect.Effect<ReadonlyArray<Message>, ApiError>
  readonly send: (
    id: string,
    text: string,
    uploads: ReadonlyArray<string>,
    model: string,
    effort: Effort
  ) => Effect.Effect<{ readonly token: string; readonly events: Stream.Stream<ChatEvent, ApiError> }, ApiError>
  readonly stop: (id: string, token: string) => Effect.Effect<void>
  readonly gather: (id: string) => Effect.Effect<void, ApiError>
  readonly withoutTurn: <A, E, R>(id: string, use: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}>()("reels-studio/Chat") {
  static readonly layer = Layer.effect(
    Chat,
    Effect.gen(function*() {
      const crypto = yield* Crypto.Crypto
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const settings = yield* Settings
      const projects = yield* Projects
      const media = yield* Media
      const attachments = yield* Attachments
      const brief = yield* Brief
      const context = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>()
      const { claim, release, stop, withoutTurn } = yield* makeTurns
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
      const attachedNote = (listed: string): string => listed === "" ? "" : `\nThe files the person attached in the chat:\n${listed}\n`
      const run: Run = (id, dir, text, names, model, effort, approving, asker) =>
        Stream.unwrap(Effect.gen(function*() {
          const state = yield* Ref.make<RunState>({ text: "", base: "", pending: undefined, failed: undefined, settled: false })
          const rules = yield* (asker.kind === "person" ? watchRules(dir, settings.projectsDir) : readOwnRules(dir)).pipe(Effect.provideService(FileSystem.FileSystem, fs), orBroken)
          if (asker.kind === "person") {
            yield* Effect.addFinalizer(() =>
              Effect.all({ last: Ref.get(state), stopped: Deferred.isDone(asker.turn.stop) }).pipe(
                Effect.flatMap(({ last, stopped }) => append(dir, lastWords(last, stopped))),
                Effect.catchTag("ApiError", (error) => Effect.logError("the reply was not saved", error.message))
              ))
          }
          const reply = Stream.unwrap(Effect.gen(function*() {
            const files = yield* attachments.show(dir, names)
            const task = briefNote((yield* brief.view(id)).brief) + (approving ? YES_NOTE : "")
            const known = `${yield* heardVideos(id)}\n${task}${attachedNote(yield* attachments.listed(dir, files))}`
            const launched = yield* piCommand(settings.pi, settings.root, (...parts: Array<string>) => path.join(...parts), systemPrompt, dir, text, files, model, effort, known, asker.kind, asker.kind === "person" ? rulesLine(rules) : "").pipe(
              Effect.tapError((error) => Effect.logError("pi did not start", error)),
              Effect.option
            )
            if (Option.isNone(launched)) return yield* endedWith(state, NOT_STARTED)
            const handle = launched.value
            const complaints = yield* handle.stderr.pipe(Stream.decodeText(), Stream.mkString, Effect.forkScoped)
            const exited = yield* handle.exitCode.pipe(Effect.forkScoped)
            return piStream(handle.stdout, makeExpand(state), stoppedStream(state, exited, complaints))
          }))
          if (asker.kind === "studio") return reply
          const starting: ChatEvent = names.length === 0 ? { type: "step", text: "Готовлю ответ" } : LOOKING
          return Stream.concat(Stream.make(starting), reply)
        })).pipe(brokenStream, Stream.provideContext(context))
      const send = Effect.fn("Chat.send")(function*(id: string, text: string, uploads: ReadonlyArray<string>, model: string, effort: Effort) {
        const trimmed = text.trim()
        if (trimmed === "" && uploads.length === 0) return yield* badRequest("Напишите сообщение")
        if (uploads.length > MAX_FILES) return yield* badRequest(`Прикрепите к одному сообщению не больше ${MAX_FILES} файлов`)
        if (!settings.models.includes(model)) return yield* badRequest("Такой модели в студии нет")
        const dir = yield* projects.folder(id)
        const names = Arr.dedupe(yield* Effect.forEach(uploads, (upload) => completedName(dir, upload, "attached").pipe(Effect.provideService(FileSystem.FileSystem, fs), Effect.provideService(Path.Path, path))))
        const plan = approves(trimmed) && names.length === 0 ? yield* brief.plan(id) : undefined
        const approved = plan === undefined || plan.state === "none" ? undefined : plan.text
        const token = yield* crypto.randomUUIDv4.pipe(orBroken)
        const turn = yield* makeTurn(token)
        if ((yield* claim(id, turn)) !== undefined) return yield* new ApiError({ status: 409, message: "Дождитесь ответа на прошлое сообщение" })
        yield* Effect.gen(function*() {
          yield* fs.makeDirectory(path.join(dir, "chat"), { recursive: true }).pipe(orBroken)
          yield* projects.setChoice(id, model, effort)
          yield* append(dir, names.length === 0 ? { role: "user", text: trimmed } : { role: "user", text: trimmed, files: names })
        }).pipe(Effect.onError(() => release(id, turn)))
        if (approved !== undefined) {
          const snapshot = yield* brief.agree(id, approved).pipe(Effect.onError(() => release(id, turn)))
          if (!(yield* brief.working(id))) {
            yield* Effect.forkDetach(brief.workAlone(id, snapshot, Deferred.await(turn.finished)).pipe(
              Effect.catchTag("ApiError", (error) => Effect.logError("the work after the yes failed", error.message))
            ))
          }
        }
        const events = run(id, dir, trimmed, names, model, effort, approved !== undefined, { kind: "person", turn }).pipe(
          Stream.interruptWhen(Deferred.await(turn.stop)),
          Stream.ensuring(release(id, turn)),
          Stream.concat(Stream.unwrap(Effect.map(Deferred.isDone(turn.stop), (stopped) =>
            stopped ? Stream.make<ReadonlyArray<ChatEvent>>({ type: "stopped" }, { type: "done" }) : Stream.empty))),
          Stream.takeUntil((event) => event.type === "done")
        )
        return { token, events }
      })
      const gather = gatherWith({ projects, settings, makeDirectory: (dir) => fs.makeDirectory(path.join(dir, "gather"), { recursive: true }).pipe(orBroken), run })
      return Chat.of({ history, send, stop, gather, withoutTurn })
    })
  )
}
