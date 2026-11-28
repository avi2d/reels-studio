import assert from "node:assert/strict"

export const SOURCE_VIDEO = "source.mp4"
export const CHAT_PICTURE = "cover.png"
export const CHAT_REPLY = "Картинка дошла до чата."
export const SLOW_MESSAGE = "Напишите длинный ответ."
export const FIRST_WORDS = "Вот начало ответа."
export const PLAN_TASK = "Объясните, как вернуть покупку без чека."
export const TASK_FILE = "receipt.png"
export const TASK_APPS = "Instagram, TikTok"
export const PLAN_TEXT = "Начать с вопроса, затем назвать два шага для возврата."
export const timeout = 20_000

export const setting = (name: "REELS_BROWSER_DIR" | "REELS_BROWSER_URL"): string => {
  const value = process.env[name]
  assert(value !== undefined, `The browser runner must set ${name}`)
  return value
}

export const address = (path: string): string => new URL(path, setting("REELS_BROWSER_URL")).href
