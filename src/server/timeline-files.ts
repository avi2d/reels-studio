import { Effect, FileSystem, Option, Result, Schema } from "effect"
import type { Transcript, VideoView } from "../shared/plan.ts"
import { kindOfName } from "../shared/chat.ts"
import { onFrames } from "./media-commands.ts"
import { Gathered } from "../shared/gather.ts"
import { insertPlaces, shownInserts } from "../shared/inserts.ts"
import { coversOf, facesByVideo, trimmed } from "../shared/joins.ts"
import {
  assemble, Blocks, clipsOf, Edits, InsertsFile, NO_EDITS, soundBlocks,
  type Clip, type Gaze, type GazeFailure, type PlannedInserts, type TimelineView, type VideoFaces
} from "../shared/timeline.ts"
import { places, readGaze, readTranscript } from "./media-jobs.ts"

const decodeBlocks = Schema.decodeUnknownOption(Schema.fromJsonString(Blocks))
const decodeGathered = Schema.decodeUnknownOption(Schema.fromJsonString(Gathered))
const decodeInserts = Schema.decodeUnknownOption(Schema.fromJsonString(InsertsFile))

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
  if (measured !== undefined && measured.heads !== undefined) return { video, state: "measured" }
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

const readPictures = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const folder = `${dir}/attached`
  if (!(yield* fs.exists(folder))) return []
  return (yield* fs.readDirectory(folder)).filter((name) => kindOfName(name) === "picture").toSorted()
})

const readInserts = Effect.fnUntraced(function*(dir: string, pictures: ReadonlyArray<string>, transcripts: ReadonlyMap<string, Transcript>) {
  const fs = yield* FileSystem.FileSystem
  const file = `${dir}/inserts.json`
  if (!(yield* fs.exists(file))) return { state: "none" } satisfies PlannedInserts
  const written = Option.getOrUndefined(decodeInserts(yield* fs.readFileString(file)))
  if (written === undefined) {
    yield* Effect.logError("the inserts are unreadable", file)
    return { state: "unreadable" } satisfies PlannedInserts
  }
  const planned = written.inserts.filter((one, index) => {
    const words = transcripts.get(one.video)?.words ?? []
    const unique = written.inserts.findIndex((other) => other.id === one.id) === index
    return unique && pictures.includes(one.picture) && one.from <= one.to && words[one.to] !== undefined && one.from >= 0
  })
  return { state: "ready", planned, dropped: written.inserts.length - planned.length } satisfies PlannedInserts
})

export const readTimeline = Effect.fnUntraced(function*(dir: string, names: ReadonlyArray<string>, unseen: ReadonlyMap<string, GazeFailure>) {
  const fs = yield* FileSystem.FileSystem
  const transcripts = new Map<string, Transcript>()
  const gazes = new Map<string, Gaze>()
  const looks: Array<Look> = []
  const faces: Array<VideoFaces> = []
  for (const name of names) {
    const place = places({ dir, name })
    if (!(yield* fs.exists(place.transcript))) continue
    transcripts.set(name, yield* readTranscript({ dir, name }))
    const written = yield* fs.exists(place.gaze)
    let measured: Gaze | undefined
    if (written) {
      const decoded = yield* Effect.result(readGaze({ dir, name }))
      if (Result.isSuccess(decoded)) {
        measured = decoded.success
        gazes.set(name, measured)
        if (measured.heads !== undefined) faces.push({ video: name, step: measured.step, gaze: measured.samples, heads: measured.heads })
      } else {
        yield* Effect.logError("the gaze is unreadable", place.gaze, decoded.failure)
      }
    }
    looks.push(lookOf(name, measured, written, unseen.get(place.source)))
  }
  const pictures = yield* readPictures(dir)
  const inserts = yield* readInserts(dir, pictures, transcripts)
  const written = yield* readBlocks(dir)
  if (written === "none" || written === "unreadable") return { looks, faces, pictures, inserts, timeline: { state: written } } satisfies TimelineView
  return { looks, faces, pictures, inserts, timeline: { state: "ready", ...soundBlocks(written, transcripts, gazes), edits: yield* readEdits(dir) } } satisfies TimelineView
})

const readFaces = Effect.fnUntraced(function*(dir: string, name: string) {
  const fs = yield* FileSystem.FileSystem
  if (!(yield* fs.exists(places({ dir, name }).gaze))) return undefined
  const decoded = yield* Effect.result(readGaze({ dir, name }))
  if (Result.isFailure(decoded) || decoded.success.heads === undefined) return undefined
  return { video: name, step: decoded.success.step, gaze: decoded.success.samples, heads: decoded.success.heads } satisfies VideoFaces
})

export interface Cut {
  readonly clips: ReadonlyArray<Clip>
  readonly inserts: ReturnType<typeof shownInserts>
}

export const readCut = Effect.fnUntraced(function*(dir: string, names: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem
  const transcripts = new Map<string, Transcript>()
  const faces: Array<VideoFaces> = []
  for (const name of names) {
    if (!(yield* fs.exists(places({ dir, name }).transcript))) continue
    transcripts.set(name, yield* readTranscript({ dir, name }))
    const measured = yield* readFaces(dir, name)
    if (measured !== undefined) faces.push(measured)
  }
  const written = yield* readBlocks(dir)
  if (written === "none" || written === "unreadable") return { clips: [], inserts: [] } satisfies Cut
  const { blocks } = soundBlocks(written, transcripts, new Map())
  const edits = yield* readEdits(dir)
  const pictures = yield* readPictures(dir)
  const base = trimmed(clipsOf(assemble(blocks, edits, transcripts)), facesByVideo(faces), transcripts, edits)
  const resolved = coversOf(base, edits, pictures)
  const clips = onFrames(base)
  const planned = yield* readInserts(dir, pictures, transcripts)
  const placesNow = insertPlaces(planned.state === "ready" ? planned.planned : [], clips, transcripts, edits, pictures)
  return { clips, inserts: shownInserts(placesNow, clips, edits, pictures, resolved) } satisfies Cut
})
