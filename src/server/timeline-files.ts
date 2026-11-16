import { Effect, FileSystem, Option, Schema } from "effect"
import type { Transcript } from "../shared/plan.ts"
import { Blocks, Edits, NO_EDITS, soundBlocks, type Gaze, type TimelineView } from "../shared/timeline.ts"
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

export const readTimeline = Effect.fnUntraced(function*(dir: string, names: ReadonlyArray<string>, unseen: ReadonlySet<string>) {
  const fs = yield* FileSystem.FileSystem
  const transcripts = new Map<string, Transcript>()
  const gazes = new Map<string, Gaze>()
  const looks: Array<Look> = []
  for (const name of names) {
    const place = places({ dir, name })
    if (!(yield* fs.exists(place.transcript))) continue
    transcripts.set(name, yield* readTranscript({ dir, name }))
    const written = yield* fs.exists(place.gaze)
    const measured = written ? Option.getOrUndefined(yield* Effect.option(readGaze({ dir, name }))) : undefined
    if (measured !== undefined) gazes.set(name, measured)
    const lost = written || unseen.has(place.source)
    looks.push({ video: name, state: measured !== undefined ? "measured" : lost ? "failed" : "waiting" })
  }
  const file = `${dir}/blocks.json`
  if (!(yield* fs.exists(file))) return { looks, timeline: { state: "none" } } satisfies TimelineView
  const written = Option.getOrUndefined(decodeBlocks(yield* fs.readFileString(file)))
  if (written === undefined) {
    yield* Effect.logError("the blocks are unreadable", file)
    return { looks, timeline: { state: "unreadable" } } satisfies TimelineView
  }
  return { looks, timeline: { state: "ready", ...soundBlocks(written, transcripts, gazes), edits: yield* readEdits(dir) } } satisfies TimelineView
})
