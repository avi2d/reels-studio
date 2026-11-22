import { Cause, Context, Deferred, Effect, Exit, FileSystem, Layer, Option, Ref } from "effect"
import type { Offer, Pick, UploadedVideo } from "../shared/library.ts"
import type { VideoView } from "../shared/plan.ts"
import type { PictureSide, ReelJob, ReelView, SoundCheck } from "../shared/reel.ts"
import type { Face } from "../shared/face.ts"
import type { RetouchPicture, RetouchView } from "../shared/retouch.ts"
import { type Edits, type GazeFailure, type TimelineView } from "../shared/timeline.ts"
import { ApiError, badRequest, notFound } from "./api-error.ts"
import { makeExchange, type Needs } from "./media-exchange.ts"
import { GazeFailed, listen, look, places, previewIsFresh, readGaze, refreshPreview, type Job } from "./media-jobs.ts"
import { keyOf, listenAgain, makeShelves, orBroken, videosIn, type Failures, type JobShield, type Reels, type Unheard, type Unseen } from "./media-shelves.ts"
import { Projects } from "./projects.ts"
import { sourceNames } from "./reuse.ts"
import { Settings } from "./settings.ts"
import { buildReel, readReel, reelPictureAt, reelVideoAt, type ReelVersion } from "./reel.ts"
import { writeFace } from "./face.ts"
import { lastTrial, readTrial, runTrial, trialPicture } from "./retouch.ts"
import { checkSound, readSoundCheck, soundKeyOf } from "./sound-check.ts"
import { readCut, readTimeline, type Cut } from "./timeline-files.ts"
import { partsOf } from "./media-commands.ts"

interface Running {
  readonly dir: string
  readonly name: string
  readonly stop: Deferred.Deferred<void>
  readonly finished: Deferred.Deferred<void>
}

interface Work {
  readonly closed: ReadonlySet<string>
  readonly closedJobs: ReadonlySet<string>
  readonly running: Running | undefined
}

const openJobs = Effect.fnUntraced(function*(closed: ReadonlySet<string>, closedJobs: ReadonlySet<string>) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const ids = yield* fs.readDirectory(settings.projectsDir).pipe(Effect.orElseSucceed((): Array<string> => []))
  const dirs = ids.map((id) => `${settings.projectsDir}/${id}`).filter((dir) => !closed.has(dir))
  const jobs = yield* Effect.forEach(dirs, (dir) =>
    sourceNames(dir).pipe(
      Effect.map((names) => names.map((name): Job => ({ dir, name }))),
      Effect.orElseSucceed((): Array<Job> => [])
    ))
  return jobs.flat().filter((job) => !closedJobs.has(keyOf(job)))
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
    if (failed.has(keyOf(job))) return false
    if (!((yield* fs.exists(place.transcript)) && (yield* fs.exists(place.preview)))) return false
    if (!(yield* fs.exists(place.gaze))) return true
    const measured = yield* Effect.option(readGaze(job))
    return Option.isSome(measured) && (measured.value.heads === undefined || measured.value.aspect === undefined)
  }))
  return jobs.find((_, index) => waiting[index] === true)
})

