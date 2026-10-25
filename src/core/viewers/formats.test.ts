import { describe, expect, it } from "vitest";

import { extensionOf, fileNameOf, isAbsolutePath, mimeTypeOf, viewerKindOf } from "./formats";

describe("viewerKindOf", () => {
  it.each([
    ["C:\\Users\\ana\\Documents\\rapport.pdf", "pdf"],
    ["/home/ana/photo.JPG", "image"],
    ["D:\\Images\\logo.png", "image"],
    ["notes.md", "markdown"],
    ["notes.markdown", "markdown"],
    ["ventes.csv", "csv"],
    ["ventes.tsv", "csv"],
    ["journal.txt", "text"],
    ["config.json", "text"],
    ["script.ps1", "text"],
    ["main.rs", "text"],
    ["morceau.mp3", "audio"],
    ["voix.m4a", "audio"],
    ["film.mp4", "video"],
    ["clip.WEBM", "video"],
  ])("%s est affiché comme %s", (path, kind) => {
    expect(viewerKindOf(path)).toBe(kind);
  });

  it("refuse les formats que NEXUS ne sait pas afficher", () => {
    expect(viewerKindOf("setup.exe")).toBeNull();
    expect(viewerKindOf("archive.zip")).toBeNull();
    expect(viewerKindOf("document.docx")).toBeNull();
  });

  it("n'affiche pas les SVG : ils peuvent contenir du script", () => {
    expect(viewerKindOf("logo.svg")).toBeNull();
  });

  it("refuse un fichier sans extension ou dont le nom commence par un point", () => {
    expect(viewerKindOf("Makefile")).toBeNull();
    expect(viewerKindOf(".txt")).toBeNull();
  });
});

describe("mimeTypeOf", () => {
  it("donne le type MIME des médias, pour que le lecteur accepte le blob", () => {
    expect(mimeTypeOf("film.mp4")).toBe("video/mp4");
    expect(mimeTypeOf("morceau.mp3")).toBe("audio/mpeg");
    expect(mimeTypeOf("rapport.pdf")).toBe("application/pdf");
  });

  it("donne un type générique pour un texte", () => {
    expect(mimeTypeOf("notes.txt")).toBe("application/octet-stream");
  });
});

describe("extensionOf et fileNameOf", () => {
  it("lit l'extension et le nom, quel que soit le séparateur", () => {
    expect(extensionOf("C:\\dossier\\Rapport.Final.PDF")).toBe("pdf");
    expect(fileNameOf("C:\\dossier\\rapport.pdf")).toBe("rapport.pdf");
    expect(fileNameOf("/home/ana/rapport.pdf")).toBe("rapport.pdf");
  });
});

describe("isAbsolutePath", () => {
  it("accepte les chemins Windows et POSIX absolus", () => {
    expect(isAbsolutePath("C:\\Users\\ana\\a.pdf")).toBe(true);
    expect(isAbsolutePath("\\\\serveur\\partage\\a.pdf")).toBe(true);
    expect(isAbsolutePath("/home/ana/a.pdf")).toBe(true);
  });

  it("refuse un nom seul ou un chemin relatif", () => {
    expect(isAbsolutePath("rapport.pdf")).toBe(false);
    expect(isAbsolutePath("Documents\\rapport.pdf")).toBe(false);
  });
});
