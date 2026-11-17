import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@plexui/ui/components/Input";
import { suggest } from "../lib/fuzzy";
import { FIELD_LABEL, type Field } from "../lib/types";

export type FieldStatus = "open" | "correct" | "missed";

type Props = {
  fields: Field[];
  target: Field;
  onTarget: (f: Field) => void;
  status: Record<Field, FieldStatus>;
  wrong: Record<Field, number>;
  maxWrong: number;
  points: (f: Field) => number;
  candidates: Record<Field, { value: string; norm: string }[]>;
  check: (f: Field, value: string) => boolean;
  onCorrect: (f: Field, value: string) => void;
  onWrong: (f: Field) => void;
  disabled: boolean;
};

const SHORT: Record<Field, string> = { track: "Track", artist: "Artist", label: "Label", album: "Album" };

export function GuessBox(p: Props) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [shake, setShake] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const suggestions = useMemo(
    () => (p.disabled ? [] : suggest(value, p.candidates[p.target], 6)),
    [value, p.candidates, p.target, p.disabled],
  );
  useEffect(() => setActive(0), [value, p.target]);
  // Switching target clears the box and keeps the keyboard up.
  useEffect(() => {
    setValue("");
    if (!p.disabled) inputRef.current?.focus();
  }, [p.target, p.disabled]);

  const submit = (v: string) => {
    if (!v.trim() || p.disabled) return;
    setOpen(false);
    if (p.check(p.target, v)) p.onCorrect(p.target, v);
    else {
      setShake((n) => n + 1);
      p.onWrong(p.target);
    }
    setValue("");
  };

  const onChange = (v: string) => {
    setValue(v);
    setOpen(true);
    // Real-time recognition: no need to press Enter once it matches.
    if (v.trim().length >= 2 && p.check(p.target, v)) {
      setOpen(false);
      setValue("");
      p.onCorrect(p.target, v);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="What are you guessing?">
        {p.fields.map((f) => {
          const st = p.status[f];
          const selected = f === p.target && st === "open" && !p.disabled;
          return (
            <button
              key={f}
              role="radio"
              aria-checked={selected}
              disabled={st !== "open" || p.disabled}
              onClick={() => p.onTarget(f)}
              className={[
                "relative flex flex-col items-center rounded-xl border py-1.5 text-sm font-medium transition-all",
                selected
                  ? "border-transparent bg-primary-solid text-primary-solid scale-[1.03]"
                  : st === "correct"
                    ? "border-success-outline bg-success-soft-alpha text-success"
                    : st === "missed"
                      ? "border-danger-outline bg-danger-soft-alpha text-danger line-through opacity-70"
                      : "border-subtle bg-surface-secondary text-secondary hover:text-default",
              ].join(" ")}
            >
              <span>{SHORT[f]}</span>
              <span className="text-[11px] tabular-nums opacity-70">
                {st === "correct" ? "✓" : `${p.points(f)}`}
                {st === "open" && p.wrong[f] > 0 && (
                  <span className="ml-1 tracking-tighter">{"·".repeat(p.maxWrong - p.wrong[f])}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        <div key={shake} className={shake ? "shake" : undefined}>
          <Input
            ref={inputRef}
            size="xl"
            pill
            value={value}
            disabled={p.disabled}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder={p.disabled ? "" : `${FIELD_LABEL[p.target]}…`}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
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
              } else if (e.key === "Tab" && !e.shiftKey) {
                // Tab cycles the target field.
                const openFields = p.fields.filter((f) => p.status[f] === "open");
                if (openFields.length > 1) {
                  e.preventDefault();
                  p.onTarget(openFields[(openFields.indexOf(p.target) + 1) % openFields.length]);
                }
              } else if (e.key === "Escape" && open && suggestions.length) {
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
        </div>

        {/* Opens upward on phones (above the keyboard), downward on desktop. */}
        {open && suggestions.length > 0 && (
          <ul
            role="listbox"
            className="absolute inset-x-2 bottom-full z-20 mb-2 overflow-hidden sm:bottom-auto sm:top-full sm:mb-0 sm:mt-2 rounded-2xl border border-default bg-surface-elevated p-1 shadow-2xl"
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
                className={`cursor-pointer truncate rounded-xl px-3 py-2 ${i === active ? "bg-secondary-soft text-default" : "text-secondary"}`}
              >
                {s.value}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
