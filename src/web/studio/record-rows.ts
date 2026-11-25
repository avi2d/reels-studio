import { type LibraryVideo, type Offer, pickOf, type UploadedVideo } from "../../shared/library.ts"
import type { Transcript, VideoView } from "../../shared/plan.ts"
import * as Api from "../api.ts"
import type { Take } from "./takes.ts"
import type { Sending } from "./uploads.ts"

export interface Shelves {
  readonly reel: ReadonlyArray<VideoView>
  readonly offer: Offer
  readonly project: Api.ProjectView
}

export type Action =
  | { readonly kind: "retry"; readonly run: () => void }
  | { readonly kind: "drop"; readonly run: () => void }
  | { readonly kind: "add"; readonly run: () => void }
  | { readonly kind: "remove"; readonly run: () => void }

export interface Row {
  readonly key: string
  readonly name: string
  readonly take: Take
  readonly preview: string | undefined
  readonly note: string | undefined
  readonly transcript: Transcript | undefined
  readonly actions: ReadonlyArray<Action>
}

const plain = { preview: undefined, note: undefined, transcript: undefined } as const

const reelRow = (id: string, video: VideoView, retry: (name: string) => void): Row => {
  if (video.state === "ready") {
    return {
      key: `reel:${video.name}`,
      name: video.name,
      take: { kind: "ready", duration: video.transcript.duration },
      preview: Api.previewUrl(id, video.name),
      note: undefined,
      transcript: video.transcript,
      actions: []
    }
  }
  const failed = video.state === "failed"
  return {
    ...plain,
    key: `reel:${video.name}`,
    name: video.name,
    take: { kind: failed ? "unheard" : "listening" },
    actions: failed ? [{ kind: "retry", run: () => { retry(video.name) } }] : []
  }
}

export const mineRows = (id: string, shelves: Shelves, retry: (name: string) => void): ReadonlyArray<Row> =>
  shelves.reel.map((video) => reelRow(id, video, retry))

export const earlierRows = (shelves: Shelves, adding: ReadonlySet<string>, add: (key: string, video: LibraryVideo) => void): ReadonlyArray<Row> =>
  shelves.offer.videos.map((video) => {
    const key = `pick:${JSON.stringify(pickOf(video))}`
    const busy = adding.has(key)
    return {
      key,
      name: video.name,
      take: busy ? { kind: "adding" } : { kind: "ready", duration: video.duration },
      preview: video.from === "library" ? Api.uploadedPreviewUrl(video.name) : Api.previewUrl(video.project, video.name),
      note: video.from === "reel" ? `Из ролика «${video.titles.join("», «")}»` : undefined,
      transcript: undefined,
      actions: busy ? [] : [{ kind: "add", run: () => { add(key, video) } }]
    }
  })

export const heardLengths = (shelves: Shelves): ReadonlyArray<number> =>
  shelves.reel.flatMap((video) => video.state === "ready" ? [video.transcript.duration] : [])

export const stillHearing = (shelves: Shelves): boolean =>
  shelves.offer.listening > 0 || shelves.reel.some((video) => video.state === "waiting")

export interface UploadHandlers {
  readonly resend: (key: string) => void
  readonly drop: (key: string) => void
  readonly retry: (name: string) => void
  readonly remove: (name: string) => void
}

const sendingRow = (entry: Sending, act: UploadHandlers): Row => ({
  ...plain,
  key: `send:${entry.key}`,
  name: entry.file.name,
  take: entry.take,
  actions: entry.take.kind === "unsent"
    ? [{ kind: "retry", run: () => { act.resend(entry.key) } }, { kind: "drop", run: () => { act.drop(entry.key) } }]
    : []
})

const uploadedTake = (video: UploadedVideo): Take => {
  switch (video.state) {
    case "ready": return { kind: "ready", duration: video.duration }
    case "failed": return { kind: "unheard" }
    case "waiting": return { kind: "listening" }
  }
}

const uploadedRow = (video: UploadedVideo, act: UploadHandlers): Row => ({
  ...plain,
  key: `lib:${video.name}`,
  name: video.name,
  take: uploadedTake(video),
  preview: video.state === "ready" ? Api.uploadedPreviewUrl(video.name) : undefined,
  actions: [
    ...video.state === "failed" ? [{ kind: "retry", run: () => { act.retry(video.name) } } satisfies Action] : [],
    { kind: "remove", run: () => { act.remove(video.name) } }
  ]
})

export const uploadRows = (sending: ReadonlyArray<Sending>, uploaded: ReadonlyArray<UploadedVideo>, act: UploadHandlers): ReadonlyArray<Row> => [
  ...sending.map((entry) => sendingRow(entry, act)),
  ...uploaded.map((video) => uploadedRow(video, act))
]

export const stillUploading = (uploaded: ReadonlyArray<UploadedVideo>): boolean => uploaded.some((video) => video.state === "waiting")
