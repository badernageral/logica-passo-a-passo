import { useEffect, useState } from "react";
import type { Variable } from "@/lib/c-interpreter";
import { cn } from "@/lib/utils";

const TYPE_COLORS: Record<string, string> = {
  int: "var(--chalk-yellow)",
  float: "var(--chalk-green)",
  double: "var(--chalk-blue)",
  char: "var(--chalk-pink)",
};

function formatScalar(type: string, value: number | string, name?: string): string {
  if (type === "char") {
    if (value === "\n") return "'\\n'";
    if (value === "\0") return "'\\0'";
    return `'${value}'`;
  }
  if (type === "float" || type === "double") return Number(value).toFixed(2);

  const numericValue = typeof value === "number" ? value : Number(value);
  const looksLikePinVariable = name ? /porta|pino|pin/i.test(name) : false;
  if (
    type === "int" &&
    looksLikePinVariable &&
    Number.isInteger(numericValue) &&
    numericValue >= 14 &&
    numericValue <= 21
  ) {
    return `A${numericValue - 14}`;
  }

  return String(value);
}

/** Espaço rígido: mantém a altura da linha quando a variável ainda não tem valor. */
const EMPTY = " ";

/** Texto C guardado num vetor de char: as letras até o '\0' (null se não houver '\0'). */
function cString(cells: (number | string)[], uninit?: boolean[]): string | null {
  const end = cells.findIndex((c, i) => c === "\0" && !uninit?.[i]);
  return end < 0 ? null : cells.slice(0, end).join("");
}

/**
 * Fase da animação de conta (`a + b` → `2 + 3` → `2 + 3 = 5`): 0, 1 e 2 são
 * as etapas; 3 é o fim, quando o resultado entra na variável. Sem conta (ou com
 * `ms` 0, auto-execução rápida demais para animar) já começa no fim.
 */
function useCalcPhase(calcId: number | undefined, ms: number): number {
  const [done, setDone] = useState<{ id: number; phase: number } | null>(null);
  useEffect(() => {
    if (calcId === undefined || ms <= 0) return;
    const timers = [1, 2, 3].map((phase) =>
      setTimeout(() => setDone({ id: calcId, phase }), (ms * phase) / 3),
    );
    return () => timers.forEach(clearTimeout);
  }, [calcId, ms]);
  if (calcId === undefined || ms <= 0) return 3;
  return done?.id === calcId ? done.phase : 0;
}

