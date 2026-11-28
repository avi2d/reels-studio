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
    Effect.catchIf((error) => !(error instanceof ApiError && error.message === AT_HOME), () => Effect.void)
  )
})

type Cdp = Effect.Success<ReturnType<typeof openBrowser>>

interface Capture {
  readonly cdp: Cdp
  readonly ready: Deferred.Deferred<string>
  readonly loaded: Deferred.Deferred<void>
  readonly idle: Deferred.Deferred<void>
  readonly pages: Set<string>
  readonly loadedLoaders: Set<string>
  readonly active: Set<Deferred.Deferred<void>>
  main: string | undefined
  loader: string | undefined
  mainFrame: string | undefined
}

const autoAttach = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }

const attachPage = Effect.fnUntraced(function*(capture: Capture, session: string, type: string) {
  const { cdp } = capture
  yield* cdp.send("Target.setAutoAttach", autoAttach, session)
  yield* cdp.send("Network.enable", {}, session)
  yield* cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, session)
  yield* cdp.send("Network.setBypassServiceWorker", { bypass: true }, session)
  yield* cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }, session)
  capture.pages.add(session)
  yield* cdp.send("Page.enable", {}, session)
  yield* cdp.send("Page.setLifecycleEventsEnabled", { enabled: true }, session)
  if (capture.main === undefined && type === "page") {
    capture.main = session
    yield* Deferred.succeed(capture.ready, session)
  }
  yield* cdp.send("Runtime.runIfWaitingForDebugger", {}, session)
})

const onAttached = Effect.fnUntraced(function*(capture: Capture, event: BrowserEvent) {
  const attached = yield* decoded(Attached, event.params)
  const type = attached.targetInfo.type
  if (type !== "page" && type !== "iframe") {
    yield* rejectHomeTarget(attached.targetInfo.url)
    yield* capture.cdp.send("Target.closeTarget", { targetId: attached.targetInfo.targetId }).pipe(Effect.orElseSucceed(() => undefined))
    return
  }
  yield* attachPage(capture, attached.sessionId, type)
})

const onPaused = Effect.fnUntraced(function*(capture: Capture, event: BrowserEvent) {
  const { cdp } = capture
  const paused = yield* decoded(Paused, event.params)
  const isMainDocument = paused.resourceType === "Document" && paused.frameId === capture.mainFrame && event.sessionId === capture.main
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
})

const onSocket = Effect.fnUntraced(function*(event: BrowserEvent) {
  const socket = yield* decoded(Socket, event.params)
  yield* rejectHomeTarget(socket.url)
})

const onDetached = Effect.fnUntraced(function*(capture: Capture, event: BrowserEvent) {
  const detached = yield* decoded(Detached, event.params)
  capture.pages.delete(detached.sessionId)
})

const onFrameNavigated = Effect.fnUntraced(function*(capture: Capture, event: BrowserEvent) {
  if (event.sessionId !== capture.main) return
  const { frame } = yield* decoded(Frame, event.params)
  if (frame.parentId === undefined && frame.url !== "about:blank") capture.loader = frame.loaderId
})

const onLifecycle = Effect.fnUntraced(function*(capture: Capture, event: BrowserEvent) {
  if (event.sessionId !== capture.main) return
  const lifecycle = yield* decoded(Lifecycle, event.params)
  if (lifecycle.name === "DOMContentLoaded") {
    capture.loadedLoaders.add(lifecycle.loaderId)
    if (lifecycle.loaderId === capture.loader) yield* Deferred.succeed(capture.loaded, undefined)
  } else if (lifecycle.name === "networkIdle" && lifecycle.loaderId === capture.loader) {
    yield* Deferred.succeed(capture.idle, undefined)
  }
})

const handle = (capture: Capture, event: BrowserEvent) => {
  switch (event.method) {
    case "Target.attachedToTarget": return onAttached(capture, event)
    case "Fetch.requestPaused": return onPaused(capture, event)
    case "Network.webSocketCreated": return onSocket(event)
    case "Target.detachedFromTarget": return onDetached(capture, event)
    case "Page.frameNavigated": return onFrameNavigated(capture, event)
    case "Page.lifecycleEvent": return onLifecycle(capture, event)
    default: return Effect.void
  }
}

