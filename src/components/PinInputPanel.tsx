import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";

export type PinInputMode = "digital" | "analog";
export interface PinInputConfig {
  mode: PinInputMode;
  value: number;
}

interface Props {
  pinInputs: Record<number, PinInputConfig>;
  onChange: (pinInputs: Record<number, PinInputConfig>) => void;
}

function pinLabel(pin: number) {
  return pin >= 14 && pin <= 21 ? `A${pin - 14}` : String(pin);
}

function parsePin(input: string): number | null {
  const s = input.trim().toUpperCase();
  if (!s) return null;
  if (s.startsWith("A")) {
    const n = parseInt(s.slice(1), 10);
    if (!Number.isFinite(n) || n < 0 || n > 7) return null;
    return 14 + n;
  }
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 0 || n > 21) return null;
  return n;
}

export function PinInputPanel({ pinInputs, onChange }: Props) {
  const [open, setOpen] = useState(true);
  const [newPin, setNewPin] = useState("");
  const [newMode, setNewMode] = useState<PinInputMode>("digital");

  const entries = Object.entries(pinInputs)
    .map(([k, v]) => [parseInt(k, 10), v] as const)
    .sort((a, b) => a[0] - b[0]);

  const addPin = () => {
    const pin = parsePin(newPin);
    if (pin == null) return;
    onChange({
      ...pinInputs,
      [pin]: pinInputs[pin] ?? { mode: newMode, value: newMode === "digital" ? 0 : 512 },
    });
    setNewPin("");
  };

  const removePin = (pin: number) => {
    const next = { ...pinInputs };
    delete next[pin];
    onChange(next);
  };

  const updatePin = (pin: number, patch: Partial<PinInputConfig>) => {
    onChange({ ...pinInputs, [pin]: { ...pinInputs[pin], ...patch } });
  };

  return (
    <div className="rounded-md border border-border bg-card/40 px-2 py-1 text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="chalk-text flex w-full items-center gap-1 text-left text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="text-xs uppercase tracking-widest">
          📥 Entradas dos pinos ({entries.length})
        </span>
        <span className="ml-2 text-[10px] text-muted-foreground/70 normal-case tracking-normal">
          valores usados automaticamente em digitalRead / analogRead
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {entries.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {entries.map(([pin, cfg]) => (
                <div
                  key={pin}
                  className="flex items-center gap-2 rounded-md border border-dashed bg-card/50 px-2 py-1"
                  style={{
                    borderColor:
                      cfg.mode === "digital" ? "var(--chalk-yellow)" : "var(--chalk-blue)",
                  }}
                >
                  <span
                    className="chalk-text font-mono text-xs"
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: cfg.mode === "digital" ? "var(--chalk-yellow)" : "var(--chalk-blue)",
                    }}
                  >
                    Pino {pinLabel(pin)}
                  </span>
                  {cfg.mode === "digital" ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => updatePin(pin, { value: 0 })}
                        className="chalk-text rounded px-2 py-0.5 font-mono text-xs transition-all"
                        style={{
                          background:
                            cfg.value === 0
                              ? "color-mix(in oklab, var(--chalk-pink) 25%, transparent)"
                              : "transparent",
                          color: cfg.value === 0 ? "var(--chalk-pink)" : "var(--muted-foreground)",
                          border: "1px solid var(--chalk-pink)",
                        }}
                      >
                        LOW
                      </button>
                      <button
                        type="button"
                        onClick={() => updatePin(pin, { value: 1 })}
                        className="chalk-text rounded px-2 py-0.5 font-mono text-xs transition-all"
                        style={{
                          background:
                            cfg.value === 1
                              ? "color-mix(in oklab, var(--chalk-yellow) 25%, transparent)"
                              : "transparent",
                          color:
                            cfg.value === 1 ? "var(--chalk-yellow)" : "var(--muted-foreground)",
                          border: "1px solid var(--chalk-yellow)",
                        }}
                      >
                        HIGH
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={1023}
                        value={cfg.value}
                        onChange={(e) => updatePin(pin, { value: parseInt(e.target.value, 10) })}
                        className="w-24 accent-[var(--chalk-blue)]"
                      />
                      <input
                        type="number"
                        min={0}
                        max={1023}
                        value={cfg.value}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          if (Number.isFinite(n))
                            updatePin(pin, { value: Math.max(0, Math.min(1023, n)) });
                        }}
                        className="w-16 rounded border border-border bg-card/40 px-1 py-0.5 font-mono text-xs text-foreground outline-none focus:border-primary"
                        style={{ fontFamily: "var(--font-mono)" }}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removePin(pin)}
                    className="text-muted-foreground hover:text-destructive"
                    title="Remover"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <Input
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addPin();
                }
              }}
              placeholder="Pino (ex: 3 ou A0)"
              className="h-7 w-32 font-mono text-xs"
              style={{ fontFamily: "var(--font-mono)" }}
            />
            <select
              value={newMode}
              onChange={(e) => setNewMode(e.target.value as PinInputMode)}
              className="h-7 rounded-md border border-border bg-card/40 px-2 text-xs text-foreground outline-none focus:border-primary"
            >
              <option value="digital">digital (0/1)</option>
              <option value="analog">analógico (0–1023)</option>
            </select>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={addPin}
              className="h-7 px-2 text-xs"
            >
              <Plus className="mr-1 h-3 w-3" /> Adicionar
            </Button>
            {entries.length === 0 && (
              <span className="chalk-text text-xs text-muted-foreground/80">
                Nenhum pino configurado — leituras pedirão valor por diálogo.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
