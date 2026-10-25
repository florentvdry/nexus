import type { OrbState } from "../core/engine/engine";
import type { HistoryEntry } from "../core/presentation/windows";
import type { Task } from "../core/tasks/taskManager";
import type { Locale, MessageKey } from "../i18n/messages";
import { CommandBar, type VoiceControl } from "./CommandBar";
import { LanguageSwitch } from "./LanguageSwitch";
import { AppsIcon, CalendarIcon, CpuIcon, LockIcon, PlusIcon, SearchIcon } from "./icons";
import { Orb } from "./Orb";
import { RecentWindows } from "./RecentWindows";
import { TaskPanel } from "./TaskPanel";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  tone: "info" | "error";
}

type Tone = "violet" | "cyan" | "amber" | "green";

/** Quatre suggestions, affichées tant qu'aucune demande n'a été faite. */
const SUGGESTIONS: { tone: Tone; title: MessageKey; example: MessageKey; icon: typeof AppsIcon }[] = [
  { tone: "violet", title: "home.suggestion.open.title", example: "home.suggestion.open.example", icon: AppsIcon },
  { tone: "cyan", title: "home.suggestion.see.title", example: "home.suggestion.see.example", icon: CpuIcon },
  { tone: "amber", title: "home.suggestion.find.title", example: "home.suggestion.find.example", icon: SearchIcon },
  { tone: "green", title: "home.suggestion.plan.title", example: "home.suggestion.plan.example", icon: CalendarIcon },
];

interface SceneViewProps {
  t: Translate;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  /** Échanges récents : la scène n'en montre que le dernier, la question et la réponse. */
  messages: ChatMessage[];
  orbState: OrbState;
  statusLabel: string;
  /** État du modèle local, affiché en haut : « Modèle local prêt » ou « Aucun modèle choisi ». */
  modelLabel: string;
  tasks: Task[];
  history: HistoryEntry[];
  voice?: VoiceControl;
  placeholder: string;
  sendLabel: string;
  onSubmit: (text: string) => void;
  onCancelTask: (id: string) => void;
  onReopen: (id: string) => void;
  onNewConversation: () => void;
}

/**
 * Scène principale : l'orbe au centre, la dernière demande et la réponse dessous, les tâches et les fenêtres récentes à
 * gauche. Les résultats détaillés s'ouvrent dans des fenêtres flottantes autour de l'orbe. Pas de fil de conversation.
 */
export function SceneView({
  t,
  locale,
  onLocale,
  messages,
  orbState,
  statusLabel,
  modelLabel,
  tasks,
  history,
  voice,
  placeholder,
  sendLabel,
  onSubmit,
  onCancelTask,
  onReopen,
  onNewConversation,
}: SceneViewProps) {
  const lastRequest = [...messages].reverse().find((message) => message.role === "user");
  const lastAnswer = [...messages].reverse().find((message) => message.role === "assistant");
  const answerCount = messages.filter((message) => message.role === "assistant").length;
  const empty = messages.length === 0;

  return (
    <section className="screen scene" aria-label={t("nav.home")}>
      <header className="scene-header" data-hud>
        <div className="scene-identity">
          <span className="wordmark">NEXUS</span>
          <span className="status-pill scene-status">
            <span className="status-dot" aria-hidden="true" />
            {modelLabel}
          </span>
        </div>
        <div className="scene-actions">
          <button type="button" className="ghost-button" onClick={onNewConversation} disabled={empty}>
            <PlusIcon size={15} />
            {t("conversation.new")}
          </button>
          <LanguageSwitch locale={locale} label={t("ui.language")} onChange={onLocale} />
        </div>
      </header>

      <aside className="scene-side" data-hud aria-label={t("conversation.activity")}>
        <TaskPanel tasks={tasks} t={t} onCancel={onCancelTask} />
        <RecentWindows history={history} t={t} onReopen={onReopen} />
      </aside>

      <div className="scene-stage">
        <Orb state={orbState} size="hero" />
        <div className="scene-label" role="status">
          {statusLabel}
        </div>

        {empty ? (
          <>
            <h1 className="scene-title">{t("home.title")}</h1>
            <p className="lead">{t("home.subtitle")}</p>
            <div className="suggestions">
              {SUGGESTIONS.map(({ tone, title, example, icon: Icon }) => (
                <button key={title} type="button" className="suggestion" data-tone={tone} onClick={() => onSubmit(t(example))}>
                  <span className="suggestion-icon">
                    <Icon size={19} />
                  </span>
                  <span>
                    <span className="suggestion-title">{t(title)}</span>
                    <span className="suggestion-example">« {t(example)} »</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="scene-answer" data-hud data-count={answerCount} aria-live="polite">
            {lastRequest && <p className="scene-caption">› {lastRequest.text}</p>}
            {lastAnswer && (
              <p className={`scene-text${lastAnswer.tone === "error" ? " error" : ""}`} data-answer>
                {lastAnswer.text}
              </p>
            )}
          </div>
        )}
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
