import { describe, expect, it } from "vitest";

import type { ConfirmationRequest } from "../core/native/bridge";
import { addRequest, removeRequest } from "./queue";

const request = (id: string): ConfirmationRequest => ({ id, permission: "file.delete", rows: [], expiresInSecs: 120, rememberable: false, scope: null });

describe("file des demandes de confirmation", () => {
  it("garde une seule fois une demande reçue deux fois (événement et liste de reprise)", () => {
    const queue = addRequest(addRequest([], request("perm-1")), request("perm-1"));
    expect(queue.map((item) => item.id)).toEqual(["perm-1"]);
  });

  it("retire une demande réglée et garde les autres", () => {
    const queue = [request("perm-1"), request("perm-2")];
    expect(removeRequest(queue, "perm-1").map((item) => item.id)).toEqual(["perm-2"]);
  });
});
