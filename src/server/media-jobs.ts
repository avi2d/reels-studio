import { Data, Effect, FileSystem, Option, Predicate, Schema, Stream, type PlatformError } from "effect"
import { ChildProcess } from "effect/process"
import { Plan, Transcript } from "../shared/plan.ts"
import { Gaze, type GazeFailure } from "../shared/timeline.ts"
import { gazeText, isHdr, KEY_FRAME_EVERY, prepareArgs, probeArgs, refreshArgs, transcriptText } from "./media-commands.ts"
import { Settings } from "./settings.ts"

class ToolFailed extends Data.TaggedError("ToolFailed")<{ readonly command: string; readonly code: number; readonly output: string }> {}

export class GazeFailed extends Data.TaggedError("GazeFailed")<{ readonly reason: GazeFailure; readonly detail: string }> {}

// 65 is the gaze program itself reporting an unreadable video, 127 is the shell reporting a missing program.
const gazeReason = (code: number): GazeFailure => code === 65 ? "file-unreadable" : code === 127 ? "no-tool" : "tool-failed"

const gazeFailure = (heavy: ReadonlyArray<string>) => (error: ToolFailed | PlatformError.PlatformError): GazeFailed =>
  error instanceof ToolFailed
    ? new GazeFailed({ reason: gazeReason(error.code), detail: error.output })
    : new GazeFailed({ reason: Predicate.isTagged("NotFound")(error.reason) && heavy.length === 0 ? "no-tool" : "tool-failed", detail: error.message })

const Probe = Schema.fromJsonString(Schema.Struct({
  streams: Schema.Array(Schema.Struct({ color_transfer: Schema.optionalKey(Schema.String) }))
}))
const decodeProbe = Schema.decodeUnknownEffect(Probe)
const decodeTranscript = Schema.decodeUnknownEffect(Schema.fromJsonString(Transcript))
const decodePlan = Schema.decodeUnknownOption(Schema.fromJsonString(Plan))
const decodeGaze = Schema.decodeUnknownEffect(Schema.fromJsonString(Gaze))

export interface Job {
  readonly dir: string
  readonly name: string
}

type Place = "source" | "transcript" | "text" | "preview" | "work" | "gaze" | "gazeText"

export const places = (job: Job): Readonly<Record<Place, string>> => ({
  source: `${job.dir}/source/${job.name}`,
  transcript: `${job.dir}/transcripts/${job.name}.json`,
  text: `${job.dir}/transcripts/${job.name}.txt`,
  preview: `${job.dir}/preview/${job.name}.mp4`,
  work: `${job.dir}/work/${job.name}`,
  gaze: `${job.dir}/gaze/${job.name}.json`,
  gazeText: `${job.dir}/gaze/${job.name}.txt`
})

export const previewFlag = (job: Job): string => `${places(job).preview}.gop`

export const previewIsFresh = Effect.fnUntraced(function*(job: Job) {
  const fs = yield* FileSystem.FileSystem
  if (!(yield* fs.exists(previewFlag(job)))) return false
  const tag = yield* Effect.orElseSucceed(fs.readFileString(previewFlag(job)), () => "")
  return tag.trim() === String(KEY_FRAME_EVERY)
})

const markPreviewFresh = Effect.fnUntraced(function*(job: Job) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.writeFileString(previewFlag(job), `${KEY_FRAME_EVERY}\n`)
})

const tool = Effect.fnUntraced(function*(command: string, args: ReadonlyArray<string>, prefix: ReadonlyArray<string>) {
  const [head = command, ...rest] = [...prefix, command, ...args]
  const handle = yield* ChildProcess.make(head, rest)
  const [output, complaints, code] = yield* Effect.all([
    handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
    handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
    handle.exitCode
  ], { concurrency: 3 })
  if (code !== 0) return yield* new ToolFailed({ command, code, output: complaints.slice(-2000) })
  return output
}, Effect.scoped)

