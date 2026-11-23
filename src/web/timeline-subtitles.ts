import { bareWord, correctedWord, subtitleWords, type ShownWord } from "../shared/subtitles.ts"
import { shiftedBy, type Shown } from "../shared/inserts.ts"
import { lengthOf } from "../shared/plan.ts"
import type { Clip, Edits, Placed } from "../shared/timeline.ts"
import type { Montage } from "./montage.ts"
import type { Loaded } from "./timeline-draw.ts"
import type { EditableSubtitle } from "./timeline-row.ts"

export const playback = (
  state: { loaded: Loaded | undefined; edits: Edits; base: number | undefined; shown: ReadonlyArray<Shown>; overlay: ReadonlyArray<Shown>; words: ReadonlyArray<ShownWord> },
  reelNow: () => ReadonlyArray<Clip>, player: Montage
): { readonly hear: (clips: ReadonlyArray<Clip>, shown: ReadonlyArray<Shown>) => void; readonly watch: (from: string) => void } => ({
  hear: (clips: ReadonlyArray<Clip>, shown: ReadonlyArray<Shown>): void => {
    state.base = undefined
    state.overlay = shown
    state.words = wordsFor(state.loaded, state.edits, clips)
    player.play(clips)
  },
  watch: (from: string): void => {
    const clips = reelNow()
    const first = clips.findIndex((clip) => clip.block === from)
    const cut = first === -1 ? [] : clips.slice(first)
    state.base = lengthOf(clips) - lengthOf(cut)
    state.overlay = shiftedBy(state.shown, state.base)
    state.words = wordsFor(state.loaded, state.edits, cut)
    player.play(cut)
  }
})

export const paintSubtitle = (node: HTMLElement, text: string): void => {
  if (node.textContent === text) return
  node.textContent = text
  node.style.fontSize = ""
  if (node.scrollWidth > node.clientWidth && node.clientWidth > 0) {
    const size = Number.parseFloat(getComputedStyle(node).fontSize)
    node.style.fontSize = `${size * node.clientWidth / node.scrollWidth}px`
  }
}

export const editableSubtitles = (loaded: Loaded | undefined, edits: Edits, one: Placed): ReadonlyArray<EditableSubtitle> => {
  if (loaded === undefined || loaded.view.timeline.state !== "ready") return []
  const transcript = loaded.transcripts.get(one.take.video)
  if (transcript === undefined) return []
  const blocks = loaded.view.timeline.blocks
  return transcript.words.flatMap((word, index) => {
    if (index < one.take.from || index > one.take.to || !one.spans.some((span) => word.end > span.start && word.start < span.end)) return []
    const text = correctedWord(blocks, loaded.transcripts, edits.subtitles ?? [], one.block.id, one.take.video, index)
    return bareWord(text) === "" ? [] : [{ index, text: bareWord(text) }]
  })
}

export const correctSubtitle = (edits: Edits, block: string, video: string, index: number, text: string): Edits => {
  const entries = (edits.subtitles ?? []).filter((one) => one.block !== block || one.video !== video || one.index !== index)
  return { ...edits, subtitles: [...entries, { block, video, index, text: text.trim() }] }
}

const wordsFor = (loaded: Loaded | undefined, edits: Edits, clips: ReadonlyArray<Clip>): ReadonlyArray<ShownWord> => {
  if (loaded === undefined || loaded.view.timeline.state !== "ready") return []
  const blocks = loaded.view.timeline.blocks
  return subtitleWords(clips, loaded.transcripts, (clip, index) =>
    correctedWord(blocks, loaded.transcripts, edits.subtitles ?? [], clip.block, clip.video, index))
}