const attempt = Effect.fnUntraced(function*<E, R>(work: Ref.Ref<Work>, job: Job, task: Effect.Effect<void, E, R>, record: (cause: Cause.Cause<E>) => Effect.Effect<void>) {
  const running: Running = { dir: job.dir, name: job.name, stop: yield* Deferred.make<void>(), finished: yield* Deferred.make<void>() }
  const claimed = yield* Ref.modify(work, (state) =>
    state.closed.has(job.dir) || state.closedJobs.has(keyOf(job)) ? [false, state] : [true, { ...state, running }])
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

type Build<E, R> = (dir: string, cut: Cut, onDone: (share: number) => Effect.Effect<void>) => Effect.Effect<void, E, R>

const reelTask = <E, R>(reels: Reels, dir: string, build: Build<E, R>) =>
  Effect.gen(function*() {
    if (!(yield* startReel(reels, dir))) return
    const cut = yield* readCut(dir, yield* sourceNames(dir))
    yield* build(dir, cut, (done) => setReel(reels, dir, { state: "running", done }))
  }).pipe(Effect.onExit((exit) => Exit.isFailure(exit) && !Exit.hasInterrupts(exit) ? setReel(reels, dir, { state: "failed" }) : forgetReel(reels, dir)))

type Tried = Ref.Ref<ReadonlyMap<string, string>>

// The task reads the cut again when it starts, which can be a later cut than the one the poll queued.
const checkSoundOf = (tried: Tried) => (dir: string, cut: Cut, onDone: (share: number) => Effect.Effect<void>) =>
  Ref.update(tried, (map) => new Map([...map, [dir, soundKeyOf(partsOf(cut.clips))]])).pipe(Effect.andThen(checkSound(dir, cut, onDone)))

const step = Effect.fnUntraced(function*(failures: Failures, tried: Tried, work: Ref.Ref<Work>) {
  const { closed, closedJobs } = yield* Ref.get(work)
  const jobs = yield* openJobs(closed, closedJobs)
  const unheard = yield* nextUnheard(failures.unheard, jobs)
  if (unheard !== undefined) return yield* attempt(work, unheard, listen(unheard), () => markFailed(failures.unheard, unheard))
  const reel = yield* nextReel(failures.reels, closed)
  if (reel !== undefined) return yield* attempt(work, { dir: reel, name: "the reel" }, reelTask(failures.reels, reel, buildReel), () => Effect.void)
  const sound = yield* nextReel(failures.sounds, closed)
  if (sound !== undefined) return yield* attempt(work, { dir: sound, name: "the sound check" }, reelTask(failures.sounds, sound, checkSoundOf(tried)), () => Effect.void)
  const trial = yield* nextReel(failures.trials, closed)
  if (trial !== undefined) return yield* attempt(work, { dir: trial, name: "the retouch trial" }, reelTask(failures.trials, trial, (dir, cut, onDone) => runTrial(dir, cut.clips, onDone)), () => Effect.void)
  const stale = yield* nextStale(failures.stale, jobs)
  if (stale !== undefined) return yield* attempt(work, stale, refreshPreview(stale), () => markFailed(failures.stale, stale))
  const unseen = yield* nextUnseen(failures.unseen, jobs)
  if (unseen !== undefined) return yield* attempt(work, unseen, look(unseen), markGazeFailed(failures.unseen, unseen))
  yield* Effect.sleep("3 seconds")
})

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
    const { clips } = yield* readCut(dir, yield* sourceNames(dir))
    if (clips.length === 0) return yield* badRequest("В монтаже нет ни одного блока. Сначала соберите блоки.")
    yield* queueWaiting(reels, dir)
    return yield* reelOf(dir)
  }, orBroken, Effect.provideContext(context))

  const reelFile = Effect.fn("Media.reelFile")(function*(id: string, made: string, version: ReelVersion) {
    const target = yield* reelVideoAt(yield* folder(id), made, version)
    if (target === undefined) return yield* notFound("Ролик ещё не собран")
    return target
  }, orBroken, Effect.provideContext(context))

  const reelPicture = Effect.fn("Media.reelPicture")(function*(id: string, picture: Picture) {
    const target = yield* reelPictureAt(yield* folder(id), picture.made, picture.join, picture.side)
    if (target === undefined) return yield* notFound("Такой картинки нет")
    return target
  }, orBroken, Effect.provideContext(context))

  const cancelReel = Effect.fn("Media.cancelReel")(function*(id: string) {
    const dir = yield* folder(id)
    yield* stopReel(work, reels, dir)
    return yield* reelOf(dir)
  }, orBroken, Effect.provideContext(context))

  return { reel, buildReel: queueReel, cancelReel, reelFile, reelPicture }
}

// A cut is checked once: a failed check waits for the next change of the cut, not for the next poll.
const soundHandler = (folder: (id: string) => Effect.Effect<string, ApiError>, sounds: Reels, tried: Tried, context: Context.Context<Needs>) =>
  Effect.fn("Media.sound")(function*(id: string) {
    const dir = yield* folder(id)
    const cut = yield* readCut(dir, yield* sourceNames(dir))
    const job = (yield* Ref.get(sounds)).get(dir) ?? { state: "idle" }
    const view = yield* readSoundCheck(dir, cut, job)
    const key = soundKeyOf(partsOf(cut.clips))
    const heard = view.heard?.fresh === true
    const busy = job.state === "waiting" || job.state === "running"
    if (cut.clips.length === 0 || heard || busy || (yield* Ref.get(tried)).get(dir) === key) return view
    yield* queueWaiting(sounds, dir)
    return { ...view, job: { state: "waiting" } } satisfies SoundCheck
  }, orBroken, Effect.provideContext(context))

