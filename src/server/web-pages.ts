import { lookup } from "node:dns/promises"
import { Context, Crypto, DateTime, Effect, FileSystem, Layer, Semaphore } from "effect"
import type { ChildProcessSpawner } from "effect/process"
import type { WebPage } from "../shared/web-pages.ts"
import { ApiError, badRequest } from "./api-error.ts"
import { Attachments } from "./attachments.ts"
import { tool } from "./media-jobs.ts"
import { Projects } from "./projects.ts"
import { Settings } from "./settings.ts"
import { checkedAddress, domArgs, isOutside, licenceOf, pageName, printArgs } from "./web-page-commands.ts"
import { readWebPages, writeWebPages } from "./web-page-files.ts"

const NOT_AN_ADDRESS = "Это не адрес страницы в интернете. Нужен адрес, который начинается с http:// или https://."
const AT_HOME = "Этот адрес ведёт в домашнюю сеть. Студия открывает только страницы в интернете."
const NOT_OPENED = "Страница не открылась. Проверьте адрес или попробуйте позже."

export interface SavedPage extends WebPage {
  readonly about: string
}

const outsideHost = Effect.fnUntraced(function*(host: string) {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
  const found = yield* Effect.tryPromise(() => lookup(bare, { all: true, order: "verbatim" })).pipe(Effect.mapError(() => badRequest(NOT_OPENED)))
  if (found.length === 0 || !found.every((one) => isOutside(one.address))) return yield* badRequest(AT_HOME)
})

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
    yield* tool(settings.chrome, printArgs(address, `${work}/profile`, pdf), [])
    if (!(yield* fs.exists(pdf)) || Number((yield* fs.stat(pdf)).size) === 0) return yield* badRequest(NOT_OPENED)
    const dom = yield* tool(settings.chrome, domArgs(address, `${work}/profile`), []).pipe(Effect.orElseSucceed(() => ""))
    yield* fs.makeDirectory(`${dir}/attached`, { recursive: true })
    yield* fs.rename(pdf, `${dir}/attached/${name}`)
    return licenceOf(dom)
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
        yield* outsideHost(url.hostname)
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
