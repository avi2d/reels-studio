import { Schema } from "effect"

export const Gathered = Schema.Struct({ videos: Schema.Array(Schema.String) })
export type Gathered = typeof Gathered.Type

export type GatherStep =
  | { readonly kind: "wait" }
  | { readonly kind: "seed"; readonly videos: ReadonlyArray<string> }
  | { readonly kind: "gather"; readonly videos: ReadonlyArray<string> }

const sameNames = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  left.length === right.length && left.every((name) => right.includes(name))

export const gatherStep = (
  heard: ReadonlyArray<string>,
  listening: boolean,
  gathered: Gathered | undefined,
  hasBlocks: boolean
): GatherStep => {
  if (listening || heard.length === 0) return { kind: "wait" }
  if (gathered === undefined) return hasBlocks ? { kind: "seed", videos: heard } : { kind: "gather", videos: heard }
  return sameNames(gathered.videos, heard) ? { kind: "wait" } : { kind: "gather", videos: heard }
}
