import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import type { ChildProcessSpawner } from "effect/process"
import { kindOfName, type FileKind } from "../shared/chat.ts"
import { ApiError, notFound, orUnavailable } from "./api-error.ts"
import { about, attachedLines, fileProbeArgs, frameArgs, frameTimes, pagesText, pictureArgs, type Seen, SHOWN_PAGES, soundArgs, type Speech, speechText } from "./attachment-notes.ts"
import { isHdr } from "./media-commands.ts"
import { decodeTranscript, tool } from "./media-jobs.ts"
import { Projects } from "./projects.ts"
import { Settings } from "./settings.ts"

const Kind = Schema.Literals(["picture", "document", "video", "sound", "other"])

const Look = Schema.Struct({ kind: Kind, about: Schema.String, shown: Schema.Array(Schema.String) })
type Look = typeof Look.Type
const LookFile = Schema.fromJsonString(Look)
const decodeLook = Schema.decodeUnknownEffect(LookFile)
const encodeLook = Schema.encodeEffect(LookFile)

const Probe = Schema.fromJsonString(Schema.Struct({
  streams: Schema.Array(Schema.Struct({
    codec_type: Schema.optionalKey(Schema.String),
    width: Schema.optionalKey(Schema.Finite),
    height: Schema.optionalKey(Schema.Finite),
    color_transfer: Schema.optionalKey(Schema.String)
  })),
  format: Schema.optionalKey(Schema.Struct({ duration: Schema.optionalKey(Schema.String) }))
}))
type Probe = typeof Probe.Type
const decodeProbe = Schema.decodeUnknownEffect(Probe)

const PdfFacts = Schema.fromJsonString(Schema.Struct({ pages: Schema.Finite, texts: Schema.Array(Schema.String) }))
const decodePdf = Schema.decodeUnknownEffect(PdfFacts)

// One message carries at most this many images, so ten attached videos do not send thirty frames.
const MOST_IMAGES = 12

interface Image {
  readonly type: "image"
  readonly data: string
  readonly mimeType: "image/jpeg"
}

export interface Shown extends Seen {
  readonly images: ReadonlyArray<Image>
}

interface Place {
  readonly file: string
  readonly view: string
  readonly look: string
  readonly shared: string
}

const placeOf = (dir: string, name: string): Place => ({
  file: `${dir}/attached/${name}`,
  view: `${dir}/attached-views/${name}`,
  look: `${dir}/attached-views/${name}/look.json`,
  shared: `attached-views/${name}`
})

const probe = (file: string) => Effect.flatMap(tool("ffprobe", fileProbeArgs(file), []), decodeProbe)

const durationOf = (facts: Probe): number | undefined => {
  const seconds = Number(facts.format?.duration)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
}

const streamOf = (facts: Probe, type: "video" | "audio") => facts.streams.find((stream) => stream.codec_type === type)

const hear = Effect.fnUntraced(function*(place: Place) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const wav = `${place.view}/sound.wav`
  const words = `${place.view}/words.json`
  yield* tool("ffmpeg", soundArgs(place.file, wav), settings.heavy)
  const transcriber = `${settings.root}/tools/transcribe`
  yield* tool("uv", ["run", "--project", transcriber, "python", `${transcriber}/transcribe.py`, wav, words], settings.heavy).pipe(
    Effect.ensuring(fs.remove(wav).pipe(Effect.orElseSucceed(() => undefined)))
  )
  const transcript = yield* decodeTranscript(yield* fs.readFileString(words))
  yield* fs.remove(words)
  const text = speechText(transcript)
  if (text === undefined) return { heard: "silent" } satisfies Speech
  yield* fs.writeFileString(`${place.view}/speech.txt`, text)
  return { heard: "words", file: `${place.shared}/speech.txt` } satisfies Speech
}, (effect) => effect.pipe(
  Effect.tapError((error) => Effect.logError("an attached sound was not heard", error)),
  Effect.orElseSucceed((): Speech => ({ heard: "unheard" }))
))

