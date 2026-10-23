// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AutoApproval, NativeBridge, PermissionRule } from "../core/native/bridge";
import { translate } from "../i18n/messages";
import { PermissionsSection } from "./PermissionsSection";

const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate("fr", key, params);

const rule: PermissionRule = { id: "rule-1", permission: "file.write", scope: "C:\\Docs", createdAt: 1_780_000_000 };

// Pont simulé : seules les quatre méthodes lues par la section sont fournies.
function simulatedBridge(rules: PermissionRule[], audit: AutoApproval[] = []) {
  return {
    listRules: vi.fn(async () => rules),
    revokeRule: vi.fn(async () => true),
    listAudit: vi.fn(async () => audit),
    onAutoApproval: vi.fn(() => () => {}),
  };
}

const asBridge = (simulated: ReturnType<typeof simulatedBridge>) => simulated as unknown as NativeBridge;

describe("autorisations mémorisées dans les réglages", () => {
  afterEach(cleanup);

  it("liste les règles avec leur portée", async () => {
    render(<PermissionsSection bridge={asBridge(simulatedBridge([rule]))} locale="fr" t={t} />);
    expect(await screen.findByText("modifier un fichier : C:\\Docs")).toBeTruthy();
  });

  it("annonce l'absence de règle", async () => {
    render(<PermissionsSection bridge={asBridge(simulatedBridge([]))} locale="fr" t={t} />);
    expect(await screen.findByText("Aucune autorisation mémorisée.")).toBeTruthy();
  });

  it("révoque une règle puis relit la liste", async () => {
    const bridge = simulatedBridge([rule]);
    bridge.listRules.mockResolvedValueOnce([rule]).mockResolvedValueOnce([]);
    render(<PermissionsSection bridge={asBridge(bridge)} locale="fr" t={t} />);
    fireEvent.click(await screen.findByRole("button", { name: "Révoquer" }));
    await waitFor(() => expect(bridge.revokeRule).toHaveBeenCalledWith("rule-1"));
    expect(await screen.findByText("Aucune autorisation mémorisée.")).toBeTruthy();
  });

  it("affiche le journal des actions approuvées automatiquement", async () => {
    const audit: AutoApproval[] = [{ at: 1_780_000_000, permission: "file.write", scope: "C:\\Docs" }];
    render(<PermissionsSection bridge={asBridge(simulatedBridge([rule], audit))} locale="fr" t={t} />);
    // Une règle et une entrée de journal portent le même libellé.
    await waitFor(() => expect(screen.getAllByText("modifier un fichier : C:\\Docs")).toHaveLength(2));
    expect(screen.queryByText("Aucune action approuvée automatiquement pour l'instant.")).toBeNull();
  });
});
