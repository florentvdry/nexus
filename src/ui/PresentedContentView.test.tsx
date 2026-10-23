// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PresentedContent } from "../core/presentation/types";
import { translate } from "../i18n/messages";
import { PresentedContentView } from "./PresentedContentView";

const t = (key: Parameters<typeof translate>[1]) => translate("fr", key);

type Confirmation = Extract<PresentedContent, { kind: "confirmation" }>;

const card = (overrides: Partial<Confirmation> = {}): Confirmation => ({
  kind: "confirmation",
  requestId: "perm-1",
  title: "Modifier un fichier ?",
  rows: [{ label: "Élément", value: "C:\\Docs\\a.pdf" }],
  approve: "Autoriser",
  refuse: "Refuser",
  ...overrides,
});

describe("carte de confirmation : « toujours autoriser »", () => {
  afterEach(cleanup);

  it("n'affiche pas la case quand l'action ne peut pas être mémorisée", () => {
    render(<PresentedContentView content={card()} onAnswer={vi.fn(async () => {})} t={t} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("affiche la case avec le dossier visé quand l'action peut être mémorisée", () => {
    const remember = { label: "Toujours autoriser dans ce dossier : C:\\Docs" };
    render(<PresentedContentView content={card({ remember })} onAnswer={vi.fn(async () => {})} t={t} />);
    expect(screen.getByRole("checkbox", { name: remember.label })).toBeTruthy();
  });

  it("transmet « toujours autoriser » seulement pour une approbation, case cochée", async () => {
    const onAnswer = vi.fn(async () => {});
    render(<PresentedContentView content={card({ remember: { label: "Toujours autoriser" } })} onAnswer={onAnswer} t={t} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Autoriser" }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith("perm-1", true, true));
  });

  it("refuse sans jamais transmettre « toujours autoriser »", async () => {
    const onAnswer = vi.fn(async () => {});
    render(<PresentedContentView content={card({ remember: { label: "Toujours autoriser" } })} onAnswer={onAnswer} t={t} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Refuser" }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith("perm-1", false, false));
  });
});
