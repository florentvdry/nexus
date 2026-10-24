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
  escapeTarget,
  type WindowRequest,
  type WindowsState,
} from "../core/presentation/windows";
import { readVoiceSettings, writeVoiceSettings, type VoiceSettings } from "../core/voice/settings";
import type { Task } from "../core/tasks/taskManager";
import { translate, type Locale, type MessageKey } from "../i18n/messages";
import { CommandBar } from "./CommandBar";
import { FloatingWindow } from "./FloatingWindow";
import { HistoryMenu } from "./HistoryMenu";
import { Orb } from "./Orb";
import { TaskPanel } from "./TaskPanel";
import { JournalSection } from "./JournalSection";
import { MemorySection } from "./MemorySection";
import { AccessibilitySection } from "./AccessibilitySection";
import { StartupSection } from "./StartupSection";
import { AgendaSection } from "./AgendaSection";
import { readAgendaPath } from "./agendaSettings";
import { NimSection } from "./NimSection";
import { readOnlineModel } from "./nimSettings";
import { applyLargeText, readLargeText } from "./textScale";
import { FirstRunSetup } from "./FirstRunSetup";
import { HardwareSection } from "./HardwareSection";
import { ModelSection } from "./ModelSection";
import { hasFirstConversation, hasSeenModelSetup, markFirstConversation, markModelSetupSeen } from "./setupMemory";
import { PermissionsSection } from "./PermissionsSection";
import { VoicePanel } from "./VoicePanel";
import { SchedulePanel } from "./SchedulePanel";
import { readStoredLocale, storeLocale } from "./locale";
import { readWindowContext } from "./scene";
import { createNativeBridge } from "../core/native/bridge";
import { useVoice } from "./useVoice";

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
  const [engine] = useState(() => injectedEngine ?? createEngine({ locale: readStoredLocale(), agendaPath: readAgendaPath, onlineModel: readOnlineModel }));
  const [locale, setLocale] = useState<Locale>(() => engine.locale);
  const [messages, setMessages] = useState<Message[]>([]);
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [tasks, setTasks] = useState<Task[]>(() => engine.tasksSnapshot());
  const [windows, dispatch] = useReducer(windowsReducer, EMPTY_WINDOWS);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(readVoiceSettings);
  const [panelOpen, setPanelOpen] = useState(false);
  const [planningOpen, setPlanningOpen] = useState(false);
  const windowsRef = useRef(windows);
  const [answerBridge] = useState(() => createNativeBridge());
  // Premier lancement : le parcours s'ouvre une seule fois, puis reste accessible depuis les réglages.
  const [setupOpen, setSetupOpen] = useState(() => !hasSeenModelSetup());
  // Le parcours peut changer le modèle choisi : la section Modèle des réglages se relit à la fermeture.
  const [modelRevision, setModelRevision] = useState(0);
  const closeSetup = () => {
    markModelSetupSeen();
    setSetupOpen(false);
    setModelRevision((revision) => revision + 1);
  };
  // Une fois le setup fermé (modèle prêt), NEXUS fait connaissance avec l'utilisateur, une seule fois.
  useEffect(() => {
    if (setupOpen || hasFirstConversation()) return;
    markFirstConversation();
    engine.startFirstConversation();
  }, [engine, setupOpen]);
  useEffect(() => {
    void engine.refreshPacks();
  }, [engine]);
  // Échap ferme la dernière fenêtre ordinaire, jamais une confirmation (qui attend une réponse explicite).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !escapeTarget(windowsRef.current)) return;
      dispatch({ type: "closeLast", now: Date.now() });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // La taille du texte choisie est rétablie à chaque lancement.
  useEffect(() => {
    applyLargeText(readLargeText());
  }, []);
  // Les tâches programmées tournent tant que NEXUS est ouvert.
  useEffect(() => {
    engine.startScheduler();
    return () => engine.stopScheduler();
  }, [engine]);
  const settingsRef = useRef(voiceSettings);

  const t = (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);
  const { controller: voice, status: voiceStatus } = useVoice(engine, () => settingsRef.current);

  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);

  useEffect(() => {
    settingsRef.current = voiceSettings;
    writeVoiceSettings(voiceSettings);
    if (!voiceSettings.enabled) void voice.stop();
  }, [voice, voiceSettings]);

  useEffect(() => {
    engine.setLocale(locale);
    storeLocale(locale);
  }, [engine, locale]);

  // Le panneau des tâches grandit avec les tâches : les fenêtres qui le recouvrent sont replacées.
  useEffect(() => {
    dispatch({ type: "reflow", context: readWindowContext() });
  }, [tasks]);

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

  const toggleLocale = () => setLocale((current) => (current === "fr" ? "en" : "fr"));
  const updateSettings = (patch: Partial<VoiceSettings>) => setVoiceSettings((current) => ({ ...current, ...patch }));

  // L'orbe suit d'abord les réponses du moteur, puis l'état du micro quand le moteur est au repos.
  const displayedOrb: OrbState =
    orbState === "idle" && voiceStatus !== "off" ? (voiceStatus === "recognizing" ? "recognizing" : "listening") : orbState;

  return (
    <div className="stage">
      <TaskPanel tasks={tasks} t={t} onCancel={(id) => engine.cancelTask(id)} />

      <div className="topbar" data-hud>
        <HistoryMenu
          history={windows.history}
          t={t}
          onReopen={(id) => dispatch({ type: "reopen", id, context: readWindowContext() })}
        />
        <button type="button" className="chip" onClick={() => setPlanningOpen((open) => !open)} aria-expanded={planningOpen}>
          {t("schedule.open")}
        </button>
        {voiceSettings.enabled && (
          <button type="button" className="chip" onClick={() => setPanelOpen((open) => !open)} aria-expanded={panelOpen}>
            {t("voice.settings")}
          </button>
        )}
        <button type="button" className="chip" onClick={toggleLocale} aria-label={t("ui.language")}>
          {locale.toUpperCase()}
        </button>
      </div>

      {planningOpen && <SchedulePanel source={engine} locale={locale} t={t} onClose={() => setPlanningOpen(false)} />}

      {panelOpen && (
        <VoicePanel settings={voiceSettings} onChange={updateSettings} t={t} onClose={() => setPanelOpen(false)}>
          <HardwareSection bridge={answerBridge} t={t} />
          <ModelSection bridge={answerBridge} t={t} revision={modelRevision} />
          <PermissionsSection bridge={answerBridge} locale={locale} t={t} />
          <button type="button" className="chip" onClick={() => setSetupOpen(true)}>
            {t("setup.open")}
          </button>
          <MemorySection bridge={answerBridge} locale={locale} t={t} />
          <AccessibilitySection t={t} />
          <StartupSection bridge={answerBridge} t={t} />
          <AgendaSection t={t} />
          <NimSection t={t} />
          <JournalSection bridge={answerBridge} locale={locale} t={t} />
        </VoicePanel>
      )}

      <div className="orb-zone">
        <Orb state={displayedOrb} />
        <span className="orb-label" role="status">
          {t(ORB_LABEL[displayedOrb])}
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

      <CommandBar
        placeholder={t("ui.placeholder")}
        sendLabel={t("ui.send")}
        onSubmit={(text) => voice.submitText(text)}
        voice={
          voiceSettings.enabled
            ? {
                status: voiceStatus,
                onToggle: () => void voice.toggle(),
                startLabel: t("voice.toggle"),
                stopLabel: t("voice.stop"),
                speaking: voiceSettings.replyMode !== "off",
                // Activer la lecture lit toutes les réponses, tapées comprises : « voice » ne lit que les commandes vocales.
                onToggleSpeaking: () => updateSettings({ replyMode: voiceSettings.replyMode === "off" ? "always" : "off" }),
                speakingLabel: t("voice.spokenReplies"),
              }
            : undefined
        }
      />

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
            onAnswer={(requestId, approved, remember) => answerBridge.answerConfirmation(requestId, approved, remember)}
          />
        ))}
      </div>

      {setupOpen && <FirstRunSetup bridge={answerBridge} t={t} onClose={closeSetup} />}
    </div>
  );
}
