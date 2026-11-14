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

  it("says when the implementer is a Paseo subagent", () => {
    expect(
      describeDelegationCard({
        implementerRunner: "paseo",
        implementerModel: "sonnet",
        implementerEffort: "medium",
        when: "balanced",
        review: false,
        searchModel: "off",
      }),
    ).toBe(
      "Delegação ligada: implementação vai para Sonnet · medium (subagente Paseo), modo equilibrado",
    );
  });

  it("names the provider and model of a Paseo subagent", () => {
    const base = {
      implementerRunner: "paseo" as const,
      implementerModel: "sonnet" as const,
      implementerEffort: "medium" as const,
      when: "balanced" as const,
      review: false,
      searchModel: "off" as const,
    };
    expect(describeDelegationCard({ ...base, paseoProvider: "codex", paseoModel: "gpt-5" })).toBe(
      "Delegação ligada: implementação vai para codex/gpt-5 (subagente Paseo), modo equilibrado",
    );
    expect(describeDelegationCard({ ...base, paseoProvider: "claude", paseoModel: "" })).toBe(
      "Delegação ligada: implementação vai para claude (modelo padrão) (subagente Paseo), modo equilibrado",
    );
  });
});
