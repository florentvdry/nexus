// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeCallError, NativeUnavailableError } from "../../core/native/adapter";
import { MAX_VIEW_BYTES } from "../../core/viewers/formats";
import { translate, type MessageKey } from "../../i18n/messages";
import { FileView, type ReadFile } from "./FileView";
import { openPdf } from "./pdf";

vi.mock("./pdf", () => ({
  openPdf: vi.fn(),
}));

const t = (key: MessageKey, params?: Record<string, string | number>) => translate("fr", key, params);

const bytesOf = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

/** Un lecteur qui renvoie ces octets pour n'importe quel chemin. */
const reader = (bytes: ArrayBuffer): ReadFile & ReturnType<typeof vi.fn> => vi.fn(async () => bytes) as ReadFile & ReturnType<typeof vi.fn>;

describe("visionneuse : chemin, lecture et erreurs", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:nexus-test");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(cleanup);

  it("lit le fichier dans le natif, puis l'affiche", async () => {
    const readFile = reader(bytesOf("bonjour"));
    render(<FileView path={"C:\\Docs\\notes.txt"} readFile={readFile} t={t} />);
    expect(await screen.findByText("bonjour")).toBeTruthy();
    expect(readFile).toHaveBeenCalledWith("C:\\Docs\\notes.txt");
  });

  it("affiche le chemin complet en pied de fenêtre", async () => {
    render(<FileView path={"C:\\Docs\\notes.txt"} readFile={reader(bytesOf("x"))} t={t} />);
    expect(await screen.findByTitle("C:\\Docs\\notes.txt")).toBeTruthy();
  });

  it("dit qu'il n'y a pas de lecteur hors de l'application de bureau", async () => {
    render(<FileView path={"C:\\Docs\\notes.txt"} t={t} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("application de bureau");
  });

  it("traduit l'indisponibilité du natif", async () => {
    const readFile = vi.fn(async () => {
      throw new NativeUnavailableError();
    });
    render(<FileView path={"C:\\Docs\\notes.txt"} readFile={readFile} t={t} />);
    expect((await screen.findByRole("alert")).textContent).toContain("application de bureau");
  });

  it("explique un refus natif dans les mots de l'application, avec le chemin", async () => {
    const readFile = vi.fn(async () => {
      throw new NativeCallError("outside-allowed-folders", "C:/Windows/win.ini");
    });
    render(<FileView path={"C:/Windows/win.ini"} readFile={readFile} t={t} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Ce dossier n'est pas autorisé : C:/Windows/win.ini.");
  });

  it("montre le motif quand le natif refuse la lecture", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("dossier hors des emplacements autorisés : C:\\Windows\\win.ini");
    });
    render(<FileView path={"C:\\Windows\\win.ini"} readFile={readFile} t={t} />);
    expect((await screen.findByRole("alert")).textContent).toContain("hors des emplacements autorisés");
  });

  it("ne lit pas un format que NEXUS ne sait pas afficher", async () => {
    const readFile = reader(bytesOf("MZ"));
    render(<FileView path={"C:\\Docs\\setup.exe"} readFile={readFile} t={t} />);
    expect((await screen.findByRole("alert")).textContent).toContain(".exe");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("refuse un contenu au-delà de la limite d'affichage, sans le décoder", async () => {
    const huge = { byteLength: MAX_VIEW_BYTES + 1 } as ArrayBuffer;
    render(<FileView path={"C:\\Docs\\film.mp4"} readFile={reader(huge)} t={t} />);
    expect((await screen.findByRole("alert")).textContent).toContain("100 Mo");
  });
});

describe("visionneuse : texte et code", () => {
  afterEach(cleanup);

  it("affiche un texte UTF-8 tel quel, dans un bloc préformaté", async () => {
    const { container } = render(<FileView path={"C:\\Docs\\journal.log"} readFile={reader(bytesOf("é ligne 1\nligne 2"))} t={t} />);
    await waitFor(() => expect(container.querySelector("pre.viewer-text")?.textContent).toBe("é ligne 1\nligne 2"));
  });

  it("décode un vieux fichier Windows-1252 quand ce n'est pas de l'UTF-8", async () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]).buffer as ArrayBuffer; // « café » en Windows-1252
    const { container } = render(<FileView path={"C:\\Docs\\vieux.txt"} readFile={reader(latin1)} t={t} />);
    await waitFor(() => expect(container.querySelector("pre")?.textContent).toBe("café"));
  });

  it("refuse un fichier binaire : son contenu ne se lit pas comme du texte", async () => {
    render(<FileView path={"C:\\Docs\\donnees.txt"} readFile={reader(new Uint8Array([0x50, 0x00, 0x01]).buffer as ArrayBuffer)} t={t} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Fichier binaire");
  });

  it("affiche un code source comme du texte, sans l'interpréter", async () => {
    const source = "<script>alert('x')</script>\nfn main() {}";
    const { container } = render(<FileView path={"C:\\Dev\\page.html"} readFile={reader(bytesOf(source))} t={t} />);
    await waitFor(() => expect(container.querySelector("pre")?.textContent).toBe(source));
    expect(container.querySelector("script")).toBeNull();
  });

  it("tronque un très long texte et le dit", async () => {
    const { container } = render(<FileView path={"C:\\Docs\\long.txt"} readFile={reader(bytesOf("a".repeat(200_001)))} t={t} />);
    await waitFor(() => expect(container.querySelector("pre")?.textContent?.length).toBe(200_000));
    expect(screen.getByText(/Seuls les 200000 premiers caractères/)).toBeTruthy();
  });
});

