---
name: paseo-critic
description: Turn the Paseo critic on or off for this agent, so a second model reviews each answer before the user reads it. Use when the user says "critic", "usa um critic", "liga o critic", "desliga o critic", "revisor crítico", "have a critic review you", or asks for every answer to be reviewed.
user-invocable: true
argument-hint: "[on|off] [model] [criterion] [--persistent]"
---

# Paseo Critic

The critic is another model that reads each of your answers before the user does. A rejected answer comes back to you as a `<critic-feedback round="N">` message and the user sees only the approved answer, with a **critic-review** card in the chat.

**User's request:** $ARGUMENTS

## Turn it on or off

Call the `set_critic` tool with `enabled: true` or `enabled: false`. It is the critic plugin's own tool, it only changes the agent it runs in, and it keeps the plugin config and the composer toggle in step. Do not call the plugin's RPC directly: the label the UI reads is part of the tool.

If `set_critic` is not in your tool list, the critic plugin is not loaded for this session (or this agent's Paseo tools are off). Say so and tell the user to reload the `critic` plugin and reopen this agent's session; they can also use the critic icon in the composer meanwhile. Do not pretend the critic is on.

## Reading the request

| User says                                                              | Pass                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------- |
| "usa um critic", "liga o critic", "have a critic review you"           | `{ "enabled": true }`                          |
| "desliga o critic", "para de usar o critic", "stop the critic"         | `{ "enabled": false }`                         |
| "com Sonnet", "usa o Opus", "critic on GPT-5"                          | `model`, as `provider/model`                   |
| "focado em segurança", "critério: sem quebrar a API", "harsh reviewer" | `prompt`, the criterion in one short paragraph |
| "persistente", "um crítico para a conversa toda"                       | `mode: "persistent"`                           |
| no mode given                                                          | leave it alone: the default is `per-request`   |
| "pode ler o repositório"                                               | `tools: "read"`                                |

For `model`, find the exact id with `list_models` (see the **paseo** skill) and pass `provider/model`, for example `claude/claude-sonnet-5-5`. A family name alone is not a model id. If the user names a family ("Sonnet", "Opus", "GPT-5"), pick that provider's model in the family; if the id is unclear, ask before turning it on. Without a model, the tool keeps the current one.

For `prompt`, keep the user's words when they give a criterion. A security-focused critic is a sentence like "Focus on security: secrets, injection, authorization, unsafe file or shell access." Do not overwrite an existing prompt when the user only asks to turn the critic on or off.

`maxRounds` (1 to 50) and `includeDiff` only change when the user asks.

## After the call

Confirm with what the tool returned, not with what you sent:

- **On:** "Critic on — model `<provider>/<model>`, mode `<per-request|persistent>`. Every answer now goes through the review before you see it."
- **Off:** "Critic off. Answers go straight to you again."

While the critic is on, end every turn with a complete report: what you changed, how you checked it, and what you left out. When a `<critic-feedback>` message arrives, fix what it points out and answer again with the full report. The user does not see the rejected answer, so the new answer has to stand on its own.

Do not turn the critic on for another agent, and do not change its prompt or model unless the user asks.
