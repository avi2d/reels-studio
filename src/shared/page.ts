export const HOME_PATH = "/"
export const PROJECT_PREFIX = "/p/"

export const projectPath = (id: string) => `${PROJECT_PREFIX}${id}` as const

export const STEPS = ["records", "plan", "montage", "look", "done"] as const
export type Step = typeof STEPS[number]

export const isStep = (name: string): name is Step => STEPS.some((step) => step === name)

export const stepPath = (id: string, step: Step) => `${projectPath(id)}/${step}` as const
