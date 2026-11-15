import { Effect, Layer, Option, Schema, Stream } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { ApiError, badRequest } from "./api-error.ts"
import { Chat } from "./chat.ts"
import { isHomeAddress, isSameOrigin } from "./home-network.ts"
import { Projects } from "./projects.ts"
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
  })))
)

const NewMessage = Schema.Struct({ text: Schema.String, model: Schema.String })

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
    const events = yield* talk.send(yield* param("id"), input.text, input.model)
    const lines = events.pipe(
      Stream.catch((error) => Stream.make({ type: "error" as const, message: error.message })),
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
    if (request.method === "OPTIONS") return Tus.options
    if (request.method === "POST") return yield* Tus.create(request, dir, `/api/projects/${id}/uploads`)
    return yield* new ApiError({ status: 405, message: "Так загрузку не начать" })
  }))),
  HttpRouter.add("*", "/api/projects/:id/uploads/:upload", (request) => reply(Effect.gen(function*() {
    const store = yield* Projects
    const dir = yield* store.folder(yield* param("id"))
    const upload = yield* param("upload")
    if (request.method === "OPTIONS") return Tus.options
    if (request.method === "HEAD") return yield* Tus.head(request, dir, upload)
    if (request.method === "PATCH") return yield* Tus.patch(request, dir, upload)
    return yield* new ApiError({ status: 405, message: "Так загрузку не продолжить" })
  })))
)

const refuse = (message: string) => HttpServerResponse.jsonUnsafe({ error: message }, { status: 403 })

const homeOnly = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function*() {
      const request = yield* HttpServerRequest.HttpServerRequest
      const remote = Option.getOrUndefined(request.remoteAddress)
      if (remote !== undefined && !isHomeAddress(remote)) {
        return refuse("Студия открывается только из домашней сети")
      }
      if (!isSameOrigin(request.headers["origin"], request.headers["host"])) {
        return refuse("Запрос пришёл с чужой страницы")
      }
      return yield* httpEffect
    }),
  { global: true }
)

export const apiRoutes = Layer.mergeAll(projects, chat, uploads, homeOnly)
