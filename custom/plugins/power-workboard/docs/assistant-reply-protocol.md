# Projects Assistant reply protocol

Version: **v2** (2026-11-19)

The Projects Assistant ends every reply to the user with a short `pwb` block. The Power Workboard
plugin draws that block in the assistant's chat as icons, a chip and a details expander, so the
user can scan the conversation. Clients without the plugin show the block as a code block, which
still reads fine. Task agents end their turn with a `<report>` instead; [The task
report](#the-task-report) lists the fields its cards draw.

The rule behind v2: show, then let the user react. Never hand the user an empty question: lay out
the options, what each gains and costs, and which one you recommend. The user answers in one tap or
comments on one item.

The keys and enums below live in [`shared/reply-protocol.ts`](../shared/reply-protocol.ts). A test
(`tests/reply-protocol.test.ts`) checks that this doc lists the same values, so change both
together and bump the version when the format changes.

## The block

A fenced block with the language `pwb`, one `key: value` per line, no braces, in this order:

```
feito: <verbo> <objeto curto> [id]                  (uma ou mais linhas)
pedido: <evidência> | <o pedido, citado> | <prova>   (opcional; uma por pedido revisado)
fora: <o que mudou sem ser pedido> [id]              (opcional)
aviso: <texto curto>                                 (opcional; só quando existe)
bloqueio: <texto curto>                              (opcional; só quando existe)
pergunta: <pergunta> [id]                            (opcional)
opção: <id> | <rótulo> | ganha: <x> | custa: <y>     (opcional; uma por opção)
recomendo: <id> | <por quê>                          (opcional)
próximo: <enum>
seu: <nada | verbo curto + objeto>
---
<detalhes em markdown, opcional>
```

The minimal block is `próximo` plus `seu`.

### `feito`

One line per thing done. The first word is one of these verbs, aligned with board_report's kinds:

<!-- done-verbs -->

- `merge`
- `revisão`
- `feedback`
- `criei`
- `iniciei`
- `movi`
- `corrigi`
- `respondi`
- `escalei`
- `nota`

<!-- /done-verbs -->

Then the task's short title. The task id may follow at the end in brackets: its first 8
characters, `[10b1b0d7]`, or the whole id. Other brackets (a date, a commit hash) stay text. The
chat hides the id and turns the line into a link to that task in the board's Reports tab.
`aviso`, `bloqueio` and `seu` take a trailing `[id]` the same way.

### `pedido` and `fora`: the review map

After a review, one `pedido` line per thing the user asked for, quoted in their words, with the
evidence that it works. The first field is the evidence:

<!-- evidence-values -->

- `seen` (`visto`): you ran it and watched it work. The proof is the command and what it showed.
- `tested` (`testado`): a test covers it. The proof is the test's name.
- `unverified` (`não verificado`, `sem prova`): no proof. A line without an evidence word is this.

<!-- /evidence-values -->

`fora` is something that changed without being asked, even an improvement: the report's `notDone`
of kind `outside`. The chat card draws the lines as a map, each with an evidence pill, and lets the
user comment on one line; the comment goes to the chat as `Sobre "<line>": <text>`.

### `pergunta`, `opção` and `recomendo`

Only when the user must decide. `pergunta` is the question; each `opção` is `<id> | <label>` plus
optional `ganha: <what it gains>` and `custa: <what it costs>` fields, in any order. The id is one
word. `recomendo: <id> | <why>` names one of the options. The card draws each option as a button:
one tap sends `Resposta a "<pergunta>": escolho <id> (<label>).` to the chat. Typing an answer
still works. Only the chat's newest card takes taps and comments, and not while the chat is
working, so an old answer is not sent again after a reload.

### `aviso` and `bloqueio`

Only when there is one. `aviso` is something the user should know; `bloqueio` is something that
stops the work. A reply with `bloqueio` opens with its details expanded.

### `próximo`

One word, who moves next:

<!-- next-values -->

- `sigo`: I carry on by myself.
- `agente`: it went back to the task's agent.
- `revisão`: an independent reviewer is looking at it.
- `você`: stopped, waiting for the user.
- `espera`: waiting on something outside (a limit, CI, a time).
- `fim`: delivered, nothing pending.

<!-- /next-values -->

### `seu`

Always the **last** key line, so the user finds it in the same place every time. The value is
`nada` or a short verb plus its object: `decidir <x>`, `aprovar <x>`, `testar <x>`,
`reiniciar <x>`. Anything other than `nada` is highlighted.

## What goes where

- **The block:** what happened, what is next, what the user must do. Short.
- **Details:** everything after a `---` line inside the block, and any text after the block. They
  go into a collapsed expander: why, criteria checked, checks, decisions, links and ids.
- **Text before the block:** only the direct answer when the user asked a question. It stays
  visible, so keep it to a sentence or two; most replies have none.
- **Leave out:** commands you ran, test output that passed, steps that changed nothing.

## Example

````
```pwb
feito: revisão abas internas do Power Workboard [10b1b0d7]
pedido: testado | "abas internas no board" | tests/workboard-pages.test.ts
pedido: visto | "Reports só abre quando pedido" | abri o board, a aba não carregou nada
fora: renomeei o hook useBoardTabs
aviso: abas internas só aparecem depois de instalar o app
pergunta: Faço o merge agora ou espero o CI?
opção: a | Merge agora | ganha: entrega hoje | custa: o CI pode quebrar depois
opção: b | Esperar o CI | ganha: nenhum risco | custa: uns 20 minutos
recomendo: a | só testes do plugin mudaram
próximo: você
seu: decidir o merge [10b1b0d7]
---
- Critérios ok: abas, restauração, Reports sob pedido.
```
````

## Parsing rules

The parser reads the **last** closed `pwb` block of the reply and never fails:

- keys and enum words match without case or accents (`proximo` is `próximo`), and a list
  marker before the key (`- feito:`) is ignored;
- lines out of order are drawn in the order above;
- an unknown key, a line without a key, an unknown verb or a `próximo` outside the enum shows as
  plain text;
- a repeated `próximo`, `seu`, `pergunta` or `recomendo` keeps the last one;
- an `opção` without an id and a label, or with an id already used, shows as plain text;
- a `recomendo` that names no option is dropped.

Only the Projects Assistant's chat (the agent labeled `pwb/assistant-chat`) gets the card: the
host hands the chat's agent to the timeline transformer, and other agents' replies stay as they
are. In the assistant's chat the turn's copy button copies the reply's original text, block
included; the reply has no paced streaming reveal once its block closes. An app build without the
agent context draws no card anywhere. A reply that also carries a valid `<report>` keeps the
report card instead.

## The task report

A task agent's `<report>` JSON (`reportSchema` in [`shared/assistant.ts`](../shared/assistant.ts),
the prompt in [`server/orchestrator.ts`](../server/orchestrator.ts)) takes the same ideas as
optional fields. A malformed one falls back to empty, so it never costs the report.

