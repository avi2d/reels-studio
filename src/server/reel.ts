import { DateTime, Effect, FileSystem, Option, Schema } from "effect"
import type { Clip } from "../shared/timeline.ts"
import { Loudness, Passage, type ReelView } from "../shared/reel.ts"
import { joinArgs, joinList, normalizeArgs, partArgs, partsOf, passagesOf, progressSeconds, sameParts, secondsOf, type Level, type Span } from "./media-commands.ts"
import { isHdrVideo, measureLoudness, places, tool } from "./media-jobs.ts"
import { Settings } from "./settings.ts"

const Record = Schema.Struct({
  made: Schema.String,
  video: Schema.String,
  before: Schema.String,
  parts: Schema.Array(Schema.Struct({ video: Schema.String, start: Schema.Finite, frames: Schema.Int })),
  loudness: Loudness,
  passages: Schema.Array(Passage)
})
const RecordFile = Schema.fromJsonString(Record)
const decodeRecord = Schema.decodeUnknownOption(RecordFile)
const encodeRecord = Schema.encodeEffect(RecordFile)

export type ReelVersion = "after" | "before"

const reelPlaces = (dir: string): { readonly record: string; readonly work: string; readonly video: (name: string) => string } => ({
  record: `${dir}/reel/reel.json`,
  work: `${dir}/reel/work`,
  video: (name: string) => `${dir}/reel/${name}`
})

const stamped = (made: string): string => made.replace(/:/g, "-")
export const videoOf = (made: string): string => `reel-${stamped(made)}.mp4`
const beforeOf = (made: string): string => `before-${stamped(made)}.mp4`

const publishedReel = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  if (!(yield* fs.exists(place.record))) return undefined
  const record = Option.getOrUndefined(decodeRecord(yield* fs.readFileString(place.record)))
  if (record === undefined) return undefined
  const target = place.video(record.video)
  if (!(yield* fs.exists(target))) return undefined
  return { target, record } as const
})

export const reelVideoAt = Effect.fnUntraced(function*(dir: string, made: string, version: ReelVersion) {
  const fs = yield* FileSystem.FileSystem
  const target = reelPlaces(dir).video(version === "before" ? beforeOf(made) : videoOf(made))
  if (!(yield* fs.exists(target))) return undefined
  return target
})

const sweepReel = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  const record = (yield* fs.exists(place.record))
    ? Option.getOrUndefined(decodeRecord(yield* fs.readFileString(place.record)))
    : undefined
  const kept = new Set<string | undefined>([record?.video, record?.before])
  if (!(yield* fs.exists(`${dir}/reel`))) return
  yield* Effect.forEach(yield* fs.readDirectory(`${dir}/reel`), (name) =>
    name.endsWith(".mp4") && !kept.has(name)
      ? fs.remove(`${dir}/reel/${name}`, { force: true }).pipe(
        Effect.catch((error) => Effect.logError("the unpublished reel video was not removed", error))
      )
      : Effect.void, { discard: true })
})

const measurePassages = Effect.fnUntraced(function*(work: string, spans: ReadonlyArray<Span>) {
  return yield* Effect.forEach(spans, (span) => Effect.gen(function*() {
    const segment = { start: span.from, seconds: span.to - span.from }
    const before = yield* measureLoudness(`${work}/joined.mp4`, segment)
    const after = yield* measureLoudness(`${work}/reel.mp4`, segment)
    return { ...span, before: before.lufs, after: after.lufs }
  }))
})

interface Rendered {
  readonly name: string
  readonly level: Level
}

// A single gain over the joined reel leaves quiet parts far under loud ones.
const evenPart = Effect.fnUntraced(function*(work: string, part: Rendered) {
  const settings = yield* Settings
  const name = `even-${part.name}`
  yield* tool("ffmpeg", normalizeArgs(`${work}/${part.name}`, part.level, `${work}/${name}`), settings.heavy)
  return name
})

