import { Schema } from "effect"

export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  status: Schema.Finite,
  message: Schema.String
}) {}

export const notFound = (message: string): ApiError => new ApiError({ status: 404, message })
export const badRequest = (message: string): ApiError => new ApiError({ status: 400, message })
