import type { App } from "../../shared/brief.ts"
import type { NoFace } from "../../shared/face.ts"
import type { ReelJob, ReelView } from "../../shared/reel.ts"
import { formatLength, formatSize } from "../format.ts"

export type File = NonNullable<ReelView["file"]>
export type Busy = { readonly state: "waiting" } | Extract<ReelJob, { readonly state: "running" }>
type Failure = Extract<ReelJob, { readonly state: "failed" }>

export type Phase =
  | { readonly kind: "empty" }
  | { readonly kind: "none"; readonly failed: Failure | undefined }
  | { readonly kind: "building"; readonly job: Busy; readonly kept: File | undefined }
  | { readonly kind: "built"; readonly file: File; readonly stale: boolean; readonly failed: Failure | undefined }

const busyOf = (job: ReelJob): Busy | undefined => {
  if (job.state === "running") return job
  return job.state === "waiting" ? { state: "waiting" } : undefined
}
const failureOf = (job: ReelJob): Failure | undefined => job.state === "failed" ? job : undefined

export const phaseOf = (view: ReelView): Phase => {
  const busy = busyOf(view.job)
  if (busy !== undefined) return { kind: "building", job: busy, kept: view.file }
  if (view.file !== undefined) return { kind: "built", file: view.file, stale: !view.file.fresh, failed: failureOf(view.job) }
  return view.cut === 0 ? { kind: "empty" } : { kind: "none", failed: failureOf(view.job) }
}

export const headingOf = (phase: Phase): string => {
  if (phase.kind === "building") return "Собираю ролики"
  if (phase.kind === "built") return phase.stale ? "Ролики устарели" : "Ролики готовы"
  return "Ролики"
}

export const progressOf = (job: Busy): { readonly text: string; readonly done: number | undefined } => {
  if (job.state === "waiting") return { text: "Ролик ждёт своей очереди: компьютер занят другой тяжёлой работой.", done: undefined }
  return job.done < 1 ? { text: `${Math.floor(job.done * 100)}%`, done: job.done } : { text: "Сохраняю файл", done: 1 }
}

const NO_FACE = {
  "short-cut": "Ролик не собрался: он слишком короткий, чтобы студия нашла лицо. На шаге «Оформление» выберите для лица «Как есть» и соберите ролик заново.",
  unseen: "Ролик не собрался: студия не нашла лицо. На шаге «Оформление» выберите для лица «Как есть» и соберите ролик заново."
} satisfies Record<NoFace, string>

export const failureText = (failure: Failure): string =>
  failure.noFace === undefined ? "Ролик не собрался. Подробности в журнале студии. Попробуйте собрать ролик ещё раз." : NO_FACE[failure.noFace]

const madeAt = (iso: string): string =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))

// The app chosen before stays chosen while its file exists; otherwise the first file is shown.
export const appOf = (file: File, chosen: App | undefined): App =>
  file.apps.find((one) => one.app === chosen)?.app ?? file.apps[0].app

const sizeOf = (file: File, app: App): number => file.apps.find((one) => one.app === app)?.size ?? file.apps[0].size

export const factsOf = (file: File, app: App): string => `${formatLength(file.seconds)} · ${formatSize(sizeOf(file, app))} · собран ${madeAt(file.made)}`

export const downloadLabel = (file: File, app: App): string => file.apps.length > 1 ? `Скачать для ${app}` : "Скачать"

export const saveHintOf = (app: App): string =>
  `На айфоне откройте скачанный файл и выберите «Сохранить видео»: ролик появится в «Фото», и ${app} его найдёт.`
