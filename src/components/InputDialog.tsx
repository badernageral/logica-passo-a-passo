import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  prompt: string;
  type: string;
  pinRead?: { fn: "digitalRead" | "analogRead"; pin: number } | null;
  onSubmit: (value: string) => void;
}

export function InputDialog({ open, prompt, type, pinRead, onSubmit }: Props) {
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isDigitalRead = pinRead?.fn === "digitalRead";
  const isAnalogRead = pinRead?.fn === "analogRead";

  useEffect(() => { if (open) setVal(isDigitalRead ? "0" : isAnalogRead ? "512" : ""); }, [open, isDigitalRead, isAnalogRead]);

  // Mantém o foco no input enquanto o diálogo estiver aberto (apenas para input de texto).
  useEffect(() => {
    if (!open || isDigitalRead || isAnalogRead) return;
    const focus = () => {
      if (document.activeElement !== inputRef.current) {
        inputRef.current?.focus();
      }
    };
    focus();
    const interval = window.setInterval(focus, 150);
    const onFocusIn = (e: FocusEvent) => {
      if (e.target !== inputRef.current) focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open, isDigitalRead]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (val.length) onSubmit(val);
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="bg-card chalk-text"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="chalk-text text-2xl text-primary chalk-glow">📥 Entrada de dados</DialogTitle>
          <DialogDescription className="chalk-text text-base">{prompt}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {isDigitalRead ? (
            <div className="flex gap-4">
              <label className="chalk-text flex cursor-pointer items-center gap-2 rounded-md border-2 border-dashed px-4 py-3 transition-all"
                style={{
                  borderColor: val === "0" ? "var(--chalk-pink)" : "var(--border)",
                  background: val === "0" ? "color-mix(in oklab, var(--chalk-pink) 15%, transparent)" : undefined,
                  boxShadow: val === "0" ? "0 0 12px color-mix(in oklab, var(--chalk-pink) 30%, transparent)" : undefined,
                }}
              >
                <input
                  type="radio"
                  name="digitalValue"
                  value="0"
                  checked={val === "0"}
                  onChange={() => setVal("0")}
                  className="accent-[var(--chalk-pink)]"
                />
                <span className="font-mono text-lg" style={{ fontFamily: "var(--font-mono)", color: "var(--chalk-pink)" }}>
                  LOW (0)
                </span>
              </label>
              <label className="chalk-text flex cursor-pointer items-center gap-2 rounded-md border-2 border-dashed px-4 py-3 transition-all"
                style={{
                  borderColor: val === "1" ? "var(--chalk-yellow)" : "var(--border)",
                  background: val === "1" ? "color-mix(in oklab, var(--chalk-yellow) 15%, transparent)" : undefined,
                  boxShadow: val === "1" ? "0 0 12px color-mix(in oklab, var(--chalk-yellow) 30%, transparent)" : undefined,
                }}
              >
                <input
                  type="radio"
                  name="digitalValue"
                  value="1"
                  checked={val === "1"}
                  onChange={() => setVal("1")}
                  className="accent-[var(--chalk-yellow)]"
                />
                <span className="font-mono text-lg" style={{ fontFamily: "var(--font-mono)", color: "var(--chalk-yellow)" }}>
                  HIGH (1)
                </span>
              </label>
            </div>
          ) : isAnalogRead ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Button type="button" variant="outline" size="sm" onClick={() => setVal("0")} className="chalk-text font-mono text-xs">MIN</Button>
                <span
                  className="chalk-text chalk-glow font-mono text-3xl font-bold"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--chalk-blue)" }}
                >
                  {val}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => setVal("1023")} className="chalk-text font-mono text-xs">MAX</Button>
              </div>
              <input
                type="range"
                min={0}
                max={1023}
                value={Number(val)}
                onChange={(e) => setVal(e.target.value)}
                className="w-full accent-[var(--chalk-blue)]"
              />
            </div>
          ) : (
            <Input
              ref={inputRef}
              autoFocus
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onBlur={() => {
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              placeholder={`valor (${type})`}
              className="font-mono"
              style={{ fontFamily: "var(--font-mono)" }}
            />
          )}
          <DialogFooter>
            <Button type="submit" disabled={!val.length}>Enviar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
