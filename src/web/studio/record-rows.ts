import { type LibraryVideo, pickOf, type UploadedVideo } from "../../shared/library.ts"
import type { Transcript, VideoView } from "../../shared/plan.ts"
import * as Api from "../api.ts"
import type { Take } from "./takes.ts"
import type { Sending } from "./uploads.ts"

export interface Shelves {
  readonly reel: ReadonlyArray<VideoView>
  readonly uploaded: ReadonlyArray<UploadedVideo>
  readonly offer: ReadonlyArray<LibraryVideo>
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

export interface Handlers {
  readonly retryReel: (name: string) => void
  readonly retryUploaded: (name: string) => void
  readonly resend: (key: string) => void
  readonly drop: (key: string) => void
  readonly add: (key: string, video: LibraryVideo) => void
  readonly remove: (name: string) => void
}

const plain = { preview: undefined, note: undefined, transcript: undefined } as const

const uploadedTake = (video: UploadedVideo | undefined): Take => {
  if (video?.state === "ready") return { kind: "ready", duration: video.duration }
  return { kind: video?.state === "failed" ? "unheard" : "listening" }
}

const reelRow = (id: string, video: VideoView, act: Handlers): Row => {
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
    actions: failed ? [{ kind: "retry", run: () => { act.retryReel(video.name) } }] : []
  }
}

// A heard recording still waits for the reel to take it, so it reads as being added rather than ready.
const joiningRow = (name: string, uploaded: ReadonlyArray<UploadedVideo>, act: Handlers): Row => {
  const take = uploadedTake(uploaded.find((video) => video.name === name))
  return {
    ...plain,
    key: `join:${name}`,
    name,
    take: take.kind === "ready" ? { kind: "adding" } : take,
    actions: take.kind === "unheard" ? [{ kind: "retry", run: () => { act.retryUploaded(name) } }] : []
  }
}

const sendingRow = (entry: Sending, act: Handlers): Row => ({
  ...plain,
  key: `send:${entry.key}`,
  name: entry.file.name,
  take: entry.take,
  actions: entry.take.kind === "unsent"
    ? [{ kind: "retry", run: () => { act.resend(entry.key) } }, { kind: "drop", run: () => { act.drop(entry.key) } }]
    : []
})

export const mineRows = (id: string, shelves: Shelves, joining: ReadonlyArray<string>, sending: ReadonlyArray<Sending>, act: Handlers): ReadonlyArray<Row> => [
  ...shelves.reel.map((video) => reelRow(id, video, act)),
  ...joining.map((name) => joiningRow(name, shelves.uploaded, act)),
  ...sending.map((entry) => sendingRow(entry, act))
]

const earlierRow = (video: LibraryVideo, adding: ReadonlySet<string>, act: Handlers): Row => {
  const key = `pick:${JSON.stringify(pickOf(video))}`
  const busy = adding.has(key)
  const remove: ReadonlyArray<Action> = video.from === "library" ? [{ kind: "remove", run: () => { act.remove(video.name) } }] : []
  return {
    key,
    name: video.name,
    take: busy ? { kind: "adding" } : { kind: "ready", duration: video.duration },
    preview: video.from === "library" ? Api.uploadedPreviewUrl(video.name) : Api.previewUrl(video.project, video.name),
    note: video.from === "reel" ? `Из ролика «${video.titles.join("», «")}»` : undefined,
    transcript: undefined,
    actions: busy ? [] : [{ kind: "add", run: () => { act.add(key, video) } }, ...remove]
  }
}

const unheardRow = (video: UploadedVideo, act: Handlers): Row => ({
  ...plain,
  key: `lib:${video.name}`,
  name: video.name,
  take: uploadedTake(video),
  actions: [
    ...video.state === "failed" ? [{ kind: "retry", run: () => { act.retryUploaded(video.name) } } satisfies Action] : [],
    { kind: "remove", run: () => { act.remove(video.name) } }
  ]
})

export const earlierRows = (shelves: Shelves, joining: ReadonlyArray<string>, adding: ReadonlySet<string>, act: Handlers): ReadonlyArray<Row> => [
  ...shelves.offer.filter((video) => video.from === "reel" || !joining.includes(video.name)).map((video) => earlierRow(video, adding, act)),
  ...shelves.uploaded.filter((video) => video.state !== "ready" && !joining.includes(video.name)).map((video) => unheardRow(video, act))
]

export const heardLengths = (shelves: Shelves): ReadonlyArray<number> =>
  shelves.reel.flatMap((video) => video.state === "ready" ? [video.transcript.duration] : [])

export const stillHearing = (shelves: Shelves): boolean =>
  shelves.reel.some((video) => video.state === "waiting") || shelves.uploaded.some((video) => video.state === "waiting")
