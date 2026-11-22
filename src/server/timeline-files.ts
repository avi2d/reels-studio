import { Effect, FileSystem, Option, Result, Schema } from "effect"
import type { Transcript, VideoView } from "../shared/plan.ts"
import { Gathered } from "../shared/gather.ts"
import { cutOf, facesByVideo } from "../shared/joins.ts"
import { assemble, Blocks, clipsOf, Edits, NO_EDITS, soundBlocks, type Gaze, type GazeFailure, type TimelineView, type VideoFaces } from "../shared/timeline.ts"
import { places, readGaze, readTranscript } from "./media-jobs.ts"

const decodeBlocks = Schema.decodeUnknownOption(Schema.fromJsonString(Blocks))
const decodeGathered = Schema.decodeUnknownOption(Schema.fromJsonString(Gathered))

export const readGathered = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const file = `${dir}/gathered.json`
  if (!(yield* fs.exists(file))) return undefined
  return Option.getOrUndefined(decodeGathered(yield* fs.readFileString(file)))
})
const EditsFile = Schema.fromJsonString(Edits)
const decodeEdits = Schema.decodeUnknownOption(EditsFile)
const encodeEdits = Schema.encodeEffect(EditsFile)

export const readEdits = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const file = `${dir}/timeline.json`
  if (!(yield* fs.exists(file))) return NO_EDITS
  return Option.getOrElse(decodeEdits(yield* fs.readFileString(file)), () => NO_EDITS)
})

export const readyTranscripts = (videos: ReadonlyArray<VideoView>): ReadonlyMap<string, Transcript> =>
  new Map(videos.flatMap((video): ReadonlyArray<readonly [string, Transcript]> => video.state === "ready" ? [[video.name, video.transcript]] : []))

export const writeEdits = Effect.fnUntraced(function*(dir: string, edits: Edits) {
  const fs = yield* FileSystem.FileSystem
  const fresh = `${dir}/timeline.json.new`
  yield* fs.writeFileString(fresh, yield* encodeEdits(edits))
  yield* fs.rename(fresh, `${dir}/timeline.json`)
})

type Look = TimelineView["looks"][number]

const lookOf = (video: string, measured: Gaze | undefined, written: boolean, failure: GazeFailure | undefined): Look => {
  if (measured !== undefined && measured.heads !== undefined && measured.aspect !== undefined) return { video, state: "measured" }
  if (failure !== undefined) return { video, state: "failed", reason: failure }
  if (measured !== undefined) return { video, state: "waiting" }
  if (written) return { video, state: "failed", reason: "file-unreadable" }
  return { video, state: "waiting" }
}

const readBlocks = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const file = `${dir}/blocks.json`
  if (!(yield* fs.exists(file))) return "none" as const
  const written = Option.getOrUndefined(decodeBlocks(yield* fs.readFileString(file)))
  if (written !== undefined) return written
  yield* Effect.logError("the blocks are unreadable", file)
  return "unreadable" as const
})

const facesOf = (name: string, measured: Gaze): ReadonlyArray<VideoFaces> => {
  if (measured.heads === undefined) return []
  const faces = { video: name, step: measured.step, gaze: measured.samples, heads: measured.heads }
  return [measured.aspect === undefined ? faces : { ...faces, aspect: measured.aspect }]
}

const readHeard = Effect.fnUntraced(function*(dir: string, names: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem
  const transcripts = new Map<string, Transcript>()
  const gazes = new Map<string, Gaze>()
  const gazeWritten = new Set<string>()
  for (const name of names) {
    const place = places({ dir, name })
    if (!(yield* fs.exists(place.transcript))) continue
    transcripts.set(name, yield* readTranscript({ dir, name }))
    if (!(yield* fs.exists(place.gaze))) continue
    gazeWritten.add(name)
    const decoded = yield* Effect.result(readGaze({ dir, name }))
    if (Result.isSuccess(decoded)) gazes.set(name, decoded.success)
    else yield* Effect.logError("the gaze is unreadable", place.gaze, decoded.failure)
  }
  const faces = [...gazes].flatMap(([name, measured]) => facesOf(name, measured))
  return { transcripts, gazes, gazeWritten, faces }
})

export const readTimeline = Effect.fnUntraced(function*(dir: string, names: ReadonlyArray<string>, unseen: ReadonlyMap<string, GazeFailure>) {
  const { transcripts, gazes, gazeWritten, faces } = yield* readHeard(dir, names)
  const looks: ReadonlyArray<Look> = [...transcripts.keys()].map((name) =>
    lookOf(name, gazes.get(name), gazeWritten.has(name), unseen.get(places({ dir, name }).source)))
  const written = yield* readBlocks(dir)
  if (written === "none" || written === "unreadable") return { looks, faces, timeline: { state: written } } satisfies TimelineView
  return { looks, faces, timeline: { state: "ready", ...soundBlocks(written, transcripts, gazes), edits: yield* readEdits(dir) } } satisfies TimelineView
})

export const readCut = Effect.fnUntraced(function*(dir: string, names: ReadonlyArray<string>) {
  const { transcripts, faces } = yield* readHeard(dir, names)
  const written = yield* readBlocks(dir)
  if (written === "none" || written === "unreadable") return []
  const { blocks } = soundBlocks(written, transcripts, new Map())
  const edits = yield* readEdits(dir)
  return cutOf(clipsOf(assemble(blocks, edits, transcripts)), facesByVideo(faces), transcripts, edits)
})
