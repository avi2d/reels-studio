import { Effect } from "effect"
import * as Api from "./api.ts"
import type { Loaded } from "./timeline-draw.ts"
import { POLL_MS, type Ticket } from "./timeline-save.ts"

export const loader = (projectId: string, anchor: { readonly isConnected: boolean }, show: (loaded: Loaded, ticket: Ticket) => void, stamp: () => Ticket): () => void => {
  const state = { timer: 0 }
  const later = (): void => {
    globalThis.clearTimeout(state.timer)
    state.timer = Number(globalThis.setTimeout(refresh, POLL_MS))
  }
  function refresh(): void {
    globalThis.clearTimeout(state.timer)
    if (!anchor.isConnected) return
    const ticket = stamp()
    Effect.runFork(Effect.all([Api.getVideos(projectId), Api.getTimeline(projectId)], { concurrency: 2 }).pipe(
      Effect.map(([{ videos }, view]) => {
        const heard = videos.flatMap((video) => video.state === "ready" ? [[video.name, video.transcript] as const] : [])
        show({ transcripts: new Map(heard), view }, ticket)
        if (view.gathering || videos.some((video) => video.state === "waiting") || view.looks.some((look) => look.state === "waiting")) later()
      }),
      Effect.catchTag("Failed", () => Effect.sync(later))
    ))
  }
  return refresh
}