describe("visionneuse : CSV", () => {
  afterEach(cleanup);

  it("affiche les en-têtes et les lignes dans un tableau", async () => {
    const { container } = render(<FileView path={"C:\\Docs\\ventes.csv"} readFile={reader(bytesOf("nom;ville\nAna;Lyon\nLéo;Nantes"))} t={t} />);
    await waitFor(() => expect(container.querySelector("table")).not.toBeNull());
    const headers = [...container.querySelectorAll("th")].map((cell) => cell.textContent);
    expect(headers).toEqual(["nom", "ville"]);
    expect(screen.getByText("Lyon")).toBeTruthy();
    expect(screen.getByText("Nantes")).toBeTruthy();
  });

  it("n'affiche que les premières lignes d'un gros fichier et l'indique", async () => {
    const lines = ["id,valeur"];
    for (let index = 1; index <= 600; index += 1) lines.push(`${index},v${index}`);
    const { container } = render(<FileView path={"C:\\Docs\\gros.csv"} readFile={reader(bytesOf(lines.join("\n")))} t={t} />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr")).toHaveLength(500));
    expect(screen.getByText(/Seules les 500 premières lignes sur 600/)).toBeTruthy();
  });
});

describe("visionneuse : Markdown", () => {
  afterEach(cleanup);

  it("rend les titres, les listes et l'emphase, sans HTML brut", async () => {
    const markdown = "# Titre\n\n- **important**\n- `code`\n\nUn [lien](https://example.com).";
    const { container } = render(<FileView path={"C:\\Docs\\notes.md"} readFile={reader(bytesOf(markdown))} t={t} />);
    await waitFor(() => expect(container.querySelector("h1")?.textContent).toBe("Titre"));
    expect(container.querySelector("li strong")?.textContent).toBe("important");
    expect(container.querySelector("li code")?.textContent).toBe("code");
    expect(container.querySelector(".viewer-link")?.getAttribute("title")).toBe("https://example.com");
  });

  it("n'injecte jamais le HTML d'un Markdown : la balise reste du texte", async () => {
    const { container } = render(<FileView path={"C:\\Docs\\piege.md"} readFile={reader(bytesOf("<img src=x onerror=alert(1)> bonjour"))} t={t} />);
    await waitFor(() => expect(container.querySelector(".viewer-markdown")).not.toBeNull());
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".viewer-markdown")?.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("visionneuse : image, audio et vidéo", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:nexus-media");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(cleanup);

  it("affiche une image à partir d'un blob du bon type, puis libère le blob", async () => {
    const { container, unmount } = render(<FileView path={"C:\\Images\\photo.jpeg"} readFile={reader(bytesOf("octets"))} t={t} />);
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:nexus-media"));
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("photo.jpeg");
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("image/jpeg");
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:nexus-media");
  });

  it("donne au lecteur audio le type MIME du format", async () => {
    const { container } = render(<FileView path={"C:\\Musique\\morceau.mp3"} readFile={reader(bytesOf("son"))} t={t} />);
    await waitFor(() => expect(container.querySelector("audio")?.getAttribute("src")).toBe("blob:nexus-media"));
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("audio/mpeg");
  });

  it("affiche un lecteur vidéo avec ses commandes", async () => {
    const { container } = render(<FileView path={"C:\\Videos\\clip.webm"} readFile={reader(bytesOf("image"))} t={t} />);
    await waitFor(() => expect(container.querySelector("video")?.hasAttribute("controls")).toBe(true));
  });
});

describe("visionneuse : PDF", () => {
  beforeEach(() => {
    vi.mocked(openPdf).mockReset();
  });
  afterEach(cleanup);

  it("dessine chaque page dans un canevas et annonce le nombre de pages", async () => {
    const renderPage = vi.fn(async (_index: number, _canvas: HTMLCanvasElement, _width: number) => {});
    const destroy = vi.fn();
    vi.mocked(openPdf).mockResolvedValue({ pageCount: 2, renderPage, destroy });

    const { container } = render(<FileView path={"C:\\Docs\\rapport.pdf"} readFile={reader(bytesOf("%PDF"))} t={t} />);
    expect(await screen.findByText("2 page(s)")).toBeTruthy();
    await waitFor(() => expect(container.querySelectorAll("canvas.viewer-page")).toHaveLength(2));
    expect(renderPage.mock.calls.map((call) => call[0])).toEqual([0, 1]);
  });

  it("libère le document quand la fenêtre est fermée", async () => {
    const destroy = vi.fn();
    vi.mocked(openPdf).mockResolvedValue({ pageCount: 1, renderPage: vi.fn(async () => {}), destroy });
    const { unmount } = render(<FileView path={"C:\\Docs\\rapport.pdf"} readFile={reader(bytesOf("%PDF"))} t={t} />);
    await screen.findByText("1 page(s)");
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("dit qu'un PDF ne s'ouvre pas au lieu d'afficher une page vide", async () => {
    vi.mocked(openPdf).mockRejectedValue(new Error("Invalid PDF structure"));
    render(<FileView path={"C:\\Docs\\abime.pdf"} readFile={reader(bytesOf("pas un pdf"))} t={t} />);
    expect((await screen.findByRole("alert")).textContent).toContain("ne peut pas être ouvert");
  });

  it("ne dessine que les 30 premières pages d'un long document", async () => {
    vi.mocked(openPdf).mockResolvedValue({ pageCount: 40, renderPage: vi.fn(async () => {}), destroy: vi.fn() });
    const { container } = render(<FileView path={"C:\\Docs\\long.pdf"} readFile={reader(bytesOf("%PDF"))} t={t} />);
    await waitFor(() => expect(container.querySelectorAll("canvas.viewer-page")).toHaveLength(30));
    expect(screen.getByText("Seules les 30 premières pages sont affichées.")).toBeTruthy();
  });
});
