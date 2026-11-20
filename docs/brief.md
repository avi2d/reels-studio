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
After the chat model answers that message, the studio works without another question:

- It shows the current take of every block, which is the take ranked first unless the person chose another, as [docs/timeline.md](timeline.md) says.
- It shortens every pause of half a second or more in the shown takes to 0.2 s, except the pauses the person returned.
- It saves the yes with the plan text and a list of what it did to `approval.json`.

The card then lists every chosen take with its reason and the seconds the pauses took off.
Every change stays undoable on the stages «Дубли и блоки» and «Паузы и склейки».
A plan the chat model changes after the yes shows as waiting for a new yes.

## Files

| Path | What it holds |
| --- | --- |
| `brief.md` | The brief the person wrote |
| `plan.md` | The plan of the whole reel, written by the chat model |
| `approval.json` | The plan text the person agreed with, the time of the yes and what the studio did |
