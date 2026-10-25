import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { readStoredLocale } from "../ui/locale";
import "../ui/App.css";
import { applyLargeText, readLargeText } from "../ui/textScale";
import { ConfirmApp } from "./ConfirmApp";

applyLargeText(readLargeText());

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ConfirmApp locale={readStoredLocale()} />
  </StrictMode>,
);
