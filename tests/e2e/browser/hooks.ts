import assert from "node:assert/strict"
import { join } from "node:path"
import type { ProductCheck } from "@avi2dg/checks/browser-hooks.ts"
import type { Page } from "playwright-core"
import { CHAT_PICTURE, CHAT_REPLY, SOURCE_VIDEO } from "./scenario.ts"

const timeout = 20_000

const setting = (name: "REELS_BROWSER_DIR" | "REELS_BROWSER_URL"): string => {
  const value = process.env[name]
  assert(value !== undefined, `The browser runner must set ${name}`)
  return value
}

const createProject = async (page: Page, title: string): Promise<void> => {
  page.setDefaultTimeout(timeout)
  await page.goto(setting("REELS_BROWSER_URL"))
  await page.getByRole("button", { name: "Новый ролик", exact: true }).click()
  await page.getByRole("textbox", { name: "Название" }).fill(title)
  await page.getByRole("button", { name: "Создать ролик", exact: true }).click()
  await page.getByRole("heading", { name: title, exact: true }).waitFor()
}

const projectFolder = (page: Page): string => {
  const id = /^\/p\/([a-z0-9-]+)$/.exec(new URL(page.url()).pathname)?.[1]
  assert(id !== undefined, "Creating a reel must open its project")
  return join(setting("REELS_BROWSER_DIR"), "projects", id)
}

const assertOriginal = async (folder: string, shelf: "source" | "attached", name: string): Promise<void> => {
  const uploaded = await Bun.file(join(folder, shelf, name)).bytes()
  const fixture = await Bun.file(join(setting("REELS_BROWSER_DIR"), name)).bytes()
  assert.deepEqual(uploaded, fixture, `The studio did not keep the original ${name}`)
}

const listedNames = (body: unknown): ReadonlyArray<unknown> =>
  typeof body === "object" && body !== null && "videos" in body && Array.isArray(body.videos)
    ? body.videos.map((video: unknown) => typeof video === "object" && video !== null && "name" in video ? video.name : undefined)
    : []

const uploadOnVideosPage = async (page: Page): Promise<void> => {
  page.setDefaultTimeout(timeout)
  await page.goto(setting("REELS_BROWSER_URL"))
  await page.getByRole("heading", { name: "Студия Reels", exact: true }).waitFor()
  assert.equal(await page.getByRole("region", { name: "Загруженные видео" }).count(), 0, "The main page must not show the uploaded videos")
  const [listed] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/library", { timeout }),
    page.getByRole("link", { name: "Загрузить видео", exact: true }).click()
  ])
  await page.getByRole("heading", { name: "Загруженные видео", exact: true }).waitFor()
  if (!listedNames(await listed.json()).includes(SOURCE_VIDEO)) {
    await page.locator('input[type="file"][accept="video/*"]').setInputFiles(join(setting("REELS_BROWSER_DIR"), SOURCE_VIDEO))
  }
  await page.getByRole("region", { name: "Загруженные видео" }).getByRole("listitem").filter({ hasText: SOURCE_VIDEO })
    .getByRole("button", { name: `Посмотреть видео «${SOURCE_VIDEO}»`, exact: true }).waitFor()
}

const addFromList = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Выбрать видео", exact: true }).click()
  await page.getByRole("checkbox", { name: new RegExp(`^${SOURCE_VIDEO}`, "u") }).check()
  await page.getByRole("button", { name: "Добавить 1 видео", exact: true }).click()
  await page.locator(".files").getByText(SOURCE_VIDEO, { exact: true }).waitFor()
}

const directVideos: ProductCheck = {
  name: "opening /videos directly renders the uploaded videos page instead of returning 404",
  run: async (page) => {
    const address = new URL("/videos", setting("REELS_BROWSER_URL")).href
    const response = await page.goto(address)
    assert.equal(response?.status(), 200)
    await page.getByRole("heading", { name: "Загруженные видео", exact: true }).waitFor()
    assert.equal(page.url(), address)
    return { targets: ["the uploaded videos page at /videos"], found: [] }
  }
}

