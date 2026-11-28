import { Cause, Data, DateTime, Effect, FileSystem, Option, Schema } from "effect"
import type { NoFace } from "../shared/face.ts"
import type { ReelJob } from "../shared/reel.ts"
import { CLOSE_UP_FROM_SECONDS, TRIAL_SECONDS, type RetouchPicture, type RetouchView } from "../shared/retouch.ts"
import type { Clip } from "../shared/timeline.ts"
import { readFace, retouchVideo } from "./face.ts"
import { compareArgs, firstSeconds, partsOf, REEL_RATE, secondsOf } from "./media-commands.ts"
import { tool, ToolFailed } from "./media-jobs.ts"
import { builtFace, renderParts } from "./reel.ts"
import { Settings } from "./settings.ts"

const Measured = Schema.fromJsonString(Schema.Struct({ seconds: Schema.Finite, took: Schema.Finite }))
const decodeMeasured = Schema.decodeUnknownEffect(Measured)
const TrialFile = Schema.fromJsonString(Schema.Struct({ made: Schema.String, seconds: Schema.Finite, took: Schema.Finite }))
const decodeTrial = Schema.decodeUnknownOption(TrialFile)
const encodeTrial = Schema.encodeEffect(TrialFile)

class TrialFoundNoFace extends Data.TaggedError("TrialFoundNoFace")<{ readonly why: NoFace }> {}

export const noFaceOf = (cause: Cause.Cause<unknown>): Option.Option<NoFace> =>
  Option.map(Option.filter(Cause.findErrorOption(cause), (error) => error instanceof TrialFoundNoFace), (error) => error.why)

const NO_CLOSE_UP_EXIT = 66

const RENDER_SHARE = 0.3
const RETOUCH_SHARE = 0.65

const trialPlaces = (dir: string) => ({
  folder: `${dir}/retouch`,
  record: `${dir}/retouch/trial.json`,
  work: `${dir}/retouch/work`,
  picture: (name: RetouchPicture) => `${dir}/retouch/${name}`
})

const PICTURES: ReadonlyArray<RetouchPicture> = ["before.jpg", "after.jpg", "compare.mp4"]

const encodeTrialRun = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const place = trialPlaces(dir)
  const parts = firstSeconds(partsOf(clips), TRIAL_SECONDS)
  const frames = parts.reduce((total, part) => total + part.frames, 0)
  if (frames < CLOSE_UP_FROM_SECONDS * REEL_RATE) return yield* new TrialFoundNoFace({ why: "short-cut" })
  yield* fs.remove(place.work, { recursive: true, force: true })
  yield* fs.makeDirectory(place.work, { recursive: true })
  const before = `${place.work}/before.mp4`
  yield* renderParts(dir, parts, [], place.work, before, (share) => onDone(share * RENDER_SHARE))
  yield* retouchVideo({ before, folder: place.work, frames, closeUp: true }, (share) => onDone(RENDER_SHARE + share * RETOUCH_SHARE)).pipe(
    Effect.catchIf((error) => error instanceof ToolFailed && error.code === NO_CLOSE_UP_EXIT, () => Effect.fail(new TrialFoundNoFace({ why: "unseen" })))
  )
  const measured = yield* decodeMeasured(yield* fs.readFileString(`${place.work}/retouch.json`))
  yield* tool("ffmpeg", compareArgs(before, `${place.work}/after.mp4`, settings.encoder, `${place.work}/compare.mp4`), settings.heavy)
  yield* fs.remove(place.record, { force: true })
  yield* Effect.forEach(PICTURES, (name) => fs.rename(`${place.work}/${name}`, place.picture(name)), { discard: true })
  const made = DateTime.formatIso(yield* DateTime.now)
  yield* fs.writeFileString(`${place.work}/trial.json`, yield* encodeTrial({ made, seconds: measured.seconds, took: measured.took }))
  yield* fs.rename(`${place.work}/trial.json`, place.record)
})

export const runTrial = Effect.fn("Retouch.trial")(function*(dir: string, clips: ReadonlyArray<Clip>, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const cleanup = fs.remove(trialPlaces(dir).work, { recursive: true, force: true }).pipe(
    Effect.catch((error) => Effect.logError("the half-made retouch trial was not removed", error))
  )
  yield* encodeTrialRun(dir, clips, onDone).pipe(Effect.ensuring(cleanup))
})

export const lastTrial = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const place = trialPlaces(dir)
  return (yield* fs.exists(place.record)) ? Option.getOrUndefined(decodeTrial(yield* fs.readFileString(place.record))) : undefined
})

export const readTrial = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>, job: ReelJob) {
  const cut = secondsOf(partsOf(clips))
  const trial = yield* lastTrial(dir)
  const face = yield* readFace(dir)
  const built = yield* builtFace(dir)
  return { job, cut, face, ...(built === undefined ? {} : { built }), ...(trial === undefined ? {} : { trial }) } satisfies RetouchView
})

export const trialPicture = Effect.fnUntraced(function*(dir: string, name: RetouchPicture) {
  const fs = yield* FileSystem.FileSystem
  const place = trialPlaces(dir)
  if (!(yield* fs.exists(place.record))) return undefined
  const target = place.picture(name)
  return (yield* fs.exists(target)) ? target : undefined
})
