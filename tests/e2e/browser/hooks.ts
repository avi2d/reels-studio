import assert from "node:assert/strict"
import { copyFile, mkdir, mkdtemp, readdir, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ProductCheck } from "@avi2dg/checks/browser-hooks.ts"
import { Schema } from "effect"
import type { Page, Request } from "playwright-core"
import { UploadedVideo } from "../../../src/shared/library.ts"
import { HOME_PATH, STEPS, stepPath } from "../../../src/shared/page.ts"
import { TimelinePage } from "../../../src/shared/timeline.ts"
import { CHAT_PICTURE, CHAT_REPLY, FIRST_WORDS, PLAN_TASK, PLAN_TEXT, SLOW_MESSAGE, SOURCE_VIDEO, TASK_FILE, setting, timeout } from "./scenario.ts"

const HEARING = 60_000

const address = (path: string): string => new URL(path, setting("REELS_BROWSER_URL")).href

const folderExists = (id: string): Promise<boolean> =>
  stat(join(setting("REELS_BROWSER_DIR"), "projects", id)).then(() => true, () => false)

// The heading gains the cut length when it loads.
const montageHeading = (page: Page) => page.getByRole("heading", { name: /^Монтаж(?: \d+:\d{2})?$/u, level: 1 })

const reelId = (page: Page): string => {
  const id = /^\/p\/([a-z0-9-]+)\/records$/u.exec(new URL(page.url()).pathname)?.[1]
  assert(id !== undefined, `Creating a reel must open its first step, it opened ${page.url()}`)
  return id
}

const createReel = async (page: Page, title: string): Promise<string> => {
  await page.goto(address(HOME_PATH))
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
  await page.goto(address(HOME_PATH))
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

const chooseTaskApps = async (page: Page): Promise<void> => {
  const make = page.getByRole("button", { name: "Составить план", exact: true })
  const apps = ["Instagram", "YouTube Shorts", "TikTok"].map((name) => page.getByRole("button", { name, exact: true }))
  for (const app of apps) await app.click()
  assert(await make.isDisabled(), "A reel for no app must not start a plan")
  await page.getByText("Выберите, куда пойдёт ролик.", { exact: true }).waitFor()
  await apps[0]?.click()
  await apps[2]?.click()
  assert(await make.isEnabled(), "Two chosen apps start a plan")
}

const attachTaskFile = async (page: Page): Promise<void> => {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout }),
    page.getByRole("button", { name: "Приложить", exact: true }).click()
  ])
  await chooser.setFiles({ name: TASK_FILE, mimeType: "image/png", buffer: Buffer.from(await Bun.file(join(setting("REELS_BROWSER_DIR"), CHAT_PICTURE)).bytes()) })
  await page.getByRole("list", { name: "Файлы к заданию" }).getByText(TASK_FILE, { exact: true }).waitFor()
}

const approvePlan = async (page: Page, id: string): Promise<void> => {
  await page.getByRole("link", { name: "Дальше: план", exact: true }).click()
  const task = page.getByRole("textbox", { name: "Задание", exact: true })
  const make = page.getByRole("button", { name: "Составить план", exact: true })
  await make.waitFor()
  assert(await make.isDisabled(), "The empty task must not start a plan")
  await task.fill("   ")
  assert(await make.isDisabled(), "Spaces are not a task")
  await task.fill(PLAN_TASK)
  await chooseTaskApps(page)
  await attachTaskFile(page)
  await make.click()
  await page.getByRole("main").getByText(PLAN_TEXT, { exact: true }).waitFor()
  await page.reload()
  assert.equal(await task.inputValue(), PLAN_TASK, "The task must survive a reload")
  assert.equal(await page.getByRole("button", { name: "YouTube Shorts", exact: true }).getAttribute("aria-pressed"), "false", "The unchosen app must stay off after a reload")
  await page.getByRole("list", { name: "Файлы к заданию" }).getByText(TASK_FILE, { exact: true }).waitFor()
  await page.getByRole("button", { name: "Да, делайте", exact: true }).click()
  await page.waitForURL(address(stepPath(id, "montage")), { timeout })
  await montageHeading(page).waitFor()
  await page.getByRole("link", { name: "Шаг 2: План", exact: true }).click()
  const work = page.getByRole("region", { name: "Что сделала студия" })
  await work.getByRole("listitem").filter({ hasText: "«Конец»" }).waitFor()
}

