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
[pm:pm-abc12345]`. The chat draws it as a link to the card. In that reply's `opção` lines, use the
card's option ids, so a tap in the chat decides the card (the chat falls back to the label).

## The user answers

On a proposal in Esperando você, each option is a button (label, gains, costs) and there is a
free-text field. One tap calls `workboard.assistant.pm.card.decide`, which:

1. moves the card to Decidido with `decidedBy: user`, `decidedAt`, the chosen option and the answer;
2. sends `Resposta a "<question>" no card <id>: escolho <option> (<label>).` to the PM chat as a
   message, so the PM can act on it.

**Reabrir** on a decided card moves it back to Esperando você, clears the decision, and tells the
PM. If the message cannot be sent, the card still moves and the page says so.

## The chat follows the card

A reply whose `seu` line (or, without one, its `pergunta`) cites `[pm:<id>]` reads the card's live
state through the same `workboard.assistant.pm.cards` query as the Decisões page: one query key per
host, polled every 5 s, refreshed at once after a decide or a reopen on either side. Old replies in
the history follow it too. The mapping is `replyCardView` in
[`shared/reply-card-sync.ts`](../shared/reply-card-sync.ts):

| card                         | the reply's block                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| Investigando, Esperando você | pending, as before: amber `seu`, open options                                            |
| Decidido                     | green: the chosen option marked, the others faded, "decidido por você/pelo PM em <hora>" |
| Arquivado                    | neutral, "arquivado"                                                                     |
| gone, or not loaded yet      | as before                                                                                |

Reopening the card turns the block back to pending. The chosen option is the block's option with
the card's `answerOptionId`, else with the same label; a written answer with no matching option
shows after the "decidido" line.

Every decision has to land on the card, or the chat stays amber. There are four ways:

1. **The user on the Decisões page:** the page calls `workboard.assistant.pm.card.decide`.
2. **The user in the chat.** A tap on an option of a block whose card waits in Esperando você
   calls the same RPC, with the card's matching option, or the option's label as the answer when
   none matches. The board records `decidedBy: user` and sends the PM the usual `Resposta a "..."
no card <id>` message, instead of the plain `Resposta a "..."` a block without a card sends.
   While the cards load, the block takes no taps, so a tap never skips the card. A typed answer is
   the PM's job: it calls `pm_card_decide` on the card in the same turn with `decidedBy: "user"`,
   the user's words as `answer` and `answerOptionId` when they name an option.
3. **The PM with `pm_card_decide`:** `decidedBy: pm` is the default.
4. **The PM in the chat**, settling a question it left open: it calls `pm_card_decide` with
   `decidedBy: "pm"` in the same turn.

The rule for 2 and 4 is `PM_CHAT_SYNC_RULE` in `server/assistant/chat.ts`. It goes into the seed
prompt, into `CHAT_RULES` (the first message of every new or compacted chat) and into the
`pm_card_decide` description; `tests/reply-protocol.test.ts` checks all three. A live
`system-prompt.md` seeded before the rule only gets it through `CHAT_RULES` and the tool.

`pm_card_decide` refuses a card the user already decided, so the PM cannot write over a choice
that came from a tap; the user reopens the card to change it.

### A `seu` that cites only tasks

A `seu` line with task ids (`seu: testar #138 [10b1b0d7]`) and no `[pm:<id>]` anywhere in the
block follows the tasks instead. The chat calls `workboard.assistant.tasks.state` with the ids;
the board answers from its stored data (column, Needs you, last change), without the snapshot,
which is too big to poll. Every reply on screen registers its ids in
`client/assistant/task-states-query.ts`, so a chat polls once per host every 5 s whatever its
length. The mapping is `replyTaskView` in [`shared/reply-task-sync.ts`](../shared/reply-task-sync.ts):

| cited tasks                                          | the `seu` line                                    |
| ---------------------------------------------------- | ------------------------------------------------- |
| one still in Needs you                               | amber, as before                                  |
| none in Needs you, all in Done                       | green, "#138 Done · <hora>"                       |
| none in Needs you, one elsewhere                     | neutral, "#138 Done · #140 em andamento · <hora>" |
| none on the board, not loaded yet, or the call fails | as before                                         |

A task leaves Needs you when its delivery leaves `needs-you` (merged, dismissed, sent back), when
it moves to Done or Canceled, or when its agent runs again. A `seu` without ids (`seu: reiniciar
hub`) cannot be checked and stays amber.

Cards can link to tasks and their Reports tickets by id (`links.taskIds`, `links.reportIds`). A
task chip shows `#N` when the ticket has a number (the id's first 8 characters otherwise) and opens
the ticket in the board's side panel; a report chip opens the ticket in Reports.

## Packages on this board

A package's gate failure opens one `investigation` card linked to the package
(`links.packageIds`) and, when the bisect finds one, to the suspect ticket (`links.taskIds`). A
later failure updates the same open investigation instead of creating another. A tier the PM
changes with `board_set_test_tier` records a `decision` card (`#N moved to gate`) with the reason,
and the risk rule's automatic escalation does the same. `board_overview` lists the open packages
with their merged counts, branch, last gate and suspect; `board_package_history` reads one
package's runs. The board's cards are not a place to start code work: a package's correction still
goes through the task board.

A **grouping suggestion** is a `proposal` with `action: "select-tasks"` and the ticket ids in
`links.taskIds`. Its card shows **Select these tickets** and **Ignore** instead of the generic
options: selecting records the answer, switches to the task board with those tickets selected and
the package menu open, and creates nothing. The PM creates the package only after the user accepts.

**Propose closing** (`board_package_propose_close`) creates one open proposal per package,
"Close package <name>?", with close/keep options and `links.packageIds`; the PM closes the package
only after the user chooses close. Closing a package with an integration branch merges the branch
into the project's base first.

The page has a **package filter**: the chips list the packages that appear on a card, either from
`links.packageIds` or from the package of a linked ticket.

## What stays on the task board

Code tasks, their orchestrators and their deliveries are unchanged. Code reviews, including the
fresh-agent review of a critical change, are tasks with an agent and stay on the task board. The
PM's Needs you list still holds only delivery reasons, now grouped by package; the cards waiting for
the user are counted on the Decisões tab.
