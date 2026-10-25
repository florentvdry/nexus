import { describe, expect, it } from "vitest";

import type { ConfirmationRequest } from "../native/bridge";
import { confirmationContent, permissionTitle } from "./content";

function request(overrides: Partial<ConfirmationRequest>): ConfirmationRequest {
  return { id: "perm-1", permission: "file.delete", rows: [], expiresInSecs: 120, rememberable: false, scope: null, ...overrides };
}

describe("carte de confirmation", () => {
  it("affiche le titre, chaque paramètre et les deux réponses, en français", () => {
    const card = confirmationContent(request({ rows: [{ key: "path", value: "/home/ana/Documents/vieux.txt" }] }), "fr");
    expect(card).toEqual({
      kind: "confirmation",
      requestId: "perm-1",
      title: "Envoyer à la corbeille ?",
      rows: [{ label: "Élément", value: "/home/ana/Documents/vieux.txt" }],
      approve: "Autoriser",
      refuse: "Refuser",
    });
  });

  it("propose « toujours autoriser » pour une écriture, avec le dossier que la règle couvrirait", () => {
    const card = confirmationContent(
      request({ permission: "file.write", rememberable: true, scope: "/home/ana/Documents", rows: [{ key: "from", value: "/home/ana/a.pdf" }] }),
      "fr",
    );
    expect(card).toMatchObject({ remember: { label: "Toujours autoriser dans ce dossier : /home/ana/Documents" } });
  });

  it("propose « toujours autoriser » pour un projet Claude Code, et jamais pour une suppression", () => {
    const project = confirmationContent(request({ permission: "agent.run", rememberable: true, scope: "/home/ana/projet" }), "fr");
    expect(project).toMatchObject({ remember: { label: "Toujours autoriser pour ce projet : /home/ana/projet" } });
    const deletion = confirmationContent(request({ rememberable: false, scope: "/home/ana" }), "fr");
    expect(deletion).not.toHaveProperty("remember");
  });

  it("traduit le titre selon la langue, et garde un titre générique pour une permission inconnue", () => {
    expect(permissionTitle("en", "file.delete")).toBe("Send to the recycle bin?");
    expect(permissionTitle("fr", "permission.inconnue")).toBe("Autoriser cette action ?");
  });
});
