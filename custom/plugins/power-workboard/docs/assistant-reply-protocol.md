# Projects Assistant reply protocol

Version: **v1** (2026-11-19)

The Projects Assistant ends every reply to the user with a short `pwb` block. The Power Workboard
plugin draws that block in the assistant's chat as icons, a chip and a details expander, so the
user can scan the conversation. Clients without the plugin show the block as a code block, which
still reads fine.

The keys and enums below live in [`shared/reply-protocol.ts`](../shared/reply-protocol.ts). A test
(`tests/reply-protocol.test.ts`) checks that this doc lists the same values, so change both
together and bump the version when the format changes.

## The block

A fenced block with the language `pwb`, one `key: value` per line, no braces, in this order:

```
feito: <verbo> <objeto curto> [id]     (uma ou mais linhas)
aviso: <texto curto>                    (opcional; só quando existe)
bloqueio: <texto curto>                 (opcional; só quando existe)
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
feito: merge abas internas do Power Workboard [10b1b0d7]
feito: revisão retomada após o limite [ed28643e]
aviso: abas internas só aparecem depois de instalar o app
próximo: revisão
seu: nada
---
- Critérios ok: abas, restauração, Reports sob pedido.
- Decidi não esperar o CI: só testes do plugin mudaram.
```
````

## Parsing rules

The parser reads the **last** closed `pwb` block of the reply and never fails:

- keys and enum words match without case or accents (`proximo` is `próximo`), and a list
  marker before the key (`- feito:`) is ignored;
- lines out of order are drawn in the order above;
- an unknown key, a line without a key, an unknown verb or a `próximo` outside the enum shows as
  plain text;
- a repeated `próximo` or `seu` keeps the last one.

Only the Projects Assistant's chat (the agent labeled `pwb/assistant-chat`) gets the card. The
plugin can't tell agents apart before rendering, so in any chat a reply with a closed `pwb` block
becomes a plugin row: other agents show the same text as Markdown, but that reply loses the turn's
copy button and the paced streaming reveal. A reply that also carries a valid `<report>` keeps the
report card instead.

## Changelog

- **v1** (2026-11-19): first version.
