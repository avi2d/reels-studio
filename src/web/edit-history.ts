import { mergeEdits, type Edits } from "../shared/timeline.ts"

interface Step {
  readonly before: Edits
  readonly after: Edits
}

export interface EditHistory {
  readonly change: (edits: Edits) => void
  readonly undo: () => void
  readonly redo: () => void
  readonly canUndo: () => boolean
  readonly canRedo: () => boolean
}

// An undone step is merged into the current edits, so a server change that came in after the step survives the undo.
export const editHistory = (current: () => Edits, apply: (edits: Edits) => void): EditHistory => {
  const done: Array<Step> = []
  const undone: Array<Step> = []
  return {
    change: (edits) => {
      done.push({ before: current(), after: edits })
      undone.length = 0
      apply(edits)
    },
    undo: () => {
      const step = done.pop()
      if (step === undefined) return
      undone.push(step)
      apply(mergeEdits(step.after, step.before, current()))
    },
    redo: () => {
      const step = undone.pop()
      if (step === undefined) return
      done.push(step)
      apply(mergeEdits(step.before, step.after, current()))
    },
    canUndo: () => done.length > 0,
    canRedo: () => undone.length > 0
  }
}
