// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
import { describe, expect, it, vi } from "vitest";

import type { InstalledConnector } from "../core/connectors/types";
import type { NativeBridge } from "../core/native/bridge";
import { ConnectorScopes } from "./ConnectorScopes";

const connector: InstalledConnector = {
  id: "app.example/notes",
  title: "Notes",
  package: "@example/notes-mcp",
  version: "1.2.0",
  variables: [],
  scopes: ["read"],
};

afterEach(cleanup);

const t = (key: string) => key;

function bridgeWith(overrides: Partial<Record<"mcpInstalled" | "mcpSetScopes", unknown>> = {}) {
  return {
    mcpInstalled: vi.fn(async () => [connector]),
    mcpSetScopes: vi.fn(async (_id: string, scopes: string[]) => ({ ...connector, scopes })),
    ...overrides,
  } as unknown as NativeBridge & { mcpSetScopes: ReturnType<typeof vi.fn> };
}

describe("accès des connecteurs", () => {
  it("affiche la lecture accordée et verrouillée, sans bouton tant que rien ne change", async () => {
    render(<ConnectorScopes bridge={bridgeWith()} t={t} />);
    const read = (await screen.findByLabelText("connectors.scope.read")) as HTMLInputElement;
    expect(read.checked).toBe(true);
    expect(read.disabled).toBe(true);
    expect(screen.queryByText("connectors.scopes.save")).toBeNull();
  });

  it("n'enregistre l'écriture qu'après la confirmation du natif", async () => {
    const bridge = bridgeWith();
    render(<ConnectorScopes bridge={bridge} t={t} />);
    fireEvent.click(await screen.findByLabelText("connectors.scope.write"));
    fireEvent.click(screen.getByText("connectors.scopes.save"));
    await waitFor(() => expect(bridge.mcpSetScopes).toHaveBeenCalledWith(connector.id, ["read", "write"]));
    await waitFor(() => expect(screen.queryByText("connectors.scopes.save")).toBeNull());
  });

  it("garde les accès tels quels quand la confirmation échoue", async () => {
    const bridge = bridgeWith({ mcpSetScopes: vi.fn(async () => Promise.reject(new Error("refusé"))) });
    render(<ConnectorScopes bridge={bridge} t={t} />);
    fireEvent.click(await screen.findByLabelText("connectors.scope.delete"));
    fireEvent.click(screen.getByText("connectors.scopes.save"));
    expect(await screen.findByText("connectors.scopes.failed")).toBeTruthy();
    expect((screen.getByLabelText("connectors.scope.delete") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("connectors.scopes.save")).toBeTruthy();
  });

  it("reste vide, sans erreur, quand le pont ne répond pas", async () => {
    render(<ConnectorScopes bridge={bridgeWith({ mcpInstalled: vi.fn(async () => Promise.reject(new Error("absent"))) })} t={t} />);
    expect(await screen.findByText("connectors.scopes.empty")).toBeTruthy();
  });
});
