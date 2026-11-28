import { Schema } from "effect"

export const WebPage = Schema.Struct({
  file: Schema.String,
  address: Schema.String,
  licence: Schema.optionalKey(Schema.String),
  saved: Schema.String
})
export type WebPage = typeof WebPage.Type

export const WebPagesFile = Schema.Struct({ pages: Schema.Array(WebPage) })

export const PageSource = Schema.Struct({
  file: Schema.String,
  address: Schema.String,
  licence: Schema.optionalKey(Schema.String),
  articles: Schema.Array(Schema.String)
})
export type PageSource = typeof PageSource.Type

export const siteOf = (address: string): string => URL.canParse(address) ? new URL(address).hostname.replace(/^www\./u, "") : address

const HEADING = /(?:^|\n)[ \t]*Статья[ \t\u00a0]+(\d+(?:\.\d+)*)/gu

export const articlesOf = (text: string): ReadonlyArray<string> => [...new Set([...text.matchAll(HEADING)].map((match) => match[1] ?? ""))]

const ARTICLE_WORD = /^(?:стать(?:я|и|е|ю|ей|ёй|ям|ях|ями)|статей|ст)$/u
const PLURAL_ARTICLE_WORD = /^(?:стать(?:ям|ях|ями)|статей)$/u
const COUNT_UNIT = /^(?:лет|год(?:а|у|ом|е|ы|ов|ам|ами|ах)?|рубл(?:ь|я|ю|ём|ем|е|и|ей|ям|ями|ях)|раз(?:а|у|ом|е)?|д(?:ень|ня|ню|нём|нем|не|ни|ней|ням|нями|нях)|месяц(?:а|у|ем|е|ы|ев|ам|ами|ах)?|процент(?:а|у|ом|е|ы|ов|ам|ами|ах)?|час(?:а|у|ом|е|ы|ов|ам|ами|ах)?|тысяч(?:а|и|у|ей|е|ам|ами|ах)?|миллион(?:а|у|ом|е|ы|ов|ам|ами|ах)?|человек(?:а|у|ом|е)?|штук(?:а|и|у|ой|е|ам|ами|ах)?)$/u
const PART_WORD = /^(?:част[а-яё]*|ч|пункт[а-яё]*|подпункт[а-яё]*|п|пп)$/u
const NUMBER = /^(\d+(?:\.\d+)*)(?:-?[а-яё]{1,3})?$/u
const BARE_NUMBER = /^\d+$/u
const LEADING = /^[«"'([]+/u
const TRAILING = /[»"')\],;:!?.]+$/u
const GLUED_ARTICLE = /^(ст\.)(?=\d)/u

const tokensOf = (word: string): ReadonlyArray<string> =>
  word.toLowerCase().replace(LEADING, "").split(GLUED_ARTICLE)
    .map((part) => part.replace(TRAILING, ""))
    .filter((token) => token !== "")

const numberOf = (token: string): string | undefined => NUMBER.exec(token)?.[1]

const isInRun = (token: string): boolean => token === "и" || numberOf(token) !== undefined

const runOpenerAt = (tokens: ReadonlyArray<string>, at: number): number => {
  let opener = at - 1
  while (opener >= 0 && isInRun(tokens[opener] ?? "")) opener--
  return opener
}

const runCloser = (tokens: ReadonlyArray<string>, at: number): string =>
  tokens.slice(at + 1).find((token) => !isInRun(token)) ?? ""

// «2 части 159 статьи» puts the part number before its part word, while in «п. 1 ч. 2 ст. 159» the number before «ч.» belongs to «п.» and in «ст. 30, ч. 1 ст. 105» it belongs to «ст.».
const isSpokenPartNumber = (tokens: ReadonlyArray<string>, at: number): boolean => {
  if (numberOf(tokens[at] ?? "") === undefined) return false
  const opener = tokens[runOpenerAt(tokens, at)] ?? ""
  return !PART_WORD.test(opener) && !ARTICLE_WORD.test(opener)
}

const isBeforeArticleWord = (tokens: ReadonlyArray<string>, at: number): boolean => {
  const token = tokens[at] ?? ""
  const next = tokens[at + 1] ?? ""
  if (numberOf(token) === undefined || !ARTICLE_WORD.test(next)) return false
  const opener = runOpenerAt(tokens, at)
  if (PART_WORD.test(tokens[opener] ?? "") && !isSpokenPartNumber(tokens, opener - 1)) return false
  if (!BARE_NUMBER.test(token)) return true
  const lastTwo = Number(token.slice(-2))
  const last = lastTwo % 10
  const counts = PLURAL_ARTICLE_WORD.test(next)
    || (next === "статья" && last === 1 && lastTwo !== 11)
    || (next === "статьи" && last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14))
  return !counts
}

const isListedAfterArticleWord = (tokens: ReadonlyArray<string>, at: number): boolean => {
  const opener = runOpenerAt(tokens, at)
  if (!ARTICLE_WORD.test(tokens[opener] ?? "")) return false
  const closer = runCloser(tokens, at)
  if (PART_WORD.test(closer) && isBeforeArticleWord(tokens, opener - 1)) return false
  return opener === at - 1 || !(PART_WORD.test(closer) || COUNT_UNIT.test(closer))
}

export const articleMentions = (words: ReadonlyArray<string>): ReadonlyArray<string> => {
  const tokens = words.flatMap(tokensOf)
  return tokens.flatMap((token, at): ReadonlyArray<string> => {
    const number = numberOf(token)
    return number !== undefined && (isListedAfterArticleWord(tokens, at) || isBeforeArticleWord(tokens, at)) ? [number] : []
  })
}

export const isMissing = (number: string, sources: ReadonlyArray<PageSource>): boolean => {
  const laws = sources.filter((source) => source.articles.length > 0)
  return laws.length > 0 && !laws.some((law) => law.articles.includes(number))
}
