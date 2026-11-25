import { formatLength } from "../format.ts"

export type Take =
  | { readonly kind: "queued" }
  | { readonly kind: "sending"; readonly sent: number; readonly total: number }
  | { readonly kind: "offline" }
  | { readonly kind: "unsent"; readonly message: string }
  | { readonly kind: "listening" }
  | { readonly kind: "unheard" }
  | { readonly kind: "adding" }
  | { readonly kind: "ready"; readonly duration: number }

export const percentOf = (sent: number, total: number): number => total <= 0 ? 0 : Math.floor((sent / total) * 100)

export const statusOf = (take: Take): string => {
  switch (take.kind) {
    case "queued": return "Жду очереди"
    case "sending": return `Загружаю ${percentOf(take.sent, take.total)}%`
    case "offline": return "Нет связи. Продолжу сама"
    case "unsent": return take.message
    case "listening": return "Слушаю"
    case "unheard": return "Не расслышала"
    case "adding": return "Добавляю в ролик"
    case "ready": return `Готово · ${formatLength(take.duration)}`
  }
}

const RECORD_FORMS: Record<Intl.LDMLPluralRule, string> = {
  zero: "записей",
  one: "запись",
  two: "записи",
  few: "записи",
  many: "записей",
  other: "записи"
}
const russianPlural = new Intl.PluralRules("ru-RU")

export const recordCount = (count: number): string => `${count} ${RECORD_FORMS[russianPlural.select(count)]}`
