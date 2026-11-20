# The Project Manager board

The **Decisões** tab, right after Board, is the Project Manager's own board: investigations,
proposals and decisions between the user and the PM. The task board keeps code tasks and code
reviews. A card here never starts an agent or a workspace, so it cannot do code work; a review by a
fresh agent needs the task board and its orchestrator.

## Cards

A card has a **kind** and a **status** (its column):

| kind            | starts in       | what it is                                                    |
| --------------- | --------------- | ------------------------------------------------------------- |
| `investigation` | Investigating   | something the PM is looking into; its findings grow           |
| `proposal`      | Waiting for you | a choice for the user: question, options with gains and costs |
| `decision`      | Decided         | a call the PM already made alone (`decidedBy: pm`)            |
| `notice`        | Decided         | information the user should track; use it sparingly           |

Columns: **Investigating · Esperando você · Decidido · Arquivado**. A "pending decision" is a
proposal in Esperando você; a decided card records `decidedBy` (`user` or `pm`) and `decidedAt`
only when the update moves it into Decidido, or when its kind is `decision`. A `notice` starts
Decidido without a decider, and updating it never makes it read "decided by the Project Manager".

The board holds 500 cards as a soft limit. Creating a card past it drops only the oldest
**Archived** cards; an active card is never deleted. When nothing is archived the board passes the
limit and the daemon log says so, so an investigation or a proposal is not lost to a new notice.

The data lives in `data.assistant.pmBoard` (the board's own store), and the page reads it through
`workboard.assistant.pm.cards` at its own poll, so the task board's 1.5 s snapshot does not grow.

## The PM writes

The PM uses `pm_card_create`, `pm_card_update`, `pm_card_decide` and `pm_card_archive`, in the same
MCP as the `board_*` tools. `board_overview` adds a `Project Manager board` section with the counts
and the cards waiting for the user.

- Create a **proposal** when the user must choose: `question`, `options` (`{id, label, gains,
costs}`) and `recommend`. Do not ask an empty question.
- Record a **decision** with `decision` and `decidedBy: pm` when the call is the PM's. The user can
  reopen it.
- Move an **investigation** to `waiting` when it needs the user.
- Use a **notice** only when the user should track something, not for every event.
- `pm_card_decide` on a `proposal` needs an `answer` or one of the card's options; on a
  `decision` it needs a non-empty `decision` or `answer`. `pm_card_update` with status `decided`
  needs one of the two for either kind. Closing a card without it fails with a message instead of
  leaving a decided card nobody answered.

A reply that needs a decision ends its `seu` line with the card id: `seu: decidir <x>
[pm:pm-abc12345]`. The chat draws it as a link to the card.

## The user answers

On a proposal in Esperando você, each option is a button (label, gains, costs) and there is a
free-text field. One tap calls `workboard.assistant.pm.card.decide`, which:

1. moves the card to Decidido with `decidedBy: user`, `decidedAt`, the chosen option and the answer;
2. sends `Resposta a "<question>" no card <id>: escolho <option> (<label>).` to the PM chat as a
   message, so the PM can act on it.

**Reabrir** on a decided card moves it back to Esperando você, clears the decision, and tells the
PM. If the message cannot be sent, the card still moves and the page says so.

Cards can link to tasks and their Reports tickets by id (`links.taskIds`, `links.reportIds`). A
task chip shows `#N` when the ticket has a number (the id's first 8 characters otherwise) and opens
the ticket in the board's side panel; a report chip opens the ticket in Reports.

## Packages on this board

A package's gate failure opens one `investigation` card linked to the package
(`links.packageIds`) and, when the bisect finds one, to the suspect ticket (`links.taskIds`). A
later failure updates the same open investigation instead of creating another. A tier the PM
changes with `board_set_test_tier` records a `decision` card (`#N moved to gate`) with the reason,
and the risk rule's automatic escalation does the same. `board_overview` lists the open packages
with their merged counts, last gate and suspect; `board_package_history` reads one package's runs.
The board's cards are not a place to start code work: a package's correction still goes through the
task board.

## What stays on the task board

Code tasks, their orchestrators and their deliveries are unchanged. Code reviews, including the
fresh-agent review of a critical change, are tasks with an agent and stay on the task board. The
PM's Needs you list still holds only delivery reasons; the cards waiting for the user are counted on
the Decisões tab.
