import { Effect, FileSystem, Layer, Option, Schema, Stream } from "effect"
import { Pick } from "../shared/library.ts"
import { Edits } from "../shared/timeline.ts"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { ApiError, badRequest } from "./api-error.ts"
import { Attachments } from "./attachments.ts"
import { Chat } from "./chat.ts"
import { allowedHosts, isAllowedHost, isHomeAddress, isSameOrigin } from "./home-network.ts"
import { Media } from "./media.ts"
import { Effort, Projects } from "./projects.ts"
import { parseRange } from "./range.ts"
import { Settings } from "./settings.ts"
import * as Tus from "./tus.ts"

const reply = <R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, ApiError, R>
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.catchTag("ApiError", (error) =>
      Effect.succeed(HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status })))
  )

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status })

const param = (name: string) =>
  Effect.map(HttpRouter.params, (params) => params[name] ?? "")

const body = <A>(schema: Schema.ConstraintDecoder<A>) =>
  HttpServerRequest.schemaBodyJson(schema).pipe(Effect.mapError(() => badRequest("Запрос не разобран")))

const NewProject = Schema.Struct({ title: Schema.String })

const projects = Layer.mergeAll(
  HttpRouter.add("GET", "/api/projects", reply(Effect.gen(function*() {
    const store = yield* Projects
    return json({ projects: yield* store.list })
  }))),
  HttpRouter.add("POST", "/api/projects", reply(Effect.gen(function*() {
    const store = yield* Projects
    const input = yield* body(NewProject)
    return json({ project: yield* store.create(input.title) }, 201)
  }))),
  HttpRouter.add("GET", "/api/projects/:id", reply(Effect.gen(function*() {
    const store = yield* Projects
    return json({ project: yield* store.get(yield* param("id")) })
  }))),
  HttpRouter.add("DELETE", "/api/projects/:id", reply(Effect.gen(function*() {
    const store = yield* Projects
    const talk = yield* Chat
    const media = yield* Media
    const id = yield* param("id")
    const dir = yield* store.folder(id)
    yield* talk.withoutTurn(id, media.withoutWork(dir, store.remove(id)))
    return json({ removed: id })
  })))
)

const NewMessage = Schema.Struct({
  text: Schema.String,
  files: Schema.optionalKey(Schema.Array(Schema.String)),
  model: Schema.String,
  effort: Effort
})

const KEEP_ALIVE = Stream.tick("15 seconds").pipe(Stream.map(() => ": \n\n"))

const chat = Layer.mergeAll(
  HttpRouter.add("GET", "/api/models", Effect.gen(function*() {
    const settings = yield* Settings
    return json({ models: settings.models })
  })),
  HttpRouter.add("GET", "/api/projects/:id/chat", reply(Effect.gen(function*() {
    const talk = yield* Chat
    return json({ messages: yield* talk.history(yield* param("id")) })
  }))),
  HttpRouter.add("POST", "/api/projects/:id/chat", reply(Effect.gen(function*() {
    const talk = yield* Chat
    const input = yield* body(NewMessage)
    const events = yield* talk.send(yield* param("id"), input.text, input.files ?? [], input.model, input.effort)
    const lines = events.pipe(
      Stream.catch((error) => Stream.make({ type: "error" as const, message: error.message }, { type: "done" as const })),
      Stream.map((event) => `data: ${JSON.stringify(event)}\n\n`)
    )
    return HttpServerResponse.stream(
      Stream.merge(lines, KEEP_ALIVE, { haltStrategy: "left" }).pipe(Stream.encodeText),
      { contentType: "text/event-stream", headers: { "cache-control": "no-store", "x-accel-buffering": "no" } }
    )
  })))
)

const uploads = Layer.mergeAll(
  HttpRouter.add("*", "/api/projects/:id/uploads", (request) => reply(Effect.gen(function*() {
    const store = yield* Projects
    const id = yield* param("id")
    const dir = yield* store.folder(id)
    if (request.method === "POST") return yield* Tus.create(request, dir, `/api/projects/${id}/uploads`, "source")
    return yield* new ApiError({ status: 405, message: "Так загрузку не начать" })
  }))),
  HttpRouter.add("*", "/api/projects/:id/attachments", (request) => reply(Effect.gen(function*() {
    const store = yield* Projects
    const id = yield* param("id")
    const dir = yield* store.folder(id)
    if (request.method === "POST") return yield* Tus.create(request, dir, `/api/projects/${id}/attachments`, "attached")
    return yield* new ApiError({ status: 405, message: "Так загрузку не начать" })
  }))),
  HttpRouter.add("*", "/api/projects/:id/attachments/:upload", (request) => reply(Effect.gen(function*() {
    const store = yield* Projects
    const dir = yield* store.folder(yield* param("id"))
    const upload = yield* param("upload")
    if (request.method === "HEAD") return yield* Tus.head(request, dir, upload)
    if (request.method === "PATCH") return yield* Tus.patch(request, dir, upload)
    return yield* new ApiError({ status: 405, message: "Так загрузку не продолжить" })
  }))),
  HttpRouter.add("GET", "/api/projects/:id/attachments/:name/cover", reply(Effect.gen(function*() {
    const attachments = yield* Attachments
    const target = yield* attachments.cover(yield* param("id"), yield* param("name"))
    return yield* HttpServerResponse.file(target, { contentType: "image/jpeg", headers: { "cache-control": "no-store" } }).pipe(
      Effect.mapError(() => new ApiError({ status: 500, message: "Файл недоступен. Попробуйте открыть страницу ещё раз." }))
    )
  }))),
  HttpRouter.add("*", "/api/projects/:id/uploads/:upload", (request) => reply(Effect.gen(function*() {
    const store = yield* Projects
    const dir = yield* store.folder(yield* param("id"))
    const upload = yield* param("upload")
    if (request.method === "HEAD") return yield* Tus.head(request, dir, upload)
    if (request.method === "PATCH") return yield* Tus.patch(request, dir, upload)
    return yield* new ApiError({ status: 405, message: "Так загрузку не продолжить" })
  })))
)

