import { Schema } from "effect"

export const Gathered = Schema.Struct({ videos: Schema.Array(Schema.String), gazed: Schema.optionalKey(Schema.Array(Schema.String)), failed: Schema.optionalKey(Schema.Boolean), hash: Schema.optionalKey(Schema.String) })
export type Gathered = typeof Gathered.Type

export type GatherStep =
  | { readonly kind: "wait" }
  | { readonly kind: "gather"; readonly videos: ReadonlyArray<string>; readonly settled: ReadonlyArray<string> }

const sameNames = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  left.length === right.length && left.every((name) => right.includes(name))

export const gatherStep = (
  heard: ReadonlyArray<string>,
  settled: ReadonlyArray<string>,
  listening: boolean,
  gathered: Gathered | undefined
): GatherStep => {
  if (listening || heard.length === 0) return { kind: "wait" }
  const now = settled.filter((name) => heard.includes(name))
  if (gathered === undefined) return { kind: "gather", videos: heard, settled: now }
  if (!sameNames(gathered.videos, heard)) return { kind: "gather", videos: heard, settled: now }
  const before = (gathered.gazed ?? []).filter((name) => heard.includes(name))
  if (sameNames(before, now)) return { kind: "wait" }
  if (now.length !== heard.length) return { kind: "wait" }
  return { kind: "gather", videos: heard, settled: now }
}

export const blocksHash = (content: string | undefined): string | undefined => {
  if (content === undefined) return undefined
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index++) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

export const failedShows = (gathered: Gathered | undefined, blocks: string | undefined): boolean =>
  gathered?.failed === true && blocksHash(blocks) === gathered.hash
