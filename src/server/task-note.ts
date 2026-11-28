import type { BriefView } from "../shared/brief.ts"

const briefNote = (brief: string): string => brief === ""
  ? "\nThe person has not written a brief yet. The page holds it in the field «Задание» of the step «План».\n"
  : `\nThe brief the person wrote in the field «Задание», also kept in brief.md:\n${brief}`

const filesNote = (files: ReadonlyArray<string>): string => files.length === 0
  ? "The person attached no files to the task.\n"
  : `The files the person attached to the task, each described with the attached files below:\n${files.map((name) => `- attached/${name}`).join("\n")}\n`

export const taskNote = (view: Pick<BriefView, "brief" | "apps" | "files">): string =>
  `${briefNote(view.brief)}\nThe apps the person chose for this reel: ${view.apps.join(", ")}.\n${filesNote(view.files)}`
