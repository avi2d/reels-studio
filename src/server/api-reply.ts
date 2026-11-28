import { Effect, type Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { type ApiError, badRequest } from "./api-error.ts"

export const reply = <R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, ApiError, R>
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.catchTag("ApiError", (error) =>
      Effect.succeed(HttpServerResponse.jsonUnsafe({ error: error.message }, { status: error.status })))
  )

export const json = (body: unknown, status = 200): HttpServerResponse.HttpServerResponse => HttpServerResponse.jsonUnsafe(body, { status })

export const param = (name: string): Effect.Effect<string, never, HttpRouter.RouteContext> =>
  Effect.map(HttpRouter.params, (params) => params[name] ?? "")

export const body = <A>(schema: Schema.ConstraintDecoder<A>): Effect.Effect<A, ApiError, HttpServerRequest.HttpServerRequest> =>
  HttpServerRequest.schemaBodyJson(schema).pipe(Effect.mapError(() => badRequest("Запрос не разобран")))
