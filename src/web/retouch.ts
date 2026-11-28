import { minuteTakes, type RetouchView } from "../shared/retouch.ts"

const NO_CUT = "В монтаже нет ни одного блока. Соберите блоки, и пробу можно будет сделать."

export const spentText = (seconds: number): string => {
  const whole = Math.max(1, Math.round(seconds))
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  if (minutes === 0) return `${rest} с`
  return rest === 0 ? `${minutes} мин` : `${minutes} мин ${rest} с`
}

export const trialStatus = (view: RetouchView): string => {
  const { job } = view
  if (job.state === "waiting") return "Проба ждёт своей очереди: компьютер занят другой тяжёлой работой."
  if (job.state === "running") return `Студия делает пробу: ${Math.floor(job.done * 100)}%`
  if (view.cut === 0) return NO_CUT
  return ""
}

export const costText = (trial: { readonly seconds: number; readonly took: number }): string =>
  `На ${spentText(trial.seconds)} видео ушло ${spentText(trial.took)}. Минута видео займёт около ${spentText(minuteTakes(trial))}.`
