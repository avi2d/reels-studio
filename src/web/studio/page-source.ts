import type { Visual } from "../../shared/inserts.ts"
import { articleMentions, isMissing, type PageSource, siteOf } from "../../shared/web-pages.ts"
import { h } from "../dom.ts"

export const sourceOf = (visual: Visual, sources: ReadonlyArray<PageSource>): PageSource | undefined =>
  visual.kind === "page" ? sources.find((source) => source.file === visual.file) : undefined

export const sourceKind = (source: PageSource): string => source.articles.length > 0 ? "Текст закона" : "Страница из интернета"

const missingArticles = (phrase: string, sources: ReadonlyArray<PageSource>): ReadonlyArray<string> =>
  [...new Set(articleMentions(phrase.split(/\s+/u)).map((mention) => mention.number))].filter((number) => isMissing(number, sources))

export const sourceLines = (source: PageSource): ReadonlyArray<HTMLElement> => [
  h("span", { class: "hint" }, "Источник: ", h("a", { href: source.address, target: "_blank", rel: "noopener noreferrer" }, siteOf(source.address))),
  h("span", { class: "hint" }, source.licence === undefined ? "Лицензия на странице не указана" : `Лицензия: ${source.licence}`)
]

export const articleWarnings = (sources: ReadonlyArray<PageSource>, phrase: string): ReadonlyArray<HTMLElement> =>
  missingArticles(phrase, sources).map((number) => h("span", { class: "hint hint--warn" }, `В этом тексте закона нет статьи ${number}. Проверьте номер.`))