export const readTranscript = Effect.fnUntraced(function*(job: Job) {
  const fs = yield* FileSystem.FileSystem
  return yield* decodeTranscript(yield* fs.readFileString(places(job).transcript))
})

export const readGaze = Effect.fnUntraced(function*(job: Job) {
  const fs = yield* FileSystem.FileSystem
  return yield* decodeGaze(yield* fs.readFileString(places(job).gaze))
})

export const readPlan = Effect.fnUntraced(function*(job: Job) {
  const fs = yield* FileSystem.FileSystem
  const file = `${job.dir}/plan.json`
  if (!(yield* fs.exists(file))) return undefined
  const plan = Option.getOrUndefined(decodePlan(yield* fs.readFileString(file)))
  if (plan === undefined) {
    yield* Effect.logError("the plan is unreadable", file)
    return "unreadable" as const
  }
  return plan.videos.find((video) => video.video === job.name)
})

export const listen = Effect.fn("Media.listen")(function*(job: Job) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const place = places(job)
  yield* Effect.forEach([place.work, `${job.dir}/transcripts`, `${job.dir}/preview`], (folder) => fs.makeDirectory(folder, { recursive: true }))
  const wav = `${place.work}/sound.wav`
  const preview = `${place.work}/preview.mp4`
  const words = `${place.work}/words.json`
  const probe = yield* decodeProbe(yield* tool("ffprobe", probeArgs(place.source), []))
  const hdr = isHdr(probe.streams[0]?.color_transfer)
  yield* tool("ffmpeg", prepareArgs({ source: place.source, wav, preview }, hdr, settings.encoder), settings.heavy)
  const transcriber = `${settings.root}/tools/transcribe`
  yield* tool("uv", ["run", "--project", transcriber, "python", `${transcriber}/transcribe.py`, wav, words], settings.heavy)
  const transcript = yield* decodeTranscript(yield* fs.readFileString(words))
  yield* fs.rename(preview, place.preview)
  yield* markPreviewFresh(job)
  yield* fs.writeFileString(place.text, transcriptText(job.name, transcript))
  yield* fs.rename(words, place.transcript)
  yield* fs.remove(place.work, { recursive: true })
})

export const refreshPreview = Effect.fn("Media.refreshPreview")(function*(job: Job) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const place = places(job)
  const probe = yield* decodeProbe(yield* tool("ffprobe", probeArgs(place.source), []))
  const hdr = isHdr(probe.streams[0]?.color_transfer)
  const next = `${place.preview}.new`
  yield* tool("ffmpeg", refreshArgs(place.source, next, hdr, settings.encoder), settings.heavy).pipe(
    Effect.catch((error) => fs.remove(next).pipe(Effect.orElseSucceed(() => undefined), Effect.andThen(Effect.fail(error))))
  )
  yield* fs.rename(next, place.preview)
  yield* markPreviewFresh(job)
})

export const look = Effect.fn("Media.look")(function*(job: Job) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const place = places(job)
  yield* Effect.forEach([place.work, `${job.dir}/gaze`], (folder) => fs.makeDirectory(folder, { recursive: true }))
  const measured = `${place.work}/gaze.json`
  const looker = `${settings.root}/tools/gaze`
  yield* tool("uv", ["run", "--project", looker, "python", `${looker}/gaze.py`, place.preview, measured], settings.heavy).pipe(Effect.mapError(gazeFailure(settings.heavy)))
  const gaze = yield* fs.readFileString(measured).pipe(
    Effect.flatMap(decodeGaze),
    Effect.mapError(() => new GazeFailed({ reason: "file-unreadable", detail: measured }))
  )
  yield* fs.writeFileString(place.gazeText, gazeText(job.name, yield* readTranscript(job), gaze))
  yield* fs.rename(measured, place.gaze)
  yield* fs.remove(place.work, { recursive: true })
})
