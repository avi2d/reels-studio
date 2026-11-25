import assert from "node:assert/strict"
import { copyFile, mkdir, mkdtemp, readdir, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ProductCheck } from "@avi2dg/checks/browser-hooks.ts"
import { Schema } from "effect"
import type { Page } from "playwright-core"
import { UploadedVideo } from "../../../src/shared/library.ts"
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

const assertSources = async (id: string, count: number): Promise<void> => {
  const folder = join(setting("REELS_BROWSER_DIR"), "projects", id, "source")
  const names = await readdir(folder)
  assert.equal(names.length, count, `The reel must hold ${count} recordings, it holds ${JSON.stringify(names)}`)
  const original = await Bun.file(join(setting("REELS_BROWSER_DIR"), SOURCE_VIDEO)).bytes()
  const kept = await Promise.all(names.map((name) => Bun.file(join(folder, name)).bytes()))
  assert(kept.some((bytes) => Buffer.from(bytes).equals(Buffer.from(original))), "The reel must keep the original bytes of the recording")
}

const playerAt = (page: Page, from: number, to: number) =>
  page.waitForFunction(([low, high]) => {
    const player = document.querySelector("video.rec__player")
    return player instanceof HTMLVideoElement && player.readyState >= 1 && !player.seeking && player.currentTime >= low && player.currentTime < high
  }, [from, to] as const)

const READY = /^Готово · 0:07$/u

const readUploads = Schema.decodeUnknownSync(Schema.Struct({ videos: Schema.Array(UploadedVideo) }))

const uploadsNow = async (): Promise<ReadonlyArray<UploadedVideo>> =>
  readUploads(await (await fetch(address("/api/library"))).json()).videos

// A free box at the end keeps the sample playable and changes its size, so the studio counts it as another take.
const secondTake = async (): Promise<string> => {
  const path = join(await mkdtemp(join(tmpdir(), "reels-take-")), "second-take.mp4")
  const original = await Bun.file(join(setting("REELS_BROWSER_DIR"), SOURCE_VIDEO)).bytes()
  const free = new Uint8Array([0, 0, 0, 16, 0x66, 0x72, 0x65, 0x65, 0, 0, 0, 0, 0, 0, 0, 0])
  await writeFile(path, Buffer.concat([original, free]))
  return path
}

// The original sample comes first: the second take is the same bytes plus a free box, so it is the larger file.
const uploadOnStudioPage = async (page: Page): Promise<ReadonlyArray<string>> => {
  await page.goto(address(STUDIO_PATH))
  await page.getByRole("heading", { name: "Записи", exact: true, level: 2 }).waitFor()
  const before = new Set((await uploadsNow()).map((video) => video.name))
  await page.locator('input[type="file"][name="records"]').setInputFiles([join(setting("REELS_BROWSER_DIR"), SOURCE_VIDEO), await secondTake()])
  const until = Date.now() + HEARING
  const heard = async (): Promise<ReadonlyArray<string>> =>
    (await uploadsNow()).filter((video) => !before.has(video.name) && video.state === "ready").toSorted((a, b) => a.size - b.size).map((video) => video.name)
  for (let names = await heard(); ; names = await heard()) {
    if (names.length === 2) {
      await page.getByRole("list", { name: "Загруженные записи", exact: true }).getByText(READY).first().waitFor({ timeout: HEARING })
      return names
    }
    assert(Date.now() < until, "Both uploads must be heard")
    await Bun.sleep(500)
  }
}

const removeUploads = async (names: ReadonlyArray<string>): Promise<void> => {
  for (const name of names) {
    const removed = await fetch(address(`/api/library/${encodeURIComponent(name)}`), { method: "DELETE" })
    assert(removed.ok, `The studio refused to delete the upload ${name}: ${removed.status}`)
  }
}

const boxOf = (page: Page, name: string) =>
  page.getByRole("list", { name: "Загружены раньше", exact: true }).getByRole("checkbox", { name: new RegExp(`^${RegExp.escape(name)}`, "u") })

