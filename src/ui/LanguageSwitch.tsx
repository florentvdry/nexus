import { SUPPORTED_LOCALES, type Locale } from "../i18n/messages";

interface LanguageSwitchProps {
  locale: Locale;
  label: string;
  onChange: (locale: Locale) => void;
}

/** Choix de la langue de l'interface : FR et EN côte à côte, l'option active est marquée. */
export function LanguageSwitch({ locale, label, onChange }: LanguageSwitchProps) {
  return (
    <div role="group" aria-label={label} className="segmented">
      {SUPPORTED_LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === locale}
          className={option === locale ? "active" : undefined}
          onClick={() => onChange(option)}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
