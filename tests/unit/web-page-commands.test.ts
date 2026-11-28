import { expect, test } from "bun:test"
import { checkedAddress, isOutside, licenceOf, pageName, printArgs } from "../../src/server/web-page-commands.ts"

test("only http and https addresses are opened, not file, javascript or ftp", () => {
  expect(checkedAddress("file:///etc/passwd")).toBeUndefined()
  expect(checkedAddress("javascript:alert(1)")).toBeUndefined()
  expect(checkedAddress("ftp://example.com/law.txt")).toBeUndefined()
  expect(checkedAddress("pravo.gov.ru")).toBeUndefined()
})

test("an address carrying a user name or password is refused, not opened with it", () => {
  expect(checkedAddress("https://user:secret@example.com/")).toBeUndefined()
})

test("the address is trimmed and its fragment dropped, while http stays http", () => {
  expect(checkedAddress("  https://example.com/a?b=1#part ")?.href).toBe("https://example.com/a?b=1")
  expect(checkedAddress("http://pravo.gov.ru/proxy/ips/?nd=102039276")?.protocol).toBe("http:")
})

test("home-network, loopback and unspecified addresses are not outside", () => {
  expect(isOutside("192.168.1.1")).toBe(false)
  expect(isOutside("127.0.0.1")).toBe(false)
  expect(isOutside("0.0.0.0")).toBe(false)
  expect(isOutside("::")).toBe(false)
  expect(isOutside("::1")).toBe(false)
  expect(isOutside("8.8.8.8")).toBe(true)
})

test("the saved file is named by its site and digest, not by the path a page chooses", () => {
  expect(pageName(new URL("https://WWW.Example.com/../../etc/passwd"), "abcdef0123456789")).toBe("web-example.com-abcdef0123.pdf")
})

test("Chrome prints the named address last, so a page address is never read as a flag", () => {
  const args = printArgs("https://example.com/", "/tmp/profile", "/tmp/out.pdf")
  expect(args.at(-1)).toBe("https://example.com/")
  expect(args).toContain("--print-to-pdf=/tmp/out.pdf")
  expect(args).toContain("--headless")
})

test("a rel=license link gives its text, and an empty link gives its address", () => {
  expect(licenceOf('<p><a rel="license" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></p>')).toBe("CC BY 4.0")
  expect(licenceOf('<a href="/x">Главная</a><a rel="nofollow license" href="https://creativecommons.org/licenses/by-sa/4.0/"><img src="b.png"></a>'))
    .toBe("https://creativecommons.org/licenses/by-sa/4.0/")
})

test("a licence link element and a Dublin Core rights meta are read, with entities decoded", () => {
  expect(licenceOf('<link rel="license" href="https://example.com/terms">')).toBe("https://example.com/terms")
  expect(licenceOf('<meta name="DCTERMS.rights" content="&copy; Public domain">')).toBe("© Public domain")
})

test("a page that names no licence gets none, not an invented one", () => {
  expect(licenceOf("<html><body><a href=\"/about\">О портале</a></body></html>")).toBeUndefined()
})

test("a very long licence text is cut, not stored whole", () => {
  expect(licenceOf(`<meta name="copyright" content="${"x".repeat(300)}">`)?.length).toBe(200)
})
