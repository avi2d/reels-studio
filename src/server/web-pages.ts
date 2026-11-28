import { Context, Crypto, DateTime, Effect, FileSystem, Layer, Semaphore } from "effect"
import type { ChildProcessSpawner } from "effect/process"
import type { WebPage } from "../shared/web-pages.ts"
import { ApiError, badRequest } from "./api-error.ts"
import { Attachments } from "./attachments.ts"
import { Projects } from "./projects.ts"
import { Settings } from "./settings.ts"
import { NOT_OPENED, WebPageAddress } from "./web-page-access.ts"
import { capturePage } from "./web-page-browser.ts"
import { checkedAddress, pageName } from "./web-page-commands.ts"
import { readWebPages, writeWebPages } from "./web-page-files.ts"

const NOT_AN_ADDRESS = "Это не адрес страницы в интернете. Нужен адрес, который начинается с http:// или https://."

export interface SavedPage extends WebPage {
  readonly about: string
}

const digestOf = Effect.fnUntraced(function*(text: string) {
  const digest = yield* (yield* Crypto.Crypto).digest("SHA-256", new TextEncoder().encode(text))
  return Buffer.from(digest).toString("hex")
})

const printed = Effect.fnUntraced(function*(dir: string, address: string, name: string) {
  const fs = yield* FileSystem.FileSystem
  const settings = yield* Settings
  const work = `${dir}/work/web-${yield* (yield* Crypto.Crypto).randomUUIDv4}`
  yield* fs.makeDirectory(`${work}/profile`, { recursive: true })
  return yield* Effect.gen(function*() {
    const pdf = `${work}/${name}`
    const captured = yield* capturePage(settings.chrome, `${work}/profile`, address)
    if (captured.pdf.length === 0) return yield* badRequest(NOT_OPENED)
    yield* fs.writeFile(pdf, captured.pdf)
    yield* fs.makeDirectory(`${dir}/attached`, { recursive: true })
    yield* fs.rename(pdf, `${dir}/attached/${name}`)
    return captured.licence
  }).pipe(Effect.ensuring(fs.remove(work, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined))))
})

export class WebPages extends Context.Service<WebPages, {
  readonly save: (id: string, address: string) => Effect.Effect<SavedPage, ApiError>
}>()("reels-studio/WebPages") {
  static readonly layer = Layer.effect(
    WebPages,
    Effect.gen(function*() {
      const projects = yield* Projects
      const attachments = yield* Attachments
      const context = yield* Effect.context<FileSystem.FileSystem | Settings | ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto>()
      const writing = yield* Semaphore.make(1)

      const saveIn = Effect.fnUntraced(function*(dir: string, url: URL) {
        const kept = yield* readWebPages(dir)
        const known = kept.find((page) => page.address === url.href)
        if (known !== undefined) return known
        const name = pageName(url, yield* digestOf(url.href))
        const licence = yield* printed(dir, url.href, name)
        const page: WebPage = { file: name, address: url.href, saved: DateTime.formatIso(yield* DateTime.now), ...licence === undefined ? {} : { licence } }
        yield* writeWebPages(dir, [...(yield* readWebPages(dir)).filter((one) => one.file !== name), page])
        return page
      })

      const save = Effect.fn("WebPages.save")(function*(id: string, address: string) {
        const url = checkedAddress(address)
        if (url === undefined) return yield* badRequest(NOT_AN_ADDRESS)
        yield* (yield* WebPageAddress)(url.hostname)
        const dir = yield* projects.folder(id)
        const page = yield* Semaphore.withPermit(writing)(saveIn(dir, url))
        return { ...page, about: yield* attachments.describe(dir, page.file) }
      }, (effect) => effect.pipe(
        Effect.tapError((cause) => cause instanceof ApiError ? Effect.void : Effect.logError("a web page was not saved", cause)),
        Effect.mapError((cause) => cause instanceof ApiError ? cause : new ApiError({ status: 502, message: NOT_OPENED }))
      ), Effect.provideContext(context))

      return WebPages.of({ save })
    })
  )
}
