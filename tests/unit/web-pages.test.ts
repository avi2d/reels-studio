import { expect, test } from "bun:test"
import { articleMentions, articlesOf, isMissing, siteOf } from "../../src/shared/web-pages.ts"

const civilCode = [
  "ГРАЖДАНСКИЙ КОДЕКС РОССИЙСКОЙ ФЕДЕРАЦИИ",
  "Статья 620. Досрочное расторжение договора по требованию арендатора",
  "Договором аренды могут быть установлены и другие основания в соответствии с пунктом 2 статьи 450 настоящего Кодекса.",
  "Статья 621. Преимущественное право арендатора на заключение договора аренды на новый срок"
].join("\n")

const law = { file: "web-pravo.gov.ru-0123456789.pdf", address: "http://pravo.gov.ru/", articles: ["620", "621"] }

test("only headings count as articles, not a reference to another article inside the text", () => {
  expect(articlesOf(civilCode)).toEqual(["620", "621"])
})

test("a dotted article number keeps its dot part instead of being cut to the first number", () => {
  expect(articlesOf("Статья 15.1. Неприкосновенность")).toEqual(["15.1"])
})

test("an article named before its number is found, with the trailing full stop dropped", () => {
  expect(articleMentions(["Проверьте", "статью", "620."])).toEqual([{ number: "620", at: 2 }])
})

test("an article named after an ordinal number is found, not missed for the -й ending", () => {
  expect(articleMentions(["в", "18-й", "статье"])).toEqual([{ number: "18", at: 1 }])
})

test("the short form ст. is an article word, not a sentence end", () => {
  expect(articleMentions(["ст.", "620"])).toEqual([{ number: "620", at: 1 }])
})

test("a number with no article word next to it is not a mention", () => {
  expect(articleMentions(["Это", "стоит", "620", "рублей"])).toEqual([])
})

test("an article the law text does not hold is missing, and one it holds is not", () => {
  expect(isMissing("1200", [law])).toBe(true)
  expect(isMissing("620", [law])).toBe(false)
})

test("with no law text among the sources nothing is called missing, not every number", () => {
  expect(isMissing("1200", [])).toBe(false)
  expect(isMissing("1200", [{ ...law, articles: [] }])).toBe(false)
})

test("the site is the host without www, and an unreadable address is shown as it is", () => {
  expect(siteOf("https://www.consultant.ru/document/cons_doc_LAW_9027/")).toBe("consultant.ru")
  expect(siteOf("not an address")).toBe("not an address")
})
