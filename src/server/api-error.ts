import { Effect, Schema } from "effect"

export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  status: Schema.Finite,
  message: Schema.String
}) {}

export const notFound = (message: string): ApiError => new ApiError({ status: 404, message })

export const orUnavailable = (label: string, message: string) =>
<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, ApiError, R> =>
  effect.pipe(
    Effect.tapError((cause) => cause instanceof ApiError ? Effect.void : Effect.logError(label, cause)),
    Effect.mapError((cause) => cause instanceof ApiError ? cause : new ApiError({ status: 500, message }))
  )

export const badRequest = (message: string): ApiError => new ApiError({ status: 400, message })
