import type { OrbState } from "../core/engine/engine";
import type { Locale, MessageKey } from "../i18n/messages";
import { CommandBar, type VoiceControl } from "./CommandBar";
import { LanguageSwitch } from "./LanguageSwitch";
import { AppsIcon, CalendarIcon, CpuIcon, LockIcon, SearchIcon } from "./icons";
import { Orb } from "./Orb";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

type Tone = "violet" | "cyan" | "amber" | "green";

/** Quatre raccourcis de l'accueil : un titre, un exemple de phrase à dire ou taper. */
const SUGGESTIONS: { tone: Tone; title: MessageKey; example: MessageKey; icon: typeof AppsIcon }[] = [
  { tone: "violet", title: "home.suggestion.open.title", example: "home.suggestion.open.example", icon: AppsIcon },
  { tone: "cyan", title: "home.suggestion.see.title", example: "home.suggestion.see.example", icon: CpuIcon },
  { tone: "amber", title: "home.suggestion.find.title", example: "home.suggestion.find.example", icon: SearchIcon },
  { tone: "green", title: "home.suggestion.plan.title", example: "home.suggestion.plan.example", icon: CalendarIcon },
];

interface HomeViewProps {
  t: Translate;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  orbState: OrbState;
  statusLabel: string;
  placeholder: string;
  sendLabel: string;
  voice?: VoiceControl;
  onSubmit: (text: string) => void;
  /** Un raccourci de l'accueil envoie directement sa phrase d'exemple. */
  onSuggest: (text: string) => void;
}

/** Accueil : l'orbe au repos, quatre raccourcis et la barre de commande. */
export function HomeView({ t, locale, onLocale, orbState, statusLabel, placeholder, sendLabel, voice, onSubmit, onSuggest }: HomeViewProps) {
  return (
    <section className="screen home" aria-label={t("nav.home")}>
      <header className="screen-header">
        <span className="wordmark">NEXUS</span>
        <LanguageSwitch locale={locale} label={t("ui.language")} onChange={onLocale} />
      </header>

      <div className="home-center">
        <Orb state={orbState} size="hero" />
        <div className="status-pill" role="status">
          <span className="status-dot" aria-hidden="true" />
          {statusLabel}
        </div>
        <h1>{t("home.title")}</h1>
        <p className="lead">{t("home.subtitle")}</p>

        <div className="suggestions">
          {SUGGESTIONS.map(({ tone, title, example, icon: Icon }) => (
            <button key={title} type="button" className="suggestion" data-tone={tone} onClick={() => onSuggest(t(example))}>
              <span className="suggestion-icon">
                <Icon size={19} />
              </span>
              <span>
                <span className="suggestion-title">{t(title)}</span>
                <span className="suggestion-example">
                  « {t(example)} »
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <footer className="dock">
        <CommandBar placeholder={placeholder} sendLabel={sendLabel} onSubmit={onSubmit} voice={voice} />
        <p className="privacy-note">
          <LockIcon size={13} />
          {t("home.privacy")}
        </p>
      </footer>
    </section>
  );
}