export interface Picture {
  readonly made: string
  readonly join: number
  readonly side: PictureSide
}

const trialHandlers = (folder: (id: string) => Effect.Effect<string, ApiError>, trials: Reels, context: Context.Context<Needs>) => {
  const trialOf = Effect.fnUntraced(function*(dir: string) {
    const job = (yield* Ref.get(trials)).get(dir) ?? { state: "idle" }
    return yield* readTrial(dir, (yield* readCut(dir, yield* sourceNames(dir))).clips, job)
  })

  const trial = Effect.fn("Media.trial")(function*(id: string) {
    return yield* trialOf(yield* folder(id))
  }, orBroken, Effect.provideContext(context))

  const startTrial = Effect.fn("Media.startTrial")(function*(id: string) {
    const dir = yield* folder(id)
    const { clips } = yield* readCut(dir, yield* sourceNames(dir))
    if (clips.length === 0) return yield* badRequest("В монтаже нет ни одного блока. Сначала соберите блоки.")
    yield* queueWaiting(trials, dir)
    return yield* trialOf(dir)
  }, orBroken, Effect.provideContext(context))

  const trialFile = Effect.fn("Media.trialFile")(function*(id: string, name: RetouchPicture) {
    const target = yield* trialPicture(yield* folder(id), name)
    if (target === undefined) return yield* notFound("Проба ещё не готова")
    return target
  }, orBroken, Effect.provideContext(context))

  const setFace = Effect.fn("Media.setFace")(function*(id: string, face: Face) {
    const dir = yield* folder(id)
    if (face === "light" && (yield* lastTrial(dir)) === undefined) return yield* badRequest(NO_TRIAL_YET)
    yield* writeFace(dir, face)
    return yield* trialOf(dir)
  }, orBroken, Effect.provideContext(context))

  return { trial, startTrial, trialFile, setFace }
}

const NO_TRIAL_YET = "Сначала сделайте пробу и сравните лицо до и после."

export class Media extends Context.Service<Media, {
  readonly videos: (id: string) => Effect.Effect<ReadonlyArray<VideoView>, ApiError>
  readonly preview: (id: string, name: string) => Effect.Effect<string, ApiError>
  readonly retry: (id: string, name: string) => Effect.Effect<VideoView, ApiError>
  readonly library: (id: string) => Effect.Effect<Offer, ApiError>
  readonly reuse: (id: string, picks: ReadonlyArray<Pick>) => Effect.Effect<void, ApiError>
  readonly uploaded: Effect.Effect<ReadonlyArray<UploadedVideo>, ApiError>
  readonly retryUploaded: (name: string) => Effect.Effect<UploadedVideo, ApiError>
  readonly uploadedPreview: (name: string) => Effect.Effect<string, ApiError>
  readonly removeUploaded: (name: string) => Effect.Effect<void, ApiError>
  readonly timeline: (id: string) => Effect.Effect<TimelineView, ApiError>
  readonly exchangeEdits: <A>(id: string, compute: (current: Edits) => { readonly edits: Edits; readonly value: A }) => Effect.Effect<A, ApiError>
  readonly mergeEdits: (id: string, base: Edits, local: Edits) => Effect.Effect<Edits, ApiError>
  readonly reel: (id: string) => Effect.Effect<ReelView, ApiError>
  readonly buildReel: (id: string) => Effect.Effect<ReelView, ApiError>
  readonly cancelReel: (id: string) => Effect.Effect<ReelView, ApiError>
  readonly reelFile: (id: string, made: string, version: ReelVersion) => Effect.Effect<string, ApiError>
  readonly trial: (id: string) => Effect.Effect<RetouchView, ApiError>
  readonly startTrial: (id: string) => Effect.Effect<RetouchView, ApiError>
  readonly trialFile: (id: string, name: RetouchPicture) => Effect.Effect<string, ApiError>
  readonly setFace: (id: string, face: Face) => Effect.Effect<RetouchView, ApiError>
  readonly reelPicture: (id: string, picture: Picture) => Effect.Effect<string, ApiError>
  readonly sound: (id: string) => Effect.Effect<SoundCheck, ApiError>
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
      const trials: Reels = yield* Ref.make<ReadonlyMap<string, ReelJob>>(new Map())
      const sounds: Reels = yield* Ref.make<ReadonlyMap<string, ReelJob>>(new Map())
      const tried: Tried = yield* Ref.make<ReadonlyMap<string, string>>(new Map())
      const work = yield* Ref.make<Work>({ closed: new Set(), closedJobs: new Set(), running: undefined })

