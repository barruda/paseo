import { describe, expect, test } from "vitest";
import { scoreWaitingTurn } from "./waiting-turn.js";

describe("scoreWaitingTurn", () => {
  test.each([
    "The desktop build is running. Once it finishes I'll install it and reopen the windows.",
    "The Tripo is at 28%. I'll wait for the background notification.",
    "Build disparado. Vou esperar a notificação e te aviso assim que terminar.",
    "Subi o build em segundo plano, vou aguardar a conclusão.",
  ])("calls %j waiting", (message) => {
    expect(scoreWaitingTurn(message).verdict).toBe("waiting");
  });

  test.each([
    "Implemented the change and the tests pass.",
    "Pronto: corrigi o bug e rodei o typecheck.",
    "Quer que eu abra o PR agora?",
    "Vou esperar sua resposta antes de continuar.",
    "",
  ])("calls %j done", (message) => {
    expect(scoreWaitingTurn(message).verdict).toBe("done");
  });

  test("a weak waiting hint alone is unsure", () => {
    expect(scoreWaitingTurn("O build ainda está rodando.").verdict).toBe("unsure");
  });

  test("waiting words next to done words are unsure", () => {
    expect(
      scoreWaitingTurn("Implementei a correção. Vou esperar o build e te aviso.").verdict,
    ).toBe("unsure");
  });

  test("only the closing words count", () => {
    const report = `I'll wait for the build. ${"Detalhes do resultado. ".repeat(60)}Tudo certo.`;
    expect(scoreWaitingTurn(report).verdict).toBe("done");
  });
});
