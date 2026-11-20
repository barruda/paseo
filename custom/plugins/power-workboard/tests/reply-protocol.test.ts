// CUSTOM(assistant-reply-protocol)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_CHAT_AGENT_LABEL,
  DONE_VERBS,
  NEXT_DESCRIPTIONS,
  NEXT_LOOK,
  NEXT_VALUES,
  nextLegend,
  REPLY_ITEM_KIND,
  REPLY_ITEM_VERSION,
  REPLY_KEYS,
  REPLY_PROTOCOL_VERSION,
  EVIDENCE_WORDS,
  normalizeWord,
  parseReplyBlock,
  replyDetails,
  replyItemDataSchema,
  replyTimelineItems,
  splitReply,
  splitReplyIds,
} from "../shared/reply-protocol";
import {
  ASSISTANT_ROLE,
  CHAT_INSTRUCTIONS,
  CHAT_LABEL,
} from "../server/assistant/chat";
import { EVIDENCE_KINDS } from "../shared/assistant"; // CUSTOM(assistant-cards)
import { itemFeedback, optionAnswer } from "../shared/card-answers";
import {
  canOpenPmCard,
  canOpenTaskPanel,
  canOpenTaskReport,
  openPmCard,
  openTaskPanel,
  openTaskReport,
  setScreenOpener,
} from "../client/assistant/nav";

const doc = readFileSync(
  fileURLToPath(
    new URL("../docs/assistant-reply-protocol.md", import.meta.url),
  ),
  "utf8",
);

/** The backticked first word of each list item between `<!-- name -->` markers. */
function docList(name: string): string[] {
  const start = doc.indexOf(`<!-- ${name} -->`);
  const end = doc.indexOf(`<!-- /${name} -->`);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return [...doc.slice(start, end).matchAll(/^- `([^`]+)`/gm)].map(
    (match) => match[1],
  );
}

const fence = (body: string) => "```pwb\n" + body + "\n```";

/** The `- \`value\`: description` lines between `<!-- name -->` markers. */
function docDescriptions(name: string): Record<string, string> {
  const start = doc.indexOf(`<!-- ${name} -->`);
  const end = doc.indexOf(`<!-- /${name} -->`);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return Object.fromEntries(
    [...doc.slice(start, end).matchAll(/^- `([^`]+)`: (.+)$/gm)].map(
      (match) => [match[1], match[2].trim()],
    ),
  );
}

describe("protocol doc", () => {
  it("lists the same verbs and next values as the parser", () => {
    expect(docList("done-verbs")).toEqual([...DONE_VERBS]);
    expect(docList("next-values")).toEqual([...NEXT_VALUES]);
  });

  it("gives the chip legend the same descriptions as the parser", () => {
    expect(docDescriptions("next-values")).toEqual({ ...NEXT_DESCRIPTIONS });
  });

  it("names the parser's version and every key", () => {
    expect(doc).toContain(`Version: **v${REPLY_PROTOCOL_VERSION}**`);
    expect(doc).toContain(`- **v${REPLY_PROTOCOL_VERSION}**`);
    for (const key of REPLY_KEYS) expect(doc).toContain(`\`${key}\``);
  });

  // CUSTOM(assistant-cards)
  it("lists the evidence values of the report schema", () => {
    expect(docList("evidence-values")).toEqual([...EVIDENCE_KINDS]);
    const words = normalizeWord(doc);
    for (const alias of Object.keys(EVIDENCE_WORDS))
      expect(words).toContain(`\`${alias}\``);
  });

  it("is what the assistant's prompt points to", () => {
    expect(ASSISTANT_ROLE).toContain("docs/assistant-reply-protocol.md");
    expect(ASSISTANT_ROLE).toContain("```pwb");
    expect(CHAT_INSTRUCTIONS).toContain("```pwb");
  });
});

