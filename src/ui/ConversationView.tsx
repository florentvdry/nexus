import type { OrbState } from "../core/engine/engine";
import type { HistoryEntry } from "../core/presentation/windows";
import type { Task } from "../core/tasks/taskManager";
import type { MessageKey } from "../i18n/messages";
import { CommandBar, type VoiceControl } from "./CommandBar";
import { Orb } from "./Orb";
import { PlusIcon } from "./icons";
import { RecentWindows } from "./RecentWindows";
import { TaskPanel } from "./TaskPanel";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  tone: "info" | "error";
}

interface ConversationViewProps {
  t: Translate;
  messages: ChatMessage[];
  orbState: OrbState;
  statusLabel: string;
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

/** Conversation : fil des échanges au centre, tâches et fenêtres récentes à droite. */
export function ConversationView({
  t,
  messages,
  orbState,
  statusLabel,
  tasks,
  history,
  voice,
  placeholder,
  sendLabel,
  onSubmit,
  onCancelTask,
  onReopen,
  onNewConversation,
}: ConversationViewProps) {
  return (
    <section className="screen conversation" aria-label={t("nav.conversation")}>
      <header className="screen-header conversation-header" data-hud>
        <div className="conversation-identity">
          <Orb state={orbState} size="small" />
          <div>
            <div className="identity-name">NEXUS</div>
            <div className="identity-status" role="status">
              {statusLabel}
            </div>
          </div>
        </div>
        <button type="button" className="ghost-button" onClick={onNewConversation}>
          <PlusIcon size={15} />
          {t("conversation.new")}
        </button>
      </header>

      <div className="conversation-body">
        <div className="thread" aria-live="polite">
          <div className="thread-inner">
            {messages.length === 0 ? (
              <p className="welcome">{t("ui.welcome")}</p>
            ) : (
              messages.map((message) =>
                message.role === "user" ? (
                  <p key={message.id} className="bubble user">
                    {message.text}
                  </p>
                ) : (
                  <div key={message.id} className="turn">
                    <span className="avatar" aria-hidden="true" />
                    <p className={`bubble assistant${message.tone === "error" ? " error" : ""}`}>{message.text}</p>
                  </div>
                ),
              )
            )}
          </div>
        </div>

        <aside className="activity" data-hud aria-label={t("conversation.activity")}>
          <TaskPanel tasks={tasks} t={t} onCancel={onCancelTask} />
          <RecentWindows history={history} t={t} onReopen={onReopen} />
        </aside>
      </div>

      <footer className="dock">
        <CommandBar placeholder={placeholder} sendLabel={sendLabel} onSubmit={onSubmit} voice={voice} />
      </footer>
    </section>
  );
}
