import { Schema } from "effect"

export const Face = Schema.Literals(["off", "light"])
export type Face = typeof Face.Type
