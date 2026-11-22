import { Crypto, Data, Effect, FileSystem, Schema } from "effect"
import { clipPreviewArgs } from "./media-commands.ts"
import { isHdrVideo, tool } from "./media-jobs.ts"
import { markArgs, markOf, PageChars, pageTextOf, quoteFound } from "./page-mark.ts"
import { Settings } from "./settings.ts"

const decodeChars = Schema.decodeUnknownEffect(Schema.fromJsonString(PageChars))

class QuoteNotFound extends Data.TaggedError("QuoteNotFound")<{ readonly document: string; readonly page: number }> {}

const viewOf = (dir: string, name: string): string => `${dir}/attached-views/${name}`

// Made under a fresh name and renamed, so a second request for the same file never reads it half-written.
const madeOnce = Effect.fnUntraced(function*<E, R>(target: string, make: (fresh: string) => Effect.Effect<unknown, E, R>) {
  const fs = yield* FileSystem.FileSystem
  if (yield* fs.exists(target)) return target
  const dot = target.lastIndexOf(".")
  const fresh = `${target.slice(0, dot)}.part-${yield* (yield* Crypto.Crypto).randomUUIDv4}${target.slice(dot)}`
  yield* make(fresh).pipe(Effect.onError(() => fs.remove(fresh, { force: true }).pipe(Effect.orElseSucceed(() => undefined))))
  yield* fs.rename(fresh, target)
  return target
})

const pageFiles = Effect.fnUntraced(function*(dir: string, document: string, page: number) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const view = viewOf(dir, document)
  const picture = `${view}/page-${page}-large.png`
  const chars = `${view}/page-${page}-chars.json`
  if ((yield* fs.exists(picture)) && (yield* fs.exists(chars))) return { picture, chars }
  yield* fs.makeDirectory(view, { recursive: true })
  const reader = `${settings.root}/tools/pdf`
  const fresh = `${view}/page-${page}.part-${yield* (yield* Crypto.Crypto).randomUUIDv4}`
  yield* tool("uv", ["run", "--project", reader, "python", `${reader}/page.py`, `${dir}/attached/${document}`, String(page), `${fresh}.png`, `${fresh}.json`], settings.heavy).pipe(
    Effect.onError(() => Effect.forEach([`${fresh}.png`, `${fresh}.json`], (file) => fs.remove(file, { force: true }), { discard: true }).pipe(Effect.orElseSucceed(() => undefined)))
  )
  yield* fs.rename(`${fresh}.png`, picture)
  yield* fs.rename(`${fresh}.json`, chars)
  return { picture, chars }
})

const markName = Effect.fnUntraced(function*(page: number, quote: string) {
  const digest = yield* (yield* Crypto.Crypto).digest("SHA-256", new TextEncoder().encode(quote))
  return `mark-${page}-${Buffer.from(digest).toString("hex").slice(0, 16)}.jpg`
})

export const quoteOnPage = Effect.fnUntraced(function*(dir: string, document: string, page: number, quote: string) {
  const fs = yield* FileSystem.FileSystem
  const file = `${viewOf(dir, document)}/text.txt`
  if (!(yield* fs.exists(file))) return false
  const text = pageTextOf(yield* fs.readFileString(file), page)
  return text !== undefined && quoteFound(text, quote)
}, Effect.orElseSucceed(() => false))

export const markedPage = Effect.fnUntraced(function*(dir: string, document: string, page: number, quote: string) {
  const fs = yield* FileSystem.FileSystem
  if (!(yield* quoteOnPage(dir, document, page, quote))) return yield* new QuoteNotFound({ document, page })
  return yield* madeOnce(`${viewOf(dir, document)}/${yield* markName(page, quote)}`, (fresh) => Effect.gen(function*() {
    const files = yield* pageFiles(dir, document, page)
    const mark = markOf(yield* decodeChars(yield* fs.readFileString(files.chars)), quote)
    if (mark === undefined) return yield* new QuoteNotFound({ document, page })
    yield* tool("ffmpeg", markArgs(files.picture, mark, fresh), (yield* Settings).heavy)
  }))
})

export const clipPreview = Effect.fnUntraced(function*(dir: string, clip: string) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const view = viewOf(dir, clip)
  yield* fs.makeDirectory(view, { recursive: true })
  const source = `${dir}/attached/${clip}`
  return yield* madeOnce(`${view}/clip.mp4`, (fresh) => Effect.gen(function*() {
    yield* tool("ffmpeg", clipPreviewArgs(source, fresh, yield* isHdrVideo(source), settings.encoder), settings.heavy)
  }))
})