const savedVideosLink: ProductCheck = {
  name: "opening a saved videos link does not leave #/videos in the address bar",
  run: async (page) => {
    const base = setting("REELS_BROWSER_URL")
    await page.goto("about:blank")
    await page.goto(new URL("/#/videos", base).href)
    await page.getByRole("heading", { name: "Загруженные видео", exact: true }).waitFor()
    assert.equal(page.url(), new URL("/videos", base).href)
    return { targets: ["the saved videos address opens /videos"], found: [] }
  }
}

const projectAndUpload: ProductCheck = {
  name: "a video uploaded on the videos page reaches a reel only by picking it, with its original bytes",
  run: async (page) => {
    const title = "Ролик для монтажа"
    await uploadOnVideosPage(page)
    await assertOriginal(join(setting("REELS_BROWSER_DIR"), "projects", ".library"), "source", SOURCE_VIDEO)
    await createProject(page, title)
    assert.equal(await page.locator('input[type="file"][accept="video/*"]').count(), 0, "A reel must not offer its own video upload")
    await addFromList(page)
    await page.getByRole("link", { name: "Все ролики" }).click()
    const tile = page.getByRole("link", { name: new RegExp(title, "u") })
    await tile.getByText("Видео: 1", { exact: true }).waitFor()
    await tile.click()
    await page.getByRole("heading", { name: title, exact: true }).waitFor()
    await assertOriginal(projectFolder(page), "source", SOURCE_VIDEO)
    return { targets: ["main page without the uploaded list", "uploaded original on the videos page", "reel without its own upload", "picked original after reopening"], found: [] }
  }
}

const saveEdit = async (page: Page, edit: () => Promise<void>): Promise<void> => {
  const [saved] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname.endsWith("/timeline"), { timeout }),
    edit()
  ])
  assert(saved.ok(), `The timeline did not save: ${saved.status()}`)
}