const reusePlanTask = async (page: Page): Promise<void> => {
  const title = "Ролик с прошлым заданием"
  await createReel(page, title)
  await page.getByRole("link", { name: "Шаг 2: План", exact: true }).click()
  await page.getByRole("button", { name: "Как в прошлый раз", exact: true }).click()
  assert.equal(await page.getByRole("textbox", { name: "Задание", exact: true }).inputValue(), PLAN_TASK)
  assert(await page.getByRole("button", { name: "Составить план", exact: true }).isEnabled())
  await deleteReel(page, title)
}

const recordsStep: ProductCheck = {
  name: "two takes uploaded on the studio page read «Готово», step 1 adds both to one reel with one press, one to the next reel, and a pressed word moves the player; a blank task cannot generate a plan and approving a real plan opens «Монтаж» instead of leaving the reel in step 2",
  run: async (page) => {
    page.setDefaultTimeout(timeout)
    const [first, second] = ["Ролик с двумя записями", "Ролик из одной записи"]
    const takes = await uploadOnStudioPage(page)
    await addChosen(page, first, takes)
    await seekByWord(page)
    await deleteReel(page, first)
    const id = await addChosen(page, second, takes.slice(0, 1))
    await approvePlan(page, id)
    await reusePlanTask(page)
    await page.goto(address(stepPath(id, "plan")))
    await deleteReel(page, second)
    await removeUploads(takes)
    return { targets: ["two uploads on the studio page reach «Готово · 0:07»", "step 1 holds no upload picker", "two chosen recordings join the reel with one press", "one chosen recording joins the next reel", "pressed «Конец» moves the player to 0:05", "each reel keeps the original", "empty task blocks the plan", "the studio shows the saved plan and what it did", "one yes opens step 3", "the next reel can reuse the last task"], found: [] }
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
    await page.goto(address(HOME_PATH))
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

const repickedUploads: ProductCheck = {
  name: "re-picked recordings all stay named in a neutral notice instead of overwriting one another or uploading again",
  run: async (page) => {
    page.setDefaultTimeout(timeout)
    const names = await uploadOnStudioPage(page)
    const before = await uploadsNow()
    const uploads: Array<string> = []
    const track = (request: Request): void => {
      if (["POST", "PATCH"].includes(request.method()) && new URL(request.url()).pathname.startsWith("/api/library/uploads")) uploads.push(request.url())
    }
    page.on("request", track)
    try {
      const picker = page.locator('input[type="file"][name="records"]')
      await picker.setInputFiles([join(setting("REELS_BROWSER_DIR"), SOURCE_VIDEO), await secondTake()])
      await page.getByText(/second-take\.mp4.*уже загруж/u).waitFor()
      const notice = page.getByRole("status").filter({ hasText: "уже загружена" })
      assert.equal(await notice.count(), 1, "Skipped recordings must use a neutral status notice, not an error alert")
      const message = await notice.innerText()
      for (const name of names) assert(message.includes(`Запись «${name}» уже загружена.`), `The notice must name the skipped recording ${name}`)
      assert(message.includes("Добавьте их в ролик на шаге «Записи»."), "The notice must explain where to add the recordings")
      assert.equal(await page.getByRole("alert").filter({ hasText: /\S/u }).count(), 0, "Skipping known recordings is not an error")
      assert.deepEqual(await uploadsNow(), before, "Re-picking must not add a hidden library copy")
      assert.deepEqual(uploads, [], "Re-picking must send no upload requests")

      await picker.setInputFiles(join(setting("REELS_BROWSER_DIR"), SOURCE_VIDEO))
      await page.getByText(`Запись «${SOURCE_VIDEO}» уже загружена. Добавьте её в ролик на шаге «Записи».`, { exact: true }).waitFor()
      assert.equal(await notice.innerText(), `Запись «${SOURCE_VIDEO}» уже загружена. Добавьте её в ролик на шаге «Записи».`, "A new pick must clear the previous skipped names")
      assert.deepEqual(uploads, [], "A later re-pick must still send no bytes")
    } finally {
      page.off("request", track)
      await removeUploads(names)
    }
    return { targets: ["every skipped recording named in a neutral notice", "new pick clears the old notice", "no duplicate uploads or library copies"], found: [] }
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

const streamingChat: ProductCheck = {
  name: "stopping a reply from step 3 keeps the streamed words and frees the server for the next message instead of buffering or only hiding the reply",
  run: async (page) => {
    page.setDefaultTimeout(timeout)
    const title = "Ролик с остановленным ответом"
    const id = await createReel(page, title)
    await page.getByRole("link", { name: "Шаг 3: Монтаж", exact: true }).click()
    await montageHeading(page).waitFor()
    await page.getByRole("button", { name: "Чат", exact: true }).click()
    const chat = page.getByRole("dialog", { name: "Чат", exact: true })
    const send = chat.getByRole("button", { name: "Отправить", exact: true })
    await chat.getByRole("textbox", { name: "Сообщение", exact: true }).fill(SLOW_MESSAGE)
    await send.click()
    await chat.getByText(FIRST_WORDS, { exact: true }).waitFor()
    const stop = chat.getByRole("button", { name: "Остановить", exact: true })
    assert(await stop.isEnabled(), "The first words must appear while the model is still working")
    await stop.click()
    await chat.getByText("Ответ остановлен.", { exact: true }).waitFor()
    await stop.waitFor({ state: "hidden" })

    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout }),
      chat.getByRole("button", { name: "Приложить файлы", exact: true }).click()
    ])
    await chooser.setFiles(join(setting("REELS_BROWSER_DIR"), CHAT_PICTURE))
    await send.click()
    await chat.getByText(CHAT_REPLY, { exact: true }).waitFor()
    await stop.waitFor({ state: "hidden" })
    const path = join(setting("REELS_BROWSER_DIR"), "projects", id, "attached", CHAT_PICTURE)
    assert.deepEqual(await Bun.file(path).bytes(), await Bun.file(join(setting("REELS_BROWSER_DIR"), CHAT_PICTURE)).bytes())
    await page.reload()
    await page.getByRole("button", { name: "Чат", exact: true }).click()
    await chat.getByText(FIRST_WORDS, { exact: true }).waitFor()
    await chat.getByText("Ответ остановлен.", { exact: true }).waitFor()
    await chat.getByText(CHAT_REPLY, { exact: true }).waitFor()
    await chat.getByRole("button", { name: "Закрыть чат", exact: true }).click()
    await deleteReel(page, title)
    return { targets: ["reply text arrives before completion", "stop frees the server for the next send", "an attachment keeps its original bytes", "stopped reply survives reload"], found: [] }
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
    const paths = [HOME_PATH, ...STEPS.map((step) => stepPath(id, step))]
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

const savedLinks: ProductCheck = {
  name: "a saved link to /new, /videos or a reel of the old studio opens the matching screen of the studio at / instead of a missing page",
  run: async (page) => {
    page.setDefaultTimeout(timeout)
    const title = "Ролик по сохранённой ссылке"
    const id = await createReel(page, title)
    const opened = async (saved: string): Promise<string> => {
      await page.goto(address(saved))
      await page.getByRole("heading", { level: 1 }).waitFor()
      return new URL(page.url()).pathname
    }
    assert.equal(await opened("/new"), HOME_PATH)
    assert.equal(await opened("/videos"), HOME_PATH)
    assert.equal(await opened(`/new/${id}/plan`), stepPath(id, "plan"))
    assert.equal(await opened(`/new/${id}`), stepPath(id, "records"))
    assert.equal(await opened(`/p/${id}`), stepPath(id, "records"))
    await deleteReel(page, title)
    return { targets: ["/new opens the reel list", "/videos opens the reel list", "/new/<reel>/plan opens step 2", "/new/<reel> and /p/<reel> open step 1"], found: [] }
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
    await page.goto(address(HOME_PATH))
    const card = page.getByRole("link", { name: new RegExp(title, "u") })
    await card.getByText(/· Записи загружены$/u).waitFor()
    await copyFile(join(fixtures, SOURCE_VIDEO), join(reel, video))
    await page.reload()
    await card.getByText(/· Ролики готовы$/u).waitFor()
    assert.equal(await card.getByText("Записи загружены", { exact: false }).count(), 0)
    return { targets: ["uploaded status without a published file", "ready status once the video file is present"], found: [] }
  }
}

const BUILD = 120_000

const sizeOf = async (path: string): Promise<string> => {
  const probe = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], { stdout: "pipe" })
  const size = (await new Response(probe.stdout).text()).trim()
  await probe.exited
  return size
}

