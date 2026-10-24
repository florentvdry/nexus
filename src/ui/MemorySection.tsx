import { useEffect, useState } from "react";

import type { Memory } from "../core/memory/types";
import type { NativeBridge } from "../core/native/bridge";
import type { Locale, MessageKey } from "../i18n/messages";

interface MemorySectionProps {
  bridge: NativeBridge;
  locale: Locale;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

/** Souvenirs de l'utilisateur : consultables, supprimables un à un ou tous ensemble, sans jamais quitter ce poste. */
export function MemorySection({ bridge, locale, t }: MemorySectionProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let current = true;
    bridge
      .memoryList()
      .then((items) => {
        if (current) setMemories(items);
      })
      .catch(() => {
        if (current) setUnavailable(true);
      });
    return () => {
      current = false;
    };
  }, [bridge]);

  const remove = async (id: number) => {
    try {
      await bridge.memoryRemove(id);
      setMemories((items) => items.filter((item) => item.id !== id));
    } catch {
      setUnavailable(true);
    }
  };

  const clear = async () => {
    try {
      await bridge.memoryClear();
      setMemories([]);
    } catch {
      setUnavailable(true);
    }
  };

  return (
    <section className="memory" aria-label={t("memory.title")}>
      <h3>{t("memory.title")}</h3>
      {unavailable ? (
        <p className="field-hint">{t("memory.unavailable")}</p>
      ) : (
        <>
          <p className="field-hint">{t("memory.hint")}</p>
          {memories.length === 0 && <p className="field-hint">{t("memory.empty")}</p>}
          {memories.length > 0 && (
            <>
              <ul className="journal-entries">
                {memories.map((memory) => (
                  <li key={memory.id}>
                    <time dateTime={new Date(memory.createdAt).toISOString()}>{new Date(memory.createdAt).toLocaleDateString(locale)}</time>
                    <span>{memory.text}</span>
                    <button type="button" className="chip" onClick={() => void remove(memory.id)}>
                      {t("memory.remove")}
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="chip" onClick={() => void clear()}>
                {t("memory.clear")}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
