import { Data, DateTime, Effect, FileSystem, Option, Schema } from "effect"
import { shapeOf, visualKey, type Shown, type Visual } from "../shared/inserts.ts"
import { Frame } from "../shared/timeline.ts"
import { Levelling, LOUDNESS_TARGET, SERIES_STEP, VideoColour, type ColourView, type PictureSide, type ReelView } from "../shared/reel.ts"
import { pictureProbeArgs } from "./attachment-notes.ts"
import { curveOf, gainsOf, levelArgs, type PartLevel } from "./level-curve.ts"
import {
  isHdr, joinArgs, joinList, lastFrameOf, partArgs, partsOf, passagesOf, pictureArgs, progressSeconds, sameParts, sampledAt, secondsOf, type Moment, type Part, type Span
} from "./media-commands.ts"
import { clipFrom, clipSoundArgs, insertArgs, type InsertLayer } from "./insert-commands.ts"
import { markedPage } from "./insert-files.ts"
import { isHdrVideo, measureLoudness, momentaryLoudness, places, tool } from "./media-jobs.ts"
import { Settings } from "./settings.ts"
import { colourJoins, coloursOf, gainOf, measureSkin } from "./skin.ts"
import type { Cut } from "./timeline-files.ts"


const Colour = Schema.Struct({ videos: Schema.Array(VideoColour), joins: Schema.Int })
type Colour = typeof Colour.Type

const ShownInsert = Schema.Struct({ picture: Schema.String, start: Schema.Finite, end: Schema.Finite })
type ShownInsert = typeof ShownInsert.Type

const Record = Schema.Struct({
  made: Schema.String,
  video: Schema.String,
  parts: Schema.Array(Schema.Struct({ video: Schema.String, start: Schema.Finite, frames: Schema.Int, frame: Schema.optionalKey(Frame) })),
  colour: Schema.optionalKey(Colour),
  inserts: Schema.Array(ShownInsert).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  levelling: Schema.optionalKey(Levelling)
})
const RecordFile = Schema.fromJsonString(Record)
const decodeRecord = Schema.decodeUnknownOption(RecordFile)
const encodeRecord = Schema.encodeEffect(RecordFile)

export type ReelVersion = "after" | "before"

const Size = Schema.Struct({ width: Schema.optionalKey(Schema.Finite), height: Schema.optionalKey(Schema.Finite) })
const Rotations = Schema.Array(Schema.Struct({ rotation: Schema.optionalKey(Schema.Finite) }))

const PictureProbe = Schema.fromJsonString(Schema.Struct({
  streams: Schema.Array(Size),
  frames: Schema.optionalKey(Schema.Array(Schema.Struct({ side_data_list: Schema.optionalKey(Rotations) })))
}))
const decodePictureProbe = Schema.decodeUnknownEffect(PictureProbe)

const ClipProbe = Schema.fromJsonString(Schema.Struct({
  streams: Schema.Array(Schema.Struct({
    ...Size.fields,
    codec_type: Schema.optionalKey(Schema.String),
    color_transfer: Schema.optionalKey(Schema.String),
    side_data_list: Schema.optionalKey(Rotations)
  })),
  format: Schema.optionalKey(Schema.Struct({ duration: Schema.optionalKey(Schema.String) }))
}))
const decodeClipProbe = Schema.decodeUnknownEffect(ClipProbe)

const clipProbeArgs = (file: string): ReadonlyArray<string> =>
  ["-v", "error", "-show_entries", "stream=codec_type,width,height,color_transfer:stream_side_data=rotation:format=duration", "-of", "json", file]

const recorded = (inserts: ReadonlyArray<Shown>): ReadonlyArray<ShownInsert> =>
  inserts.map((one) => ({ picture: visualKey(one.visual), start: Number(one.start.toFixed(4)), end: Number(one.end.toFixed(4)) }))

const sameInserts = (left: ReadonlyArray<ShownInsert>, right: ReadonlyArray<ShownInsert>): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

class PictureUnreadable extends Data.TaggedError("PictureUnreadable")<{ readonly picture: string }> {}