const downloadReel = async (page: Page, app: string): Promise<string> => {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: `Скачать для ${app}`, exact: true }).click()])
  const path = join(await mkdtemp(join(tmpdir(), "reels-download-")), "reel.mp4")
  await download.saveAs(path)
  return path
}

const dropFirstBlock = async (page: Page, id: string): Promise<void> => {
  const { timeline } = Schema.decodeUnknownSync(TimelinePage)(await (await page.request.get(address(`/api/projects/${id}/timeline`))).json())
  assert(timeline.state === "ready", "The approved plan must leave a ready montage")
  const first = timeline.blocks[0]?.id
  assert(first !== undefined, "The approved plan must leave a block in the montage")
  const saved = await page.request.put(address(`/api/projects/${id}/timeline`), { data: { base: timeline.edits, edits: { ...timeline.edits, deleted: [...timeline.edits.deleted, first] } } })
  assert(saved.ok(), `The studio refused the montage edit: ${saved.status()}`)
}

const reelsStep: ProductCheck = {
  name: "step 5 builds the reel with progress, downloads a 1080 by 1920 file for each chosen app and none for the unchosen one, reads «Ролики устарели» after a montage edit, and a stopped rebuild keeps the earlier file instead of dropping it",
  run: async (page) => {
    page.setDefaultTimeout(timeout)
    const title = "Ролик до скачивания"
    const takes = await uploadOnStudioPage(page)
    const id = await addChosen(page, title, takes.slice(0, 1))
    await approvePlan(page, id)
    await page.getByRole("link", { name: "Шаг 5: Ролики", exact: true }).click()
    await page.getByRole("heading", { name: "Ролики", exact: true, level: 1 }).waitFor()
    await page.getByRole("button", { name: "Собрать ролик", exact: true }).click()
    await page.getByRole("heading", { name: "Собираю ролики", exact: true, level: 1 }).waitFor()
    await page.getByRole("heading", { name: "Ролики готовы", exact: true, level: 1 }).waitFor({ timeout: BUILD })
    assert.deepEqual(await page.getByRole("tab").allInnerTexts(), ["Instagram", "TikTok"], "Step 5 must show a tab for each chosen app and none for YouTube Shorts")
    assert.equal(await sizeOf(await downloadReel(page, "Instagram")), "1080,1920", "The Instagram reel must be 1080 by 1920")
    await page.getByRole("tab", { name: "TikTok", exact: true }).click()
    assert.equal(await sizeOf(await downloadReel(page, "TikTok")), "1080,1920", "The TikTok reel must be 1080 by 1920")
    const href = await page.getByRole("link", { name: "Скачать для TikTok", exact: true }).getAttribute("href")
    await dropFirstBlock(page, id)
    await page.getByRole("heading", { name: "Ролики устарели", exact: true, level: 1 }).waitFor()
    await page.getByRole("button", { name: "Собрать заново", exact: true }).click()
    await page.getByRole("button", { name: "Остановить", exact: true }).click()
    await page.getByRole("heading", { name: "Ролики устарели", exact: true, level: 1 }).waitFor({ timeout: BUILD })
    assert.equal(await page.getByRole("link", { name: "Скачать для TikTok", exact: true }).getAttribute("href"), href, "A stopped rebuild must keep the earlier file")
    await deleteReel(page, title)
    await removeUploads(takes)
    return { targets: ["«Новый ролик» to step 5", "build progress", "«Ролики готовы» with a tab per chosen app", "the downloaded Instagram and TikTok files are 1080 by 1920", "«Ролики устарели» after a montage edit", "«Остановить» keeps the earlier file"], found: [] }
  }
}

export const checks = [createListDelete, recordsStep, finishedUploadStays, repickedUploads, addedRowsStayBusy, streamingChat, pageWidths, renamePersists, savedLinks, builtStatus, reelsStep] satisfies readonly ProductCheck[]