const listenIf = (place: Place, facts: Probe): Effect.Effect<Speech, never, FileSystem.FileSystem | Settings | ChildProcessSpawner.ChildProcessSpawner> =>
  streamOf(facts, "audio") === undefined ? Effect.succeed({ heard: "no-sound" }) : hear(place)

const lookAtPicture = Effect.fnUntraced(function*(place: Place) {
  const settings = yield* Settings
  const picture = streamOf(yield* probe(place.file), "video")
  yield* tool("ffmpeg", pictureArgs(place.file, `${place.view}/picture.jpg`), settings.heavy)
  return { kind: "picture", about: about.picture(picture?.width, picture?.height), shown: ["picture.jpg"] } satisfies Look
})

const lookAtSound = Effect.fnUntraced(function*(place: Place, facts: Probe) {
  return { kind: "sound", about: about.sound(durationOf(facts), yield* listenIf(place, facts)), shown: [] } satisfies Look
})

const lookAtVideo = Effect.fnUntraced(function*(place: Place) {
  const settings = yield* Settings
  const facts = yield* probe(place.file)
  const picture = streamOf(facts, "video")
  if (picture === undefined) return yield* lookAtSound(place, facts)
  const duration = durationOf(facts)
  const times = frameTimes(duration)
  const shown = times.map((_, index) => `frame-${index + 1}.jpg`)
  const hdr = isHdr(picture.color_transfer)
  yield* Effect.forEach(times, (at, index) =>
    tool("ffmpeg", frameArgs(place.file, at, hdr, `${place.view}/${shown[index] ?? "frame.jpg"}`), settings.heavy), { discard: true })
  return { kind: "video", about: about.video(duration, times, yield* listenIf(place, facts)), shown } satisfies Look
})

const lookAtDocument = Effect.fnUntraced(function*(place: Place) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const reader = `${settings.root}/tools/pdf`
  yield* tool("uv", ["run", "--project", reader, "python", `${reader}/pdf.py`, place.file, place.view, "--pages", String(SHOWN_PAGES)], settings.heavy)
  const facts = yield* decodePdf(yield* fs.readFileString(`${place.view}/pdf.json`))
  yield* fs.remove(`${place.view}/pdf.json`)
  const hasText = facts.texts.some((text) => text !== "")
  if (hasText) yield* fs.writeFileString(`${place.view}/text.txt`, pagesText(facts.texts))
  const shown = Array.from({ length: Math.min(facts.pages, SHOWN_PAGES) }, (_, index) => `page-${index + 1}.jpg`)
  return { kind: "document", about: about.document(facts.pages, shown.length, hasText ? `${place.shared}/text.txt` : undefined), shown } satisfies Look
})

const lookAtSoundFile = Effect.fnUntraced(function*(place: Place) {
  return yield* lookAtSound(place, yield* probe(place.file))
})

const LOOKS = {
  picture: lookAtPicture,
  document: lookAtDocument,
  video: lookAtVideo,
  sound: lookAtSoundFile,
  other: () => Effect.succeed({ kind: "other", about: about.other(), shown: [] } satisfies Look)
} satisfies Readonly<Record<FileKind, unknown>>

const savedLook = Effect.fnUntraced(function*(place: Place) {
  const fs = yield* FileSystem.FileSystem
  if (!(yield* fs.exists(place.look))) return undefined
  return yield* decodeLook(yield* fs.readFileString(place.look))
}, Effect.orElseSucceed(() => undefined))

const freshLook = Effect.fnUntraced(function*(place: Place, kind: FileKind) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(place.view, { recursive: true })
  const look: Look = yield* LOOKS[kind](place)
  yield* fs.writeFileString(place.look, yield* encodeLook(look))
  return look
})