      const guarded = Effect.gen(function*() {
        const outcome = yield* Effect.exit(step({ unheard, unseen, stale, reels, trials, sounds }, tried, work))
        if (Exit.isSuccess(outcome)) return
        yield* Effect.logError("the media worker failed", outcome.cause)
        yield* Effect.sleep("3 seconds")
      })
      yield* Effect.forkScoped(Effect.forever(guarded).pipe(Effect.provideContext(context)))

      const videos = Effect.fn("Media.videos")(function*(id: string) {
        return yield* videosIn(unheard, yield* projects.folder(id))
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
        return yield* listenAgain(unheard, yield* projects.folder(id), name, "Такого видео в ролике нет")
      }, orBroken, Effect.provideContext(context))

      const shielded = <A, E, R>(
        matches: (running: Running | undefined) => Running | undefined,
        close: (state: Work) => Work,
        open: (state: Work) => Work,
        use: Effect.Effect<A, E, R>
      ): Effect.Effect<A, E, R> =>
        Effect.acquireUseRelease(
          Effect.gen(function*() {
            const running = yield* Ref.modify(work, (state) => [matches(state.running), close(state)])
            if (running === undefined) return
            yield* Deferred.succeed(running.stop, undefined)
            yield* Deferred.await(running.finished)
          }),
          () => use,
          () => Ref.update(work, open)
        )

      const withoutWork = <A, E, R>(dir: string, use: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        shielded(
          (running) => running?.dir === dir ? running : undefined,
          (state) => ({ ...state, closed: new Set([...state.closed, dir]) }),
          (state) => ({ ...state, closed: new Set([...state.closed].filter((other) => other !== dir)) }),
          use
        )

      const withoutJob: JobShield = <A, E, R>(job: Job, use: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
        const key = keyOf(job)
        return shielded(
          (running) => running?.dir === job.dir && running.name === job.name ? running : undefined,
          (state) => ({ ...state, closedJobs: new Set([...state.closedJobs, key]) }),
          (state) => ({ ...state, closedJobs: new Set([...state.closedJobs].filter((other) => other !== key)) }),
          use
        )
      }

      const { uploaded, retryUploaded, uploadedPreview, removeUploaded, library, reuse } = makeShelves(projects, { unheard, unseen, stale, reels, trials, sounds }, withoutJob, context)

      const timeline = Effect.fn("Media.timeline")(function*(id: string) {
        const dir = yield* projects.folder(id)
        return yield* readTimeline(dir, yield* sourceNames(dir), yield* Ref.get(unseen))
      }, orBroken, Effect.provideContext(context))

      const { exchangeEdits, mergeEdits } = yield* makeExchange(projects, context)

      const { reel, buildReel: queueReel, cancelReel, reelFile, reelPicture } = reelHandlers(projects.folder, reels, work, context)

      const { trial, startTrial, trialFile, setFace } = trialHandlers(projects.folder, trials, context)

      const sound = soundHandler(projects.folder, sounds, tried, context)

      return Media.of({ videos, preview, retry, library, reuse, uploaded, retryUploaded, uploadedPreview, removeUploaded, timeline, exchangeEdits, mergeEdits, reel, buildReel: queueReel, cancelReel, reelFile, reelPicture, sound, trial, startTrial, trialFile, setFace, withoutWork })
    })
  )
}
