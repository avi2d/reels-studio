import { DateTime, Effect, FileSystem, Option, Schema } from "effect"
import type { Clip } from "../shared/timeline.ts"
import { VideoColour, type ColourView, type PictureSide, type ReelView } from "../shared/reel.ts"
import { joinArgs, joinList, lastFrameOf, partArgs, partsOf, pictureArgs, progressSeconds, sameParts, secondsOf, type Part } from "./media-commands.ts"
import { isHdrVideo, places, tool } from "./media-jobs.ts"
import { Settings } from "./settings.ts"
import { colourJoins, coloursOf, gainOf, measureSkin } from "./skin.ts"

const Colour = Schema.Struct({ videos: Schema.Array(VideoColour), joins: Schema.Int })
type Colour = typeof Colour.Type

const Record = Schema.Struct({
  made: Schema.String,
  video: Schema.String,
  parts: Schema.Array(Schema.Struct({ video: Schema.String, start: Schema.Finite, frames: Schema.Int })),
  colour: Schema.optionalKey(Colour)
})
const RecordFile = Schema.fromJsonString(Record)
const decodeRecord = Schema.decodeUnknownOption(RecordFile)
const encodeRecord = Schema.encodeEffect(RecordFile)

const reelPlaces = (dir: string): { readonly record: string; readonly work: string; readonly video: (name: string) => string } => ({
  record: `${dir}/reel/reel.json`,
  work: `${dir}/reel/work`,
  video: (name: string) => `${dir}/reel/${name}`
})

const stemOf = (made: string): string => `reel-${made.replace(/:/g, "-")}`

export const videoOf = (made: string): string => `${stemOf(made)}.mp4`

const pictureName = (join: number, side: PictureSide): string => `join-${join}-${side}.jpg`

const pictureOf = (made: string, join: number, side: PictureSide): string => `${stemOf(made)}-${pictureName(join, side)}`

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

const builtFileAt = Effect.fnUntraced(function*(dir: string, name: string) {
  const fs = yield* FileSystem.FileSystem
  const target = reelPlaces(dir).video(name)
  if (!(yield* fs.exists(target))) return undefined
  return target
})

export const reelVideoAt = Effect.fnUntraced(function*(dir: string, made: string) {
  return yield* builtFileAt(dir, videoOf(made))
})

export const reelPictureAt = Effect.fnUntraced(function*(dir: string, made: string, join: number, side: PictureSide) {
  return yield* builtFileAt(dir, pictureOf(made, join, side))
})

const sweepReel = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  const kept = (yield* fs.exists(place.record))
    ? Option.getOrUndefined(decodeRecord(yield* fs.readFileString(place.record)))?.made
    : undefined
  if (!(yield* fs.exists(`${dir}/reel`))) return
  const isKept = (name: string): boolean => kept !== undefined && name.startsWith(stemOf(kept))
  yield* Effect.forEach(yield* fs.readDirectory(`${dir}/reel`), (name) =>
    name.startsWith("reel-") && (name.endsWith(".mp4") || name.endsWith(".jpg")) && !isKept(name)
      ? fs.remove(`${dir}/reel/${name}`, { force: true }).pipe(
        Effect.catch((error) => Effect.logError("the unpublished reel video was not removed", error))
      )
      : Effect.void, { discard: true })
})

// The first video of the cut in upload order is the one the others are brought to.
const measureColours = Effect.fnUntraced(function*(dir: string, parts: ReadonlyArray<Part>, work: string) {
  const videos = [...new Set(parts.map((part) => part.video))].toSorted()
  return coloursOf(yield* Effect.forEach(videos, (video) => Effect.map(measureSkin({ dir, name: video }, work), (skin) => ({ video, skin }))))
})

const lookOf = Effect.fnUntraced(function*(dir: string, video: string, colours: ReadonlyArray<VideoColour>, hdr: Map<string, boolean>) {
  const source = places({ dir, name: video }).source
  const tone = hdr.get(video) ?? (yield* isHdrVideo(source))
  hdr.set(video, tone)
  return { source, look: { hdr: tone, gain: gainOf(colours, video) } }
})

