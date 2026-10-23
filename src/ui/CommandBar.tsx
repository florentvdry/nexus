import { useState, type FormEvent } from "react";

interface CommandBarProps {
  placeholder: string;
  sendLabel: string;
  onSubmit: (text: string) => void;
}

export function CommandBar({ placeholder, sendLabel, onSubmit }: CommandBarProps) {
  const [value, setValue] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue("");
  };

  return (
    <form className="command" data-hud onSubmit={submit}>
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />
      <button type="submit" className="send">
        {sendLabel}
      </button>
    </form>
  );
}
