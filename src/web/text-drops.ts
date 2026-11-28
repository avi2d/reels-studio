import type { TextPlace } from "../shared/captions.ts"
import { TITLE } from "../shared/text-names.ts"

export type DroppedText = Extract<TextPlace, { readonly state: "dropped" }>

export const whyDropped = (place: DroppedText, nameOf: (id: string) => string): string => {
  switch (place.reason) {
    case "unknown-video": return `Видео «${place.planned.video}» нет в проекте, поэтому студия не знает, где показать мысль.`
    case "out-of-range": return `В тексте видео «${place.planned.video}» нет слов, к которым привязана мысль, поэтому студия не знает, где её показать.`
    case "cut": return "Этой фразы сейчас нет в ролике, поэтому мысль в ролик не встанет."
    case "empty": return "У мысли нет ни одной строки текста, поэтому показывать нечего."
    case "removed": return nameOf(place.planned.id) === TITLE ? "Вы убрали его из ролика." : "Вы убрали её из ролика."
    case "covered": return `${nameOf(place.by.id)} займёт экран на всё время этой фразы, поэтому эта мысль в ролик не встанет.`
  }
}
