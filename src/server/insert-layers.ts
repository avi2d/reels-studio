import { Data, Effect, Schema } from "effect"
import { shapeOf, type Shown, type Visual } from "../shared/inserts.ts"
import { pictureProbeArgs } from "./attachment-notes.ts"
import { clipFrom, type InsertLayer } from "./insert-commands.ts"
import { markedPage } from "./insert-files.ts"
import { isHdr } from "./media-commands.ts"
import { tool } from "./media-jobs.ts"

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
  const probed = Number(probe.format?.duration ?? Number.NaN)
  const duration = Number.isFinite(probed) ? probed : undefined
  const from = clipFrom(visual.start, duration)
  return {
    kind: "clip", file, shape: shapeOf(width, height), width, height, start: insert.start, end: insert.end,
    from, lasts: duration === undefined ? insert.end - insert.start : duration - from, hdr: isHdr(stream.color_transfer), sound
  } satisfies InsertLayer
})

export const insertLayerOf = Effect.fnUntraced(function*(dir: string, insert: Shown) {
  const { visual } = insert
  if (visual.kind === "clip") return yield* clipOf(`${dir}/attached/${visual.file}`, visual, insert)
  if (visual.kind === "page") return yield* stillOf(yield* markedPage(dir, visual.file, visual.page, visual.quote), insert)
  return yield* stillOf(`${dir}/attached/${visual.file}`, insert)
})
