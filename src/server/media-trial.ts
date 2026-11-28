import { type Context, Effect, Ref } from "effect"
import type { Face } from "../shared/face.ts"
import type { RetouchPicture, RetouchView } from "../shared/retouch.ts"
import { type ApiError, badRequest, notFound } from "./api-error.ts"
import { writeFace } from "./face.ts"
import type { Needs } from "./media-exchange.ts"
import { orBroken, queueWaiting, type Reels } from "./media-shelves.ts"
import { lastTrial, readTrial, trialPicture } from "./retouch.ts"
import { sourceNames } from "./reuse.ts"
import { readCut } from "./timeline-files.ts"

export interface TrialHandlers {
  readonly trial: (id: string) => Effect.Effect<RetouchView, ApiError>
  readonly startTrial: (id: string) => Effect.Effect<RetouchView, ApiError>
  readonly trialFile: (id: string, name: RetouchPicture) => Effect.Effect<string, ApiError>
  readonly setFace: (id: string, face: Face) => Effect.Effect<RetouchView, ApiError>
}

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
