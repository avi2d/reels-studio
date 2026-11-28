import type { Face } from "../shared/face.ts"

export type VideoStep =
  | { readonly kind: "face"; readonly from: string; readonly to: string }
  | { readonly kind: "inserts"; readonly from: string; readonly to: string }

interface VideoChain {
  readonly levelled: string
  readonly steps: ReadonlyArray<VideoStep>
}

// Retouch must run before inserts so it cannot change attached pictures.
export const videoChain = (work: string, face: Face, inserts: boolean): VideoChain => {
  const reel = `${work}/reel.mp4`
  const retouched = `${work}/retouched.mp4`
  const levelled = face === "off" && !inserts ? reel : `${work}/levelled.mp4`
  const faceStep: ReadonlyArray<VideoStep> = face === "light" ? [{ kind: "face", from: levelled, to: inserts ? retouched : reel }] : []
  const insertStep: ReadonlyArray<VideoStep> = inserts ? [{ kind: "inserts", from: face === "light" ? retouched : levelled, to: reel }] : []
  return { levelled, steps: [...faceStep, ...insertStep] }
}