const shownSize = (stream: typeof Size.Type, sides: typeof Rotations.Type | undefined, file: string) => {
  if (stream.width === undefined || stream.height === undefined) return Effect.fail(new PictureUnreadable({ picture: file }))
  const rotation = sides?.find((one) => one.rotation !== undefined)?.rotation
  const upright = rotation !== undefined && Math.abs(rotation % 180) === 90
  return Effect.succeed(upright ? { width: stream.height, height: stream.width } : { width: stream.width, height: stream.height })
}

const stillOf = Effect.fnUntraced(function*(file: string, insert: Shown) {
  const probe = yield* decodePictureProbe(yield* tool("ffprobe", pictureProbeArgs(file), []))
  const stream = probe.streams.find((one) => one.width !== undefined) ?? {}
  const { width, height } = yield* shownSize(stream, probe.frames?.[0]?.side_data_list, file)
  return { kind: "still", file, shape: shapeOf(width, height), width, height, start: insert.start, end: insert.end } satisfies InsertLayer
})

const clipOf = Effect.fnUntraced(function*(file: string, visual: Visual & { readonly kind: "clip" }, insert: Shown) {
  const probe = yield* decodeClipProbe(yield* tool("ffprobe", clipProbeArgs(file), []))
  const stream = probe.streams.find((one) => one.codec_type === "video") ?? {}
  const { width, height } = yield* shownSize(stream, stream.side_data_list, file)
  const sound = visual.sound && probe.streams.some((one) => one.codec_type === "audio")
  const duration = Number(probe.format?.duration ?? Number.NaN)
  return {
    kind: "clip", file, shape: shapeOf(width, height), width, height, start: insert.start, end: insert.end,
    from: clipFrom(visual.start, Number.isFinite(duration) ? duration : undefined), hdr: isHdr(stream.color_transfer), sound
  } satisfies InsertLayer
})

const insertLayerOf = Effect.fnUntraced(function*(dir: string, insert: Shown) {
  const { visual } = insert
  if (visual.kind === "clip") return yield* clipOf(`${dir}/attached/${visual.file}`, visual, insert)
  if (visual.kind === "page") return yield* stillOf(yield* markedPage(dir, visual.file, visual.page, visual.quote), insert)
  return yield* stillOf(`${dir}/attached/${visual.file}`, insert)
})


const reelPlaces = (dir: string): { readonly record: string; readonly work: string; readonly video: (name: string) => string } => ({
  record: `${dir}/reel/reel.json`,
  work: `${dir}/reel/work`,
  video: (name: string) => `${dir}/reel/${name}`
})

const stemOf = (made: string): string => `reel-${made.replace(/:/g, "-")}`

export const videoOf = (made: string): string => `${stemOf(made)}.mp4`

const beforeOf = (made: string): string => `before-${made.replace(/:/g, "-")}.mp4`

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

export const reelVideoAt = Effect.fnUntraced(function*(dir: string, made: string, version: ReelVersion) {
  return yield* builtFileAt(dir, version === "before" ? beforeOf(made) : videoOf(made))
})

export const reelPictureAt = Effect.fnUntraced(function*(dir: string, made: string, join: number, side: PictureSide) {
  return yield* builtFileAt(dir, pictureOf(made, join, side))
})

const sweepReel = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const place = reelPlaces(dir)
  const record = (yield* fs.exists(place.record))
    ? Option.getOrUndefined(decodeRecord(yield* fs.readFileString(place.record)))
    : undefined
  const pictures = record?.colour === undefined
    ? []
    : Array.from({ length: record.colour.joins }, (_, index) => [pictureOf(record.made, index + 1, "before"), pictureOf(record.made, index + 1, "after")]).flat()
  const kept = new Set<string | undefined>([record?.video, record?.levelling === undefined ? undefined : beforeOf(record.made), ...pictures])
  if (!(yield* fs.exists(`${dir}/reel`))) return
  yield* Effect.forEach(yield* fs.readDirectory(`${dir}/reel`), (name) =>
    (name.endsWith(".mp4") || name.endsWith(".jpg")) && !kept.has(name)
      ? fs.remove(`${dir}/reel/${name}`, { force: true }).pipe(
        Effect.catch((error) => Effect.logError("the unpublished reel video was not removed", error))
      )
      : Effect.void, { discard: true })
})

