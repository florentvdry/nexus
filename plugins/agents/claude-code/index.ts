import type { PluginApi } from "../../../src/core/plugins/types";
import type { CapabilityHandler, CapabilityManifest } from "../../../src/core/capabilities/types";
import type { AgentEvent } from "../../../src/core/native/bridge";
import { CapabilityError } from "../../../src/core/capabilities/errors";

export const CLAUDE_CODE_MANIFEST: CapabilityManifest = {
  id: "agent.claude-code",
  name: "Claude Code",
  version: "1.0.0",
  description: "Lance Claude Code (CLI officiel) dans un projet, avec confirmation, budget plafonné et progression.",
  categories: ["agents", "development"],
  inputs: ["project", "prompt"],
  outputs: ["agent-result"],
  dependencies: ["Claude Code (CLI installé localement)"],
  permissions: ["agent.run"],
  locality: "network",
  requiredApis: ["Compte Claude Code (authentification locale du CLI)"],
  // 15 minutes de run au maximum, plus le délai de confirmation.
  timeoutMs: 20 * 60_000,
  cost: "llm",
  offline: false,
};

type Outcome = Extract<AgentEvent, { kind: "result" | "error" | "cancelled" }>;

function finish(outcome: Outcome, tools: number, context: Parameters<CapabilityHandler>[1]) {
  const { t, locale } = context;
  if (outcome.kind === "error") throw new CapabilityError("agent-failed", { details: outcome.message });
  if (outcome.kind === "cancelled") throw new CapabilityError("cancelled");

  const status = outcome.isError ? t("agent.status.error") : t("agent.status.done");
  return {
    caption: outcome.isError ? t("agent.caption.error") : t("agent.caption.done"),
    presentations: [
      {
        kind: "information-card" as const,
        title: t("agent.resultTitle"),
        rows: [
          { label: t("agent.status"), value: status },
          { label: t("agent.tools"), value: String(tools) },
          { label: t("agent.denials"), value: String(outcome.denials.length) },
          { label: t("agent.cost"), value: `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(outcome.costUsd)} $` },
          { label: t("agent.turns"), value: String(outcome.turns) },
          { label: t("agent.duration"), value: `${Math.round(outcome.durationMs / 1000)} s` },
        ],
      },
      { kind: "information-card" as const, title: t("agent.answer"), rows: [{ label: t("agent.answer"), value: outcome.text || "—" }] },
    ],
    source: { capabilityId: CLAUDE_CODE_MANIFEST.id, locality: "network" as const, collectedAt: Date.now() },
  };
}

export const claudeCode: CapabilityHandler = async (input, context) => {
  const project = input.project ?? "";
  const prompt = input.prompt ?? "";
  if (!project || !prompt) throw new CapabilityError("invalid-path", { details: "projet ou demande manquant" });

  const runId = crypto.randomUUID();
  let tools = 0;
  const outcome = await new Promise<Outcome>((resolve, reject) => {
    let settled = false;
    const stopListening = context.bridge.onAgentEvent((id, event) => {
      if (id !== runId || settled) return;
      if (event.kind === "tool") {
        tools += 1;
        context.progress(`${context.t("agent.tool")} : ${event.name}${event.summary ? ` — ${event.summary}` : ""}`);
      }
      if (event.kind === "result" || event.kind === "error" || event.kind === "cancelled") {
        settled = true;
        stopListening();
        resolve(event);
      }
    });
    context.signal.addEventListener("abort", () => void context.bridge.cancelAgent(runId), { once: true });
    context.bridge.runAgent(runId, project, prompt).catch((error: unknown) => {
      if (settled) return;
      settled = true;
      stopListening();
      reject(error);
    });
  });
  return finish(outcome, tools, context);
};

export function activate(api: PluginApi): void {
  api.registerCapability(CLAUDE_CODE_MANIFEST, claudeCode);
}
