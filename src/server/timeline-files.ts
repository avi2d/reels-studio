import { Effect, FileSystem, Option, Result, Schema } from "effect"
import type { Transcript } from "../shared/plan.ts"
import { assemble, Blocks, clipsOf, Edits, NO_EDITS, soundBlocks, type Gaze, type GazeFailure, type TimelineView } from "../shared/timeline.ts"
import { places, readGaze, readTranscript } from "./media-jobs.ts"

const decodeBlocks = Schema.decodeUnknownOption(Schema.fromJsonString(Blocks))
const EditsFile = Schema.fromJsonString(Edits)
const decodeEdits = Schema.decodeUnknownOption(EditsFile)
const encodeEdits = Schema.encodeEffect(EditsFile)

const readEdits = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const file = `${dir}/timeline.json`
  if (!(yield* fs.exists(file))) return NO_EDITS
  return Option.getOrElse(decodeEdits(yield* fs.readFileString(file)), () => NO_EDITS)
})

export const writeEdits = Effect.fnUntraced(function*(dir: string, edits: Edits) {
  const fs = yield* FileSystem.FileSystem
  const fresh = `${dir}/timeline.json.new`
  yield* fs.writeFileString(fresh, yield* encodeEdits(edits))
  yield* fs.rename(fresh, `${dir}/timeline.json`)
})

type Look = TimelineView["looks"][number]

const lookOf = (video: string, measured: Gaze | undefined, written: boolean, failure: GazeFailure | undefined): Look => {
  if (measured !== undefined) return { video, state: "measured" }
  if (written) return { video, state: "failed", reason: "file-unreadable" }
  if (failure !== undefined) return { video, state: "failed", reason: failure }
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

export const readTimeline = Effect.fnUntraced(function*(dir: string, names: ReadonlyArray<string>, unseen: ReadonlyMap<string, GazeFailure>) {
  const fs = yield* FileSystem.FileSystem
  const transcripts = new Map<string, Transcript>()
  const gazes = new Map<string, Gaze>()
  const looks: Array<Look> = []
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
      } else {
        yield* Effect.logError("the gaze is unreadable", place.gaze, decoded.failure)
      }
    }
    looks.push(lookOf(name, measured, written, unseen.get(place.source)))
  }
  const written = yield* readBlocks(dir)
  if (written === "none" || written === "unreadable") return { looks, timeline: { state: written } } satisfies TimelineView
  return { looks, timeline: { state: "ready", ...soundBlocks(written, transcripts, gazes), edits: yield* readEdits(dir) } } satisfies TimelineView
})

export const readCut = Effect.fnUntraced(function*(dir: string, names: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem
  const transcripts = new Map<string, Transcript>()
  for (const name of names) {
    if (yield* fs.exists(places({ dir, name }).transcript)) transcripts.set(name, yield* readTranscript({ dir, name }))
  }
  const written = yield* readBlocks(dir)
  if (written === "none" || written === "unreadable") return []
  const { blocks } = soundBlocks(written, transcripts, new Map())
  return clipsOf(assemble(blocks, yield* readEdits(dir), transcripts))
})
