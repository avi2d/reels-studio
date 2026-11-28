import { Effect, Schema } from "effect"
import { Face } from "./face.ts"

export const SubtitleStyle = Schema.Literals(["brand", "plate", "example"])
export type SubtitleStyle = typeof SubtitleStyle.Type

export const SubtitleSize = Schema.Literals(["normal", "large"])
export type SubtitleSize = typeof SubtitleSize.Type

export const SubtitleLook = Schema.Struct({ style: SubtitleStyle, size: SubtitleSize })
export type SubtitleLook = typeof SubtitleLook.Type

export const PLATE_LONGEST = 40

export const NamePlate = Schema.Struct({ shown: Schema.Boolean, text: Schema.String.check(Schema.isMaxLength(PLATE_LONGEST)) })
export type NamePlate = typeof NamePlate.Type

export const BRAND_SUBTITLES: SubtitleLook = { style: "brand", size: "normal" }
const NO_PLATE: NamePlate = { shown: false, text: "" }

export const Looks = Schema.Struct({
  face: Face.pipe(Schema.withDecodingDefaultKey(Effect.succeed("off" as const))),
  subtitles: SubtitleLook.pipe(Schema.withDecodingDefaultKey(Effect.succeed(BRAND_SUBTITLES))),
  plate: NamePlate.pipe(Schema.withDecodingDefaultKey(Effect.succeed(NO_PLATE)))
})
export type Looks = typeof Looks.Type

export const NO_LOOKS: Looks = { face: "off", subtitles: BRAND_SUBTITLES, plate: NO_PLATE }

const Colour = Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/iu))

export const ExampleSubtitles = Schema.Struct({
  font: Schema.Literals(["serif", "sans"]),
  colour: Colour,
  outline: Schema.NullOr(Colour),
  box: Schema.NullOr(Colour),
  capitals: Schema.Boolean
})
export type ExampleSubtitles = typeof ExampleSubtitles.Type

export const TitlePlace = Schema.Literals(["top", "middle"])
export type TitlePlace = typeof TitlePlace.Type

export const ExampleLook = Schema.Struct({
  took: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1), Schema.isMaxLength(3)),
  subtitles: ExampleSubtitles,
  title: TitlePlace
})
export type ExampleLook = typeof ExampleLook.Type

export const LooksView = Schema.Struct({
  subtitles: SubtitleLook,
  plate: NamePlate,
  example: Schema.optionalKey(ExampleLook)
})
export type LooksView = typeof LooksView.Type

export const NewLooks = Schema.Struct({ subtitles: Schema.optionalKey(SubtitleLook), plate: Schema.optionalKey(NamePlate) })
export type NewLooks = typeof NewLooks.Type