const concatParts = Effect.fnUntraced(function*(work: string, names: ReadonlyArray<string>, output: string) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  yield* fs.writeFileString(`${work}/parts.txt`, joinList(names))
  yield* tool("ffmpeg", joinArgs(`${work}/parts.txt`, output), settings.heavy)
})

// Written last: the record names only files that are already whole.
const publish = Effect.fnUntraced(function*(dir: string, record: typeof Record.Type) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  yield* fs.writeFileString(`${place.work}/reel.json`, yield* encodeRecord(record))
  yield* fs.rename(`${place.work}/joined.mp4`, place.video(record.before))
  yield* fs.rename(`${place.work}/reel.mp4`, place.video(record.video))
  yield* Effect.uninterruptible(fs.rename(`${place.work}/reel.json`, place.record))
})

const encodeReel = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const place = reelPlaces(dir)
  const parts = partsOf(clips)
  const total = secondsOf(parts)
  yield* fs.remove(place.work, { recursive: true, force: true })
  yield* fs.makeDirectory(place.work, { recursive: true })
  yield* sweepReel(dir)
  const hdr = new Map<string, boolean>()
  const rendered: Array<Rendered> = []
  for (const part of parts) {
    const source = places({ dir, name: part.video }).source
    const tone = hdr.get(part.video) ?? (yield* isHdrVideo(source))
    hdr.set(part.video, tone)
    const before = secondsOf(parts.slice(0, rendered.length))
    const name = `part-${String(rendered.length + 1).padStart(3, "0")}.mov`
    yield* tool("ffmpeg", partArgs(source, part, tone, settings.encoder, `${place.work}/${name}`), settings.heavy, (line) => {
      const seconds = progressSeconds(line)
      return seconds === undefined ? Effect.void : onDone(Math.min(1, (before + seconds) / total))
    })
    rendered.push({ name, level: yield* measureLoudness(`${place.work}/${name}`) })
  }
  yield* concatParts(place.work, rendered.map((part) => part.name), `${place.work}/joined.mp4`)
  const heard = yield* measureLoudness(`${place.work}/joined.mp4`)
  const evened = yield* Effect.forEach(rendered, (part) => evenPart(place.work, part))
  yield* concatParts(place.work, evened, `${place.work}/reel.mp4`)
  const changed = yield* measureLoudness(`${place.work}/reel.mp4`)
  const passages = yield* measurePassages(place.work, passagesOf(parts, rendered.map((part) => part.level)))
  const made = DateTime.formatIso(yield* DateTime.now)
  const record = {
    made,
    video: videoOf(made),
    before: beforeOf(made),
    parts,
    loudness: { before: heard.lufs, after: changed.lufs },
    passages
  }
  yield* publish(dir, record)
})

export const buildReel = Effect.fn("Reel.build")(function*(dir: string, clips: ReadonlyArray<Clip>, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const cleanup = Effect.andThen(
    fs.remove(reelPlaces(dir).work, { recursive: true, force: true }).pipe(
      Effect.catch((error) => Effect.logError("the half-built reel parts were not removed", error))
    ),
    sweepReel(dir).pipe(
      Effect.catch((error) => Effect.logError("the unpublished reel video was not removed", error))
    )
  )
  yield* encodeReel(dir, clips, onDone).pipe(Effect.ensuring(cleanup))
})

export const readReel = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>, job: ReelView["job"]) {
  const fs = yield* FileSystem.FileSystem
  const parts = partsOf(clips)
  const cut = secondsOf(parts)
  const published = yield* publishedReel(dir)
  if (published === undefined) return { job, cut } satisfies ReelView
  const size = Number((yield* fs.stat(published.target)).size)
  const { record } = published
  const file = {
    made: record.made,
    seconds: secondsOf(record.parts),
    size,
    fresh: sameParts(record.parts, parts),
    loudness: record.loudness,
    passages: record.passages
  }
  return { job, cut, file } satisfies ReelView
})
