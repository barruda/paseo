// CUSTOM(assistant-reply-protocol)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_CHAT_AGENT_LABEL,
  DONE_VERBS,
  NEXT_VALUES,
  REPLY_ITEM_KIND,
  REPLY_ITEM_VERSION,
  REPLY_KEYS,
  REPLY_PROTOCOL_VERSION,
  parseReplyBlock,
  replyDetails,
  replyItemDataSchema,
  replyTimelineItems,
  splitReply,
  splitTaskIds,
} from "../shared/reply-protocol";
import {
  ASSISTANT_ROLE,
  CHAT_INSTRUCTIONS,
  CHAT_LABEL,
} from "../server/assistant/chat";
import {
  canOpenTaskReport,
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

describe("protocol doc", () => {
  it("lists the same verbs and next values as the parser", () => {
    expect(docList("done-verbs")).toEqual([...DONE_VERBS]);
    expect(docList("next-values")).toEqual([...NEXT_VALUES]);
  });

  it("names the parser's version and every key", () => {
    expect(doc).toContain(`Version: **v${REPLY_PROTOCOL_VERSION}**`);
    expect(doc).toContain(`- **v${REPLY_PROTOCOL_VERSION}**`);
    for (const key of REPLY_KEYS) expect(doc).toContain(`\`${key}\``);
  });

  it("is what the assistant's prompt points to", () => {
    expect(ASSISTANT_ROLE).toContain("docs/assistant-reply-protocol.md");
    expect(ASSISTANT_ROLE).toContain("```pwb");
    expect(CHAT_INSTRUCTIONS).toContain("```pwb");
  });
});

describe("parseReplyBlock", () => {
  it("reads a full block", () => {
    const reply = parseReplyBlock(
      [
        "feito: merge abas internas do Power Workboard [10b1b0d7]",
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
          text: "abas internas do Power Workboard",
          taskIds: ["10b1b0d7"],
        },
        {
          verb: "revisão",
          text: "retomada após o limite",
          taskIds: ["ed28643e"],
        },
      ],
      warnings: [
        {
          text: "abas internas só aparecem depois de instalar o app",
          taskIds: [],
        },
      ],
      blockers: [{ text: "CI fora do ar", taskIds: [] }],
      next: { value: "revisão", text: "revisão" },
      yours: { none: false, text: "aprovar o merge", taskIds: ["10b1b0d7"] },
      extra: [],
      details: "",
    });
  });

  it("reads the minimal block", () => {
    const reply = parseReplyBlock("próximo: fim\nseu: nada");
    expect(reply.done).toEqual([]);
    expect(reply.next).toEqual({ value: "fim", text: "fim" });
    expect(reply.yours).toEqual({ none: true, text: "nada", taskIds: [] });
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
      { verb: null, text: "dancei a valsa", taskIds: [] },
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
    expect(reply.yours).toEqual({ none: true, text: "nada", taskIds: [] });
  });
});

describe("splitTaskIds", () => {
  it("takes every trailing id and leaves other brackets", () => {
    expect(splitTaskIds("algo [WIP] [abcdef12] [01234567]")).toEqual({
      text: "algo [WIP]",
      ids: ["abcdef12", "01234567"],
    });
    expect(splitTaskIds("reseta [2026-11-20]").ids).toEqual([]);
    expect(splitTaskIds("merge X [763ec569c]").ids).toEqual([]);
    expect(
      splitTaskIds("full [6F1D2C3A-1111-2222-3333-444455556666]").ids,
    ).toEqual(["6f1d2c3a-1111-2222-3333-444455556666"]);
    expect(splitTaskIds("curto [abc]")).toEqual({
      text: "curto [abc]",
      ids: [],
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
    expect(split?.reply.done).toEqual([{ verb: null, text: "", taskIds: [] }]);
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
});
