import { type Context, Effect, Ref } from "effect"
import type { Face } from "../shared/face.ts"
import type { Cleaned, Noise, NoiseView } from "../shared/noise.ts"
import type { ReelJob } from "../shared/reel.ts"
import type { RetouchPicture, RetouchView } from "../shared/retouch.ts"
import { type ApiError, badRequest, notFound } from "./api-error.ts"
import { writeFace } from "./face.ts"
import { writeNoise } from "./looks.ts"
import type { Needs } from "./media-exchange.ts"
import { orBroken, type Reels } from "./media-shelves.ts"
import { cleanedPreview, needsCleaning, readCleaning } from "./noise.ts"
import { lastTrial, readTrial, trialPicture } from "./retouch.ts"
import { sourceNames } from "./reuse.ts"
import { readCut } from "./timeline-files.ts"

export interface TrialHandlers {
  readonly trial: (id: string) => Effect.Effect<RetouchView, ApiError>
  readonly startTrial: (id: string) => Effect.Effect<RetouchView, ApiError>
  readonly trialFile: (id: string, name: RetouchPicture) => Effect.Effect<string, ApiError>
  readonly setFace: (id: string, face: Face) => Effect.Effect<RetouchView, ApiError>
}

export interface NoiseHandlers {
  readonly noise: (id: string) => Effect.Effect<NoiseView, ApiError>
  readonly startCleaning: (id: string) => Effect.Effect<NoiseView, ApiError>
  readonly cleanedFile: (id: string, noise: Cleaned, video: string) => Effect.Effect<string, ApiError>
  readonly setNoise: (id: string, noise: Noise) => Effect.Effect<NoiseView, ApiError>
}

export const queueWaiting = (reels: Reels, dir: string): Effect.Effect<boolean> =>
  Ref.modify(reels, (map): [boolean, ReadonlyMap<string, ReelJob>] => {
    const job = map.get(dir)
    if (job?.state === "waiting" || job?.state === "running") return [false, map]
    return [true, new Map([...map, [dir, { state: "waiting" }]])]
  })

export const trialHandlers = (folder: (id: string) => Effect.Effect<string, ApiError>, trials: Reels, context: Context.Context<Needs>): TrialHandlers => {
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

export const noiseHandlers = (folder: (id: string) => Effect.Effect<string, ApiError>, cleanings: Reels, context: Context.Context<Needs>): NoiseHandlers => {
  const noiseOf = Effect.fnUntraced(function*(dir: string) {
    const job = (yield* Ref.get(cleanings)).get(dir) ?? { state: "idle" }
    return yield* readCleaning(dir, (yield* readCut(dir, yield* sourceNames(dir))).clips, job)
  })

  const noise = Effect.fn("Media.noise")(function*(id: string) {
    return yield* noiseOf(yield* folder(id))
  }, orBroken, Effect.provideContext(context))

  const startCleaning = Effect.fn("Media.startCleaning")(function*(id: string) {
    const dir = yield* folder(id)
    const { clips } = yield* readCut(dir, yield* sourceNames(dir))
    if (yield* needsCleaning(dir, clips)) yield* queueWaiting(cleanings, dir)
    return yield* noiseOf(dir)
  }, orBroken, Effect.provideContext(context))

  const cleanedFile = Effect.fn("Media.cleanedFile")(function*(id: string, strength: Cleaned, video: string) {
    const dir = yield* folder(id)
    if (!(yield* sourceNames(dir)).includes(video)) return yield* notFound("Такого видео в ролике нет")
    const target = yield* cleanedPreview(dir, strength, video)
    if (target === undefined) return yield* notFound("Студия ещё не очистила звук этого видео")
    return target
  }, orBroken, Effect.provideContext(context))

  const setNoise = Effect.fn("Media.setNoise")(function*(id: string, choice: Noise) {
    const dir = yield* folder(id)
    yield* writeNoise(dir, choice)
    return yield* noiseOf(dir)
  }, orBroken, Effect.provideContext(context))

  return { noise, startCleaning, cleanedFile, setNoise }
}
