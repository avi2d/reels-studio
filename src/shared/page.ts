export const HOME_PATH = "/"
export const VIDEOS_PATH = "/videos"
export const PROJECT_PREFIX = "/p/"

export const projectPath = (id: string) => `${PROJECT_PREFIX}${id}` as const
