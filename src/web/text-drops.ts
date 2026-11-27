import type { TextPlace } from "../shared/captions.ts"
import type { PlannedText } from "../shared/texts.ts"

export type DroppedText = Extract<TextPlace, { readonly state: "dropped" }>

export const whyDropped = (place: DroppedText, numberOf: (planned: PlannedText) => number): string => {
  switch (place.reason) {
    case "unknown-video": return `Видео «${place.planned.video}» нет в проекте, поэтому студия не знает, где показать мысль.`
    case "out-of-range": return `В тексте видео «${place.planned.video}» нет слов, к которым привязана мысль, поэтому студия не знает, где её показать.`
    case "cut": return "Этой фразы сейчас нет в ролике, поэтому мысль в ролик не встанет."
    case "empty": return "У мысли нет ни одной строки текста, поэтому показывать нечего."
    case "covered": return `Мысль ${numberOf(place.by)} займёт экран на всё время этой фразы, поэтому эта мысль в ролик не встанет.`
  }
}
