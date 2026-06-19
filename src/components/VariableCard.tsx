import type { Variable } from "@/lib/c-interpreter";
import { cn } from "@/lib/utils";

const TYPE_COLORS: Record<string, string> = {
  int: "var(--chalk-yellow)",
  float: "var(--chalk-green)",
  double: "var(--chalk-blue)",
  char: "var(--chalk-pink)",
};

function formatScalar(type: string, value: number | string, name?: string): string {
  if (type === "char") return `'${value === "\n" ? "\\n" : value}'`;
  if (type === "float" || type === "double") return Number(value).toFixed(2);

  const numericValue = typeof value === "number" ? value : Number(value);
  const looksLikePinVariable = name ? /porta|pino|pin/i.test(name) : false;
  if (type === "int" && looksLikePinVariable && Number.isInteger(numericValue) && numericValue >= 14 && numericValue <= 21) {
    return `A${numericValue - 14}`;
  }

  return String(value);
}

export function VariableCard({ v }: { v: Variable }) {
  const color = TYPE_COLORS[v.type] || "var(--chalk-white)";
  const isArray = !!v.dims && v.dims.length > 0;
  const is2D = isArray && v.dims!.length === 2;
  const display = !isArray ? formatScalar(v.type, v.value as number | string, v.name) : "";

  return (
    <div
      className={cn(
        "relative rounded-md border-2 border-dashed bg-card/30 p-3 transition-all",
        isArray && "col-span-2 sm:col-span-3",
        v.justCreated && "animate-chalk-write",
      )}
      style={{ borderColor: color, boxShadow: `0 0 14px color-mix(in oklab, ${color} 30%, transparent)` }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="chalk-text text-xs uppercase tracking-wider" style={{ color }}>
          {v.type}{isArray ? `[${v.dims!.join("][")}]` : ""}
        </span>
        {v.scope !== "main" && v.scope !== "global" && (
          <span className="chalk-text text-[10px] text-muted-foreground">
            escopo: {v.scope.split("#")[0]}
          </span>
        )}
      </div>
      <div className="chalk-text mt-1 text-2xl font-semibold text-foreground">{v.name}</div>
      {!isArray && (
        <div
          key={String(v.value) + (v.justChanged ? "-c" : "")}
          className={cn(
            "chalk-text mt-1 font-mono text-3xl chalk-glow",
            v.justChanged && "animate-value-pop",
          )}
          style={{ color, fontFamily: "var(--font-mono)" }}
        >
          {display}
        </div>
      )}
      {isArray && !is2D && (
        <div className="mt-2 flex flex-wrap gap-1">
          {(v.value as (number | string)[]).map((cell, i) => {
            const highlighted = v.lastIndex && v.lastIndex[0] === i && v.justChanged;
            return (
              <div
                key={i}
                className={cn(
                  "chalk-text flex min-w-[44px] flex-col items-center rounded border px-2 py-1 font-mono",
                  highlighted && "animate-value-pop",
                )}
                style={{
                  borderColor: color,
                  color,
                  fontFamily: "var(--font-mono)",
                  background: highlighted ? `color-mix(in oklab, ${color} 18%, transparent)` : undefined,
                }}
              >
                <span className="text-[10px] opacity-60">[{i}]</span>
                <span className="text-base">{formatScalar(v.type, cell)}</span>
              </div>
            );
          })}
        </div>
      )}
      {is2D && (
        <div className="mt-2 inline-block">
          <table className="border-separate" style={{ borderSpacing: 4 }}>
            <tbody>
              {(v.value as (number | string)[][]).map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => {
                    const highlighted = v.lastIndex && v.lastIndex[0] === i && v.lastIndex[1] === j && v.justChanged;
                    return (
                      <td
                        key={j}
                        className={cn(
                          "chalk-text rounded border px-2 py-1 text-center font-mono text-sm",
                          highlighted && "animate-value-pop",
                        )}
                        style={{
                          borderColor: color,
                          color,
                          fontFamily: "var(--font-mono)",
                          minWidth: 36,
                          background: highlighted ? `color-mix(in oklab, ${color} 18%, transparent)` : undefined,
                        }}
                        title={`[${i}][${j}]`}
                      >
                        {formatScalar(v.type, cell)}
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