import { Schema } from "effect"

export const Doubt = Schema.Struct({ video: Schema.String, index: Schema.Int, fix: Schema.String, reason: Schema.String })
export type Doubt = typeof Doubt.Type

export const DoubtsFile = Schema.Struct({ doubts: Schema.Array(Doubt) })

export const PlannedDoubts = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["none", "unreadable"]) }),
  Schema.Struct({ state: Schema.Literal("ready"), planned: Schema.Array(Doubt), dropped: Schema.Int })
])
export type PlannedDoubts = typeof PlannedDoubts.Type
