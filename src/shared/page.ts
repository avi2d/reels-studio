export const HOME_PATH = "/"
export const VIDEOS_PATH = "/videos"
export const PROJECT_PREFIX = "/p/"
export const STUDIO_PATH = "/new"

export const projectPath = (id: string) => `${PROJECT_PREFIX}${id}` as const

export const STEPS = ["records", "plan", "montage", "look", "done"] as const
export type Step = typeof STEPS[number]

export const isStep = (name: string): name is Step => STEPS.some((step) => step === name)

export const stepPath = (id: string, step: Step) => `${STUDIO_PATH}/${id}/${step}` as const
