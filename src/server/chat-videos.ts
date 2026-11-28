import type { VideoView } from "../shared/plan.ts"
import type { TimelineView } from "../shared/timeline.ts"

const videoLine = (video: VideoView): string =>
  video.state === "ready" && video.plan === "unreadable"
    ? `- source/${video.name}: heard, its words are in transcripts/${video.name}.txt, but plan.json is not valid and must be rewritten in the format the skill gives`
    : video.state === "ready"
    ? `- source/${video.name}: heard, its words are in transcripts/${video.name}.txt`
    : video.state === "failed"
      ? `- source/${video.name}: the studio could not hear it; the person can press «Ещё раз» next to the video on the step «Записи» to have the studio listen to it again`
      : `- source/${video.name}: the studio is still listening to it, no transcript yet`

const LOOK_NOTES = {
  measured: (name: string) => `  Where the speaker looks during each stretch of it is in gaze/${name}.txt.`,
  waiting: () => "  The studio is still measuring where the speaker looks in it, so rank its takes by speech alone and say so.",
  failed: () => "  The studio could not measure where the speaker looks in it, so rank its takes by speech alone and say so."
}

const blocksLine = (timeline: TimelineView["timeline"]): ReadonlyArray<string> => {
  if (timeline.state === "unreadable") return ["blocks.json is not valid and must be rewritten in the format the skill gives."]
  if (timeline.state === "ready" && timeline.dropped > 0) {
    return [`blocks.json names ${timeline.dropped} take(s) with a video or word numbers that do not exist, and the page leaves them out.`]
  }
  return []
}

const insertsLine = (inserts: TimelineView["inserts"]): ReadonlyArray<string> => {
  if (inserts.state === "unreadable") return ["inserts.json is not valid and must be rewritten in the format the reels-inserts skill gives."]
  if (inserts.state === "ready" && inserts.dropped > 0) {
    return [`inserts.json names ${inserts.dropped} insert(s) with a repeated id, a missing picture, clip or document, a quote that is not on its page, a video or word numbers that do not exist, and the page leaves them out.`]
  }
  return []
}

const doubtsLine = (doubts: TimelineView["doubts"]): ReadonlyArray<string> => {
  if (doubts.state === "unreadable") return ["doubts.json is not valid and must be rewritten in the format the reels-plan skill gives."]
  if (doubts.state === "ready" && doubts.dropped > 0) {
    return [`doubts.json names ${doubts.dropped} word(s) that do not exist or are not marked unsure, or a fix that is empty or the same as the heard word, and the page leaves them out.`]
  }
  return []
}

export const videoLines = (videos: ReadonlyArray<VideoView>, view: Pick<TimelineView, "looks" | "timeline" | "inserts" | "doubts">): string => {
  if (videos.length === 0) return "No video is uploaded yet."
  const lines = videos.flatMap((video) => {
    const look = view.looks.find((one) => one.video === video.name)
    return look === undefined ? [videoLine(video)] : [videoLine(video), LOOK_NOTES[look.state](video.name)]
  })
  return [...lines, ...blocksLine(view.timeline), ...insertsLine(view.inserts), ...doubtsLine(view.doubts)].join("\n")
}
