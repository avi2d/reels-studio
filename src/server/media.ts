import { type Crypto, Cause, Context, Deferred, Effect, Exit, FileSystem, Layer, Option, Ref } from "effect"
import type { ChildProcessSpawner } from "effect/process"
import type { LibraryVideo, Pick } from "../shared/library.ts"
import type { VideoView } from "../shared/plan.ts"
import type { ReelJob, ReelView } from "../shared/reel.ts"
import type { Edits, GazeFailure, TimelineView } from "../shared/timeline.ts"
import { ApiError, badRequest, notFound, orUnavailable } from "./api-error.ts"
import { GazeFailed, listen, look, places, previewIsFresh, readPlan, readTranscript, refreshPreview, type Job } from "./media-jobs.ts"
import { Projects } from "./projects.ts"
import { gatherLibrary, heardIn, keysIn, reuse as reuseOne, sourceNames } from "./reuse.ts"
import { Settings } from "./settings.ts"
import { buildReel, readReel, reelVideoAt } from "./reel.ts"
import { readCut, readTimeline, writeEdits } from "./timeline-files.ts"

const UNAVAILABLE = "Видео недоступно. Попробуйте открыть страницу ещё раз."
const orBroken = orUnavailable("the media failed", UNAVAILABLE)

const keyOf = (job: Job): string => places(job).source

type Unheard = Ref.Ref<ReadonlySet<string>>
type Unseen = Ref.Ref<ReadonlyMap<string, GazeFailure>>
type Reels = Ref.Ref<ReadonlyMap<string, ReelJob>>

interface Failures {
  readonly unheard: Unheard
  readonly unseen: Unseen
  readonly stale: Unheard
  readonly reels: Reels
}

interface Running {
  readonly dir: string
  readonly stop: Deferred.Deferred<void>
  readonly finished: Deferred.Deferred<void>
}

interface Work {
  readonly closed: ReadonlySet<string>
  readonly running: Running | undefined
}

const openJobs = Effect.fnUntraced(function*(closed: ReadonlySet<string>) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const ids = yield* fs.readDirectory(settings.projectsDir).pipe(Effect.orElseSucceed((): Array<string> => []))
  const dirs = ids.map((id) => `${settings.projectsDir}/${id}`).filter((dir) => !closed.has(dir))
  const jobs = yield* Effect.forEach(dirs, (dir) =>
    sourceNames(dir).pipe(
      Effect.map((names) => names.map((name): Job => ({ dir, name }))),
      Effect.orElseSucceed((): Array<Job> => [])
    ))
  return jobs.flat()
})

const nextUnheard = Effect.fnUntraced(function*(unheard: Unheard, jobs: ReadonlyArray<Job>) {
  const fs = yield* FileSystem.FileSystem
  const failed = yield* Ref.get(unheard)
  const heard = yield* Effect.forEach(jobs, (job) =>
    Effect.map(fs.exists(places(job).transcript), (exists) => exists || failed.has(keyOf(job))))
  return jobs.find((_, index) => heard[index] === false)
})

const nextStale = Effect.fnUntraced(function*(stale: Unheard, jobs: ReadonlyArray<Job>) {
  const fs = yield* FileSystem.FileSystem
  const failed = yield* Ref.get(stale)
  const old = yield* Effect.forEach(jobs, (job) => Effect.gen(function*() {
    if (failed.has(keyOf(job))) return false
    if (!(yield* fs.exists(places(job).transcript))) return false
    if (!(yield* fs.exists(places(job).preview))) return false
    return !(yield* previewIsFresh(job))
  }))
  return jobs.find((_, index) => old[index] === true)
})

const nextUnseen = Effect.fnUntraced(function*(unseen: Unseen, jobs: ReadonlyArray<Job>) {
  const fs = yield* FileSystem.FileSystem
  const failed = yield* Ref.get(unseen)
  const waiting = yield* Effect.forEach(jobs, (job) => Effect.gen(function*() {
    const place = places(job)
    if (failed.has(keyOf(job)) || (yield* fs.exists(place.gaze))) return false
    return (yield* fs.exists(place.transcript)) && (yield* fs.exists(place.preview))
  }))
  return jobs.find((_, index) => waiting[index] === true)
})

