---
kind: reference
---
# The brief and the one plan

Each reel keeps a brief the person writes, one plan the chat model answers it with, and one yes.

## The brief

The stage «Видео и задание» holds the field «Задание».
«Составить план» saves the text to `brief.md` and asks the chat model for one plan of the whole reel.
The chat model reads the brief with every message and cannot write it.
A brief holds at most 4,000 characters.

## The plan and the yes

The chat model writes the plan to `plan.md`, and the card «План ролика» shows it as written.
The plan covers every stage the studio can do, the takes, the pauses, the chosen apps, the task files and the open questions.
The person agrees by pressing «Согласна» under the plan, or by writing «Согласна» or «Согласен» as the whole message.
After the chat model answers that message, or the request is cut, the studio works in the background without another question:

- When a gathering runs or is due, the studio is still hearing a video, or the gaze of a heard video has not settled yet, the yes waits for it to finish, then pins the takes and writes the list.
- It pins the shown take of every block in `timeline.json`, while that take still exists, so later gatherings keep it.
The take is the take ranked first unless the person chose another, as [docs/timeline.md](timeline.md) says.
Before the yes the studio pins nothing.
- It shortens the pauses of half a second or more left in the shown takes to the seconds of the pause rule, except the pauses the person returned.
The pause rule is 0.2 s unless the reel's rules say another, as [docs/timeline.md](timeline.md) says.
- It saves the yes with the plan text, the `texts.json` contents captured at the yes, and a list of what it did to `approval.json`.
Removing a reel stops this work the same way it stops a gathering.

While the studio works after the yes, the card hides «Согласна» and updates itself when the list is ready.
The card then lists every chosen take with its reason and every shortened pause in them, whenever it was shortened, with the seconds the pauses took off.
Every change stays undoable on the stages «Дубли и блоки» and «Паузы и склейки».
A change to `plan.md` or `texts.json` after the yes makes the plan wait for a new yes.
Adding or removing `texts.json` also requires a new yes.
An approval saved without a text snapshot stays valid while the project has no `texts.json`.

## The new studio at `/new`

On step «План», «Как в прошлый раз» fills an empty task with the last task from another reel.
Under the task, «Куда» holds a button for each app: Instagram, YouTube Shorts and TikTok.
A new reel goes to every app, and a plan needs at least one.
«Файлы» lists the files for the task, and «Приложить» adds up to 10.
A file removed with «Убрать» stays in `attached/`, but the plan, the inserts and the chat model's list of attached files no longer include it, unless a chat message names it.
«Составить план» uploads the new files, saves the task, the apps and the files, and asks for a plan.
The chat model gets the chosen apps and the task files with every message, and the plan names them.
After you press «Да, делайте», the studio finishes the work and opens «Монтаж».
To see what the studio did, return to «План».

«Чат» is available on every step.
Replies appear as the model writes them.
«Остановить» ends the current reply and keeps the text that arrived.
It does not undo work the studio already started after a yes.
Files for the chat go through «Приложить файлы».

## Files

| Path | What it holds |
| --- | --- |
| `brief.md` | The brief the person wrote |
| `task.json` | The apps the person chose and the names of the task files in `attached/` |
| `plan.md` | The plan of the whole reel, written by the chat model |
| `approval.json` | The approved plan, the `texts.json` snapshot or null when absent, the time of the yes, and what the studio did |
