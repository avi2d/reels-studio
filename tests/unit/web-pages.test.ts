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
  expect(articleMentions(["Проверьте", "статью", "620."])).toEqual(["620"])
})

test("an article named after an ordinal number is found, not missed for the -й ending", () => {
  expect(articleMentions(["в", "18-й", "статье"])).toEqual(["18"])
})

test("the short form ст. is an article word, not a sentence end", () => {
  expect(articleMentions(["ст.", "620"])).toEqual(["620"])
})

test("a bare number before the article word is found, not missed for lacking an ordinal ending", () => {
  expect(articleMentions(["по", "159", "статье", "УК"])).toEqual(["159"])
})

test("every number in a list after the article word is found, not only the first", () => {
  expect(articleMentions(["статьи", "620", "и", "621"])).toEqual(["620", "621"])
  expect(articleMentions(["статьи", "620,", "621", "и", "622"])).toEqual(["620", "621", "622"])
})

test.each([
  ["статьи 15 и 16 ФЗ", ["15", "16"]],
  ["статьи 15 и 16 Закона о защите прав потребителей", ["15", "16"]],
  ["статьи 620 и 621 настоящего Кодекса", ["620", "621"]],
  ["статьи 620 и 621 Гражданского кодекса", ["620", "621"]],
  ["статьи 620 и 621 говорят", ["620", "621"]]
])("a law name or ordinary prose does not hide the last listed article: %s", (phrase, expected) => {
  expect(articleMentions(phrase.split(" "))).toEqual(expected)
})

test.each([
  ["228 статья УК", ["228"]],
  ["159 статья — мошенничество", ["159"]],
  ["по признакам 159 статьи УК", ["159"]],
  ["11 статья", ["11"]],
  ["12 статьи", ["12"]],
  ["13 статьи", ["13"]],
  ["14 статьи", ["14"]],
  ["111 статья", ["111"]],
  ["112 статьи", ["112"]],
  ["1 статья", []],
  ["21 статья", []],
  ["101 статья", []],
  ["2 статьи", []],
  ["4 статьи", []],
  ["22 статьи", []],
  ["5 статей", []],
  ["11 статей", []],
  ["21-я статья", ["21"]],
  ["22-й статьи", ["22"]]
])("numeral agreement distinguishes article counts from citations: %s", (phrase, expected) => {
  expect(articleMentions(phrase.split(" "))).toEqual(expected)
})

test.each([
  "лет", "года", "рублей", "раз", "дней", "месяцев", "процентов", "часов",
  "тысяч", "миллионов", "человек", "штук"
])("an unrelated quantity does not become a listed article before %s", (unit) => {
  expect(articleMentions(["статья", "159", "и", "5", unit])).toEqual(["159"])
})

test("a closing quote before the full stop does not hide the number", () => {
  expect(articleMentions(["статья", "620»."])).toEqual(["620"])
})

test("ст. glued to its number is still an article word", () => {
  expect(articleMentions(["ст.620"])).toEqual(["620"])
  expect(articleMentions(["(ст.620)"])).toEqual(["620"])
})

test("a part number before статьи is not mistaken for an article number", () => {
  expect(articleMentions(["часть", "1", "статьи", "12.8"])).toEqual(["12.8"])
  expect(articleMentions(["ч.", "2", "ст.", "159"])).toEqual(["159"])
  expect(articleMentions(["пунктом", "2", "статьи", "450"])).toEqual(["450"])
})

test("part numbers listed before статьи are not mistaken for article numbers", () => {
  expect(articleMentions(["по", "частям", "1", "и", "2", "статьи", "159"])).toEqual(["159"])
  expect(articleMentions(["ч.", "1,", "2", "ст.", "159"])).toEqual(["159"])
  expect(articleMentions(["части", "1", "и", "3", "статьи", "450"])).toEqual(["450"])
  expect(articleMentions(["пунктами", "1", "и", "2", "статьи", "450", "ГК"])).toEqual(["450"])
})

test.each([
  ["по 2 части 159 статьи", ["159"]],
  ["2 часть 159 статьи", ["159"]],
  ["по 3 части 228 статьи УК", ["228"]],
  ["по 2-й части 159-й статьи", ["159"]],
  ["2 ч. 159 ст.", ["159"]],
  ["2 пункт 159 статьи", ["159"]],
  ["2 подпункт 159.1 статьи", ["159.1"]],
  ["части 2 статьи 159", ["159"]],
  ["по частям 1 и 2 статьи 159", ["159"]]
])("a part citation does not hide the article or turn its part into an article: %s", (phrase, expected) => {
  expect(articleMentions(phrase.split(" "))).toEqual(expected)
})

test.each([
  ["нарушение статей 15 и 16 Закона", ["15", "16"]],
  ["статей 158 и 159", ["158", "159"]],
  ["5 статей", []],
  ["в законе 3 статьи", []]
])("genitive plural citations are not missed or confused with article counts: %s", (phrase, expected) => {
  expect(articleMentions(phrase.split(" "))).toEqual(expected)
})

test("a count of articles is not an article number", () => {
  expect(articleMentions(["в", "законе", "3", "статьи"])).toEqual([])
})

test("a list after the article word stops at a number that counts something else", () => {
  expect(articleMentions(["статья", "159", "и", "5", "лет"])).toEqual(["159"])
  expect(articleMentions(["статьи", "620", "и", "621", "ГК"])).toEqual(["620", "621"])
})

test.each([
  ["159 статья 2 часть", ["159"]],
  ["по 228 статье 2 части", ["228"]],
  ["статья 159 2 и 3 части", ["159"]],
  ["статье 159 3 пункт", ["159"]],
  ["статья 159 часть 2", ["159"]],
  ["статья 159 и 5 и 6 лет", ["159"]]
])("a part or quantity spoken after the article number is not another article: %s", (phrase, expected) => {
  expect(articleMentions(phrase.split(" "))).toEqual(expected)
})

test("a number before a plural article form is a count, not an article number", () => {
  expect(articleMentions(["в", "3", "статьях", "закона"])).toEqual([])
  expect(articleMentions(["по", "2", "статьям", "УК"])).toEqual([])
  expect(articleMentions(["между", "5", "статьями"])).toEqual([])
})

test("a second article word in a list keeps its own number, not read as a part", () => {
  expect(articleMentions(["ст.", "158,", "ст.", "159", "УК"])).toEqual(["158", "159"])
  expect(articleMentions(["статья", "105,", "статья", "111", "УК"])).toEqual(["105", "111"])
  expect(articleMentions(["статья", "620", "статья", "621"])).toEqual(["620", "621"])
  expect(articleMentions(["ч.", "2", "ст.", "158,", "ст.", "159"])).toEqual(["158", "159"])
})

test("a nested point and part citation names only the article, not the part", () => {
  expect(articleMentions(["п.", "1", "ч.", "2", "ст.", "159"])).toEqual(["159"])
  expect(articleMentions(["пункта", "3", "части", "5", "статьи", "159"])).toEqual(["159"])
  expect(articleMentions(["пункта", "1", "части", "1", "статьи", "228", "УК"])).toEqual(["228"])
  expect(articleMentions(["подпункта", "2", "пункта", "1", "статьи", "333.19"])).toEqual(["333.19"])
  expect(articleMentions(["пп.", "2", "п.", "1", "ст.", "333"])).toEqual(["333"])
  expect(articleMentions(["пункт", "2", "части", "1", "статьи", "333"])).toEqual(["333"])
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
