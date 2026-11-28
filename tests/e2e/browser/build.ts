import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Option, Schema } from "effect"
import type { Page } from "playwright-core"
import { ReelView } from "../../../src/shared/reel.ts"
import { address, timeout } from "./scenario.ts"

export const BUILD = 120_000

export const sizeOf = async (path: string): Promise<string> => {
  const probe = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], { stdout: "pipe" })
  const size = (await new Response(probe.stdout).text()).trim()
  await probe.exited
  return size
}

export const downloadReel = async (page: Page, app: string): Promise<string> => {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: `Скачать для ${app}`, exact: true }).click()])
  const path = join(await mkdtemp(join(tmpdir(), "reels-download-")), "reel.mp4")
  await download.saveAs(path)
  return path
}

export const waitForBuilt = async (page: Page, id: string): Promise<void> => {
  const heading = page.getByRole("heading", { level: 1 })
  try {
    await page.getByRole("heading", { name: "Ролики готовы", exact: true, level: 1 }).waitFor({ timeout: BUILD })
  } catch (cause) {
    const screen = await heading.textContent({ timeout })
    const response = await page.request.get(address(`/api/projects/${id}/reel`), { timeout })
    const view = Schema.decodeUnknownOption(ReelView)(await response.json())
    const state = Option.match(view, {
      onNone: () => ({ status: response.status() }),
      onSome: ({ job, file }) => ({ job, fresh: file?.fresh, status: response.status() })
    })
    throw new Error(`Step 5 did not show ready reels. Heading: ${screen}. Server: ${JSON.stringify(state)}`, { cause })
  }
}
