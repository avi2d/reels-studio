import { Schema } from "effect"

export const ProjectId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/))

export const Effort = Schema.Literals(["low", "medium", "high"])
export type Effort = typeof Effort.Type

export const Project = Schema.Struct({
  id: ProjectId,
  title: Schema.String,
  createdAt: Schema.String,
  model: Schema.optionalKey(Schema.String),
  effort: Schema.optionalKey(Effort)
})

export const ProjectTitleInput = Schema.Struct({ title: Schema.String })

export const ProjectView = Schema.Struct({
  ...Project.fields,
  stage: Schema.Literals(["created", "uploaded"]),
  status: Schema.Literals(["created", "uploaded", "built"]),
  files: Schema.Array(Schema.Struct({ name: Schema.String, size: Schema.Finite })),
  cover: Schema.optionalKey(Schema.String)
})
export type ProjectView = typeof ProjectView.Type
