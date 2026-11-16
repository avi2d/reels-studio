import { type Crypto, Context, Deferred, Effect, Exit, FileSystem, Layer, Ref } from "effect"
import type { ChildProcessSpawner } from "effect/process"
import type { LibraryVideo, Pick } from "../shared/library.ts"
import type { VideoView } from "../shared/plan.ts"
import { ApiError, badRequest, notFound, orUnavailable } from "./api-error.ts"
import { listen, places, readPlan, readTranscript, type Job } from "./media-jobs.ts"
import { Projects } from "./projects.ts"
import { gatherLibrary, heardIn, keysIn, reuse as reuseOne, sourceNames } from "./reuse.ts"
import { Settings } from "./settings.ts"

const UNAVAILABLE = "Видео недоступно. Попробуйте открыть страницу ещё раз."
const orBroken = orUnavailable("the media failed", UNAVAILABLE)

const keyOf = (job: Job): string => places(job).source

type Unheard = Ref.Ref<ReadonlySet<string>>

interface Running {
  readonly dir: string
  readonly stop: Deferred.Deferred<void>
  readonly finished: Deferred.Deferred<void>
}

interface Work {
  readonly closed: ReadonlySet<string>
  readonly running: Running | undefined
}

const nextUnheard = Effect.fnUntraced(function*(unheard: Unheard, closed: ReadonlySet<string>) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const failed = yield* Ref.get(unheard)
  const ids = yield* fs.readDirectory(settings.projectsDir).pipe(Effect.orElseSucceed((): Array<string> => []))
  const dirs = ids.map((id) => `${settings.projectsDir}/${id}`).filter((dir) => !closed.has(dir))
  const jobs = yield* Effect.forEach(dirs, (dir) =>
    sourceNames(dir).pipe(
      Effect.map((names) => names.map((name): Job => ({ dir, name }))),
      Effect.orElseSucceed((): Array<Job> => [])
    ))
  const heard = yield* Effect.forEach(jobs.flat(), (job) =>
    Effect.map(fs.exists(places(job).transcript), (exists) => exists || failed.has(keyOf(job))))
  return jobs.flat().find((_, index) => heard[index] === false)
})

const hear = Effect.fnUntraced(function*(unheard: Unheard, work: Ref.Ref<Work>, job: Job) {
  const running: Running = { dir: job.dir, stop: yield* Deferred.make<void>(), finished: yield* Deferred.make<void>() }
  const claimed = yield* Ref.modify(work, (state) =>
    state.closed.has(job.dir) ? [false, state] : [true, { ...state, running }])
  if (!claimed) return
  const outcome = yield* Effect.exit(Effect.raceFirst(listen(job), Deferred.await(running.stop))).pipe(
    Effect.ensuring(Ref.update(work, (state) => ({ ...state, running: undefined })).pipe(
      Effect.andThen(Deferred.succeed(running.finished, undefined))
    ))
  )
  if (Exit.isFailure(outcome)) {
    yield* Effect.logError("the transcription failed", outcome.cause)
    yield* Ref.update(unheard, (set) => new Set([...set, keyOf(job)]))
  }
})

const step = Effect.fnUntraced(function*(unheard: Unheard, work: Ref.Ref<Work>) {
  const job = yield* nextUnheard(unheard, (yield* Ref.get(work)).closed)
  if (job === undefined) return yield* Effect.sleep("3 seconds")
  yield* hear(unheard, work, job)
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
  readonly withoutWork: <A, E, R>(dir: string, use: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}>()("reels-studio/Media") {
  static readonly layer = Layer.effect(
    Media,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const projects = yield* Projects
      const context = yield* Effect.context<FileSystem.FileSystem | Crypto.Crypto | Settings | ChildProcessSpawner.ChildProcessSpawner>()
      const unheard: Unheard = yield* Ref.make<ReadonlySet<string>>(new Set())
      const work = yield* Ref.make<Work>({ closed: new Set(), running: undefined })

      const guarded = Effect.gen(function*() {
        const outcome = yield* Effect.exit(step(unheard, work))
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

      return Media.of({ videos, preview, retry, library, reuse, withoutWork })
    })
  )
}