const attempt = Effect.fnUntraced(function*<E, R>(work: Ref.Ref<Work>, job: Job, task: Effect.Effect<void, E, R>, record: (cause: Cause.Cause<E>) => Effect.Effect<void>) {
  const running: Running = { dir: job.dir, stop: yield* Deferred.make<void>(), finished: yield* Deferred.make<void>() }
  const claimed = yield* Ref.modify(work, (state) =>
    state.closed.has(job.dir) ? [false, state] : [true, { ...state, running }])
  if (!claimed) return
  const outcome = yield* Effect.exit(Effect.raceFirst(task, Deferred.await(running.stop))).pipe(
    Effect.ensuring(Ref.update(work, (state) => ({ ...state, running: undefined })).pipe(
      Effect.andThen(Deferred.succeed(running.finished, undefined))
    ))
  )
  if (Exit.isFailure(outcome)) {
    yield* Effect.logError("the media job failed", job.name, outcome.cause)
    yield* record(outcome.cause)
  }
})

const markFailed = (failures: Unheard, job: Job): Effect.Effect<void> =>
  Ref.update(failures, (set) => new Set([...set, keyOf(job)]))

const markGazeFailed = (failures: Unseen, job: Job) => (cause: Cause.Cause<unknown>): Effect.Effect<void> =>
  Ref.update(failures, (map) => new Map([...map, [keyOf(job), Option.match(Cause.findErrorOption(cause), {
    onNone: (): GazeFailure => "tool-failed",
    onSome: (error): GazeFailure => error instanceof GazeFailed ? error.reason : "tool-failed"
  })]]))

const setReel = (reels: Reels, dir: string, job: ReelJob): Effect.Effect<void> =>
  Ref.update(reels, (map) => new Map([...map, [dir, job]]))

const queueWaiting = (reels: Reels, dir: string): Effect.Effect<boolean> =>
  Ref.modify(reels, (map) => {
    const job = map.get(dir)
    if (job?.state === "waiting" || job?.state === "running") return [false, map]
    return [true, new Map([...map, [dir, { state: "waiting" }]])]
  })

const forgetReel = (reels: Reels, dir: string): Effect.Effect<void> =>
  Ref.update(reels, (map) => new Map([...map].filter(([other]) => other !== dir)))

const nextReel = Effect.fnUntraced(function*(reels: Reels, closed: ReadonlySet<string>) {
  const fs = yield* FileSystem.FileSystem
  const waiting = [...(yield* Ref.get(reels))].flatMap(([dir, job]) => job.state === "waiting" && !closed.has(dir) ? [dir] : [])
  for (const dir of waiting) {
    if (yield* fs.exists(dir)) return dir
    yield* forgetReel(reels, dir)
  }
  return undefined
})

const startReel = (reels: Reels, dir: string): Effect.Effect<boolean> =>
  Ref.modify(reels, (map) => map.get(dir)?.state === "waiting" ? [true, new Map([...map, [dir, { state: "running", done: 0 }]])] : [false, map])

const reelTask = (reels: Reels, dir: string) =>
  Effect.gen(function*() {
    if (!(yield* startReel(reels, dir))) return
    const clips = yield* readCut(dir, yield* sourceNames(dir))
    yield* buildReel(dir, clips, (done) => setReel(reels, dir, { state: "running", done }))
  }).pipe(Effect.onExit((exit) => Exit.isFailure(exit) && !Exit.hasInterrupts(exit) ? setReel(reels, dir, { state: "failed" }) : forgetReel(reels, dir)))

const step = Effect.fnUntraced(function*(failures: Failures, work: Ref.Ref<Work>) {
  const { closed } = yield* Ref.get(work)
  const jobs = yield* openJobs(closed)
  const unheard = yield* nextUnheard(failures.unheard, jobs)
  if (unheard !== undefined) return yield* attempt(work, unheard, listen(unheard), () => markFailed(failures.unheard, unheard))
  const reel = yield* nextReel(failures.reels, closed)
  if (reel !== undefined) return yield* attempt(work, { dir: reel, name: "the reel" }, reelTask(failures.reels, reel), () => Effect.void)
  const stale = yield* nextStale(failures.stale, jobs)
  if (stale !== undefined) return yield* attempt(work, stale, refreshPreview(stale), () => markFailed(failures.stale, stale))
  const unseen = yield* nextUnseen(failures.unseen, jobs)
  if (unseen !== undefined) return yield* attempt(work, unseen, look(unseen), markGazeFailed(failures.unseen, unseen))
  yield* Effect.sleep("3 seconds")
})

