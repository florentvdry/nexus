import { useEffect, useReducer, useRef, useState } from "react";

import { createEngine, type Engine, type EngineEvent, type OrbState } from "../core/engine/engine";
import type { Rect } from "../core/presentation/types";
import {
  EMPTY_WINDOWS,
  closeAllWindows,
  closeLastWindow,
  closeWindow,
  focusWindow,
  moveWindow,
  openWindow,
  reflowOpenWindows,
  reopenFromHistory,
  type WindowContext,
  type WindowRequest,
  type WindowsState,
} from "../core/presentation/windows";
import type { Task } from "../core/tasks/taskManager";
import { translate, type Locale, type MessageKey } from "../i18n/messages";
import { CommandBar } from "./CommandBar";
import { FloatingWindow } from "./FloatingWindow";
import { HistoryMenu } from "./HistoryMenu";
import { Orb } from "./Orb";
import { TaskPanel } from "./TaskPanel";
import { readStoredLocale, storeLocale } from "./locale";
import { readWindowContext } from "./scene";

type WindowAction =
  | { type: "open"; request: WindowRequest; context: WindowContext }
  | { type: "close"; id: string; now: number }
  | { type: "closeLast"; now: number }
  | { type: "closeAll"; now: number }
  | { type: "move"; id: string; rect: Rect; context: WindowContext }
  | { type: "focus"; id: string }
  | { type: "reopen"; id: string; context: WindowContext }
  | { type: "reflow"; context: WindowContext };

function windowsReducer(state: WindowsState, action: WindowAction): WindowsState {
  switch (action.type) {
    case "open":
      return openWindow(state, action.request, action.context);
    case "close":
      return closeWindow(state, action.id, action.now);
    case "closeLast":
      return closeLastWindow(state, action.now);
    case "closeAll":
      return closeAllWindows(state, action.now);
    case "move":
      return moveWindow(state, action.id, action.rect, action.context);
    case "focus":
      return focusWindow(state, action.id);
    case "reopen":
      return reopenFromHistory(state, action.id, action.context);
    case "reflow":
      return reflowOpenWindows(state, action.context);
  }
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  tone: "info" | "error";
}

const MAX_MESSAGES = 12;
const VISIBLE_MESSAGES = 4;

const ORB_LABEL: Record<OrbState, MessageKey> = {
  idle: "ui.orb.idle",
  listening: "ui.orb.listening",
  recognizing: "ui.orb.recognizing",
  thinking: "ui.orb.thinking",
  executing: "ui.orb.executing",
  responding: "ui.orb.responding",
  error: "ui.orb.error",
};

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${++sequence}`;

export interface AppProps {
  /** Moteur injecté pour les tests ; l'application crée le sien par défaut. */
  engine?: Engine;
}

export function App({ engine: injectedEngine }: AppProps) {
  const [engine] = useState(() => injectedEngine ?? createEngine({ locale: readStoredLocale() }));
  const [locale, setLocale] = useState<Locale>(() => engine.locale);
  const [messages, setMessages] = useState<Message[]>([]);
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [tasks, setTasks] = useState<Task[]>(() => engine.tasksSnapshot());
  const [windows, dispatch] = useReducer(windowsReducer, EMPTY_WINDOWS);
  const windowsRef = useRef(windows);

  const t = (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);

  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);

  useEffect(() => {
    engine.setLocale(locale);
    storeLocale(locale);
  }, [engine, locale]);

  useEffect(() => {
    const handleEvent = (event: EngineEvent) => {
      switch (event.type) {
        case "message":
          setMessages((items) =>
            [...items, { id: nextId("msg"), role: event.role, text: event.text, tone: event.tone }].slice(-MAX_MESSAGES),
          );
          return;
        case "orb":
          setOrbState(event.state);
          return;
        case "present":
          dispatch({
            type: "open",
            request: { id: nextId("win"), content: event.content, source: event.source },
            context: readWindowContext(),
          });
          return;
        case "window-command": {
          const hadWindows = windowsRef.current.open.length > 0;
          const now = Date.now();
          if (event.command === "close-last") {
            dispatch({ type: "closeLast", now });
            engine.say(translate(locale, hadWindows ? "close.done" : "close.none"));
          } else {
            dispatch({ type: "closeAll", now });
            engine.say(translate(locale, hadWindows ? "close.allDone" : "close.none"));
          }
          return;
        }
      }
    };

    const unsubscribeEvents = engine.subscribe(handleEvent);
    const unsubscribeTasks = engine.subscribeTasks(setTasks);
    const handleResize = () => dispatch({ type: "reflow", context: readWindowContext() });
    window.addEventListener("resize", handleResize);

    return () => {
      unsubscribeEvents();
      unsubscribeTasks();
      window.removeEventListener("resize", handleResize);
    };
  }, [engine, locale]);

  const submit = (text: string) => {
    void engine.submit(text);
  };

  const toggleLocale = () => setLocale((current) => (current === "fr" ? "en" : "fr"));

  return (
    <div className="stage">
      <TaskPanel tasks={tasks} t={t} onCancel={(id) => engine.cancelTask(id)} />

      <div className="topbar" data-hud>
        <HistoryMenu
          history={windows.history}
          t={t}
          onReopen={(id) => dispatch({ type: "reopen", id, context: readWindowContext() })}
        />
        <button type="button" className="chip" onClick={toggleLocale} aria-label={t("ui.language")}>
          {locale.toUpperCase()}
        </button>
      </div>

      <div className="orb-zone">
        <Orb state={orbState} />
        <span className="orb-label" role="status">
          {t(ORB_LABEL[orbState])}
        </span>
      </div>

      <div className="transcript" data-hud aria-live="polite">
        {messages.length === 0 ? (
          <p className="welcome">{t("ui.welcome")}</p>
        ) : (
          messages.slice(-VISIBLE_MESSAGES).map((message) => (
            <p key={message.id} className={`${message.role}${message.tone === "error" ? " error" : ""}`}>
              {message.role === "user" ? `› ${message.text}` : message.text}
            </p>
          ))
        )}
      </div>

      <CommandBar placeholder={t("ui.placeholder")} sendLabel={t("ui.send")} onSubmit={submit} />

      <div className="windows-layer">
        {windows.open.map((item, index) => (
          <FloatingWindow
            key={item.id}
            item={item}
            zIndex={10 + index}
            t={t}
            onMove={(id, rect) => dispatch({ type: "move", id, rect, context: readWindowContext() })}
            onFocus={(id) => dispatch({ type: "focus", id })}
            onClose={(id) => dispatch({ type: "close", id, now: Date.now() })}
          />
        ))}
      </div>
    </div>
  );
}
