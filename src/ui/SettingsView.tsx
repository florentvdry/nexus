import { useState, type ReactNode } from "react";

import type { NativeBridge } from "../core/native/bridge";
import type { VoiceSettings } from "../core/voice/settings";
import type { Locale, MessageKey } from "../i18n/messages";
import { AccessibilitySection } from "./AccessibilitySection";
import { AgendaSection } from "./AgendaSection";
import { HardwareSection } from "./HardwareSection";
import { JournalSection } from "./JournalSection";
import { LanguageSwitch } from "./LanguageSwitch";
import { MemorySection } from "./MemorySection";
import { ModelSection } from "./ModelSection";
import { NeuralVoiceSection } from "./NeuralVoiceSection";
import { NimSection } from "./NimSection";
import { PermissionsSection } from "./PermissionsSection";
import { StartupSection } from "./StartupSection";
import { VoiceSettingsFields } from "./VoiceSettings";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

type PaneId = "general" | "model" | "voice" | "permissions" | "memory" | "journal" | "accessibility" | "startup" | "agenda" | "online";

const PANES: { id: PaneId; label: MessageKey }[] = [
  { id: "general", label: "settings.nav.general" },
  { id: "model", label: "settings.nav.model" },
  { id: "voice", label: "settings.nav.voice" },
  { id: "permissions", label: "settings.nav.permissions" },
  { id: "memory", label: "settings.nav.memory" },
  { id: "journal", label: "settings.nav.journal" },
  { id: "accessibility", label: "settings.nav.accessibility" },
  { id: "startup", label: "settings.nav.startup" },
  { id: "agenda", label: "settings.nav.agenda" },
  { id: "online", label: "settings.nav.online" },
];

interface SettingsViewProps {
  t: Translate;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  bridge: NativeBridge;
  voiceSettings: VoiceSettings;
  onVoiceChange: (patch: Partial<VoiceSettings>) => void;
  modelRevision: number;
  onOpenSetup: () => void;
}

/** Une ligne de réglage : libellé à gauche, commande à droite. */
function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-title">{title}</div>
      {children}
    </div>
  );
}

/** Réglages : sous-navigation à gauche, une page à la fois. Chaque page regroupe les sections existantes. */
export function SettingsView({
  t,
  locale,
  onLocale,
  bridge,
  voiceSettings,
  onVoiceChange,
  modelRevision,
  onOpenSetup,
}: SettingsViewProps) {
  const [pane, setPane] = useState<PaneId>("general");
  const current = PANES.find((item) => item.id === pane) ?? PANES[0];

  const renderPane = (): ReactNode => {
    switch (pane) {
      case "general":
        return (
          <div className="card">
            <Row title={t("settings.general.language")}>
              <LanguageSwitch locale={locale} label={t("ui.language")} onChange={onLocale} />
            </Row>
            <Row title={t("setup.title")}>
              <button type="button" className="ghost-button" onClick={onOpenSetup}>
                {t("setup.open")}
              </button>
            </Row>
          </div>
        );
      case "model":
        return (
          <>
            <p className="pane-intro">{t("settings.model.intro")}</p>
            <div className="card">
              <HardwareSection bridge={bridge} t={t} />
            </div>
            <div className="card">
              <ModelSection bridge={bridge} t={t} revision={modelRevision} />
            </div>
            <div className="card">
              <Row title={t("setup.title")}>
                <button type="button" className="ghost-button" onClick={onOpenSetup}>
                  {t("setup.open")}
                </button>
              </Row>
            </div>
          </>
        );
      case "voice":
        return (
          <>
            <div className="card">
              <VoiceSettingsFields settings={voiceSettings} onChange={onVoiceChange} t={t} />
            </div>
            <div className="card">
              <NeuralVoiceSection bridge={bridge} t={t} />
            </div>
          </>
        );
      case "permissions":
        return (
          <div className="card">
            <PermissionsSection bridge={bridge} locale={locale} t={t} />
          </div>
        );
      case "memory":
        return (
          <div className="card">
            <MemorySection bridge={bridge} locale={locale} t={t} />
          </div>
        );
      case "journal":
        return (
          <div className="card">
            <JournalSection bridge={bridge} locale={locale} t={t} />
          </div>
        );
      case "accessibility":
        return (
          <div className="card">
            <AccessibilitySection t={t} />
          </div>
        );
      case "startup":
        return (
          <div className="card">
            <StartupSection bridge={bridge} t={t} />
          </div>
        );
      case "agenda":
        return (
          <div className="card">
            <AgendaSection t={t} />
          </div>
        );
      case "online":
        return (
          <div className="card">
            <NimSection t={t} />
          </div>
        );
    }
  };

  return (
    <section className="screen settings" aria-label={t("settings.title")}>
      <nav className="settings-nav" aria-label={t("settings.title")} data-hud>
        <h1>{t("settings.title")}</h1>
        {PANES.map((item) => (
          <button
            key={item.id}
            type="button"
            className="settings-link"
            aria-current={item.id === pane ? "true" : undefined}
            onClick={() => setPane(item.id)}
          >
            {t(item.label)}
          </button>
        ))}
      </nav>

      <div className="settings-main">
        <div className="settings-inner">
          <h2>{t(current.label)}</h2>
          {renderPane()}
        </div>
      </div>
    </section>
  );
}