const settleBeforeSave = Effect.fnUntraced(function*(capture: Capture, session: string) {
  const { cdp } = capture
  yield* Deferred.await(capture.idle).pipe(Effect.timeoutOrElse({ duration: "4 seconds", orElse: () => Effect.void }))
  yield* Effect.forEach([...capture.pages], (page) => cdp.send("Page.setWebLifecycleState", { state: "frozen" }, page))
  yield* cdp.send("Page.stopLoading", {}, session)
  yield* Effect.forEach([...capture.active], (done) => Deferred.await(done), { concurrency: "unbounded" })
})

const openAndSave = Effect.fnUntraced(function*(capture: Capture, address: string) {
  const { cdp } = capture
  yield* cdp.send("Browser.setDownloadBehavior", { behavior: "deny" })
  const target = yield* decoded(Target, yield* cdp.send("Target.createTarget", { url: "about:blank" }))
  yield* cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })
  const session = yield* Deferred.await(capture.ready)
  const tree = yield* decoded(FrameTree, yield* cdp.send("Page.getFrameTree", {}, session))
  capture.mainFrame = tree.frameTree.frame.id
  const navigation = yield* decoded(Navigation, yield* cdp.send("Page.navigate", { url: address }, session))
  if (navigation.errorText !== undefined || navigation.loaderId === undefined) return yield* badRequest(NOT_OPENED)
  capture.loader ??= navigation.loaderId
  if (!capture.loadedLoaders.has(capture.loader)) yield* Deferred.await(capture.loaded)
  yield* settleBeforeSave(capture, session)
  const dom = yield* decoded(Dom, yield* cdp.send("Runtime.evaluate", {
    expression: "document.documentElement.outerHTML", returnByValue: true
  }, session))
  const pdf = yield* decoded(Pdf, yield* cdp.send("Page.printToPDF", {
    printBackground: true, displayHeaderFooter: false
  }, session))
  return { pdf: Buffer.from(pdf.data, "base64"), licence: licenceOf(dom.result.value) }
})

export const capturePage = Effect.fnUntraced(function*(chrome: string, profile: string, address: string) {
  const cdp = yield* openBrowser(chrome, profile)
  const capture: Capture = {
    cdp,
    ready: yield* Deferred.make<string>(),
    loaded: yield* Deferred.make<void>(),
    idle: yield* Deferred.make<void>(),
    pages: new Set<string>(),
    loadedLoaders: new Set<string>(),
    active: new Set<Deferred.Deferred<void>>(),
    main: undefined,
    loader: undefined,
    mainFrame: undefined
  }
  yield* Stream.fromQueue(cdp.events).pipe(
    Stream.runForEach((event) => Effect.gen(function*() {
      const finished = yield* Deferred.make<void>()
      capture.active.add(finished)
      yield* handle(capture, event).pipe(
        Effect.catch((error) => error instanceof ApiError
          ? Deferred.fail(cdp.failed, error)
          : Effect.logError("a web page browser event failed", error).pipe(Effect.andThen(Deferred.fail(cdp.failed, badRequest(NOT_OPENED))))),
        Effect.ensuring(Effect.gen(function*() {
          capture.active.delete(finished)
          yield* Deferred.succeed(finished, undefined)
        })),
        Effect.forkScoped
      )
    })),
    Effect.forkScoped
  )
  return yield* Effect.raceFirst(openAndSave(capture, address), Deferred.await(cdp.failed))
}, (effect) => effect.pipe(
  Effect.scoped,
  Effect.timeout("20 seconds"),
  Effect.tapError((cause) => cause instanceof ApiError ? Effect.void : Effect.logError("the web page browser failed", cause)),
  Effect.mapError((cause) => cause instanceof ApiError ? cause : badRequest(NOT_OPENED))
))