// CUSTOM(assistant-cards): protocol v2.
describe("parseReplyBlock v2", () => {
  it("reads the review map", () => {
    const reply = parseReplyBlock(
      [
        'pedido: testado | "abas internas" | tests/pages.test.ts [10b1b0d7]',
        "pedido: Visto | Reports sob pedido | abri o board | nada carregou",
        "pedido: sem prova | retry no 503",
        "pedido: o pedido sem evidência",
        "fora: renomeei o hook [10b1b0d7]",
      ].join("\n"),
    );
    expect(reply.outcomes).toEqual([
      {
        evidence: "tested",
        text: "abas internas",
        detail: "tests/pages.test.ts",
        taskIds: ["10b1b0d7"],
        pmCardIds: [],
      },
      {
        evidence: "seen",
        text: "Reports sob pedido",
        detail: "abri o board | nada carregou",
        taskIds: [],
        pmCardIds: [],
      },
      {
        evidence: "unverified",
        text: "retry no 503",
        detail: "",
        taskIds: [],
        pmCardIds: [],
      },
      {
        evidence: "unverified",
        text: "o pedido sem evidência",
        detail: "",
        taskIds: [],
        pmCardIds: [],
      },
    ]);
    expect(reply.notDone).toEqual([
      {
        kind: "outside",
        text: "renomeei o hook",
        taskIds: ["10b1b0d7"],
        pmCardIds: [],
      },
    ]);
    expect(reply.extra).toEqual([]);
  });

  it("reads a question with options and a recommendation", () => {
    const reply = parseReplyBlock(
      [
        "pergunta: Merge agora ou espero o CI? [10b1b0d7]",
        "opção: a | Merge agora | ganha: entrega hoje | custa: CI pode quebrar",
        "Opcao: b | Esperar o CI | custa: 20 min",
        "opção: c | Só | rótulo | com barras",
        "recomendo: a | só testes mudaram",
        "próximo: você",
        "seu: decidir o merge",
      ].join("\n"),
    );
    expect(reply.question).toEqual({
      text: "Merge agora ou espero o CI?",
      taskIds: ["10b1b0d7"],
      pmCardIds: [],
      options: [
        {
          id: "a",
          label: "Merge agora",
          gains: "entrega hoje",
          costs: "CI pode quebrar",
        },
        { id: "b", label: "Esperar o CI", gains: null, costs: "20 min" },
        {
          id: "c",
          label: "Só | rótulo | com barras",
          gains: null,
          costs: null,
        },
      ],
      recommend: "a",
      why: "só testes mudaram",
    });
    expect(reply.next?.value).toBe("você");
  });

  it("keeps bad options as text and drops a recommendation of no option", () => {
    const reply = parseReplyBlock(
      [
        "opção: a | Um",
        "opção: a | Repetida",
        "opção: sem rótulo",
        "opção: duas palavras | rótulo",
        "recomendo: z | não existe",
      ].join("\n"),
    );
    expect(reply.question).toEqual({
      text: "",
      taskIds: [],
      pmCardIds: [],
      options: [{ id: "a", label: "Um", gains: null, costs: null }],
      recommend: null,
      why: null,
    });
    expect(reply.extra.map((line) => line.text)).toEqual([
      "a | Repetida",
      "sem rótulo",
      "duas palavras | rótulo",
    ]);
  });

  it("keeps a question without options and the last repeated one", () => {
    const reply = parseReplyBlock(
      "pergunta: primeira\npergunta: Qual nome usar?",
    );
    expect(reply.question).toEqual({
      text: "Qual nome usar?",
      taskIds: [],
      pmCardIds: [],
      options: [],
      recommend: null,
      why: null,
    });
  });
});

describe("card answers", () => {
  it("names the question and the option, or the item", () => {
    expect(
      optionAnswer("Merge agora?", { id: "a", label: " Merge agora " }),
    ).toBe('Resposta a "Merge agora?": escolho a (Merge agora).');
    expect(optionAnswer("", { id: "b", label: "Esperar" })).toBe(
      "Escolho b (Esperar).",
    );
    expect(itemFeedback("retry\nno 503", " falta o teste ")).toBe(
      'Sobre "retry no 503": falta o teste',
    );
  });
});

