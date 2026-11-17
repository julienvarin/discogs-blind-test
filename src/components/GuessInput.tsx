import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@plexui/ui/components/Input";
import { Badge } from "@plexui/ui/components/Badge";
import { suggest } from "../lib/fuzzy";

export type FieldStatus = "open" | "correct" | "missed";

type Props = {
  label: string;
  points: number;
  status: FieldStatus;
  revealed: boolean;
  answer: string;
  wrong: number;
  maxWrong: number;
  candidates: { value: string; norm: string }[];
  /** true when the value is right (called live while typing and on pick) */
  check: (value: string) => boolean;
  onCorrect: (value: string) => void;
  onWrong: () => void;
  autoFocus?: boolean;
  inputRef?: (el: HTMLInputElement | null) => void;
};

export function GuessInput(p: Props) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [shake, setShake] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const locked = p.status !== "open" || p.revealed;

  const suggestions = useMemo(
    () => (locked ? [] : suggest(value, p.candidates, 7)),
    [value, p.candidates, locked],
  );
  useEffect(() => setActive(0), [value]);

  const submit = (v: string) => {
    if (!v.trim() || locked) return;
    setOpen(false);
    if (p.check(v)) {
      setValue(v);
      p.onCorrect(v);
    } else {
      setShake((n) => n + 1);
      setValue("");
      p.onWrong();
    }
  };

  const onChange = (v: string) => {
    setValue(v);
    setOpen(true);
    // Real-time recognition: lock the field as soon as the typed text matches.
    if (v.trim().length >= 2 && p.check(v)) {
      setOpen(false);
      p.onCorrect(v);
    }
  };

  const tone =
    p.status === "correct"
      ? "border-success-outline bg-success-soft-alpha"
      : p.status === "missed" || (p.revealed && p.status === "open")
        ? "border-danger-outline bg-danger-soft-alpha"
        : "border-subtle";

  return (
    <div ref={wrapRef} className={`relative rounded-xl border p-3 transition-colors ${tone}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-secondary">{p.label}</span>
        <div className="flex items-center gap-1.5">
          {p.status === "open" && !p.revealed && p.wrong > 0 && (
            <span className="text-xs text-tertiary" aria-label="wrong guesses">
              {"●".repeat(p.wrong)}
              {"○".repeat(Math.max(0, p.maxWrong - p.wrong))}
            </span>
          )}
          <Badge color={p.status === "correct" ? "success" : "secondary"} variant="soft" pill>
            {p.points} pts
          </Badge>
        </div>
      </div>

      {locked ? (
        <div className="flex min-h-9 items-center text-base font-semibold">
          {p.status === "correct" ? (
            <span className="text-success">✓ {p.answer}</span>
          ) : p.revealed ? (
            <span className="text-default">{p.answer}</span>
          ) : (
            <span className="text-danger">✗ locked</span>
          )}
        </div>
      ) : (
        <div key={shake} className={shake ? "shake" : undefined}>
          <Input
            ref={p.inputRef}
            value={value}
            autoFocus={p.autoFocus}
            autoComplete="off"
            spellCheck={false}
            placeholder={`Type the ${p.label.toLowerCase()}…`}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onClear={value ? () => setValue("") : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, suggestions.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                submit(open && suggestions[active] ? suggestions[active].value : value);
              } else if (e.key === "Escape" && open && suggestions.length) {
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
        </div>
      )}

      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute inset-x-3 top-full z-20 mt-1 max-h-72 overflow-auto rounded-lg border border-default bg-surface-elevated p-1 shadow-xl"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.value}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                submit(s.value);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer truncate rounded-md px-2.5 py-1.5 text-sm ${i === active ? "bg-secondary-soft text-default" : "text-secondary"}`}
            >
              {s.value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
