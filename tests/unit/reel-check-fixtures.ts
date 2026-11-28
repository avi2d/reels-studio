import type { ReelChecks } from "../../src/shared/reel-checks.ts"

export const PASSING = {
  texts: { id: "texts", state: "inside", apps: ["Instagram"] },
  places: { id: "places", open: 0 },
  length: { id: "length", seconds: 7 },
  loudness: { id: "loudness", state: "heard", level: "good" }
} satisfies ReelChecks
