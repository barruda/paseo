import { describe, expect, it } from "vitest";
import { describeDelegationCard } from "./card";

describe("describeDelegationCard", () => {
  it("says what the session was told, in Portuguese", () => {
    expect(
      describeDelegationCard({
        implementerModel: "sonnet",
        implementerEffort: "medium",
        when: "balanced",
        review: true,
        searchModel: "haiku",
      }),
    ).toBe(
      "Delegação ligada: implementação vai para Sonnet · medium, modo equilibrado, revisão nesta sessão, busca em Haiku",
    );
    expect(
      describeDelegationCard({
        implementerModel: "opus",
        implementerEffort: "low",
        when: "conservative",
        review: false,
        searchModel: "off",
      }),
    ).toBe("Delegação ligada: implementação vai para Opus · low, modo conservador");
  });
});
