import { Context, Effect, FileSystem, Ref } from "effect"
import type { Offer, Pick, UploadedVideo } from "../shared/library.ts"
import type { VideoView } from "../shared/plan.ts"
import type { ReelJob } from "../shared/reel.ts"
import type { GazeFailure } from "../shared/timeline.ts"
import { ApiError, badRequest, notFound, orUnavailable } from "./api-error.ts"
import { openLibrary, removeFiles, uploadedJob } from "./library.ts"
import type { Needs } from "./media-exchange.ts"
import { places, readPlan, readTranscript, type Job } from "./media-jobs.ts"
import type { Projects } from "./projects.ts"
import { gatherLibrary, heardIn, keysIn, reuse as reuseOne, sourceNames } from "./reuse.ts"

const UNAVAILABLE = "Видео недоступно. Попробуйте открыть страницу ещё раз."
export const orBroken = orUnavailable("the media failed", UNAVAILABLE)

export const keyOf = (job: Job): string => places(job).source

export type Unheard = Ref.Ref<ReadonlySet<string>>
export type Unseen = Ref.Ref<ReadonlyMap<string, GazeFailure>>
export type Reels = Ref.Ref<ReadonlyMap<string, ReelJob>>

export interface Failures {
  readonly unheard: Unheard
  readonly unseen: Unseen
  readonly stale: Unheard
  readonly reels: Reels
  readonly trials: Reels
  readonly sounds: Reels
}

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

export const videosIn = Effect.fnUntraced(function*(unheard: Unheard, dir: string) {
  const names = yield* sourceNames(dir)
  return yield* Effect.forEach(names, (name) => view(unheard, { dir, name }))
})

export const listenAgain = Effect.fnUntraced(function*(unheard: Unheard, dir: string, name: string, missing: string) {
  const names = yield* sourceNames(dir)
  if (!names.includes(name)) return yield* notFound(missing)
  const job: Job = { dir, name }
  yield* Ref.update(unheard, (set) => new Set([...set].filter((key) => key !== keyOf(job))))
  return yield* view(unheard, job)
})

const asUploaded = Effect.fnUntraced(function*(dir: string, video: VideoView) {
  const fs = yield* FileSystem.FileSystem
  const size = Number((yield* fs.stat(places({ dir, name: video.name }).source)).size)
  const uploaded: UploadedVideo = video.state === "ready"
    ? { name: video.name, size, state: "ready", duration: video.transcript.duration }
    : { name: video.name, size, state: video.state }
  return uploaded
})

export type JobShield = <A, E, R>(job: Job, use: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>

const forgetFailures = (failures: Failures, job: Job): Effect.Effect<void> => {
  const key = keyOf(job)
  const without = (set: ReadonlySet<string>): ReadonlySet<string> => new Set([...set].filter((other) => other !== key))
  return Effect.all([
    Ref.update(failures.unheard, without),
    Ref.update(failures.stale, without),
    Ref.update(failures.unseen, (map) => new Map([...map].filter(([other]) => other !== key)))
  ], { discard: true })
}

export const makeShelves = (projects: Projects["Service"], failures: Failures, withoutJob: JobShield, context: Context.Context<Needs>): {
  readonly uploaded: Effect.Effect<ReadonlyArray<UploadedVideo>, ApiError>
  readonly retryUploaded: (name: string) => Effect.Effect<UploadedVideo, ApiError>
  readonly uploadedPreview: (name: string) => Effect.Effect<string, ApiError>
  readonly removeUploaded: (name: string) => Effect.Effect<void, ApiError>
  readonly library: (id: string) => Effect.Effect<Offer, ApiError>
  readonly reuse: (id: string, picks: ReadonlyArray<Pick>) => Effect.Effect<void, ApiError>
} => {
  const { unheard } = failures
  const uploaded = Effect.gen(function*() {
    const dir = yield* openLibrary
    return yield* Effect.forEach(yield* videosIn(unheard, dir), (video) => asUploaded(dir, video))
  }).pipe(orBroken, Effect.provideContext(context))

  const retryUploaded = Effect.fn("Media.retryUploaded")(function*(name: string) {
    const dir = yield* openLibrary
    return yield* asUploaded(dir, yield* listenAgain(unheard, dir, name, "Такого загруженного видео нет"))
  }, orBroken, Effect.provideContext(context))

  const uploadedPreview = Effect.fn("Media.uploadedPreview")(function*(name: string) {
    const fs = yield* FileSystem.FileSystem
    const target = places(yield* uploadedJob(name)).preview
    if (!(yield* fs.exists(target))) return yield* notFound("Этот файл ещё не готов")
    return target
  }, orBroken, Effect.provideContext(context))

  const removeUploaded = Effect.fn("Media.removeUploaded")(function*(name: string) {
    const job = yield* uploadedJob(name)
    yield* withoutJob(job, removeFiles(job))
    yield* forgetFailures(failures, job)
  }, orUnavailable("the uploaded video was not removed", "Не получилось удалить видео. Попробуйте ещё раз."), Effect.provideContext(context))

  const library = Effect.fn("Media.library")(function*(id: string) {
    const here = yield* keysIn(yield* projects.folder(id))
    const shared = yield* openLibrary
    const others = (yield* projects.list).filter((project) => project.id !== id)
    const inReels = yield* Effect.forEach(others, (project) =>
      Effect.flatMap(projects.folder(project.id), (dir) => heardIn(dir, { from: "reel", project: project.id, titles: [project.title] })).pipe(
        Effect.tapError((error) => error instanceof ApiError && error.status === 404 ? Effect.void : Effect.logError("the library skipped a folder", error)),
        Effect.orElseSucceed(() => [])))
    const inLibrary = yield* heardIn(shared, { from: "library" }).pipe(Effect.tapError((error) => Effect.logError("the library skipped the shared list", error)), Effect.orElseSucceed(() => []))
    const waiting = yield* videosIn(unheard, shared).pipe(Effect.tapError((error) => Effect.logError("the library skipped the shared list", error)), Effect.orElseSucceed((): ReadonlyArray<VideoView> => []))
    const offer: Offer = {
      videos: gatherLibrary(here, [...inLibrary, ...inReels.flat()]),
      listening: waiting.filter((video) => video.state === "waiting").length
    }
    return offer
  }, orBroken, Effect.provideContext(context))

  const reuse = Effect.fn("Media.reuse")(function*(id: string, picks: ReadonlyArray<Pick>) {
    const dir = yield* projects.folder(id)
    yield* Effect.forEach(picks, (pick) => Effect.gen(function*() {
      if (pick.from === "reel" && pick.project === id) return yield* badRequest("Это видео уже есть в ролике")
      const from = pick.from === "library" ? yield* openLibrary : yield* projects.folder(pick.project)
      if (!(yield* sourceNames(from)).includes(pick.name)) return yield* notFound("Такого видео уже нет")
      yield* reuseOne({ dir: from, name: pick.name }, dir)
    }), { discard: true })
  }, orUnavailable("the reuse failed", "Не получилось добавить видео. Попробуйте ещё раз."), Effect.provideContext(context))

  return { uploaded, retryUploaded, uploadedPreview, removeUploaded, library, reuse }
}

export const queueWaiting = (reels: Reels, dir: string): Effect.Effect<boolean> =>
  Ref.modify(reels, (map) => {
    const job = map.get(dir)
    if (job?.state === "waiting" || job?.state === "running") return [false, map]
    return [true, new Map([...map, [dir, { state: "waiting" }]])]
  })
