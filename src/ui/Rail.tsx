import type { MessageKey } from "../i18n/messages";
import { CalendarIcon, ChatIcon, HomeIcon, SettingsIcon } from "./icons";

export type View = "home" | "conversation" | "settings";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

interface RailProps {
  view: View;
  planningOpen: boolean;
  t: Translate;
  onNavigate: (view: View) => void;
  onTogglePlanning: () => void;
}

/** Rail gauche : navigation principale, toujours visible. Le planning s'ouvre en panneau par-dessus. */
export function Rail({ view, planningOpen, t, onNavigate, onTogglePlanning }: RailProps) {
  return (
    <nav className="rail" aria-label="NEXUS" data-hud>
      <div className="brand-mark" aria-hidden="true" />
      <button
        type="button"
        className="rail-button"
        aria-label={t("nav.home")}
        aria-current={view === "home" ? "page" : undefined}
        onClick={() => onNavigate("home")}
      >
        <HomeIcon />
      </button>
      <button
        type="button"
        className="rail-button"
        aria-label={t("nav.conversation")}
        aria-current={view === "conversation" ? "page" : undefined}
        onClick={() => onNavigate("conversation")}
      >
        <ChatIcon />
      </button>
      <button
        type="button"
        className="rail-button"
        aria-label={t("schedule.open")}
        aria-pressed={planningOpen}
        onClick={onTogglePlanning}
      >
        <CalendarIcon />
      </button>
      <div className="rail-spacer" />
      <button
        type="button"
        className="rail-button"
        aria-label={t("nav.settings")}
        aria-current={view === "settings" ? "page" : undefined}
        onClick={() => onNavigate("settings")}
      >
        <SettingsIcon />
      </button>
    </nav>
  );
}