describe("parseReplyBlock", () => {
  it("reads a full block", () => {
    const reply = parseReplyBlock(
      [
        "feito: merge abas internas do Workboard [10b1b0d7]",
        "feito: revisão retomada após o limite [ed28643e]",
        "aviso: abas internas só aparecem depois de instalar o app",
        "bloqueio: CI fora do ar",
        "próximo: revisão",
        "seu: aprovar o merge [10b1b0d7]",
      ].join("\n"),
    );
    expect(reply).toEqual({
      done: [
        {
          verb: "merge",
          text: "abas internas do Workboard",
          taskIds: ["10b1b0d7"],
          pmCardIds: [],
        },
        {
          verb: "revisão",
          text: "retomada após o limite",
          taskIds: ["ed28643e"],
          pmCardIds: [],
        },
      ],
      warnings: [
        {
          text: "abas internas só aparecem depois de instalar o app",
          taskIds: [],
          pmCardIds: [],
        },
      ],
      blockers: [{ text: "CI fora do ar", taskIds: [], pmCardIds: [] }],
      next: { value: "revisão", text: "revisão" },
      yours: {
        none: false,
        text: "aprovar o merge",
        taskIds: ["10b1b0d7"],
        pmCardIds: [],
      },
      extra: [],
      details: "",
      // CUSTOM(assistant-cards): a v1 block has none of the v2 parts.
      outcomes: [],
      notDone: [],
      question: null,
    });
  });

  it("reads the minimal block", () => {
    const reply = parseReplyBlock("próximo: fim\nseu: nada");
    expect(reply.done).toEqual([]);
    expect(reply.next).toEqual({ value: "fim", text: "fim" });
    expect(reply.yours).toEqual({
      none: true,
      text: "nada",
      taskIds: [],
      pmCardIds: [],
    });
  });

  it("matches keys and words without case or accents", () => {
    const reply = parseReplyBlock(
      "Feito: Revisao do parser\nPROXIMO: voce\nseu: Nada",
    );
    expect(reply.done[0].verb).toBe("revisão");
    expect(reply.next?.value).toBe("você");
    expect(reply.yours?.none).toBe(true);
  });

  it("keeps unknown keys, keyless lines and unknown words as text", () => {
    const reply = parseReplyBlock(
      [
        "seu: nada",
        "humor: ótimo",
        "uma linha solta",
        "feito: dancei a valsa",
        "próximo: talvez",
      ].join("\n"),
    );
    expect(reply.extra).toEqual([
      { key: "humor", text: "ótimo" },
      { key: null, text: "uma linha solta" },
    ]);
    expect(reply.done).toEqual([
      { verb: null, text: "dancei a valsa", taskIds: [], pmCardIds: [] },
    ]);
    expect(reply.next).toEqual({ value: null, text: "talvez" });
    expect(reply.yours?.none).toBe(true);
  });

  it("puts everything after --- into the details", () => {
    const reply = parseReplyBlock(
      "feito: nota x\npróximo: sigo\nseu: nada\n---\n- por quê: y\nseu: isto não é chave",
    );
    expect(reply.details).toBe("- por quê: y\nseu: isto não é chave");
    expect(reply.yours?.text).toBe("nada");
  });

  it("ignores list markers before the key", () => {
    const reply = parseReplyBlock(
      "- feito: merge x [abcdef12]\n* próximo: agente [abcdef12]\n1. seu: nada",
    );
    expect(reply.extra).toEqual([]);
    expect(reply.done[0].verb).toBe("merge");
    expect(reply.next).toEqual({ value: "agente", text: "agente" });
    expect(reply.yours?.none).toBe(true);
  });

  it("treats an empty seu as nada and keeps the last repeated key", () => {
    const reply = parseReplyBlock("próximo: sigo\npróximo: fim\nseu:");
    expect(reply.next?.value).toBe("fim");
    expect(reply.yours).toEqual({
      none: true,
      text: "nada",
      taskIds: [],
      pmCardIds: [],
    });
  });
});

