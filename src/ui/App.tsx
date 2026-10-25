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
import type { VoiceControl } from "./CommandBar";
import { ConversationView, type ChatMessage } from "./ConversationView";
import { FloatingWindow } from "./FloatingWindow";
import { FirstRunSetup } from "./FirstRunSetup";
import { HomeView } from "./HomeView";
import { Rail, type View } from "./Rail";
import { SchedulePanel } from "./SchedulePanel";
import { SettingsView } from "./SettingsView";
import { readAgendaPath } from "./agendaSettings";
import { migrateLegacyNimKey, readOnlineModel } from "./nimSettings";
import { applyLargeText, readLargeText } from "./textScale";
import { hasFirstConversation, hasSeenModelSetup, markFirstConversation, markModelSetupSeen } from "./setupMemory";
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

const MAX_MESSAGES = 12;

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
  const [view, setView] = useState<View>("home");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [tasks, setTasks] = useState<Task[]>(() => engine.tasksSnapshot());
  const [windows, dispatch] = useReducer(windowsReducer, EMPTY_WINDOWS);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(readVoiceSettings);
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
  // Une clé NIM gardée dans le navigateur par une version précédente part dans le stockage natif chiffré.
  useEffect(() => {
    void migrateLegacyNimKey(answerBridge);
  }, [answerBridge]);
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
          // Depuis l'accueil, un échange (tapé, dit ou une réponse) ouvre la conversation ; les réglages restent ouverts.
          setView((current) => (current === "home" ? "conversation" : current));
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

  const updateSettings = (patch: Partial<VoiceSettings>) => setVoiceSettings((current) => ({ ...current, ...patch }));

  // L'orbe suit d'abord les réponses du moteur, puis l'état du micro quand le moteur est au repos.
  const displayedOrb: OrbState =
    orbState === "idle" && voiceStatus !== "off" ? (voiceStatus === "recognizing" ? "recognizing" : "listening") : orbState;

  const submit = (text: string) => {
    setView("conversation");
    void voice.submitText(text);
  };

  // Les boutons vocaux n'apparaissent que si les fonctions vocales sont activées.
  const commandVoice: VoiceControl | undefined = voiceSettings.enabled
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
    : undefined;

  const statusLabel = t(ORB_LABEL[displayedOrb]);

  return (
    <div className="app">
      <Rail
        view={view}
        planningOpen={planningOpen}
        t={t}
        onNavigate={setView}
        onTogglePlanning={() => setPlanningOpen((open) => !open)}
      />

      <main className="workspace">
        {view === "home" && (
          <HomeView
            t={t}
            locale={locale}
            onLocale={setLocale}
            orbState={displayedOrb}
            statusLabel={statusLabel}
            placeholder={t("ui.placeholder")}
            sendLabel={t("ui.send")}
            voice={commandVoice}
            onSubmit={submit}
            onSuggest={submit}
          />
        )}

        {view === "conversation" && (
          <ConversationView
            t={t}
            messages={messages}
            orbState={displayedOrb}
            statusLabel={statusLabel}
            tasks={tasks}
            history={windows.history}
            voice={commandVoice}
            placeholder={t("conversation.placeholder")}
            sendLabel={t("ui.send")}
            onSubmit={submit}
            onCancelTask={(id) => engine.cancelTask(id)}
            onReopen={(id) => dispatch({ type: "reopen", id, context: readWindowContext() })}
            onNewConversation={() => {
              setMessages([]);
              setView("home");
            }}
          />
        )}

        {view === "settings" && (
          <SettingsView
            t={t}
            locale={locale}
            onLocale={setLocale}
            bridge={answerBridge}
            voiceSettings={voiceSettings}
            onVoiceChange={updateSettings}
            modelRevision={modelRevision}
            onOpenSetup={() => setSetupOpen(true)}
          />
        )}
      </main>

      {planningOpen && <SchedulePanel source={engine} locale={locale} t={t} onClose={() => setPlanningOpen(false)} />}

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

      {setupOpen && <FirstRunSetup bridge={answerBridge} t={t} onClose={closeSetup} />}
    </div>
  );
}