const view = Effect.fnUntraced(function*(unheard: Unheard, job: Job) {
  const fs = yield* FileSystem.FileSystem
  const unready = (state: "failed" | "waiting"): VideoView => ({ name: job.name, state })
  if ((yield* Ref.get(unheard)).has(keyOf(job))) return unready("failed")
  if (!(yield* fs.exists(places(job).transcript))) return unready("waiting")
  const transcript = yield* readTranscript(job)
  const plan = yield* readPlan(job)
  if (plan === undefined) { const ready: VideoView = { name: job.name, state: "ready", transcript }; return ready }
  const ready: VideoView = { name: job.name, state: "ready", transcript, plan }
  return ready
})

type Needs = FileSystem.FileSystem | Crypto.Crypto | Settings | ChildProcessSpawner.ChildProcessSpawner

const stopReel = Effect.fnUntraced(function*(work: Ref.Ref<Work>, reels: Reels, dir: string) {
  const job = (yield* Ref.get(reels)).get(dir)
  if (job?.state === "waiting") return yield* forgetReel(reels, dir)
  if (job?.state !== "running") return
  const running = (yield* Ref.get(work)).running
  if (running?.dir !== dir) return
  yield* Deferred.succeed(running.stop, undefined)
  yield* Deferred.await(running.finished)
})

const reelHandlers = (folder: (id: string) => Effect.Effect<string, ApiError>, reels: Reels, work: Ref.Ref<Work>, context: Context.Context<Needs>) => {
  const reelOf = Effect.fnUntraced(function*(dir: string) {
    const job = (yield* Ref.get(reels)).get(dir) ?? { state: "idle" }
    return yield* readReel(dir, yield* readCut(dir, yield* sourceNames(dir)), job)
  })

  const reel = Effect.fn("Media.reel")(function*(id: string) {
    return yield* reelOf(yield* folder(id))
  }, orBroken, Effect.provideContext(context))

  const queueReel = Effect.fn("Media.buildReel")(function*(id: string) {
    const dir = yield* folder(id)
    const job = (yield* Ref.get(reels)).get(dir)
    if (job?.state === "waiting" || job?.state === "running") return yield* reelOf(dir)
    const clips = yield* readCut(dir, yield* sourceNames(dir))
    if (clips.length === 0) return yield* badRequest("В монтаже нет ни одного блока. Сначала соберите блоки.")
    yield* queueWaiting(reels, dir)
    return yield* reelOf(dir)
  }, orBroken, Effect.provideContext(context))

  const reelFile = Effect.fn("Media.reelFile")(function*(id: string, made: string) {
    const target = yield* reelVideoAt(yield* folder(id), made)
    if (target === undefined) return yield* notFound("Ролик ещё не собран")
    return target
  }, orBroken, Effect.provideContext(context))

  const cancelReel = Effect.fn("Media.cancelReel")(function*(id: string) {
    const dir = yield* folder(id)
    yield* stopReel(work, reels, dir)
    return yield* reelOf(dir)
  }, orBroken, Effect.provideContext(context))

  return { reel, buildReel: queueReel, cancelReel, reelFile }
}

