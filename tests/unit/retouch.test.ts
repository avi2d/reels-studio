import { expect, test } from "bun:test"
import { faceOf } from "../../src/server/face.ts"
import { compareArgs, firstSeconds, retouchArgs, retouchedFrames } from "../../src/server/media-commands.ts"
import { costText, faceHint, spentText, trialStatus } from "../../src/web/retouch.ts"

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

test("the face choice asks for a trial first when there is none, not for a rebuild of a face she has not seen", () => {
  expect(faceHint({ job: { state: "idle" }, cut: 30, face: "off" })).toBe("Чтобы выбрать «Слегка выровнять», сначала сделайте пробу и сравните лицо до и после.")
  expect(faceHint({ job: { state: "idle" }, cut: 30, face: "off", trial: { made: "m", seconds: 20, took: 54 } })).toBe("Новый выбор попадёт в файл при следующей сборке на вкладке «Готовый ролик».")
})

test("the reel retouch writes no face close-ups, while the trial still asks for them", () => {
  expect(retouchArgs("/g", { before: "/w/in.mp4", folder: "/w/face", closeUp: false }, "libx264")).toEqual(
    ["run", "--project", "/g", "python", "/g/retouch.py", "--encoder", "libx264", "--no-close-up", "/w/in.mp4", "/w/face"])
  expect(retouchArgs("/g", { before: "/w/in.mp4", folder: "/w/trial", closeUp: true }, "libx264")).toEqual(
    ["run", "--project", "/g", "python", "/g/retouch.py", "--encoder", "libx264", "/w/in.mp4", "/w/trial"])
})
