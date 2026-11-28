import { expect, test } from "bun:test"
import { faceOf } from "../../src/server/face.ts"
import { compareArgs, firstSeconds, retouchArgs, retouchedFrames } from "../../src/server/media-commands.ts"
import { splitAt } from "../../src/web/face-compare.ts"
import { costText, faceNext, needsBuild, spentText, trialStatus } from "../../src/web/retouch.ts"

test("the trial takes the first 20 seconds of the cut and shortens the part that crosses them, not the whole part", () => {
  const parts = [{ video: "a", start: 0, frames: 450 }, { video: "b", start: 3, frames: 450 }, { video: "c", start: 0, frames: 30 }]
  expect(firstSeconds(parts, 20)).toEqual([{ video: "a", start: 0, frames: 450 }, { video: "b", start: 3, frames: 150 }])
})

test("a cut shorter than 20 seconds goes to the trial whole, not stretched", () => {
  expect(firstSeconds([{ video: "a", start: 1, frames: 90 }], 20)).toEqual([{ video: "a", start: 1, frames: 90 }])
})

test("only the frames= line of the retouch counts as progress, not a word that starts the same", () => {
  expect(retouchedFrames("frames=60")).toBe(60)
  expect(retouchedFrames("frame=60")).toBeUndefined()
  expect(retouchedFrames("frames=")).toBeUndefined()
})

test("the side by side clip puts the original on the left and keeps its sound, not the retouched one on the left", () => {
  const args = compareArgs("before.mp4", "after.mp4", "libx264", "compare.mp4")
  expect(args.slice(args.indexOf("-i"), args.indexOf("-i") + 4)).toEqual(["-i", "before.mp4", "-i", "after.mp4"])
  expect(args[args.indexOf("-filter_complex") + 1]).toStartWith("[0:v][1:v]hstack")
  expect(args).toContain("0:a:0")
})

test("a time reads in minutes and seconds and never as zero seconds", () => {
  expect(spentText(54.2)).toBe("54 с")
  expect(spentText(120)).toBe("2 мин")
  expect(spentText(162.6)).toBe("2 мин 43 с")
  expect(spentText(0.2)).toBe("1 с")
})

test("54 seconds of work on 20 seconds of video come to 2 min 42 s a minute, not 54 seconds", () => {
  expect(costText({ seconds: 20, took: 54 })).toBe("На 20 с видео ушло 54 с. Минута видео займёт около 2 мин 42 с.")
})

test("the trial status names the queue, the share done and an empty cut, and says nothing when idle", () => {
  expect(trialStatus({ job: { state: "waiting" }, cut: 30, face: "off" })).toBe("Проба ждёт своей очереди: компьютер занят другой тяжёлой работой.")
  expect(trialStatus({ job: { state: "running", done: 0.456 }, cut: 30, face: "off" })).toBe("Студия делает пробу: 45%")
  expect(trialStatus({ job: { state: "idle" }, cut: 0, face: "off" })).toBe("В монтаже нет ни одного блока. Соберите блоки, и пробу можно будет сделать.")
  expect(trialStatus({ job: { state: "idle" }, cut: 30, face: "off" })).toBe("")
})

test("a project with no face file or a broken one reads as off, so her face is never changed without her choice", () => {
  expect(faceOf(undefined)).toBe("off")
  expect(faceOf("not json")).toBe("off")
  expect(faceOf(JSON.stringify({ face: "strong" }))).toBe("off")
  expect(faceOf(JSON.stringify({ face: "light" }))).toBe("light")
})

const trial = { made: "m", seconds: 20, took: 54 }
const view = (face: "off" | "light", built?: "off" | "light") =>
  ({ job: { state: "idle" as const }, cut: 30, face, trial, ...(built === undefined ? {} : { built }) })

test("the face line asks for a trial first when there is none, not for a rebuild of a face she has not seen", () => {
  expect(faceNext({ job: { state: "idle" }, cut: 30, face: "off" })).toBe("Сначала сделайте пробу и сравните лицо до и после. Потом здесь можно включить выравнивание.")
})

test("the face line says the file already has the chosen face instead of asking for a needless rebuild", () => {
  expect(faceNext(view("light", "light"))).toBe("Включено. Готовый ролик уже собран с выровненным лицом.")
  expect(faceNext(view("off", "off"))).toBe("Выключено. Лицо в готовом ролике остаётся как в исходных видео.")
  expect(needsBuild(view("light", "light"))).toBe(false)
  expect(needsBuild(view("off", "off"))).toBe(false)
})

test("turning the face on after the file was built asks for a rebuild, not a silent no-op", () => {
  expect(faceNext(view("light", "off"))).toBe("Включено, но готовый ролик собран без выравнивания. Нажмите «Собрать ролик с выровненным лицом»: студия соберёт его заново.")
  expect(faceNext(view("off", "light"))).toBe("Выключено, но готовый ролик собран с выровненным лицом. Нажмите «Собрать ролик заново», чтобы вернуть исходное лицо.")
  expect(needsBuild(view("light", "off"))).toBe(true)
  expect(needsBuild(view("off", "light"))).toBe(true)
})

test("with no file yet only the face turned on offers a build, since off changes nothing", () => {
  expect(needsBuild(view("light"))).toBe(true)
  expect(needsBuild(view("off"))).toBe(false)
})

test("the split line follows the pointer and stops at the frame edges instead of leaving it", () => {
  expect(splitAt(150, 100, 200)).toBe(25)
  expect(splitAt(50, 100, 200)).toBe(0)
  expect(splitAt(400, 100, 200)).toBe(100)
})

test("the reel retouch writes no face close-ups, while the trial still asks for them", () => {
  expect(retouchArgs("/g", { before: "/w/in.mp4", folder: "/w/face", closeUp: false }, "libx264")).toEqual(
    ["run", "--project", "/g", "python", "/g/retouch.py", "--encoder", "libx264", "--no-close-up", "/w/in.mp4", "/w/face"])
  expect(retouchArgs("/g", { before: "/w/in.mp4", folder: "/w/trial", closeUp: true }, "libx264")).toEqual(
    ["run", "--project", "/g", "python", "/g/retouch.py", "--encoder", "libx264", "--close-up-from", "3", "/w/in.mp4", "/w/trial"])
})
