import { DateTime, Effect, FileSystem, Option, Schema } from "effect"
import type { Clip } from "../shared/timeline.ts"
import type { ReelView } from "../shared/reel.ts"
import { joinArgs, joinList, partArgs, partsOf, progressSeconds, sameParts, secondsOf } from "./media-commands.ts"
import { isHdrVideo, places, tool } from "./media-jobs.ts"
import { Settings } from "./settings.ts"

const Record = Schema.Struct({
  made: Schema.String,
  parts: Schema.Array(Schema.Struct({ video: Schema.String, start: Schema.Finite, frames: Schema.Int }))
})
const RecordFile = Schema.fromJsonString(Record)
const decodeRecord = Schema.decodeUnknownOption(RecordFile)
const encodeRecord = Schema.encodeEffect(RecordFile)

export const reelPlaces = (dir: string): Readonly<Record<"file" | "record" | "work", string>> => ({
  file: `${dir}/reel/reel.mp4`,
  record: `${dir}/reel/reel.json`,
  work: `${dir}/reel/work`
})

const encodeReel = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const place = reelPlaces(dir)
  const parts = partsOf(clips)
  const total = secondsOf(parts)
  yield* fs.remove(place.work, { recursive: true, force: true })
  yield* fs.makeDirectory(place.work, { recursive: true })
  const hdr = new Map<string, boolean>()
  const names: Array<string> = []
  for (const part of parts) {
    const source = places({ dir, name: part.video }).source
    const tone = hdr.get(part.video) ?? (yield* isHdrVideo(source))
    hdr.set(part.video, tone)
    const before = secondsOf(parts.slice(0, names.length))
    const name = `part-${String(names.length + 1).padStart(3, "0")}.mov`
    yield* tool("ffmpeg", partArgs(source, part, tone, settings.encoder, `${place.work}/${name}`), settings.heavy, (line) => {
      const seconds = progressSeconds(line)
      return seconds === undefined ? Effect.void : onDone(Math.min(1, (before + seconds) / total))
    })
    names.push(name)
  }
  yield* fs.writeFileString(`${place.work}/parts.txt`, joinList(names))
  yield* tool("ffmpeg", joinArgs(`${place.work}/parts.txt`, `${place.work}/reel.mp4`), settings.heavy)
  yield* fs.writeFileString(`${place.work}/reel.json`, yield* encodeRecord({ made: DateTime.formatIso(yield* DateTime.now), parts }))
  yield* Effect.uninterruptible(Effect.gen(function*() {
    yield* fs.rename(`${place.work}/reel.mp4`, place.file)
    yield* fs.rename(`${place.work}/reel.json`, place.record)
  }))
})

export const buildReel = Effect.fn("Reel.build")(function*(dir: string, clips: ReadonlyArray<Clip>, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  yield* encodeReel(dir, clips, onDone).pipe(Effect.ensuring(fs.remove(reelPlaces(dir).work, { recursive: true, force: true }).pipe(
    Effect.catch((error) => Effect.logError("the half-built reel parts were not removed", error))
  )))
})

export const readReel = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>, job: ReelView["job"]) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  const parts = partsOf(clips)
  const cut = secondsOf(parts)
  if (!(yield* fs.exists(place.file)) || !(yield* fs.exists(place.record))) return { job, cut } satisfies ReelView
  const record = Option.getOrUndefined(decodeRecord(yield* fs.readFileString(place.record)))
  if (record === undefined) return { job, cut } satisfies ReelView
  const size = Number((yield* fs.stat(place.file)).size)
  const file = { made: record.made, seconds: secondsOf(record.parts), size, fresh: sameParts(record.parts, parts) }
  return { job, cut, file } satisfies ReelView
})
