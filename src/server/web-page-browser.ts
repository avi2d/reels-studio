import { Deferred, Effect, Schema, Stream } from "effect"
import { ApiError, badRequest } from "./api-error.ts"
import { AT_HOME, NOT_OPENED, PageRequest, pageResponse, WebPageAddress } from "./web-page-access.ts"
import { openBrowser, type BrowserEvent } from "./web-page-cdp.ts"
import { checkedRequestAddress, licenceOf } from "./web-page-commands.ts"

const Target = Schema.Struct({ targetId: Schema.String })
const Attached = Schema.Struct({ sessionId: Schema.String, targetInfo: Schema.Struct({ type: Schema.String, targetId: Schema.String, url: Schema.String }) })
const Paused = Schema.Struct({
  requestId: Schema.String,
  resourceType: Schema.String,
  frameId: Schema.String,
  request: PageRequest
})
const FrameTree = Schema.Struct({ frameTree: Schema.Struct({ frame: Schema.Struct({ id: Schema.String }) }) })
const Frame = Schema.Struct({ frame: Schema.Struct({ loaderId: Schema.String, parentId: Schema.optionalKey(Schema.String), url: Schema.String }) })
const Detached = Schema.Struct({ sessionId: Schema.String })
const Lifecycle = Schema.Struct({ name: Schema.String, loaderId: Schema.String })
const Navigation = Schema.Struct({ loaderId: Schema.optionalKey(Schema.String), errorText: Schema.optionalKey(Schema.String) })
const Socket = Schema.Struct({ url: Schema.String })
const Pdf = Schema.Struct({ data: Schema.String })
const Dom = Schema.Struct({ result: Schema.Struct({ value: Schema.String }) })

const decoded = <S extends Schema.Top>(schema: S, value: unknown) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(Effect.mapError(() => badRequest(NOT_OPENED)))

const rejectHomeTarget = Effect.fnUntraced(function*(address: string) {
  const url = checkedRequestAddress(address.replace(/^ws(s?):/u, "http$1:"))
  if (url !== undefined) yield* (yield* WebPageAddress)(url.hostname).pipe(
    Effect.timeout("3 seconds"),
    Effect.catch((error) => error instanceof ApiError && error.message === AT_HOME ? Effect.fail(error) : Effect.void)
  )
})

