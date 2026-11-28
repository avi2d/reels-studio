import { Effect, FileSystem, Option, Schema } from "effect"
import { articlesOf, type PageSource, type WebPage, WebPagesFile } from "../shared/web-pages.ts"
import { readText } from "./approval.ts"
import { viewOf } from "./insert-files.ts"

const PagesJson = Schema.fromJsonString(WebPagesFile)
const decodePages = Schema.decodeUnknownOption(PagesJson)
const encodePages = Schema.encodeEffect(PagesJson)

const fileOf = (dir: string): string => `${dir}/web-pages.json`

export const readWebPages = Effect.fnUntraced(function*(dir: string) {
  const text = yield* readText(fileOf(dir))
  if (text === undefined) return []
  return Option.getOrElse(Option.map(decodePages(text), (file) => file.pages), (): ReadonlyArray<WebPage> => [])
})

export const writeWebPages = Effect.fnUntraced(function*(dir: string, pages: ReadonlyArray<WebPage>) {
  const fs = yield* FileSystem.FileSystem
  const fresh = `${fileOf(dir)}.new`
  yield* fs.writeFileString(fresh, yield* encodePages({ pages }))
  yield* fs.rename(fresh, fileOf(dir))
})

export const pageSources = Effect.fnUntraced(function*(dir: string) {
  const pages = yield* readWebPages(dir)
  return yield* Effect.forEach(pages, (page) => Effect.gen(function*() {
    const text = yield* readText(`${viewOf(dir, page.file)}/text.txt`)
    const source: PageSource = { file: page.file, address: page.address, articles: articlesOf(text ?? ""), ...page.licence === undefined ? {} : { licence: page.licence } }
    return source
  }))
}, Effect.orElseSucceed((): ReadonlyArray<PageSource> => []))