const addChosen = async (page: Page, title: string, names: ReadonlyArray<string>): Promise<string> => {
  const count = names.length
  const id = await createReel(page, title)
  assert.equal(await page.locator('input[type="file"]').count(), 0, "Step 1 picks uploaded recordings and holds no upload picker")
  for (const name of names) await boxOf(page, name).check()
  const [added] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/projects/${id}/videos`),
    page.getByRole("button", { name: count === 1 ? "Добавить в ролик: 1 запись" : `Добавить в ролик: ${count} записи`, exact: true }).click()
  ])
  assert(added.ok(), `The studio refused to add the recordings: ${added.status()}`)
  await page.getByRole("heading", { name: count === 1 ? "1 запись · 0:07" : `${count} записи · 0:14`, exact: true, level: 1 }).waitFor()
  assert.equal(await reelRecords(page).getByText(READY).count(), count, "One press of «Добавить в ролик» must add every chosen recording ready")
  await assertSources(id, count)
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
  name: "two takes uploaded on the studio page read «Готово», step 1 adds both to one reel with one press, one to the next reel, and a pressed word moves the player, instead of one take per press, a second upload, an upload picker in step 1 or the player staying at the start",
  run: async (page) => {
    page.setDefaultTimeout(timeout)
    const [first, second] = ["Ролик с двумя записями", "Ролик из одной записи"]
    const takes = await uploadOnStudioPage(page)
    await addChosen(page, first, takes)
    await seekByWord(page)
    await deleteReel(page, first)
    await addChosen(page, second, takes.slice(0, 1))
    await deleteReel(page, second)
    await removeUploads(takes)
    return { targets: ["two uploads on the studio page reach «Готово · 0:07»", "step 1 holds no upload picker", "two chosen recordings join the reel with one press", "one chosen recording joins the next reel", "pressed «Конец» moves the player to 0:05", "each reel keeps the original"], found: [] }
  }
}

const pickUpload = async (page: Page, name: string, bytes: Uint8Array): Promise<string> => {
  const before = new Set((await uploadsNow()).map((video) => video.name))
  await page.locator('input[type="file"][name="records"]').setInputFiles({ name, mimeType: "video/mp4", buffer: Buffer.from(bytes) })
  const until = Date.now() + HEARING
  for (;;) {
    const ready = (await uploadsNow()).find((video) => !before.has(video.name) && video.state === "ready")
    if (ready !== undefined) return ready.name
    assert(Date.now() < until, "The new upload must reach ready")
    await Bun.sleep(500)
  }
}

const deleteUpload = async (page: Page, name: string): Promise<void> => {
  await page.getByRole("button", { name: `Ещё о записи «${name}»`, exact: true }).click()
  await page.getByRole("menuitem", { name: "Удалить запись", exact: true }).click()
  const [removed] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "DELETE" && new URL(response.url()).pathname.startsWith("/api/library/"), { timeout }),
    page.getByRole("dialog", { name: `Удалить запись «${name}»?` }).getByRole("button", { name: "Удалить запись", exact: true }).click()
  ])
  assert(removed.ok(), `The studio refused to delete the upload: ${removed.status()}`)
}

const finishedUploadStays: ProductCheck = {
  name: "the owner's finished upload stays on page 1 above more than five older uploads, also when it reuses the name of a take deleted after load, instead of moving to its alphabetical page",
  run: async (page) => {
    page.setDefaultTimeout(timeout)
    const bytes = await Bun.file(join(setting("REELS_BROWSER_DIR"), SOURCE_VIDEO)).bytes()
    const older = Array.from({ length: 6 }, (_, index) => `a-page-${index}.mp4`)
    for (const olderName of older) {
      const start = await fetch(address("/api/library/uploads"), {
        method: "POST",
        headers: { "tus-resumable": "1.0.0", "upload-length": String(bytes.length), "upload-metadata": `filename ${Buffer.from(olderName).toString("base64")}` }
      })
      assert.equal(start.status, 201)
      const location = start.headers.get("location")
      assert(location !== null, "Starting an upload must return its location")
      const finish = await fetch(address(location), {
        method: "PATCH",
        headers: { "tus-resumable": "1.0.0", "upload-offset": "0", "content-type": "application/offset+octet-stream" },
        body: bytes
      })
      assert.equal(finish.status, 204)
    }
    await page.goto(address(STUDIO_PATH))
    const list = page.getByRole("list", { name: "Загруженные записи", exact: true })
    const pages = page.getByRole("navigation", { name: "Страницы записей", exact: true })
    const back = pages.getByRole("button", { name: "Назад", exact: true })
    const next = pages.getByRole("button", { name: "Дальше", exact: true })
    const staysOnFirstPage = async (finished: string): Promise<void> => {
      await list.getByRole("listitem").filter({ has: page.getByText(finished, { exact: true }) }).getByText(READY).waitFor({ timeout: HEARING })
      assert.equal(await list.getByRole("listitem").count(), 5, "Page 1 must still hold at most five uploads")
      assert(await back.isDisabled(), "The finished row must stay on page 1")
    }
    await next.click()
    const name = await pickUpload(page, "z-page-finished.mp4", bytes)
    await staysOnFirstPage(name)
    const row = list.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) })
    await page.getByRole("button", { name: "Новый ролик", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Новый ролик" })
    await dialog.getByRole("textbox", { name: "Название" }).fill("Проверка порядка записей")
    await dialog.getByRole("button", { name: "Создать ролик", exact: true }).click()
    await page.getByRole("heading", { name: "Выберите записи", exact: true, level: 1 }).waitFor()
    await deleteReel(page, "Проверка порядка записей")
    await row.getByText(READY).waitFor()
    await page.reload()
    await list.getByRole("listitem").first().waitFor()
    assert.equal(await row.count(), 0, "Reloading must restore the library order")
    while (await row.count() === 0) {
      assert(await next.isEnabled(), "The finished upload must be on a later page after a reload")
      await next.click()
    }
    await deleteUpload(page, name)
    assert.equal(await pickUpload(page, name, bytes), name, "A deleted name must be free for the next upload")
    await staysOnFirstPage(name)
    await removeUploads([...older, name])
    return { targets: ["more than five older uploads", "new upload resets to page 1", "finished row stays on page 1 through navigation", "reload restores library order", "a take deleted after load and uploaded again under its name stays on page 1"], found: [] }
  }
}

const addedRowsStayBusy: ProductCheck = {
  name: "an added recording stays unavailable until refreshed shelves arrive instead of flashing back as a free checkbox",
  run: async (page) => {
    page.setDefaultTimeout(timeout)
    const [first, second] = await uploadOnStudioPage(page)
    assert(first !== undefined && second !== undefined, "The check needs two distinct uploaded recordings")
    const title = "Проверка обновления записей"
    const id = await createReel(page, title)
    const held = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const path = `**/api/projects/${id}/library`
    await page.route(path, async (route) => {
      const response = await route.fetch()
      held.resolve()
      await release.promise
      await route.fulfill({ response })
    })
    try {
      await boxOf(page, first).check()
      await page.getByRole("button", { name: "Добавить в ролик: 1 запись", exact: true }).click()
      await held.promise
      await boxOf(page, second).check()
      assert.equal(await boxOf(page, first).count(), 0, "A successful add must not become selectable while shelves are stale")
      const earlier = page.getByRole("list", { name: "Загружены раньше", exact: true })
      await earlier.getByRole("listitem").filter({ hasText: first }).getByText("Добавляю в ролик", { exact: true }).waitFor()
      release.resolve()
      await page.getByRole("heading", { name: "1 запись · 0:07", exact: true, level: 1 }).waitFor()
      assert.equal(await boxOf(page, first).count(), 0, "The refreshed offer must omit the added recording")
      assert(await boxOf(page, second).isChecked(), "Refreshing must preserve the other selection")
      await assertSources(id, 1)
    } finally {
      release.resolve()
      await page.unroute(path)
    }
    await deleteReel(page, title)
    await removeUploads([first, second])
    return { targets: ["added recording stays busy during a delayed refresh", "another selection survives the refresh", "one original recording reaches the reel"], found: [] }
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

export const studioChecks = [createListDelete, recordsStep, finishedUploadStays, addedRowsStayBusy, pageWidths, renamePersists, builtStatus] satisfies readonly ProductCheck[]