export const capturePage = Effect.fnUntraced(function*(chrome: string, profile: string, address: string) {
  const cdp = yield* openBrowser(chrome, profile)
  const ready = yield* Deferred.make<string>()
  const loaded = yield* Deferred.make<void>()
  const idle = yield* Deferred.make<void>()
  const pages = new Set<string>()
  const loadedLoaders = new Set<string>()
  const active = new Set<Deferred.Deferred<void>>()
  let main: string | undefined
  let loader: string | undefined
  let mainFrame: string | undefined

  const autoAttach = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }
  const handle = Effect.fnUntraced(function*(event: BrowserEvent) {
    if (event.method === "Target.attachedToTarget") {
      const attached = yield* decoded(Attached, event.params)
      const session = attached.sessionId
      const type = attached.targetInfo.type
      if (type !== "page" && type !== "iframe") {
        yield* rejectHomeTarget(attached.targetInfo.url)
        yield* cdp.send("Target.closeTarget", { targetId: attached.targetInfo.targetId }).pipe(Effect.orElseSucceed(() => undefined))
        return
      }
      yield* cdp.send("Target.setAutoAttach", autoAttach, session)
      yield* cdp.send("Network.enable", {}, session)
      yield* cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, session)
      yield* cdp.send("Network.setBypassServiceWorker", { bypass: true }, session)
      yield* cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }, session)
      pages.add(session)
      yield* cdp.send("Page.enable", {}, session)
      yield* cdp.send("Page.setLifecycleEventsEnabled", { enabled: true }, session)
      if (main === undefined && type === "page") {
        main = session
        yield* Deferred.succeed(ready, session)
      }
      yield* cdp.send("Runtime.runIfWaitingForDebugger", {}, session)
    } else if (event.method === "Fetch.requestPaused") {
      const paused = yield* decoded(Paused, event.params)
      const isMainDocument = paused.resourceType === "Document" && paused.frameId === mainFrame && event.sessionId === main
      yield* Effect.gen(function*() {
        const response = yield* pageResponse(paused.request).pipe(
          Effect.timeout(isMainDocument ? "15 seconds" : "3 seconds")
        )
        yield* cdp.send("Fetch.fulfillRequest", { requestId: paused.requestId, ...response }, event.sessionId).pipe(
          Effect.catchTag("BrowserCommandError", (error) =>
            error.message.includes("Invalid InterceptionId") ? Effect.void : Effect.fail(error))
        )
      }).pipe(Effect.catch((error) => Effect.gen(function*() {
        if (error instanceof ApiError && error.message === AT_HOME) return yield* error
        if (isMainDocument) {
          return yield* badRequest(NOT_OPENED)
        }
        yield* cdp.send("Fetch.failRequest", { requestId: paused.requestId, errorReason: "Failed" }, event.sessionId).pipe(
          Effect.orElseSucceed(() => undefined)
        )
      })))
    } else if (event.method === "Network.webSocketCreated") {
      const socket = yield* decoded(Socket, event.params)
      yield* rejectHomeTarget(socket.url)
    } else if (event.method === "Target.detachedFromTarget") {
      const detached = yield* decoded(Detached, event.params)
      pages.delete(detached.sessionId)
    } else if (event.method === "Page.frameNavigated" && event.sessionId === main) {
      const { frame } = yield* decoded(Frame, event.params)
      if (frame.parentId === undefined && frame.url !== "about:blank") loader = frame.loaderId
    } else if (event.method === "Page.lifecycleEvent" && event.sessionId === main) {
      const lifecycle = yield* decoded(Lifecycle, event.params)
      if (lifecycle.name === "DOMContentLoaded") {
        loadedLoaders.add(lifecycle.loaderId)
        if (lifecycle.loaderId === loader) yield* Deferred.succeed(loaded, undefined)
      } else if (lifecycle.name === "networkIdle" && lifecycle.loaderId === loader) {
        yield* Deferred.succeed(idle, undefined)
      }
    }
  })

  yield* Stream.fromQueue(cdp.events).pipe(
    Stream.runForEach((event) => Effect.gen(function*() {
      const finished = yield* Deferred.make<void>()
      active.add(finished)
      yield* handle(event).pipe(
        Effect.catch((error) => Deferred.fail(cdp.failed, error instanceof ApiError ? error : badRequest(NOT_OPENED))),
        Effect.ensuring(Effect.gen(function*() {
          active.delete(finished)
          yield* Deferred.succeed(finished, undefined)
        })),
        Effect.forkScoped
      )
    })),
    Effect.forkScoped
  )

  const capture = Effect.gen(function*() {
    yield* cdp.send("Browser.setDownloadBehavior", { behavior: "deny" })
    const target = yield* decoded(Target, yield* cdp.send("Target.createTarget", { url: "about:blank" }))
    yield* cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })
    const session = yield* Deferred.await(ready)
    const tree = yield* decoded(FrameTree, yield* cdp.send("Page.getFrameTree", {}, session))
    mainFrame = tree.frameTree.frame.id
    const navigation = yield* decoded(Navigation, yield* cdp.send("Page.navigate", { url: address }, session))
    if (navigation.errorText !== undefined || navigation.loaderId === undefined) return yield* badRequest(NOT_OPENED)
    loader ??= navigation.loaderId
    if (!loadedLoaders.has(loader)) yield* Deferred.await(loaded)
    yield* Effect.raceFirst(Deferred.await(idle), Effect.sleep("4 seconds"))
    yield* Effect.forEach([...pages], (page) => cdp.send("Page.setWebLifecycleState", { state: "frozen" }, page))
    yield* cdp.send("Page.stopLoading", {}, session)
    yield* Effect.all([...active].map((done) => Deferred.await(done)), { concurrency: "unbounded" })
    const dom = yield* decoded(Dom, yield* cdp.send("Runtime.evaluate", {
      expression: "document.documentElement.outerHTML", returnByValue: true
    }, session))
    const pdf = yield* decoded(Pdf, yield* cdp.send("Page.printToPDF", {
      printBackground: true, displayHeaderFooter: false
    }, session))
    return { pdf: Buffer.from(pdf.data, "base64"), licence: licenceOf(dom.result.value) }
  })
  return yield* Effect.raceFirst(capture, Deferred.await(cdp.failed))
}, (effect) => effect.pipe(
  Effect.scoped,
  Effect.timeout("20 seconds"),
  Effect.mapError((cause) => cause instanceof ApiError ? cause : badRequest(NOT_OPENED))
))
