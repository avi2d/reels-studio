import { type Crypto, Context, Deferred, Effect, Exit, FileSystem, Layer, Ref } from "effect"
import type { ChildProcessSpawner } from "effect/process"
import type { LibraryVideo, Pick } from "../shared/library.ts"
import type { VideoView } from "../shared/plan.ts"
import type { Edits, TimelineView } from "../shared/timeline.ts"
import { ApiError, badRequest, notFound, orUnavailable } from "./api-error.ts"
import { listen, look, places, readPlan, readTranscript, type Job } from "./media-jobs.ts"
import { Projects } from "./projects.ts"
import { gatherLibrary, heardIn, keysIn, reuse as reuseOne, sourceNames } from "./reuse.ts"
import { Settings } from "./settings.ts"
import { readTimeline, writeEdits } from "./timeline-files.ts"

const UNAVAILABLE = "Видео недоступно. Попробуйте открыть страницу ещё раз."
const orBroken = orUnavailable("the media failed", UNAVAILABLE)

const keyOf = (job: Job): string => places(job).source

type Unheard = Ref.Ref<ReadonlySet<string>>

interface Failures {
  readonly unheard: Unheard
  readonly unseen: Unheard
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

const nextUnseen = Effect.fnUntraced(function*(unseen: Unheard, jobs: ReadonlyArray<Job>) {
  const fs = yield* FileSystem.FileSystem
  const failed = yield* Ref.get(unseen)
  const waiting = yield* Effect.forEach(jobs, (job) => Effect.gen(function*() {
    const place = places(job)
    if (failed.has(keyOf(job)) || (yield* fs.exists(place.gaze))) return false
    return (yield* fs.exists(place.transcript)) && (yield* fs.exists(place.preview))
  }))
  return jobs.find((_, index) => waiting[index] === true)
})

const attempt = Effect.fnUntraced(function*<E, R>(failures: Unheard, work: Ref.Ref<Work>, job: Job, task: Effect.Effect<void, E, R>) {
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
    yield* Ref.update(failures, (set) => new Set([...set, keyOf(job)]))
  }
})

const step = Effect.fnUntraced(function*(failures: Failures, work: Ref.Ref<Work>) {
  const jobs = yield* openJobs((yield* Ref.get(work)).closed)
  const unheard = yield* nextUnheard(failures.unheard, jobs)
  if (unheard !== undefined) return yield* attempt(failures.unheard, work, unheard, listen(unheard))
  const unseen = yield* nextUnseen(failures.unseen, jobs)
  if (unseen !== undefined) return yield* attempt(failures.unseen, work, unseen, look(unseen))
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

export class Media extends Context.Service<Media, {
  readonly videos: (id: string) => Effect.Effect<ReadonlyArray<VideoView>, ApiError>
  readonly preview: (id: string, name: string) => Effect.Effect<string, ApiError>
  readonly retry: (id: string, name: string) => Effect.Effect<VideoView, ApiError>
  readonly library: (id: string) => Effect.Effect<ReadonlyArray<LibraryVideo>, ApiError>
  readonly reuse: (id: string, picks: ReadonlyArray<Pick>) => Effect.Effect<void, ApiError>
  readonly timeline: (id: string) => Effect.Effect<TimelineView, ApiError>
  readonly saveEdits: (id: string, edits: Edits) => Effect.Effect<void, ApiError>
  readonly withoutWork: <A, E, R>(dir: string, use: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}>()("reels-studio/Media") {
  static readonly layer = Layer.effect(
    Media,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const projects = yield* Projects
      const context = yield* Effect.context<FileSystem.FileSystem | Crypto.Crypto | Settings | ChildProcessSpawner.ChildProcessSpawner>()
      const unheard: Unheard = yield* Ref.make<ReadonlySet<string>>(new Set())
      const unseen: Unheard = yield* Ref.make<ReadonlySet<string>>(new Set())
      const work = yield* Ref.make<Work>({ closed: new Set(), running: undefined })

      const guarded = Effect.gen(function*() {
        const outcome = yield* Effect.exit(step({ unheard, unseen }, work))
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

      return Media.of({ videos, preview, retry, library, reuse, timeline, saveEdits, withoutWork })
    })
  )
}