const lookAt = Effect.fnUntraced(function*(dir: string, name: string) {
  const place = placeOf(dir, name)
  const saved = yield* savedLook(place)
  if (saved !== undefined) return saved
  const kind = kindOfName(name)
  return yield* freshLook(place, kind).pipe(
    Effect.tapError((error) => Effect.logError("an attached file was not looked at", name, error)),
    Effect.orElseSucceed((): Look => ({ kind, about: about.failed(kind), shown: [] }))
  )
})

const imagesOf = Effect.fnUntraced(function*(dir: string, name: string, look: Look) {
  const fs = yield* FileSystem.FileSystem
  const place = placeOf(dir, name)
  return yield* Effect.forEach(look.shown, (file) =>
    Effect.map(fs.readFile(`${place.view}/${file}`), (bytes): Image => ({
      type: "image",
      data: Buffer.from(bytes).toString("base64"),
      mimeType: "image/jpeg"
    })))
}, Effect.orElseSucceed((): ReadonlyArray<Image> => []))

const attachedNames = Effect.fnUntraced(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const folder = `${dir}/attached`
  if (!(yield* fs.exists(folder))) return []
  return (yield* fs.readDirectory(folder)).toSorted()
})

const UNAVAILABLE = "Файл недоступен. Попробуйте открыть страницу ещё раз."

export class Attachments extends Context.Service<Attachments, {
  readonly show: (dir: string, names: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<Shown>>
  readonly listed: (dir: string) => Effect.Effect<string>
  readonly cover: (id: string, name: string) => Effect.Effect<string, ApiError>
}>()("reels-studio/Attachments") {
  static readonly layer = Layer.effect(
    Attachments,
    Effect.gen(function*() {
      const projects = yield* Projects
      const context = yield* Effect.context<FileSystem.FileSystem | Settings | ChildProcessSpawner.ChildProcessSpawner>()

      const show = Effect.fn("Attachments.show")(function*(dir: string, names: ReadonlyArray<string>) {
        const loaded = yield* Effect.forEach(names, (name) => Effect.gen(function*() {
          const look = yield* lookAt(dir, name)
          return { name, look, shared: placeOf(dir, name).shared, images: yield* imagesOf(dir, name, look) }
        }))
        let left = MOST_IMAGES
        return loaded.map(({ name, look, shared, images }) => {
          const delivered = images.slice(0, left)
          left -= delivered.length
          const total = look.shown.length
          const omitted = look.shown.slice(delivered.length).map((file) => `${shared}/${file}`)
          const noun = look.kind === "picture" ? "image" : look.kind === "document" ? "page images" : "frames"
          const about = total === 0 || delivered.length === total
            ? look.about
            : delivered.length === 0
              ? `${look.about} Included with this message: 0 of ${total} ${noun}. Read them at ${omitted.join(", ")}.`
              : `${look.about} Included with this message: ${delivered.length} of ${total} ${noun}. Read the rest at ${omitted.join(", ")}.`
          return { name, about, images: delivered }
        })
      }, Effect.provideContext(context))

      const listed = Effect.fn("Attachments.listed")(function*(dir: string) {
        const names = yield* attachedNames(dir)
        const seen = yield* Effect.forEach(names, (name) => Effect.map(savedLook(placeOf(dir, name)), (look): Seen => ({
          name,
          about: look?.about ?? about.failed(kindOfName(name))
        })))
        return attachedLines(seen)
      }, Effect.orElseSucceed(() => ""), Effect.provideContext(context))

      const cover = Effect.fn("Attachments.cover")(function*(id: string, name: string) {
        const dir = yield* projects.folder(id)
        if (!(yield* attachedNames(dir)).includes(name)) return yield* notFound("Такого файла в ролике нет")
        const place = placeOf(dir, name)
        const first = (yield* savedLook(place))?.shown[0]
        if (first === undefined) return yield* notFound("У этого файла нет картинки")
        return `${place.view}/${first}`
      }, orUnavailable("the cover failed", UNAVAILABLE), Effect.provideContext(context))

      return Attachments.of({ show, listed, cover })
    })
  )
}
