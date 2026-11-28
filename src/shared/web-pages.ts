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

const ARTICLE_WORD = /^(?:стать(?:я|и|е|ю|ей|ям|ях|ями)|ст\.?)$/u
const NUMBER = /^(\d+(?:\.\d+)*)(?:-?[а-яё]{1,3})?$/u
const EDGES = /^[«"'([]+|[»"')\],;:!?]+$/gu

const tokenOf = (word: string): string => {
  const bare = word.toLowerCase().replace(EDGES, "")
  return bare.endsWith(".") && bare !== "ст." ? bare.slice(0, -1) : bare
}

const numberOf = (token: string): string | undefined => NUMBER.exec(token)?.[1]

interface Mention {
  readonly number: string
  readonly at: number
}

export const articleMentions = (words: ReadonlyArray<string>): ReadonlyArray<Mention> => {
  const tokens = words.map(tokenOf)
  return tokens.flatMap((token, at): ReadonlyArray<Mention> => {
    const number = numberOf(token)
    if (number === undefined) return []
    const before = tokens[at - 1]
    const after = tokens[at + 1]
    const named = (before !== undefined && ARTICLE_WORD.test(before)) ||
      (after !== undefined && ARTICLE_WORD.test(after) && token !== number)
    return named ? [{ number, at }] : []
  })
}

export const isMissing = (number: string, sources: ReadonlyArray<PageSource>): boolean => {
  const laws = sources.filter((source) => source.articles.length > 0)
  return laws.length > 0 && !laws.some((law) => law.articles.includes(number))
}
