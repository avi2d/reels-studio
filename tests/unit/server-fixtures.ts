import { Effect } from "effect"
import { Media } from "../../src/server/media.ts"
import { Projects } from "../../src/server/projects.ts"
import type { VideoView } from "../../src/shared/plan.ts"
import { NO_EDITS, type Edits, type TimelineView } from "../../src/shared/timeline.ts"

const unavailable = () => Effect.die("unexpected service call")

export const projectAt = (dir: string): ReturnType<typeof Projects.of> => Projects.of({
  folder: () => Effect.succeed(dir), list: Effect.succeed([]), create: unavailable,
  get: unavailable, rename: unavailable, setChoice: unavailable, remove: unavailable
})

export const mediaWith = (videos: () => ReadonlyArray<VideoView>, timeline: TimelineView): { readonly service: ReturnType<typeof Media.of>, readonly edits: () => Edits } => {
  let edits: Edits = NO_EDITS
  const service = Media.of({
    videos: () => Effect.sync(videos),
    timeline: () => Effect.succeed(timeline),
    exchangeEdits: (_id, compute) => Effect.sync(() => {
      const result = compute(edits)
      edits = result.edits
      return result.value
    }),
    preview: unavailable, retry: unavailable, library: unavailable, reuse: unavailable,
    uploaded: Effect.die("unexpected service call"), retryUploaded: unavailable,
    uploadedPreview: unavailable, removeUploaded: unavailable, mergeEdits: unavailable,
    reel: unavailable, buildReel: unavailable, cancelReel: unavailable, reelFile: unavailable,
    trial: unavailable, startTrial: unavailable, trialFile: unavailable, setFace: unavailable,
    reelPicture: unavailable, reelFrame: unavailable, sound: unavailable,
    withoutWork: (_dir, use) => use
  })
  return { service, edits: (): Edits => edits }
}
