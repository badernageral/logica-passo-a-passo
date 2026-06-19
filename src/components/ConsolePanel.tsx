import { useEffect, useRef } from "react";
import type { OutputLine } from "@/lib/c-interpreter";

export function ConsolePanel({ lines }: { lines: OutputLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  return (
    <div
      ref={ref}
      className="console-output h-full overflow-auto rounded-md border border-border bg-black/40 p-3 font-mono text-sm"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {lines.length === 0 && (
        <div className="chalk-text text-muted-foreground">// A saída do monitor serial aparecerá aqui...</div>
      )}
      {lines.map((l) => (
        <div key={l.id} className="animate-print-line whitespace-pre-wrap text-[var(--chalk-green)] chalk-glow">
          {l.text || "\u00a0"}
        </div>
      ))}
    </div>
  );
}