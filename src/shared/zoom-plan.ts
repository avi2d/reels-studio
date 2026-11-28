import { Schema } from "effect"

export const ZoomLevel = Schema.Literals(["off", "soft", "full"])
export type ZoomLevel = typeof ZoomLevel.Type

export const PlannedZoom = Schema.Struct({ id: Schema.String, video: Schema.String, from: Schema.Int, to: Schema.Int })
export type PlannedZoom = typeof PlannedZoom.Type

export const ZoomsFile = Schema.Struct({ zooms: Schema.Array(PlannedZoom) })

export const PlannedZooms = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["none", "unreadable"]) }),
  Schema.Struct({ state: Schema.Literal("ready"), planned: Schema.Array(PlannedZoom) })
])
export type PlannedZooms = typeof PlannedZooms.Type

export const ZoomAnswer = Schema.Struct({ id: Schema.String, level: ZoomLevel })
export type ZoomAnswer = typeof ZoomAnswer.Type

// A push-in on key words, with its times in seconds of the source and its centre in the frame the clip shows.
// The zoom grows from start to peak and is back to none at end.
export const Push = Schema.Struct({
  start: Schema.Finite,
  peak: Schema.Finite,
  end: Schema.Finite,
  scale: Schema.Finite.check(Schema.isGreaterThan(1)),
  x: Schema.Finite,
  y: Schema.Finite
})
export type Push = typeof Push.Type
