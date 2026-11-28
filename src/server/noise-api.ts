import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { Cleaned, Noise } from "../shared/noise.ts"
import { notFound } from "./api-error.ts"
import { body, json, param, reply } from "./api-reply.ts"
import { Media } from "./media.ts"
import { sendFile } from "./send-file.ts"

const NewNoise = Schema.Struct({ noise: Noise })

export const noiseRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/api/projects/:id/noise", reply(Effect.gen(function*() {
    const media = yield* Media
    return json(yield* media.noise(yield* param("id")))
  }))),
  HttpRouter.add("POST", "/api/projects/:id/noise", reply(Effect.gen(function*() {
    const media = yield* Media
    return json(yield* media.startCleaning(yield* param("id")), 202)
  }))),
  HttpRouter.add("PUT", "/api/projects/:id/noise/choice", reply(Effect.gen(function*() {
    const media = yield* Media
    const id = yield* param("id")
    return json(yield* media.setNoise(id, (yield* body(NewNoise)).noise))
  }))),
  HttpRouter.add("GET", "/api/projects/:id/noise/:noise/:name", (request) => reply(Effect.gen(function*() {
    const media = yield* Media
    const strength = yield* Schema.decodeUnknownEffect(Cleaned)(yield* param("noise")).pipe(Effect.mapError(() => notFound("Такой очистки звука нет")))
    const id = yield* param("id")
    const name = yield* param("name")
    const target = yield* media.cleanedFile(id, strength, name).pipe(
      Effect.catchTag("ApiError", (error) => error.status === 404 ? Effect.void : Effect.fail(error))
    )
    if (target === undefined) {
      yield* media.preview(id, name)
      return HttpServerResponse.empty({ status: 307, headers: {
        location: `/api/projects/${encodeURIComponent(id)}/videos/${encodeURIComponent(name)}/preview`,
        "cache-control": "no-store"
      } })
    }
    return yield* sendFile(target, "video/mp4", request.headers["range"])
  })))
)
