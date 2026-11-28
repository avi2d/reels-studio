import { Effect } from "effect"
import type { Transcript } from "../shared/plan.ts"
import type { Edits, TimelinePage } from "../shared/timeline.ts"
import * as Api from "./api.ts"
import { POLL_MS, takeServer, type Ticket } from "./timeline-save.ts"

export interface Loaded {
  readonly transcripts: ReadonlyMap<string, Transcript>
  readonly view: TimelinePage
}

export interface Adopting {
  loaded: Loaded | undefined
  edits: Edits
  acked: Edits
  changes: number
  drawn: string
}

export const adoptLoaded = (state: Adopting, loaded: Loaded, ticket: Ticket, busy: boolean): boolean => {
  const { timeline } = loaded.view
  if (timeline.state === "ready" && takeServer(state.edits, state.acked, timeline.edits, ticket, state.changes, busy)) {
    state.edits = timeline.edits
    state.acked = timeline.edits
  }
  state.loaded = loaded
  const drawn = JSON.stringify([loaded.view, [...loaded.transcripts.keys()], state.edits])
  if (drawn === state.drawn) return false
  state.drawn = drawn
  return true
}

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