const makePictures = Effect.fnUntraced(function*(dir: string, parts: ReadonlyArray<Part>, colours: ReadonlyArray<VideoColour>, hdr: Map<string, boolean>) {
  const settings = yield* Settings
  const work = reelPlaces(dir).work
  const joins = colours.some((colour) => colour.state === "matched") ? colourJoins(parts) : []
  for (const [index, join] of joins.entries()) {
    const end = yield* lookOf(dir, join.end.video, colours, hdr)
    const start = yield* lookOf(dir, join.start.video, colours, hdr)
    const sides = [
      ["before", { ...end.look, gain: undefined }, { ...start.look, gain: undefined }],
      ["after", end.look, start.look]
    ] as const
    for (const [side, left, right] of sides) {
      const shots = [{ source: end.source, time: lastFrameOf(join.end), look: left }, { source: start.source, time: join.start.start, look: right }] as const
      yield* tool("ffmpeg", pictureArgs(shots[0], shots[1], `${work}/${pictureName(index + 1, side)}`), settings.heavy)
    }
  }
  return joins.length
})

const publishPictures = Effect.fnUntraced(function*(dir: string, made: string, joins: number) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  for (let join = 1; join <= joins; join++) {
    for (const side of ["before", "after"] as const) yield* fs.rename(`${place.work}/${pictureName(join, side)}`, place.video(pictureOf(made, join, side)))
  }
})

export const renderParts = Effect.fnUntraced(function*(dir: string, parts: ReadonlyArray<Part>, colours: ReadonlyArray<VideoColour>, work: string, output: string, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const total = secondsOf(parts)
  const hdr = new Map<string, boolean>()
  const names: Array<string> = []
  for (const part of parts) {
    const { source, look } = yield* lookOf(dir, part.video, colours, hdr)
    const before = secondsOf(parts.slice(0, names.length))
    const name = `part-${String(names.length + 1).padStart(3, "0")}.mov`
    yield* tool("ffmpeg", partArgs(source, part, look, settings.encoder, `${work}/${name}`), settings.heavy, (line) => {
      const seconds = progressSeconds(line)
      return seconds === undefined ? Effect.void : onDone(Math.min(1, (before + seconds) / total))
    })
    names.push(name)
  }
  yield* fs.writeFileString(`${work}/parts.txt`, joinList(names))
  yield* tool("ffmpeg", joinArgs(`${work}/parts.txt`, output), settings.heavy)
})

const encodeReel = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  const parts = partsOf(clips)
  yield* fs.remove(place.work, { recursive: true, force: true })
  yield* fs.makeDirectory(place.work, { recursive: true })
  yield* sweepReel(dir)
  const colours = yield* measureColours(dir, parts, place.work)
  const joins = yield* makePictures(dir, parts, colours, new Map())
  yield* renderParts(dir, parts, colours, place.work, `${place.work}/reel.mp4`, onDone)
  const made = DateTime.formatIso(yield* DateTime.now)
  const video = videoOf(made)
  yield* fs.writeFileString(`${place.work}/reel.json`, yield* encodeRecord({ made, video, parts, colour: { videos: colours, joins } }))
  yield* publishPictures(dir, made, joins)
  yield* fs.rename(`${place.work}/reel.mp4`, place.video(video))
  yield* Effect.uninterruptible(fs.rename(`${place.work}/reel.json`, place.record))
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

const colourView = (colour: Colour): ColourView => ({
  joins: colour.joins,
  matched: colour.videos.filter((video) => video.state === "matched").length,
  unmeasured: colour.videos.filter((video) => video.state === "unmeasured").length
})

export const readReel = Effect.fnUntraced(function*(dir: string, clips: ReadonlyArray<Clip>, job: ReelView["job"]) {
  const fs = yield* FileSystem.FileSystem
  const parts = partsOf(clips)
  const cut = secondsOf(parts)
  const published = yield* publishedReel(dir)
  if (published === undefined) return { job, cut } satisfies ReelView
  const size = Number((yield* fs.stat(published.target)).size)
  const { colour } = published.record
  const file = { made: published.record.made, seconds: secondsOf(published.record.parts), size, fresh: sameParts(published.record.parts, parts) }
  return { job, cut, file: colour === undefined ? file : { ...file, colour: colourView(colour) } } satisfies ReelView
})