const buildBlocks = async (page: Page): Promise<void> => {
  await uploadOnVideosPage(page)
  await createProject(page, "Сборка ролика")
  await addFromList(page)
  await page.locator('wa-tab[panel="takes"]').click()
  await page.getByRole("button", { name: "Собрать блоки", exact: true }).click()
  await page.getByText("Блоки готовы.", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Закрыть чат" }).click()
  await page.getByRole("heading", { name: "Блок 1. Начало", exact: true }).waitFor()
}

const changeCut = async (page: Page): Promise<void> => {
  const timeline = page.getByRole("region", { name: "Монтаж" })
  await saveEdit(page, () => page.getByRole("radio", { name: /^Дубль 2/u }).check())
  await timeline.getByRole("button", { name: "Блок 2. Конец" }).click()
  await saveEdit(page, () => timeline.getByRole("button", { name: /^Переместить блок «Конец»/u }).press("ArrowLeft"))
  await page.locator('wa-tab[panel="pauses"]').click()
  await page.getByText("Блоков: 2 · ролик 0:05 · пауз: 1 на 0:02", { exact: true }).waitFor()
  await saveEdit(page, () => page.getByRole("button", { name: /^Убрать паузу 1,5 с в блоке 2$/u }).click())
}

const verifyPlayback = async (page: Page): Promise<void> => {
  const map = page.getByRole("navigation", { name: "Весь ролик" })
  const first = map.getByRole("button", { name: "Блок 1. Конец" })
  await first.click()
  const seeks = "browser-check-seek"
  await page.getByRole("region", { name: "Просмотр" }).locator("video.player").evaluate((node, name) => {
    if (!(node instanceof HTMLVideoElement)) throw new Error("The player is not a video")
    node.addEventListener("seeked", () => performance.mark(name, { detail: node.currentTime }))
  }, seeks)
  await page.getByRole("button", { name: "Смотреть с этого блока" }).click()
  await first.and(page.locator(".playing")).waitFor()
  await page.waitForFunction((name) => {
    const times = performance.getEntriesByName(name).flatMap((entry) =>
      entry instanceof PerformanceMark && typeof entry.detail === "number" ? [entry.detail] : [])
    const chosen = times.findIndex((time) => time >= 1.95 && time < 2.15)
    return chosen >= 0 && times.slice(chosen + 1).some((time) => time >= 3.85 && time < 4.1)
  }, seeks, { timeout })
}

const preview: ProductCheck = {
  name: "the built preview plays the saved block order and chosen take and skips the removed pause",
  run: async (page) => {
    await buildBlocks(page)
    await changeCut(page)
    await page.reload()
    await page.getByText("Блоков: 2 · ролик 0:04 · пауз нет", { exact: true }).waitFor()
    await verifyPlayback(page)
    return { targets: ["saved cut duration", "reordered first block", "chosen take and pause seek"], found: [] }
  }
}

const attachment: ProductCheck = {
  name: "a picture-only message delivers the file to chat and does not lose it on reload",
  run: async (page) => {
    await createProject(page, "Ролик с картинкой")
    await page.getByRole("button", { name: "Чат", exact: true }).click()
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout }),
      page.getByRole("button", { name: "Приложить файлы", exact: true }).click()
    ])
    await chooser.setFiles(join(setting("REELS_BROWSER_DIR"), CHAT_PICTURE))
    await page.getByRole("list", { name: "Файлы к сообщению" }).getByText(CHAT_PICTURE, { exact: true }).waitFor()
    const [sent] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/chat")),
      page.getByRole("button", { name: "Отправить", exact: true }).click()
    ])
    assert(sent.ok(), `Chat refused the picture: ${sent.status()}`)
    await page.getByText(CHAT_REPLY, { exact: true }).waitFor()
    await page.getByRole("status").waitFor({ state: "detached", timeout })
    assert.equal(await page.getByText("Ответ не дошёл").count(), 0, "The chat reply did not finish")
    await assertOriginal(projectFolder(page), "attached", CHAT_PICTURE)
    await page.reload()
    await page.getByRole("button", { name: "Чат", exact: true }).click()
    await page.getByRole("list", { name: "Приложенные файлы" }).getByText(CHAT_PICTURE, { exact: true }).waitFor()
    await page.getByText(CHAT_REPLY, { exact: true }).waitFor()
    return { targets: ["original picture", "saved attachment", "saved reply"], found: [] }
  }
}

const removeUploaded = async (page: Page): Promise<void> => {
  page.setDefaultTimeout(timeout)
  await page.goto(new URL("/videos", setting("REELS_BROWSER_URL")).href)
  const item = page.getByRole("region", { name: "Загруженные видео" }).getByRole("listitem").filter({ hasText: SOURCE_VIDEO })
  await item.getByRole("button", { name: `Удалить видео «${SOURCE_VIDEO}»`, exact: true }).click()
  const [removed] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "DELETE" && new URL(response.url()).pathname.startsWith("/api/library/"), { timeout }),
    page.getByRole("dialog", { name: `Удалить видео «${SOURCE_VIDEO}»?` }).getByRole("button", { name: "Удалить видео", exact: true }).click()
  ])
  assert(removed.ok(), `The studio refused to delete the video: ${removed.status()}`)
  await item.waitFor({ state: "detached" })
}

const removal: ProductCheck = {
  name: "deleting an uploaded video drops its card and shared file without taking the copy out of a reel that uses it",
  run: async (page) => {
    await removeUploaded(page)
    const shared = join(setting("REELS_BROWSER_DIR"), "projects", ".library", "source", SOURCE_VIDEO)
    assert.equal(await Bun.file(shared).exists(), false, "Deleting must remove the uploaded file")
    await page.goto(setting("REELS_BROWSER_URL"))
    await page.getByRole("link", { name: /Сборка ролика/u }).click()
    await page.getByRole("heading", { name: "Сборка ролика", exact: true }).waitFor()
    await assertOriginal(projectFolder(page), "source", SOURCE_VIDEO)
    return { targets: ["card removed", "shared file removed", "reel copy kept"], found: [] }
  }
}

export const checks = [directVideos, savedVideosLink, projectAndUpload, preview, attachment, removal] satisfies readonly ProductCheck[]
