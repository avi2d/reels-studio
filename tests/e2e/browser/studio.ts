import assert from "node:assert/strict"
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { ProductCheck } from "@avi2dg/checks/browser-hooks.ts"
import type { Page } from "playwright-core"
import { STEPS, STUDIO_PATH, stepPath } from "../../../src/shared/page.ts"
import { SOURCE_VIDEO, setting, timeout } from "./scenario.ts"

const HEARING = 60_000

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
  await page.getByRole("heading", { name: "Выберите записи", exact: true, level: 1 }).waitFor()
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
    await page.getByRole("heading", { name: "Выберите записи", exact: true, level: 1 }).waitFor()
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

const reelRecords = (page: Page) => page.getByRole("list", { name: "Записи ролика", exact: true }).getByRole("listitem")

const assertOnlySource = async (id: string): Promise<void> => {
  const folder = join(setting("REELS_BROWSER_DIR"), "projects", id, "source")
  const names = await readdir(folder)
  assert.equal(names.length, 1, `The reel must hold one recording, it holds ${JSON.stringify(names)}`)
  const kept = await Bun.file(join(folder, names[0] ?? "")).bytes()
  assert.deepEqual(kept, await Bun.file(join(setting("REELS_BROWSER_DIR"), SOURCE_VIDEO)).bytes(), "The reel must keep the original bytes of the recording")
}

const playerAt = (page: Page, from: number, to: number) =>
  page.waitForFunction(([low, high]) => {
    const player = document.querySelector("video.rec__player")
    return player instanceof HTMLVideoElement && player.readyState >= 1 && !player.seeking && player.currentTime >= low && player.currentTime < high
  }, [from, to] as const)

const READY = /^Готово · 0:07$/u

const readyUploads = (page: Page): Promise<number> =>
  page.getByRole("list", { name: "Загруженные записи", exact: true }).getByText(READY).count()

const uploadOnStudioPage = async (page: Page): Promise<void> => {
  await page.goto(address(STUDIO_PATH))
  await page.getByRole("heading", { name: "Записи", exact: true, level: 2 }).waitFor()
  const before = await readyUploads(page)
  await page.locator('input[type="file"][name="records"]').setInputFiles(join(setting("REELS_BROWSER_DIR"), SOURCE_VIDEO))
  await page.waitForFunction((count) => [...document.querySelectorAll('[aria-label="Загруженные записи"] .rec__status')]
    .filter((status) => status.textContent === "Готово · 0:07").length > count, before, { timeout: HEARING })
}

const addEarlier = async (page: Page, title: string): Promise<string> => {
  const id = await createReel(page, title)
  assert.equal(await page.locator('input[type="file"]').count(), 0, "Step 1 picks uploaded recordings and holds no upload picker")
  const [added] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/projects/${id}/videos`),
    page.getByRole("list", { name: "Загружены раньше", exact: true }).getByRole("button", { name: /^В ролик: «source/u }).first().click()
  ])
  assert(added.ok(), `The studio refused to add the recording: ${added.status()}`)
  await reelRecords(page).first().getByText(READY).waitFor()
  await page.getByRole("heading", { name: "1 запись · 0:07", exact: true, level: 1 }).waitFor()
  assert.equal(await reelRecords(page).count(), 1, "One press of «В ролик» must make one recording in the reel")
  await assertOnlySource(id)
  return id
}

const seekByWord = async (page: Page): Promise<void> => {
  const row = reelRecords(page).first()
  await row.getByRole("button", { expanded: false }).click()
  await playerAt(page, 0, 1)
  await row.getByRole("button", { name: "Конец", exact: true }).click()
  await playerAt(page, 4.95, 5.3)
  assert.equal(await page.getByText(/обрежу по лицу/u).count(), 0, "The horizontal crop status waits for its server step")
}

const recordsStep: ProductCheck = {
  name: "a recording uploaded on the studio page reads «Готово», step 1 adds it to two reels with «В ролик» and a pressed word moves its player, instead of a second upload, an upload picker in step 1 or the player staying at the start",
  run: async (page) => {
    page.setDefaultTimeout(timeout)
    const [first, second] = ["Ролик с записью", "Ролик из прежней записи"]
    await uploadOnStudioPage(page)
    await addEarlier(page, first)
    await seekByWord(page)
    await deleteReel(page, first)
    await addEarlier(page, second)
    await deleteReel(page, second)
    return { targets: ["upload on the studio page reaches «Готово · 0:07»", "step 1 holds no upload picker", "«В ролик» adds the uploaded recording ready", "pressed «Конец» moves the player to 0:05", "each reel keeps the original"], found: [] }
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

const renamePersists: ProductCheck = {
  name: "a reel renamed from the top bar keeps its new title after reload instead of reverting",
  run: async (page) => {
    page.setDefaultTimeout(timeout)
    const before = "Название до правки"
    const after = "Название после правки"
    const id = await createReel(page, before)
    await page.getByRole("button", { name: "Ещё", exact: true }).click()
    await page.getByRole("menuitem", { name: "Переименовать", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Переименовать ролик" })
    const title = dialog.getByRole("textbox", { name: "Название" })
    assert.equal(await title.inputValue(), before)
    await title.fill(after)
    await dialog.getByRole("button", { name: "Сохранить название" }).click()
    await dialog.waitFor({ state: "hidden" })
    const bar = page.getByRole("banner")
    await bar.getByText(after, { exact: true }).waitFor()
    await page.reload()
    await bar.getByText(after, { exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, stepPath(id, "records"))
    await bar.getByRole("link", { name: "Студия" }).click()
    await page.getByRole("link", { name: new RegExp(after, "u") }).waitFor()
    assert.equal(await page.getByRole("link", { name: new RegExp(before, "u") }).count(), 0)
    return { targets: ["renamed title in the top bar after reload", "renamed card on the same reel"], found: [] }
  }
}

const builtStatus: ProductCheck = {
  name: "a reel card reads «Ролики готовы» when the published video file is present instead of keeping the upload status",
  run: async (page) => {
    page.setDefaultTimeout(timeout)
    const title = "Собранный ролик"
    const id = await createReel(page, title)
    const fixtures = setting("REELS_BROWSER_DIR")
    const directory = join(fixtures, "projects", id)
    const reel = join(directory, "reel")
    const made = "2026-01-01T00:00:00.000Z"
    const video = "reel-2026-01-01T00-00-00.000Z.mp4"
    await mkdir(reel)
    await writeFile(join(reel, "reel.json"), JSON.stringify({ made, video, parts: [] }))
    await copyFile(join(fixtures, SOURCE_VIDEO), join(directory, "source", SOURCE_VIDEO))
    await page.goto(address(STUDIO_PATH))
    const card = page.getByRole("link", { name: new RegExp(title, "u") })
    await card.getByText(/· Записи загружены$/u).waitFor()
    await copyFile(join(fixtures, SOURCE_VIDEO), join(reel, video))
    await page.reload()
    await card.getByText(/· Ролики готовы$/u).waitFor()
    assert.equal(await card.getByText("Записи загружены", { exact: false }).count(), 0)
    return { targets: ["uploaded status without a published file", "ready status once the video file is present"], found: [] }
  }
}

export const studioChecks = [createListDelete, recordsStep, pageWidths, renamePersists, builtStatus] satisfies readonly ProductCheck[]
