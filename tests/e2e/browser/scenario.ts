import assert from "node:assert/strict"

export const SOURCE_VIDEO = "source.mp4"
export const CHAT_PICTURE = "cover.png"
export const CHAT_REPLY = "Картинка дошла до чата."
export const PLAN_TASK = "Объясните, как вернуть покупку без чека."
export const PLAN_TEXT = "Начать с вопроса, затем назвать два шага для возврата."
export const timeout = 20_000

export const setting = (name: "REELS_BROWSER_DIR" | "REELS_BROWSER_URL"): string => {
  const value = process.env[name]
  assert(value !== undefined, `The browser runner must set ${name}`)
  return value
}
