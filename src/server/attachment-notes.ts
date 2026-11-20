import type { FileKind } from "../shared/chat.ts"
import type { Transcript } from "../shared/plan.ts"
import { TO_SDR } from "./media-commands.ts"

export const SHOWN_PAGES = 4

const LONGEST_SIDE = 1568
const FIT = `scale='min(${LONGEST_SIDE},iw)':'min(${LONGEST_SIDE},ih)':force_original_aspect_ratio=decrease`
const QUIET = ["-hide_banner", "-loglevel", "error", "-y"]

export const fileProbeArgs = (file: string): ReadonlyArray<string> =>
  ["-v", "error", "-show_entries", "stream=codec_type,width,height,color_transfer:format=duration", "-of", "json", file]

export const pictureArgs = (source: string, target: string): ReadonlyArray<string> =>
  [...QUIET, "-i", source, "-frames:v", "1", "-vf", FIT, "-q:v", "3", target]

export const frameArgs = (source: string, at: number, hdr: boolean, target: string): ReadonlyArray<string> =>
  [...QUIET, "-ss", at.toFixed(2), "-i", source, "-frames:v", "1", "-vf", hdr ? `${TO_SDR},${FIT}` : FIT, "-q:v", "3", target]

export const soundArgs = (source: string, wav: string): ReadonlyArray<string> =>
  [...QUIET, "-i", source, "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", wav]

export const frameTimes = (duration: number | undefined): ReadonlyArray<number> =>
  duration === undefined || !(duration > 0) ? [0] : [0.1, 0.5, 0.9].map((share) => share * duration)

const clock = (seconds: number): string => {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

export const speechText = (transcript: Transcript): string | undefined =>
  transcript.words.length === 0 ? undefined : transcript.words.map((word) => word.text).join(" ") + "\n"

export const pagesText = (texts: ReadonlyArray<string>): string =>
  texts.map((text, index) => `Page ${index + 1}:\n${text === "" ? "(no text)" : text}`).join("\n\n") + "\n"

export type Speech =
  | { readonly heard: "words"; readonly file: string }
  | { readonly heard: "silent" }
  | { readonly heard: "no-sound" }
  | { readonly heard: "unheard" }

const SPEECH_NOTES = {
  silent: "No speech is heard in it.",
  "no-sound": "It has no sound.",
  unheard: "The studio could not hear its sound."
}

const speechNote = (speech: Speech): string =>
  speech.heard === "words" ? `What is said in it is in ${speech.file}.` : SPEECH_NOTES[speech.heard]

const shownPages = (shown: number): string =>
  shown === 0 ? "No page is shown to you." : shown === 1 ? "Its first page is shown to you as an image." : `Its first ${shown} pages are shown to you as images.`

export const about = {
  picture: (width: number | undefined, height: number | undefined): string =>
    width === undefined || height === undefined
      ? "A picture, shown to you as an image."
      : `A picture of ${width}×${height} pixels, shown to you as an image.`,
  document: (pages: number, shown: number, textFile: string | undefined): string =>
    [
      `A PDF document of ${pages} ${pages === 1 ? "page" : "pages"}.`,
      textFile === undefined ? "It holds no text layer, so it is likely a scan: read it from the page images." : `Its text is in ${textFile}.`,
      shownPages(shown)
    ].join(" "),
  video: (duration: number | undefined, times: ReadonlyArray<number>, speech: Speech): string =>
    [
      duration === undefined ? "A video." : `A video of ${clock(duration)}.`,
      `Frames at ${times.map(clock).join(", ")} are shown to you as images.`,
      speechNote(speech)
    ].join(" "),
  sound: (duration: number | undefined, speech: Speech): string =>
    [duration === undefined ? "A sound recording." : `A sound recording of ${clock(duration)}.`, speechNote(speech)].join(" "),
  other: (): string => "A file of a kind the studio cannot open, so only its name is known.",
  failed: (kind: FileKind): string => `The studio could not open this file, though its name says it is a ${KIND_NAMES[kind]}. Tell the person so.`
}

const KIND_NAMES: Readonly<Record<FileKind, string>> = {
  picture: "picture",
  document: "PDF document",
  video: "video",
  sound: "sound recording",
  other: "file"
}

export interface Seen {
  readonly name: string
  readonly about: string
}

export const attachedLines = (files: ReadonlyArray<Seen>): string =>
  files.map((file) => `- attached/${file.name}: ${file.about}`).join("\n")

export const promptText = (text: string, files: ReadonlyArray<Seen>): string => {
  if (files.length === 0) return text
  const words = text === "" ? "The person sent these files without words." : text
  return `${words}\n\nThe person attached to this message:\n${attachedLines(files)}`
}
