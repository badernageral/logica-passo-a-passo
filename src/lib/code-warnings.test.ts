import { describe, it, expect } from "vitest";
import { analyzeCode } from "./code-warnings";

/** Junta as mensagens dos avisos para asserts por substring. */
const messages = (code: string, mode: "arduino" | "c" = "c") =>
  analyzeCode(code, mode)
    .map((w) => w.message)
    .join("\n");

describe("analyzeCode", () => {
  it("não gera avisos para um programa C correto", () => {
    const src = `#include <stdio.h>
int main() {
  int x = 5;
  if (x == 5) {
    printf("%d", x);
  }
  return 0;
}`;
    expect(analyzeCode(src, "c")).toHaveLength(0);
  });

  it("alerta sobre '=' em vez de '==' na condição", () => {
    const src = `int main(){ int x = 0; if (x = 5) { } }`;
    expect(messages(src)).toMatch(/==/);
  });

  it("alerta sobre falta do operador '=' na declaração", () => {
    const src = `int x 5;
int main(){ return 0; }`;
    expect(messages(src)).toMatch(/=/);
  });

  it("alerta sobre '&' simples em condição lógica", () => {
    const src = `int main(){ int a = 1; int b = 2; if (a == 1 & b == 2) { } }`;
    expect(messages(src)).toMatch(/&&/);
  });

  it("alerta sobre '|' simples em condição lógica", () => {
    const src = `int main(){ int a = 1; int b = 2; if (a == 1 | b == 2) { } }`;
    expect(messages(src)).toMatch(/\|\|/);
  });

  it("ignora comentários ao analisar", () => {
    const src = `int main(){ int x = 0; // if (x = 5)
  return 0; }`;
    expect(analyzeCode(src, "c")).toHaveLength(0);
  });

  it("cada aviso traz a linha e a severidade", () => {
    const src = `int main(){ int x = 0; if (x = 5) { } }`;
    const ws = analyzeCode(src, "c");
    expect(ws.length).toBeGreaterThan(0);
    expect(ws[0]).toHaveProperty("line");
    expect(ws[0]).toHaveProperty("severity");
  });
});