// CUSTOM(pm-board): protocol v3 adds `[pm:<card id>]`.
describe("parseReplyBlock v3", () => {
  it("reads a PM card id at the end of a line", () => {
    const reply = parseReplyBlock(
      [
        "feito: decidi o merge [pm:pm-abc12345]",
        "pergunta: Publicar agora? [pm:pm-abc12345]",
        "opção: a | Sim",
        "seu: decidir a publicação [pm:pm-abc12345]",
      ].join("\n"),
    );
    expect(reply.done[0]).toEqual({
      verb: null,
      text: "decidi o merge",
      taskIds: [],
      pmCardIds: ["pm-abc12345"],
    });
    expect(reply.question).toMatchObject({
      text: "Publicar agora?",
      taskIds: [],
      pmCardIds: ["pm-abc12345"],
    });
    expect(reply.yours).toEqual({
      none: false,
      text: "decidir a publicação",
      taskIds: [],
      pmCardIds: ["pm-abc12345"],
    });
  });

  it("splits task and PM card ids together, leaving other brackets", () => {
    expect(splitReplyIds("movi X [10b1b0d7] [pm:pm-abc12345]")).toEqual({
      text: "movi X",
      taskIds: ["10b1b0d7"],
      pmCardIds: ["pm-abc12345"],
    });
    expect(splitReplyIds("algo [WIP] [abcdef12] [01234567]")).toEqual({
      text: "algo [WIP]",
      taskIds: ["abcdef12", "01234567"],
      pmCardIds: [],
    });
    expect(splitReplyIds("reseta [2026-11-20]").taskIds).toEqual([]);
    expect(splitReplyIds("merge X [763ec569c]").taskIds).toEqual([]);
    expect(
      splitReplyIds("full [6F1D2C3A-1111-2222-3333-444455556666]").taskIds,
    ).toEqual(["6f1d2c3a-1111-2222-3333-444455556666"]);
    expect(splitReplyIds("curto [abc]")).toEqual({
      text: "curto [abc]",
      taskIds: [],
      pmCardIds: [],
    });
    expect(splitReplyIds("decidir x [PM:PM-ABC12345]").pmCardIds).toEqual([
      "pm-abc12345",
    ]);
    expect(splitReplyIds("decidir x [pm:]").pmCardIds).toEqual([]);
    expect(splitReplyIds("decidir x [pm:com espaço]").pmCardIds).toEqual([]);
    expect(splitReplyIds("reseta [2026-11-20] [pm:pm-1]")).toEqual({
      text: "reseta [2026-11-20]",
      taskIds: [],
      pmCardIds: ["pm-1"],
    });
  });
});

describe("splitReply", () => {
  it("returns null without a block", () => {
    expect(splitReply("Tudo certo.")).toBeNull();
    expect(splitReply("```ts\nconst a = 1;\n```")).toBeNull();
  });

  it("ignores an unclosed block, as while it streams", () => {
    expect(splitReply("Ok.\n\n```pwb\nfeito: nota x\n")).toBeNull();
  });

  it("splits around the last block", () => {
    const text = [
      "Respondendo: sim.",
      "",
      fence("feito: nota primeira\npróximo: sigo\nseu: nada"),
      "",
      fence("feito: merge segunda [abcdef12]\npróximo: fim\nseu: nada"),
      "",
      "Mais contexto.",
    ].join("\n");
    const split = splitReply(text);
    expect(split?.before).toContain("Respondendo: sim.");
    expect(split?.before).toContain("nota primeira");
    expect(split?.reply.done[0]).toEqual({
      verb: "merge",
      text: "segunda",
      taskIds: ["abcdef12"],
      pmCardIds: [],
    });
    expect(split?.after).toBe("Mais contexto.");
    expect(split && replyDetails(split)).toBe("Mais contexto.");
  });

  it("joins the block's details and the text after it", () => {
    const split = splitReply(
      fence("próximo: sigo\nseu: nada\n---\ndetalhe") + "\n\ndepois",
    );
    expect(split && replyDetails(split)).toBe("detalhe\n\ndepois");
  });

  it("parses a malformed block without failing", () => {
    const split = splitReply(fence(":::\n: sem chave\nfeito:\n---"));
    expect(split?.reply.extra).toEqual([
      { key: null, text: ":::" },
      { key: null, text: ": sem chave" },
    ]);
    expect(split?.reply.done).toEqual([
      { verb: null, text: "", taskIds: [], pmCardIds: [] },
    ]);
    expect(split?.reply.next).toBeNull();
    expect(split?.reply.yours).toBeNull();
  });

  it("skips a pwb block quoted inside another code block", () => {
    const quoted = "````md\n" + fence("próximo: fim\nseu: nada") + "\n````";
    expect(splitReply(quoted)).toBeNull();
  });

  it("closes only on a fence that starts a line", () => {
    const split = splitReply(
      fence("feito: nota usei ``` no meio```\npróximo: fim\nseu: nada"),
    );
    expect(split?.reply.next?.value).toBe("fim");
    expect(split?.reply.done[0].text).toBe("usei ``` no meio```");
  });

  it("reads CRLF text and a longer closing fence", () => {
    const split = splitReply("```pwb\r\npróximo: fim\r\nseu: nada\r\n````");
    expect(split?.reply.next?.value).toBe("fim");
    expect(split?.reply.extra).toEqual([]);
  });

  it("accepts an empty block", () => {
    expect(splitReply("```pwb\n```")?.reply.extra).toEqual([]);
  });
});

