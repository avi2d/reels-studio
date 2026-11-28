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

const ARTICLE_WORD = /^(?:стать(?:я|и|е|ю|ей|ям|ях|ями)|ст)$/u
const PART_WORD = /^(?:част[а-яё]*|ч|пункт[а-яё]*|подпункт[а-яё]*|п|пп)$/u
const NUMBER = /^(\d+(?:\.\d+)*)(?:-?[а-яё]{1,3})?$/u
const LEADING = /^[«"'([]+/u
const TRAILING = /[»"')\],;:!?.]+$/u
const GLUED_ARTICLE = /^(ст\.)(?=\d)/u

const tokensOf = (word: string): ReadonlyArray<string> =>
  word.toLowerCase().replace(LEADING, "").split(GLUED_ARTICLE)
    .map((part) => part.replace(TRAILING, ""))
    .filter((token) => token !== "")

const numberOf = (token: string): string | undefined => NUMBER.exec(token)?.[1]

const isListedAfterArticleWord = (tokens: ReadonlyArray<string>, at: number): boolean => {
  const before = tokens.slice(0, at).reverse()
  const end = before.findIndex((token) => token !== "и" && numberOf(token) === undefined)
  return ARTICLE_WORD.test(before[end] ?? "")
}

const isBeforeArticleWord = (tokens: ReadonlyArray<string>, at: number): boolean =>
  ARTICLE_WORD.test(tokens[at + 1] ?? "") && !PART_WORD.test(tokens[at - 1] ?? "")

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
