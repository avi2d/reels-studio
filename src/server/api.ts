import { Effect, FileSystem, Layer, Option, Schema, Stream } from "effect"
import { Pick } from "../shared/library.ts"
import { Edits, type TimelinePage } from "../shared/timeline.ts"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { ApiError, badRequest } from "./api-error.ts"
import { Attachments } from "./attachments.ts"
import { Brief } from "./brief.ts"
import { Chat } from "./chat.ts"
import { Gather } from "./gather.ts"
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

const madeOf = (request: HttpServerRequest.HttpServerRequest): string =>
  new URL(request.url, "http://localhost").searchParams.get("made") ?? ""

const body = <A>(schema: Schema.ConstraintDecoder<A>) =>
  HttpServerRequest.schemaBodyJson(schema).pipe(Effect.mapError(() => badRequest("Запрос не разобран")))

const NewProject = Schema.Struct({ title: Schema.String })
const SaveEdits = Schema.Struct({ base: Edits, edits: Edits })

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
    const gather = yield* Gather
    const id = yield* param("id")
    const dir = yield* store.folder(id)
    yield* talk.withoutTurn(id, gather.withoutGather(id, media.withoutWork(dir, store.remove(id))))
    return json({ removed: id })
  })))
)

const NewMessage = Schema.Struct({
  text: Schema.String,
  files: Schema.optionalKey(Schema.Array(Schema.String)),
  model: Schema.String,
  effort: Effort
})

const NewBrief = Schema.Struct({ text: Schema.String })

const brief = Layer.mergeAll(
  HttpRouter.add("GET", "/api/projects/:id/brief", reply(Effect.gen(function*() {
    const store = yield* Brief
    return json(yield* store.view(yield* param("id")))
  }))),
  HttpRouter.add("PUT", "/api/projects/:id/brief", reply(Effect.gen(function*() {
    const store = yield* Brief
    const id = yield* param("id")
    yield* store.write(id, (yield* body(NewBrief)).text)
    return json(yield* store.view(id))
  })))
)

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

const startUpload = (segment: string, into: Tus.Folder) => (request: HttpServerRequest.HttpServerRequest) => reply(Effect.gen(function*() {
  const store = yield* Projects
  const id = yield* param("id")
  const dir = yield* store.folder(id)
  if (request.method === "POST") return yield* Tus.create(request, dir, `/api/projects/${id}/${segment}`, into)
  return yield* new ApiError({ status: 405, message: "Так загрузку не начать" })
}))

const resumeUpload = (request: HttpServerRequest.HttpServerRequest) => reply(Effect.gen(function*() {
  const store = yield* Projects
  const dir = yield* store.folder(yield* param("id"))
  const upload = yield* param("upload")
  if (request.method === "HEAD") return yield* Tus.head(request, dir, upload)
  if (request.method === "PATCH") return yield* Tus.patch(request, dir, upload)
  return yield* new ApiError({ status: 405, message: "Так загрузку не продолжить" })
}))

const uploads = Layer.mergeAll(
  HttpRouter.add("*", "/api/projects/:id/uploads", startUpload("uploads", "source")),
  HttpRouter.add("*", "/api/projects/:id/attachments", startUpload("attachments", "attached")),
  HttpRouter.add("*", "/api/projects/:id/attachments/:upload", resumeUpload),
  HttpRouter.add("GET", "/api/projects/:id/attachments/:name/cover", reply(Effect.gen(function*() {
    const attachments = yield* Attachments
    const target = yield* attachments.cover(yield* param("id"), yield* param("name"))
    return yield* HttpServerResponse.file(target, { contentType: "image/jpeg", headers: { "cache-control": "no-store" } }).pipe(
      Effect.mapError(() => new ApiError({ status: 500, message: "Файл недоступен. Попробуйте открыть страницу ещё раз." }))
    )
  }))),
  HttpRouter.add("*", "/api/projects/:id/uploads/:upload", resumeUpload)
)

const UNREADABLE = new ApiError({ status: 500, message: "Видео недоступно. Попробуйте открыть страницу ещё раз." })

const sendFile = Effect.fnUntraced(function*(target: string, contentType: string, rangeHeader: string | undefined, extra: Readonly<Record<string, string>> = {}) {
  const fs = yield* FileSystem.FileSystem
  const size = Number((yield* fs.stat(target)).size)
  const range = parseRange(rangeHeader, size)
  const headers = { "accept-ranges": "bytes", "cache-control": "no-store", ...extra }
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

// The ASCII name serves a browser that ignores filename*, which alone carries the Russian title.
export const attachment = (title: string): string => {
  const name = `${title.trim() || "reel"}.mp4`
  return `attachment; filename="reel.mp4"; filename*=UTF-8''${encodeURIComponent(name)}`
}

const reel = Layer.mergeAll(
  HttpRouter.add("GET", "/api/projects/:id/reel", reply(Effect.gen(function*() {
    const media = yield* Media
    return json(yield* media.reel(yield* param("id")))
  }))),
  HttpRouter.add("POST", "/api/projects/:id/reel", reply(Effect.gen(function*() {
    const media = yield* Media
    return json(yield* media.buildReel(yield* param("id")), 202)
  }))),
  HttpRouter.add("DELETE", "/api/projects/:id/reel/build", reply(Effect.gen(function*() {
    const media = yield* Media
    return json(yield* media.cancelReel(yield* param("id")))
  }))),
  HttpRouter.add("GET", "/api/projects/:id/reel/file", (request) => reply(Effect.gen(function*() {
    const media = yield* Media
    const target = yield* media.reelFile(yield* param("id"), madeOf(request))
    return yield* sendFile(target, "video/mp4", request.headers["range"])
  }))),
  HttpRouter.add("GET", "/api/projects/:id/reel/download", (request) => reply(Effect.gen(function*() {
    const media = yield* Media
    const store = yield* Projects
    const id = yield* param("id")
    const target = yield* media.reelFile(id, madeOf(request))
    const { title } = yield* store.get(id)
    return yield* sendFile(target, "video/mp4", request.headers["range"], { "content-disposition": attachment(title) })
  })))
)

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
    const gather = yield* Gather
    const id = yield* param("id")
    const gathering = yield* gather.running(id)
    const view = yield* media.timeline(id)
    return json({ ...view, gathering, gatherFailed: yield* gather.failed(id) } satisfies TimelinePage)
  }))),
  HttpRouter.add("PUT", "/api/projects/:id/timeline", reply(Effect.gen(function*() {
    const media = yield* Media
    const id = yield* param("id")
    const input = yield* body(SaveEdits)
    return json(yield* media.mergeEdits(id, input.base, input.edits))
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

export const apiRoutes = Layer.mergeAll(projects, brief, chat, uploads, videos, reel, homeOnly)