const UNREADABLE = new ApiError({ status: 500, message: "Видео недоступно. Попробуйте открыть страницу ещё раз." })

const sendFile = Effect.fnUntraced(function*(target: string, contentType: string, rangeHeader: string | undefined) {
  const fs = yield* FileSystem.FileSystem
  const size = Number((yield* fs.stat(target)).size)
  const range = parseRange(rangeHeader, size)
  const headers = { "accept-ranges": "bytes", "cache-control": "no-store" }
  if (range.kind === "outside") {
    return HttpServerResponse.empty({ status: 416, headers: { ...headers, "content-range": `bytes */${size}` } })
  }
  if (range.kind === "whole") return yield* HttpServerResponse.file(target, { contentType, headers })
  return yield* HttpServerResponse.file(target, {
    status: 206,
    contentType,
    offset: range.start,
    bytesToRead: range.end - range.start + 1,
    headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${size}` }
  })
}, Effect.mapError((cause) => cause instanceof ApiError ? cause : UNREADABLE))

const NewVideos = Schema.Struct({ videos: Schema.Array(Pick).check(Schema.isMinLength(1)) })

const videos = Layer.mergeAll(
  HttpRouter.add("GET", "/api/projects/:id/videos", reply(Effect.gen(function*() {
    const media = yield* Media
    return json({ videos: yield* media.videos(yield* param("id")) })
  }))),
  HttpRouter.add("POST", "/api/projects/:id/videos", reply(Effect.gen(function*() {
    const media = yield* Media
    const store = yield* Projects
    const id = yield* param("id")
    const input = yield* body(NewVideos)
    yield* media.reuse(id, input.videos)
    return json({ project: yield* store.get(id) })
  }))),
  HttpRouter.add("GET", "/api/projects/:id/timeline", reply(Effect.gen(function*() {
    const media = yield* Media
    return json(yield* media.timeline(yield* param("id")))
  }))),
  HttpRouter.add("PUT", "/api/projects/:id/timeline", reply(Effect.gen(function*() {
    const media = yield* Media
    const id = yield* param("id")
    yield* media.saveEdits(id, yield* body(Edits))
    return json({ saved: id })
  }))),
  HttpRouter.add("GET", "/api/projects/:id/library", reply(Effect.gen(function*() {
    const media = yield* Media
    return json({ videos: yield* media.library(yield* param("id")) })
  }))),
  HttpRouter.add("GET", "/api/projects/:id/videos/:name/preview", (request) => reply(Effect.gen(function*() {
    const media = yield* Media
    const target = yield* media.preview(yield* param("id"), yield* param("name"))
    return yield* sendFile(target, "video/mp4", request.headers["range"])
  }))),
  HttpRouter.add("POST", "/api/projects/:id/videos/:name/retry", reply(Effect.gen(function*() {
    const media = yield* Media
    return json({ video: yield* media.retry(yield* param("id"), yield* param("name")) })
  })))
)

const refuse = (message: string) => HttpServerResponse.jsonUnsafe({ error: message }, { status: 403 })

const homeOnly = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const settings = yield* Settings
      const remote = Option.getOrUndefined(request.remoteAddress)
      if (remote !== undefined && !isHomeAddress(remote)) {
        return refuse("Студия открывается только из домашней сети")
      }
      if (!isAllowedHost(request.headers["host"], allowedHosts(settings.port))) {
        return refuse("Студия открывается только из домашней сети")
      }
      if (!isSameOrigin(request.headers["origin"], request.headers["host"])) {
        return refuse("Запрос пришёл с чужой страницы")
      }
      return yield* httpEffect
    }),
  { global: true }
)

export const apiRoutes = Layer.mergeAll(projects, chat, uploads, videos, homeOnly)
