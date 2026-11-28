import { Schema } from "effect"

export const Face = Schema.Literals(["off", "light"])
export type Face = typeof Face.Type

export const NoFace = Schema.Literals(["short-cut", "unseen"])
export type NoFace = typeof NoFace.Type
