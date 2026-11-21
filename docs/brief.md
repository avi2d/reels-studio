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
The plan covers every stage the studio can do, the takes, the pauses, the players and the open questions.
The person agrees by pressing «Согласна» under the plan, or by writing «Согласна» or «Согласен» as the whole message.
After the chat model answers that message, or the request is cut, the studio works in the background without another question:

- When a gathering runs or is due, the yes waits for it to finish, then pins the takes and writes the list.
- It pins the shown take of every block in `timeline.json`, while that take still exists, so later gatherings keep it.
The take is the take ranked first unless the person chose another, as [docs/timeline.md](timeline.md) says.
Before the yes the studio pins nothing.
- It shortens the pauses of half a second or more left in the shown takes to 0.2 s, except the pauses the person returned.
- It saves the yes with the plan text and a list of what it did to `approval.json`.
Removing a reel stops this work the same way it stops a gathering.

While the studio works after the yes, the card hides «Согласна» and updates itself when the list is ready.
The card then lists every chosen take with its reason and every shortened pause in them, whenever it was shortened, with the seconds the pauses took off.
Every change stays undoable on the stages «Дубли и блоки» and «Паузы и склейки».
A plan the chat model changes after the yes shows as waiting for a new yes.

## Files

| Path | What it holds |
| --- | --- |
| `brief.md` | The brief the person wrote |
| `plan.md` | The plan of the whole reel, written by the chat model |
| `approval.json` | The plan text the person agreed with, the time of the yes and what the studio did |