export function VariableCard({ v, calcMs = 0 }: { v: Variable; calcMs?: number }) {
  const color = TYPE_COLORS[v.type] || "var(--chalk-white)";
  const isArray = !!v.dims && v.dims.length > 0;
  const is2D = isArray && v.dims!.length === 2;
  const calc = v.calc;
  const phase = useCalcPhase(calc?.id, calcMs);
  /** Durante a conta a variável (ou a célula) ainda mostra o que guardava antes. */
  const calculating = !!calc && phase < 3;
  const cellPending = (i: number, j?: number) =>
    calculating && calc!.index?.[0] === i && (j === undefined || calc!.index?.[1] === j);
  const display = isArray
    ? ""
    : calculating
      ? calc!.prev.empty
        ? EMPTY
        : formatScalar(v.type, calc!.prev.value, v.name)
      : v.uninit
        ? EMPTY
        : formatScalar(v.type, v.value as number | string, v.name);
  const resultText = (() => {
    if (!calc) return "";
    if (!calc.index) return formatScalar(v.type, v.value as number | string, v.name);
    const [i, j] = calc.index;
    const cell = is2D
      ? (v.value as (number | string)[][])[i][j]
      : (v.value as (number | string)[])[i];
    return formatScalar(v.type, cell);
  })();

  return (
    <div
      className={cn(
        "relative max-w-full rounded-md border-2 border-dashed bg-card/30 p-3 transition-all",
        !isArray && "min-w-[180px]",
        v.justCreated && "animate-chalk-write",
      )}
      style={{
        borderColor: color,
        boxShadow: `0 0 14px color-mix(in oklab, ${color} 30%, transparent)`,
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="chalk-text text-xs uppercase tracking-wider" style={{ color }}>
          {v.type}
          {isArray ? `[${v.dims!.join("][")}]` : ""}
        </span>
        {v.scope !== "main" && v.scope !== "global" && (
          <span className="chalk-text text-[10px] text-muted-foreground">
            escopo: {v.scope.split("#")[0]}
          </span>
        )}
      </div>
      <div className="chalk-text mt-1 text-2xl font-semibold text-foreground">{v.name}</div>
      {v.alias && (
        <div className="chalk-text text-xs text-muted-foreground">
          → é o próprio vetor '{v.alias.name}
          {v.alias.row !== undefined ? `[${v.alias.row}]` : ""}' de {v.alias.scope.split("#")[0]}{" "}
          (não é cópia)
        </div>
      )}
      {calc && (
        <div
          key={phase}
          className={cn(
            "chalk-text mt-1 whitespace-nowrap font-mono text-base",
            phase < 3 && "animate-chalk-write",
            phase === 3 && "opacity-60",
          )}
          style={{ color, fontFamily: "var(--font-mono)" }}
          aria-live="polite"
        >
          {calc.index && (
            <span className="opacity-60">
              {v.name}[{calc.index.join("][")}] ={" "}
            </span>
          )}
          {phase === 0 ? calc.expr : calc.values}
          {phase >= 2 && (
            <span className="text-foreground">
              {" "}
              = <span style={{ color }}>{resultText}</span>
            </span>
          )}
        </div>
      )}
      {!isArray && (
        <div
          key={String(v.value) + (v.justChanged ? "-c" : "") + (calculating ? "-calc" : "")}
          className={cn(
            "chalk-text mt-1 font-mono text-3xl chalk-glow",
            v.justChanged && "animate-value-pop",
          )}
          style={{ color, fontFamily: "var(--font-mono)" }}
        >
          {display}
        </div>
      )}
      {isArray &&
        !is2D &&
        v.type === "char" &&
        (() => {
          const text = cString(
            v.value as (number | string)[],
            v.uninitCells as boolean[] | undefined,
          );
          return text === null ? null : (
            <div
              className="chalk-text mt-1 font-mono text-xl chalk-glow"
              style={{ color, fontFamily: "var(--font-mono)" }}
            >
              "{text}"
            </div>
          );
        })()}
      {isArray && !is2D && (
        <div className="mt-2 flex flex-wrap gap-1">
          {(v.value as (number | string)[]).map((cell, i) => {
            const pending = cellPending(i);
            const highlighted = v.lastIndex && v.lastIndex[0] === i && v.justChanged;
            const empty = pending
              ? calc!.prev.empty
              : (v.uninitCells as boolean[] | undefined)?.[i];
            const shown = pending ? calc!.prev.value : cell;
            return (
              <div
                key={`${i}${pending ? "-calc" : ""}`}
                className={cn(
                  "chalk-text flex min-w-[44px] flex-col items-center rounded border px-2 py-1 font-mono",
                  highlighted && !pending && "animate-value-pop",
                )}
                style={{
                  borderColor: color,
                  color,
                  fontFamily: "var(--font-mono)",
                  background: highlighted
                    ? `color-mix(in oklab, ${color} 18%, transparent)`
                    : undefined,
                }}
              >
                <span className="text-[10px] opacity-60">[{i}]</span>
                <span className="text-base">{empty ? EMPTY : formatScalar(v.type, shown)}</span>
              </div>
            );
          })}
        </div>
      )}
      {is2D && (
        <div className="mt-2 max-w-full overflow-x-auto">
          <table className="border-separate" style={{ borderSpacing: 4 }}>
            <thead>
              <tr>
                <th />
                {((v.value as (number | string)[][])[0] ?? []).map((_, j) => (
                  <th
                    key={j}
                    scope="col"
                    className="chalk-text text-center font-mono text-[10px] font-normal opacity-60"
                    style={{ color, fontFamily: "var(--font-mono)" }}
                  >
                    [{j}]
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(v.value as (number | string)[][]).map((row, i) => (
                <tr key={i}>
                  <th
                    scope="row"
                    className="chalk-text pr-1 text-right font-mono text-[10px] font-normal opacity-60"
                    style={{ color, fontFamily: "var(--font-mono)" }}
                  >
                    [{i}]
                  </th>
                  {row.map((cell, j) => {
                    const pending = cellPending(i, j);
                    const highlighted =
                      v.lastIndex && v.lastIndex[0] === i && v.lastIndex[1] === j && v.justChanged;
                    const empty = pending
                      ? calc!.prev.empty
                      : (v.uninitCells as boolean[][] | undefined)?.[i]?.[j];
                    const shown = pending ? calc!.prev.value : cell;
                    return (
                      <td
                        key={`${j}${pending ? "-calc" : ""}`}
                        className={cn(
                          "chalk-text rounded border px-2 py-1 text-center font-mono text-sm",
                          highlighted && !pending && "animate-value-pop",
                        )}
                        style={{
                          borderColor: color,
                          color,
                          fontFamily: "var(--font-mono)",
                          minWidth: 36,
                          background: highlighted
                            ? `color-mix(in oklab, ${color} 18%, transparent)`
                            : undefined,
                        }}
                        title={`[${i}][${j}]`}
                      >
                        {empty ? EMPTY : formatScalar(v.type, shown)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
