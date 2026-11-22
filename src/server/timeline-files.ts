import { Effect, FileSystem, Option, Result, Schema } from "effect"
import type { Transcript, VideoView } from "../shared/plan.ts"
import { kindOfName } from "../shared/chat.ts"
import { onFrames } from "./media-commands.ts"
import { Gathered } from "../shared/gather.ts"
import { insertPlaces, plannedVisual, shownInserts } from "../shared/inserts.ts"
import { coversOf, cutOf, facesByVideo } from "../shared/joins.ts"
import {
  assemble, Blocks, clipsOf, Edits, InsertsFile, NO_EDITS, soundBlocks,
  type Clip, type Gaze, type GazeFailure, type PlannedInsert, type PlannedInserts, type TimelineView, type VideoFaces
} from "../shared/timeline.ts"
import { quoteOnPage } from "./insert-files.ts"
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

export const readAttached = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const folder = `${dir}/attached`
  if (!(yield* fs.exists(folder))) return []
  return (yield* fs.readDirectory(folder)).toSorted()
})

const readPictures = Effect.fnUntraced(function*(dir: string) {
  return (yield* readAttached(dir)).filter((name) => kindOfName(name) === "picture")
})

const shownExists = Effect.fnUntraced(function*(dir: string, attached: ReadonlyArray<string>, planned: PlannedInsert) {
  const visual = plannedVisual(planned)
  const kind = { picture: "picture", clip: "video", page: "document" } as const
  if (!attached.includes(visual.file) || kindOfName(visual.file) !== kind[visual.kind]) return false
  if (visual.kind === "clip") return visual.start >= 0
  if (visual.kind === "page") return visual.page >= 1 && (yield* quoteOnPage(dir, visual.file, visual.page, visual.quote))
  return true
})

const readInserts = Effect.fnUntraced(function*(dir: string, transcripts: ReadonlyMap<string, Transcript>) {
  const fs = yield* FileSystem.FileSystem
  const file = `${dir}/inserts.json`
  if (!(yield* fs.exists(file))) return { state: "none" } satisfies PlannedInserts
  const written = Option.getOrUndefined(decodeInserts(yield* fs.readFileString(file)))
  if (written === undefined) {
    yield* Effect.logError("the inserts are unreadable", file)
    return { state: "unreadable" } satisfies PlannedInserts
  }
  const attached = yield* readAttached(dir)
  const shown = yield* Effect.forEach(written.inserts, (one) => shownExists(dir, attached, one))
  const planned = written.inserts.filter((one, index) => {
    const words = transcripts.get(one.video)?.words ?? []
    const unique = written.inserts.findIndex((other) => other.id === one.id) === index
    return unique && shown[index] === true && one.from <= one.to && words[one.to] !== undefined && one.from >= 0
  })
  return { state: "ready", planned, dropped: written.inserts.length - planned.length } satisfies PlannedInserts
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
  const pictures = yield* readPictures(dir)
  const inserts = yield* readInserts(dir, transcripts)
  const written = yield* readBlocks(dir)
  if (written === "none" || written === "unreadable") return { looks, faces, pictures, inserts, timeline: { state: written } } satisfies TimelineView
  return { looks, faces, pictures, inserts, timeline: { state: "ready", ...soundBlocks(written, transcripts, gazes), edits: yield* readEdits(dir) } } satisfies TimelineView
})

export interface Cut {
  readonly clips: ReadonlyArray<Clip>
  readonly inserts: ReturnType<typeof shownInserts>
}

export const readCut = Effect.fnUntraced(function*(dir: string, names: ReadonlyArray<string>) {
  const { transcripts, faces } = yield* readHeard(dir, names)
  const written = yield* readBlocks(dir)
  if (written === "none" || written === "unreadable") return { clips: [], inserts: [] } satisfies Cut
  const { blocks } = soundBlocks(written, transcripts, new Map())
  const edits = yield* readEdits(dir)
  const pictures = yield* readPictures(dir)
  const base = cutOf(clipsOf(assemble(blocks, edits, transcripts)), facesByVideo(faces), transcripts, edits)
  const resolved = coversOf(base, edits, pictures)
  const clips = onFrames(base)
  const planned = yield* readInserts(dir, transcripts)
  const placesNow = insertPlaces(planned.state === "ready" ? planned.planned : [], clips, transcripts, edits, pictures)
  return { clips, inserts: shownInserts(placesNow, clips, edits, pictures, resolved) } satisfies Cut
})