const assistantLabels = { [ASSISTANT_CHAT_AGENT_LABEL]: "true" };

describe("replyTimelineItems", () => {
  it("keeps the whole reply in one item", () => {
    const text = "Oi.\n\n" + fence("próximo: fim\nseu: nada");
    const items = replyTimelineItems(text, assistantLabels);
    expect(items).toEqual([
      {
        type: "plugin",
        kind: REPLY_ITEM_KIND,
        version: REPLY_ITEM_VERSION,
        data: { text },
      },
    ]);
    expect(replyItemDataSchema.parse(items?.[0].data)).toEqual({ text });
  });

  it("leaves replies without a block alone", () => {
    expect(replyTimelineItems("Sem bloco.", assistantLabels)).toBeUndefined();
  });

  it("leaves other agents' replies alone, and every reply when the host passes no agent", () => {
    const text = "Oi.\n\n" + fence("próximo: fim\nseu: nada");
    expect(replyTimelineItems(text, {})).toBeUndefined();
    expect(
      replyTimelineItems(text, { [ASSISTANT_CHAT_AGENT_LABEL]: "false" }),
    ).toBeUndefined();
    expect(replyTimelineItems(text, undefined)).toBeUndefined();
  });

  it("matches the label the server puts on the chat agent", () => {
    expect(ASSISTANT_CHAT_AGENT_LABEL).toBe(CHAT_LABEL);
  });
});

describe("openTaskReport", () => {
  it("opens the board on its Reports tab, only once the host gave openScreen", () => {
    expect(openTaskReport("abcdef12")).toBe(false);
    const open = vi.fn();
    setScreenOpener(open);
    expect(canOpenTaskReport()).toBe(true);
    expect(openTaskReport("abcdef12")).toBe(true);
    expect(open).toHaveBeenCalledWith({
      screenId: "power-workboard",
      params: { tab: "reports", request: expect.any(String) },
    });
    setScreenOpener(null);
    expect(canOpenTaskReport()).toBe(false);
  });

  // CUSTOM(pm-board): a task link on a decision card opens the ticket in the board's side panel.
  it("opens the board on its board tab with the ticket in the panel", () => {
    expect(openTaskPanel("abcdef12")).toBe(false);
    const open = vi.fn();
    setScreenOpener(open);
    expect(canOpenTaskPanel()).toBe(true);
    expect(openTaskPanel("abcdef12")).toBe(true);
    expect(open).toHaveBeenCalledWith({
      screenId: "power-workboard",
      params: {
        tab: "board",
        request: expect.any(String),
        task: "abcdef12",
      },
    });
    setScreenOpener(null);
    expect(canOpenTaskPanel()).toBe(false);
  });

  // CUSTOM(pm-board): a `[pm:<id>]` opens the Decisões tab on that card.
  it("opens the board on its Decisões tab with a PM card", () => {
    expect(openPmCard("pm-abc12345")).toBe(false);
    const open = vi.fn();
    setScreenOpener(open);
    expect(canOpenPmCard()).toBe(true);
    expect(openPmCard("pm-abc12345")).toBe(true);
    expect(open).toHaveBeenCalledWith({
      screenId: "power-workboard",
      params: { tab: "pm-board", request: expect.any(String) },
    });
    setScreenOpener(null);
    expect(canOpenPmCard()).toBe(false);
  });
});

describe("the próximo chip legend", () => {
  it("lists every value with its chip icon, tone and description", () => {
    const legend = nextLegend("agente");
    expect(legend.map((entry) => entry.value)).toEqual([...NEXT_VALUES]);
    for (const entry of legend) {
      expect(entry.icon).toBe(NEXT_LOOK[entry.value].icon);
      expect(entry.tone).toBe(NEXT_LOOK[entry.value].tone);
      expect(entry.description).toBe(NEXT_DESCRIPTIONS[entry.value]);
    }
  });

  it("highlights only the current value", () => {
    for (const current of NEXT_VALUES) {
      expect(
        nextLegend(current)
          .filter((entry) => entry.current)
          .map((entry) => entry.value),
      ).toEqual([current]);
    }
    expect(nextLegend(null).some((entry) => entry.current)).toBe(false);
  });
});