// The first video of the cut with a face, in cut order, is the one the others are brought to.
const measureColours = Effect.fnUntraced(function*(dir: string, parts: ReadonlyArray<Part>, work: string) {
  const videos = [...new Set(parts.map((part) => part.video))]
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

const measurePassages = Effect.fnUntraced(function*(work: string, levelled: string, spans: ReadonlyArray<Span>) {
  return yield* Effect.forEach(spans, (span) => Effect.gen(function*() {
    const segment = { start: span.from, seconds: span.to - span.from }
    const before = yield* measureLoudness(`${work}/joined.mp4`, segment)
    const after = yield* measureLoudness(levelled, segment)
    return { ...span, before: before.lufs, after: after.lufs }
  }))
})

// One gain curve over the whole reel, not per part, so quiet and loud passages share one target.
const levelReel = Effect.fnUntraced(function*(work: string, moments: ReadonlyArray<Moment>, parts: ReadonlyArray<PartLevel>, offset: number, output: string) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const curve = `${work}/curve.txt`
  yield* fs.writeFileString(curve, curveOf(gainsOf(moments, parts, offset)))
  yield* tool("ffmpeg", levelArgs(`${work}/joined.mp4`, curve, output), settings.heavy)
  return yield* measureLoudness(output)
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
  yield* fs.rename(`${place.work}/joined.mp4`, place.video(beforeOf(record.made)))
  yield* fs.rename(`${place.work}/reel.mp4`, place.video(record.video))
  yield* Effect.uninterruptible(fs.rename(`${place.work}/reel.json`, place.record))
})

type Rendered = PartLevel & { readonly name: string }

const joinSound = Effect.fnUntraced(function*(work: string, rendered: ReadonlyArray<Rendered>, layers: ReadonlyArray<InsertLayer>) {
  const joined = `${work}/joined.mp4`
  const mix = clipSoundArgs(`${work}/voice.mp4`, layers, joined)
  yield* concatParts(work, rendered.map((part) => part.name), mix === undefined ? joined : `${work}/voice.mp4`)
  if (mix !== undefined) yield* tool("ffmpeg", mix, (yield* Settings).heavy)
})

const levelSound = Effect.fnUntraced(function*(work: string, parts: ReadonlyArray<Part>, rendered: ReadonlyArray<Rendered>, layers: ReadonlyArray<InsertLayer>, levelledFile: string, soundDone: (step: number) => Effect.Effect<void>) {
  const total = secondsOf(parts)
  yield* joinSound(work, rendered, layers)
  const heard = yield* measureLoudness(`${work}/joined.mp4`)
  const moments = yield* momentaryLoudness(`${work}/joined.mp4`, `${work}/moments.txt`)
  yield* soundDone(1)
  const trial = yield* levelReel(work, moments, rendered, 0, `${work}/trial.mp4`)
  yield* soundDone(2)
  const changed = yield* levelReel(work, moments, rendered, LOUDNESS_TARGET - trial.lufs, levelledFile)
  yield* soundDone(3)
  const changedMoments = yield* momentaryLoudness(levelledFile, `${work}/moments-after.txt`)
  yield* soundDone(4)
  const passages = yield* measurePassages(work, levelledFile, passagesOf(parts, rendered.map((part) => part.lufs)))
  yield* soundDone(5)
  return {
    before: heard.lufs,
    after: changed,
    series: { before: sampledAt(moments, SERIES_STEP, total), after: sampledAt(changedMoments, SERIES_STEP, total) },
    passages
  } satisfies Levelling
})

const SOUND_SHARE = 0.2
const SOUND_STEPS = 5
const INSERTS_SHARE = 0.25

const encodeReel = Effect.fnUntraced(function*(dir: string, cut: Cut, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const place = reelPlaces(dir)
  const parts = partsOf(cut.clips)
  const total = secondsOf(parts)
  const pictures = yield* Effect.forEach(cut.inserts, (insert) => insertLayerOf(dir, insert))
  const insertsShare = pictures.length === 0 ? 0 : INSERTS_SHARE
  const partsShare = 1 - SOUND_SHARE - insertsShare
  yield* fs.remove(place.work, { recursive: true, force: true })
  yield* fs.makeDirectory(place.work, { recursive: true })
  yield* sweepReel(dir)
  const colours = yield* measureColours(dir, parts, place.work)
  const joins = yield* makePictures(dir, parts, colours, new Map())
  yield* renderParts(dir, parts, colours, place.work, `${place.work}/joined.mp4`, (share) => onDone(share * partsShare))
  const rendered: Array<Rendered> = []
  for (const [index] of parts.entries()) {
    const name = `part-${String(index + 1).padStart(3, "0")}.mov`
    rendered.push({ name, from: secondsOf(parts.slice(0, index)), to: secondsOf(parts.slice(0, index + 1)), lufs: (yield* measureLoudness(`${place.work}/${name}`)).lufs })
  }
  const levelledFile = pictures.length === 0 ? `${place.work}/reel.mp4` : `${place.work}/levelled.mp4`
  const levelling = yield* levelSound(place.work, parts, rendered, pictures, levelledFile, (step) => onDone(partsShare + SOUND_SHARE * step / SOUND_STEPS))
  if (pictures.length > 0) {
    yield* tool("ffmpeg", insertArgs(levelledFile, pictures, settings.encoder, `${place.work}/reel.mp4`), settings.heavy, (line) => {
      const seconds = progressSeconds(line)
      return seconds === undefined ? Effect.void : onDone(1 - insertsShare + insertsShare * Math.min(1, seconds / total))
    })
  }
  const made = DateTime.formatIso(yield* DateTime.now)
  const record = {
    made,
    video: videoOf(made),
    parts,
    inserts: recorded(cut.inserts),
    colour: { videos: colours, joins },
    levelling
  }
  yield* publishPictures(dir, made, joins)
  yield* publish(dir, record)
})

export const buildReel = Effect.fn("Reel.build")(function*(dir: string, cut: Cut, onDone: (share: number) => Effect.Effect<void>) {
  const fs = yield* FileSystem.FileSystem
  const cleanup = Effect.andThen(
    fs.remove(reelPlaces(dir).work, { recursive: true, force: true }).pipe(
      Effect.catch((error) => Effect.logError("the half-built reel parts were not removed", error))
    ),
    sweepReel(dir).pipe(
      Effect.catch((error) => Effect.logError("the unpublished reel video was not removed", error))
    )
  )
  yield* encodeReel(dir, cut, onDone).pipe(Effect.ensuring(cleanup))
})

const colourView = (colour: Colour): ColourView => ({
  joins: colour.joins,
  matched: colour.videos.filter((video) => video.state === "matched").length,
  unmeasured: colour.videos.filter((video) => video.state === "unmeasured").length
})

export const readReel = Effect.fnUntraced(function*(dir: string, cut: Cut, job: ReelView["job"]) {
  const fs = yield* FileSystem.FileSystem
  const parts = partsOf(cut.clips)
  const seconds = secondsOf(parts)
  const published = yield* publishedReel(dir)
  if (published === undefined) return { job, cut: seconds } satisfies ReelView
  const size = Number((yield* fs.stat(published.target)).size)
  const { record } = published
  const file = {
    made: record.made,
    seconds: secondsOf(record.parts),
    size,
    fresh: sameParts(record.parts, parts) && sameInserts(record.inserts, recorded(cut.inserts)),
    ...(record.colour === undefined ? {} : { colour: colourView(record.colour) }),
    ...(record.levelling === undefined ? {} : { levelling: record.levelling })
  }
  return { job, cut: seconds, file } satisfies ReelView
})
