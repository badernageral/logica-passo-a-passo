import type { PinState } from "@/lib/c-interpreter";
import { cn } from "@/lib/utils";

export function PinCard({ p }: { p: PinState }) {
  const isInput = p.direction !== "OUTPUT";
  const isAnalog = p.kind === "analog" || p.kind === "input-analog";
  const isDigital = p.kind === "digital" || p.kind === "input-digital";
  const isHigh = isDigital && p.value === 1;
  const isLow = isDigital && p.value === 0;

  // Cores: INPUT em verde, OUTPUT analógico em azul, OUTPUT digital HIGH/LOW em amarelo/rosa.
  const color = isInput
    ? "var(--chalk-green)"
    : isAnalog
      ? "var(--chalk-blue)"
      : isHigh
        ? "var(--chalk-yellow)"
        : "var(--chalk-pink)";

  const label = isInput
    ? p.direction === "INPUT_PULLUP"
      ? "INPUT_PULLUP"
      : isAnalog
        ? "ANALOG INPUT"
        : "DIGITAL INPUT"
    : isAnalog
      ? "PWM OUTPUT"
      : "DIGITAL OUTPUT";

  const display =
    p.value === null
      ? "—"
      : isAnalog
        ? String(p.value)
        : isHigh
          ? "HIGH (1)"
          : isLow
            ? "LOW (0)"
            : String(p.value);

  // Para analogWrite (PWM 0–255) ou analogRead (0–1023), mostrar barrinha de intensidade.
  const max = p.kind === "input-analog" ? 1023 : 255;
  const pct = isAnalog && p.value !== null ? Math.max(0, Math.min(max, p.value)) / max : 0;

  return (
    <div
      className={cn(
        "relative rounded-md border-2 border-dashed bg-card/30 p-3 transition-all",
        p.justCreated && "animate-chalk-write",
      )}
      style={{
        borderColor: color,
        boxShadow: `0 0 14px color-mix(in oklab, ${color} 30%, transparent)`,
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="chalk-text text-xs uppercase tracking-wider" style={{ color }}>
          {label}
        </span>
        <span className="chalk-text text-[10px] text-muted-foreground">pino</span>
      </div>
      <div className="chalk-text mt-1 text-2xl font-semibold text-foreground">
        Pino {p.pin >= 14 && p.pin <= 21 ? `A${p.pin - 14}` : p.pin}
      </div>

      <div className="mt-2 flex items-center gap-2">
        {/* LED visual */}
        <div
          className={cn(
            "h-6 w-6 rounded-full border-2 transition-all",
            p.justChanged && "animate-value-pop",
          )}
          style={{
            borderColor: color,
            background:
              p.value === null
                ? "transparent"
                : isAnalog
                  ? `color-mix(in oklab, ${color} ${20 + pct * 70}%, transparent)`
                  : isHigh
                    ? color
                    : "transparent",
            boxShadow:
              p.value !== null && (isHigh || (isAnalog && p.value > 0))
                ? `0 0 ${isAnalog ? 6 + pct * 16 : 16}px ${color}`
                : "none",
          }}
          aria-hidden
        />
        <div
          key={String(p.value) + (p.justChanged ? "-c" : "")}
          className={cn(
            "chalk-text font-mono text-xl chalk-glow",
            p.justChanged && "animate-value-pop",
          )}
          style={{ color, fontFamily: "var(--font-mono)" }}
        >
          {display}
        </div>
      </div>

      {isAnalog && p.value !== null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-card/40">
          <div
            className="h-full transition-all"
            style={{ width: `${pct * 100}%`, background: color }}
          />
        </div>
      )}
    </div>
  );
}
