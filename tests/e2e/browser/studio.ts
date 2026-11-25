import assert from "node:assert/strict"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import type { ProductCheck } from "@avi2dg/checks/browser-hooks.ts"
import type { Page } from "playwright-core"
import { STEPS, STUDIO_PATH, stepPath } from "../../../src/shared/page.ts"
import { setting, timeout } from "./scenario.ts"

const address = (path: string): string => new URL(path, setting("REELS_BROWSER_URL")).href

const folderExists = (id: string): Promise<boolean> =>
  stat(join(setting("REELS_BROWSER_DIR"), "projects", id)).then(() => true, () => false)

const reelId = (page: Page): string => {
  const id = /^\/new\/([a-z0-9-]+)\/records$/u.exec(new URL(page.url()).pathname)?.[1]
  assert(id !== undefined, `Creating a reel must open its first step, it opened ${page.url()}`)
  return id
}

const createReel = async (page: Page, title: string): Promise<string> => {
  await page.goto(address(STUDIO_PATH))
  await page.getByRole("heading", { name: "Ролики", exact: true }).waitFor()
  await page.getByRole("button", { name: "Новый ролик", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Новый ролик" })
  await dialog.getByRole("textbox", { name: "Название" }).fill(title)
  await dialog.getByRole("button", { name: "Создать ролик", exact: true }).click()
  await page.getByRole("heading", { name: "Записи", exact: true, level: 1 }).waitFor()
  await page.getByRole("link", { name: "Шаг 1: Записи" }).and(page.locator('[aria-current="step"]')).waitFor()
  return reelId(page)
}

const deleteReel = async (page: Page, title: string): Promise<void> => {
  await page.getByRole("button", { name: "Ещё", exact: true }).click()
  await page.getByRole("menuitem", { name: "Удалить ролик", exact: true }).click()
  const [removed] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "DELETE" && new URL(response.url()).pathname.startsWith("/api/projects/"), { timeout }),
    page.getByRole("dialog", { name: `Удалить ролик «${title}»?` }).getByRole("button", { name: "Удалить ролик", exact: true }).click()
  ])
  assert(removed.ok(), `The studio refused to delete the reel: ${removed.status()}`)
  await page.getByRole("heading", { name: "Ролики", exact: true, level: 1 }).waitFor()
}

const createListDelete: ProductCheck = {
  name: "a reel created on the new screens shows in their list as new and is gone from the list and the disk once deleted, instead of lingering",
  run: async (page) => {
    page.setDefaultTimeout(timeout)
    const title = "Ролик новой студии"
    const id = await createReel(page, title)
    assert(await folderExists(id), "Creating a reel must make its folder")
    await page.getByRole("link", { name: "Студия", exact: true }).click()
    const card = page.getByRole("link", { name: new RegExp(title, "u") })
    await card.getByText(/· Новый$/u).waitFor()
    await card.click()
    await page.getByRole("heading", { name: "Записи", exact: true, level: 1 }).waitFor()
    assert.equal(new URL(page.url()).pathname, stepPath(id, "records"))
    await deleteReel(page, title)
    assert.equal(await page.getByRole("link", { name: new RegExp(title, "u") }).count(), 0, "The deleted reel must leave the list")
    await page.reload()
    await page.getByRole("heading", { name: "Ролики", exact: true, level: 1 }).waitFor()
    assert.equal(await page.getByRole("link", { name: new RegExp(title, "u") }).count(), 0, "The deleted reel must stay out of the list after a reload")
    assert.equal(await folderExists(id), false, "Deleting a reel must remove its folder")
    return { targets: ["new reel opens its first step", "reel card reads «Новый»", "deleted reel leaves the list and the disk"], found: [] }
  }
}

const WINDOWS = [[1440, 900], [390, 844], [320, 640]] as const

const pageWidths: ProductCheck = {
  name: "every new screen is as wide as the window at 1440, 390 and 320 px instead of scrolling sideways",
  run: async (page) => {
    page.setDefaultTimeout(timeout)
    const title = "Ролик с длинным названием, которое не помещается в верхнюю строку телефона"
    const id = await createReel(page, title)
    const browser = page.context().browser()
    assert(browser !== null, "The browser checks must run in a browser that opens new contexts")
    const paths = [STUDIO_PATH, ...STEPS.map((step) => stepPath(id, step))]
    const wide: Array<string> = []
    for (const [width, height] of WINDOWS) {
      const context = await browser.newContext({ viewport: { width, height } })
      try {
        const tab = await context.newPage()
        tab.setDefaultTimeout(timeout)
        for (const path of paths) {
          await tab.goto(address(path))
          await tab.getByRole("heading", { level: 1 }).waitFor()
          const [pageWidth, windowWidth] = await tab.evaluate(() => [document.documentElement.scrollWidth, innerWidth])
          if (pageWidth !== windowWidth) wide.push(`${path} at ${width}: page ${pageWidth}, window ${windowWidth}`)
        }
        await tab.goto(address(stepPath(id, "plan")))
        const summary = tab.getByText("2 из 5 ·")
        await summary.waitFor({ state: width < 960 ? "visible" : "hidden" })
      } finally {
        await context.close()
      }
    }
    await deleteReel(page, title)
    assert.deepEqual(wide, [], "Every new screen must fit the window")
    return { targets: WINDOWS.map(([width]) => `${paths.length} screens at ${width} px`), found: [] }
  }
}

export const studioChecks = [createListDelete, pageWidths] satisfies readonly ProductCheck[]