- `options`: `[{id, label, gains, costs}]`, the answers to `question`; `recommend` (an option id)
  and `why`.
- `outcomes`: `[{ask, evidence, detail}]`, one per thing the task asked for, with `evidence` as
  above.
- `notDone`: `[{kind, text}]`, `kind` one of `skipped`, `unverified`, `outside`.

The report card in the agent's chat and in the board's Reports tab draw them like the chat card.
One tap on an option, or a comment on an outcome or a checklist step, continues the task with it
as its feedback, like Continue task (action `answer`). The action refuses a card from an older
agent of the task, a question the task no longer asks, a task in a Done column or whose delivery
was delivered or dismissed, and a task with a delivery step running; the card shows why. The
question is the one the last report asked, kept with the assistant on or off. The board's Ready to review card shows the same options as buttons. Reports from
before these fields draw as before.

## Who did it: `by`

Every history event records `by`: `user` (the board or a card), `assistant` (the chat's board
tools) or `orchestrator` (the board's engine). The Reports tab keeps what the user did by hand
apart from the assistant's entries; it used to guess by time, which joined a ticket the user moved
to an assistant entry written a minute later. Events from before the field have no `by` and keep
the old two-minute rule until they age out of the history.

## Changelog

- **v2** (2026-11-19): `pedido`, `fora`, `pergunta`, `opção`, `recomendo`; the task report's
  `options`, `recommend`, `why`, `outcomes`, `notDone`; the history's `by`. v1 blocks parse as
  before.
- **v1** (2026-11-19): first version.