export class Media extends Context.Service<Media, {
  readonly videos: (id: string) => Effect.Effect<ReadonlyArray<VideoView>, ApiError>
  readonly preview: (id: string, name: string) => Effect.Effect<string, ApiError>
  readonly retry: (id: string, name: string) => Effect.Effect<VideoView, ApiError>
  readonly library: (id: string) => Effect.Effect<ReadonlyArray<LibraryVideo>, ApiError>
  readonly reuse: (id: string, picks: ReadonlyArray<Pick>) => Effect.Effect<void, ApiError>
  readonly timeline: (id: string) => Effect.Effect<TimelineView, ApiError>
  readonly saveEdits: (id: string, edits: Edits) => Effect.Effect<void, ApiError>
  readonly reel: (id: string) => Effect.Effect<ReelView, ApiError>
  readonly buildReel: (id: string) => Effect.Effect<ReelView, ApiError>
  readonly cancelReel: (id: string) => Effect.Effect<ReelView, ApiError>
  readonly reelFile: (id: string, made: string) => Effect.Effect<string, ApiError>
  readonly withoutWork: <A, E, R>(dir: string, use: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}>()("reels-studio/Media") {
  static readonly layer = Layer.effect(
    Media,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const projects = yield* Projects
      const context = yield* Effect.context<Needs>()
      const unheard: Unheard = yield* Ref.make<ReadonlySet<string>>(new Set())
      const unseen: Unseen = yield* Ref.make<ReadonlyMap<string, GazeFailure>>(new Map())
      const stale: Unheard = yield* Ref.make<ReadonlySet<string>>(new Set())
      const reels: Reels = yield* Ref.make<ReadonlyMap<string, ReelJob>>(new Map())
      const work = yield* Ref.make<Work>({ closed: new Set(), running: undefined })

      const guarded = Effect.gen(function*() {
        const outcome = yield* Effect.exit(step({ unheard, unseen, stale, reels }, work))
        if (Exit.isSuccess(outcome)) return
        yield* Effect.logError("the media worker failed", outcome.cause)
        yield* Effect.sleep("3 seconds")
      })
      yield* Effect.forkScoped(Effect.forever(guarded).pipe(Effect.provideContext(context)))

      const videos = Effect.fn("Media.videos")(function*(id: string) {
        const dir = yield* projects.folder(id)
        const names = yield* sourceNames(dir)
        return yield* Effect.forEach(names, (name) => view(unheard, { dir, name }))
      }, orBroken, Effect.provideContext(context))

      const preview = Effect.fn("Media.preview")(function*(id: string, name: string) {
        const dir = yield* projects.folder(id)
        const names = yield* sourceNames(dir)
        if (!names.includes(name)) return yield* notFound("Такого видео в ролике нет")
        const target = places({ dir, name }).preview
        if (!(yield* fs.exists(target))) return yield* notFound("Этот файл ещё не готов")
        return target
      }, orBroken, Effect.provideContext(context))

      const retry = Effect.fn("Media.retry")(function*(id: string, name: string) {
        const dir = yield* projects.folder(id)
        const names = yield* sourceNames(dir)
        if (!names.includes(name)) return yield* notFound("Такого видео в ролике нет")
        const job: Job = { dir, name }
        yield* Ref.update(unheard, (set) => new Set([...set].filter((key) => key !== keyOf(job))))
        return yield* view(unheard, job)
      }, orBroken, Effect.provideContext(context))

      const library = Effect.fn("Media.library")(function*(id: string) {
        const here = yield* keysIn(yield* projects.folder(id))
        const others = (yield* projects.list).filter((project) => project.id !== id)
        const found = yield* Effect.forEach(others, (project) =>
          Effect.flatMap(projects.folder(project.id), (dir) => heardIn(project, dir)).pipe(
            Effect.tapError((error) => error instanceof ApiError && error.status === 404 ? Effect.void : Effect.logError("the library skipped a folder", error)),
            Effect.orElseSucceed(() => [])))
        return gatherLibrary(here, found.flat())
      }, orBroken, Effect.provideContext(context))

      const reuse = Effect.fn("Media.reuse")(function*(id: string, picks: ReadonlyArray<Pick>) {
        const dir = yield* projects.folder(id)
        yield* Effect.forEach(picks, (pick) => Effect.gen(function*() {
          if (pick.project === id) return yield* badRequest("Это видео уже есть в ролике")
          const from = yield* projects.folder(pick.project)
          if (!(yield* sourceNames(from)).includes(pick.name)) return yield* notFound("Такого видео в том ролике уже нет")
          yield* reuseOne({ dir: from, name: pick.name }, dir)
        }), { discard: true })
      }, orUnavailable("the reuse failed", "Не получилось добавить видео. Попробуйте ещё раз."), Effect.provideContext(context))

      const timeline = Effect.fn("Media.timeline")(function*(id: string) {
        const dir = yield* projects.folder(id)
        return yield* readTimeline(dir, yield* sourceNames(dir), yield* Ref.get(unseen))
      }, orBroken, Effect.provideContext(context))

      const saveEdits = Effect.fn("Media.saveEdits")(function*(id: string, edits: Edits) {
        yield* writeEdits(yield* projects.folder(id), edits)
      }, orUnavailable("the timeline was not saved", "Не получилось сохранить монтаж. Попробуйте ещё раз."), Effect.provideContext(context))

      const { reel, buildReel: queueReel, cancelReel, reelFile } = reelHandlers(projects.folder, reels, work, context)

      const withoutWork = <A, E, R>(dir: string, use: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        Effect.acquireUseRelease(
          Effect.gen(function*() {
            const running = yield* Ref.modify(work, (state) => [
              state.running?.dir === dir ? state.running : undefined,
              { ...state, closed: new Set([...state.closed, dir]) }
            ])
            if (running === undefined) return
            yield* Deferred.succeed(running.stop, undefined)
            yield* Deferred.await(running.finished)
          }),
          () => use,
          () => Ref.update(work, (state) => ({ ...state, closed: new Set([...state.closed].filter((other) => other !== dir)) }))
        )

      return Media.of({ videos, preview, retry, library, reuse, timeline, saveEdits, reel, buildReel: queueReel, cancelReel, reelFile, withoutWork })
    })
  )
}
