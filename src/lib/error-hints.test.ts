import { describe, it, expect } from "vitest";
import { getErrorHint } from "./error-hints";

describe("getErrorHint", () => {
  it("retorna null para mensagem vazia", () => {
    expect(getErrorHint("")).toBeNull();
  });

  it("retorna null para mensagem desconhecida", () => {
    expect(getErrorHint("uma mensagem qualquer sem padrão conhecido")).toBeNull();
  });

  it("dá dica para variável não declarada", () => {
    expect(getErrorHint("Variável 'x' não declarada")).toBeTruthy();
  });

  it("dá dica para variável já declarada", () => {
    expect(getErrorHint("Variável 'x' já declarada")).toBeTruthy();
  });

  it("dá dica para função não definida", () => {
    expect(getErrorHint("Função 'soma' não definida.")).toBeTruthy();
  });

  it("dá dica para ';' faltante citando a linha", () => {
    const hint = getErrorHint("Esperado ';' ao final da linha 4");
    expect(hint).toBeTruthy();
  });

  it("dá dica para índice fora do limite incluindo os valores", () => {
    const hint = getErrorHint(
      "Índice fora do limite ao acessar 'v': posição 5 (válido: 0 a 2)",
    );
    expect(hint).toContain("5");
    expect(hint).toContain("2");
  });

  it("dá dica para setup ausente (Arduino)", () => {
    expect(getErrorHint("Função 'setup' não encontrada.")).toBeTruthy();
  });
});
