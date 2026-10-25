import { beforeEach, describe, expect, it, vi } from "vitest";

import { callNative } from "../core/native/tauri-adapter";
import { answerConfirmation, pendingConfirmations } from "./confirmBridge";

vi.mock("../core/native/tauri-adapter", () => ({ callNative: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

describe("pont de la fenêtre de confirmation", () => {
  beforeEach(() => {
    vi.mocked(callNative).mockClear();
  });

  it("envoie la réponse au natif, sans identité, « toujours autoriser » faux par défaut", async () => {
    await answerConfirmation("perm-1", true);
    expect(callNative).toHaveBeenCalledWith("permission_answer", { id: "perm-1", approved: true, remember: false });
  });

  it("transmet « toujours autoriser » quand l'utilisateur coche la case", async () => {
    await answerConfirmation("perm-2", true, true);
    expect(callNative).toHaveBeenCalledWith("permission_answer", { id: "perm-2", approved: true, remember: true });
  });

  it("reprend les demandes en attente depuis le natif à l'ouverture de la fenêtre", async () => {
    await pendingConfirmations();
    expect(callNative).toHaveBeenCalledWith("confirmation_pending");
  });
});
