import { Context, Effect, Exit, FileSystem, Layer, Ref } from "effect"
import type { ChildProcessSpawner } from "effect/process"
import type { VideoView } from "../shared/plan.ts"
import { type ApiError, notFound, orUnavailable } from "./api-error.ts"
import { listen, places, readPlan, readTranscript, type Job } from "./media-jobs.ts"
import { Projects } from "./projects.ts"
import { Settings } from "./settings.ts"

const UNAVAILABLE = "Видео недоступно. Попробуйте открыть страницу ещё раз."
const orBroken = orUnavailable("the media failed", UNAVAILABLE)

const keyOf = (job: Job): string => places(job).source

type Unheard = Ref.Ref<ReadonlySet<string>>

const sourceNames = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const names = yield* fs.readDirectory(`${dir}/source`)
  return names.toSorted()
})

const nextUnheard = Effect.fnUntraced(function*(unheard: Unheard) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const failed = yield* Ref.get(unheard)
  const ids = yield* fs.readDirectory(settings.projectsDir).pipe(Effect.orElseSucceed((): Array<string> => []))
  const jobs = yield* Effect.forEach(ids, (id) => {
    const dir = `${settings.projectsDir}/${id}`
    return sourceNames(dir).pipe(
      Effect.map((names) => names.map((name): Job => ({ dir, name }))),
      Effect.orElseSucceed((): Array<Job> => [])
    )
  })
  const heard = yield* Effect.forEach(jobs.flat(), (job) =>
    Effect.map(fs.exists(places(job).transcript), (exists) => exists || failed.has(keyOf(job))))
  return jobs.flat().find((_, index) => heard[index] === false)
})

const step = Effect.fnUntraced(function*(unheard: Unheard) {
  const job = yield* nextUnheard(unheard)
  if (job === undefined) return yield* Effect.sleep("3 seconds")
  const outcome = yield* Effect.exit(listen(job))
  if (Exit.isFailure(outcome)) {
    yield* Effect.logError("the transcription failed", outcome.cause)
    yield* Ref.update(unheard, (set) => new Set([...set, keyOf(job)]))
  }
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
}>()("reels-studio/Media") {
  static readonly layer = Layer.effect(
    Media,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const projects = yield* Projects
      const context = yield* Effect.context<FileSystem.FileSystem | Settings | ChildProcessSpawner.ChildProcessSpawner>()
      const unheard: Unheard = yield* Ref.make<ReadonlySet<string>>(new Set())

      const guarded = Effect.gen(function*() {
        const outcome = yield* Effect.exit(step(unheard))
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

      return Media.of({ videos, preview, retry })
    })
  )
}
