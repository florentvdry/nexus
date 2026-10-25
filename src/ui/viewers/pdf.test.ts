import { describe, expect, it, vi } from "vitest";

const { getDocument } = vi.hoisted(() => ({
  getDocument: vi.fn((_options: { data: Uint8Array; useWasm: boolean; disableAutoFetch: boolean }) => ({
    promise: Promise.resolve({ numPages: 3, getPage: vi.fn(), loadingTask: { destroy: vi.fn() } }),
  })),
}));

vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument }));

import { openPdf } from "./pdf";

describe("ouverture d'un PDF", () => {
  it("donne à pdf.js une copie des octets : le tampon de l'appelant reste utilisable", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]).buffer as ArrayBuffer;
    const preview = await openPdf(bytes);

    expect(preview.pageCount).toBe(3);
    const passed = getDocument.mock.calls[0][0].data;
    expect(passed.buffer).not.toBe(bytes);
    expect(Array.from(passed)).toEqual([37, 80, 68, 70]);
    // pdf.js détache les octets qu'il reçoit : l'original doit rester intact pour une nouvelle ouverture.
    expect(bytes.byteLength).toBe(4);
  });

  it("désactive WebAssembly et la récupération de polices distantes", async () => {
    await openPdf(new ArrayBuffer(8));
    const options = getDocument.mock.calls[getDocument.mock.calls.length - 1][0];
    expect(options).toMatchObject({ useWasm: false, disableAutoFetch: true });
  });
});
