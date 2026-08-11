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
    const hint = getErrorHint("Índice fora do limite ao acessar 'v': posição 5 (válido: 0 a 2)");
    expect(hint).toContain("5");
    expect(hint).toContain("2");
  });

  it("dá dica para biblioteca não incluída, citando o cabeçalho certo", () => {
    const stdio = getErrorHint(
      "'printf' foi usado na linha 2, mas a biblioteca <stdio.h> não foi incluída. Adicione '#include <stdio.h>' no topo do programa.",
    );
    // Não pode cair na regra genérica de printf, que vem depois no array.
    expect(stdio).toContain("stdio.h");
    expect(getErrorHint("a biblioteca <math.h> não foi incluída")).toContain("math.h");
    expect(getErrorHint("a biblioteca <string.h> não foi incluída")).toContain("string.h");
  });

  it("dá dica para nome de biblioteca digitado errado", () => {
    const hint = getErrorHint(
      "A biblioteca 'sdtio.h' incluída na linha 1 não existe. Você quis dizer 'stdio.h'?",
    );
    expect(hint).toContain("sdtio.h");
    expect(hint).toContain("stdio.h");
  });

  it("dá dica para diretiva #include mal escrita", () => {
    const hint = getErrorHint(
      "Erro na diretiva include da linha 1: Falta o '#' antes de 'include'. O correto é '#include <stdio.h>'.",
    );
    expect(hint).toContain("#include <stdio.h>");
  });

  it("dá dica para setup ausente (Arduino)", () => {
    expect(getErrorHint("Função 'setup' não encontrada.")).toBeTruthy();
  });

  it("explica ';' no lugar da vírgula antes da dica genérica de ')'", () => {
    const hint = getErrorHint("Esperado ')' mas encontrado ';' (linha 4)");
    expect(hint).toMatch(/VÍRGULA/);
    expect(hint).not.toMatch(/Faltou fechar/);
  });

  it("aponta separador faltando quando aparece um nome no lugar do ')'", () => {
    const hint = getErrorHint("Esperado ')' mas encontrado 'idade' (linha 3)");
    expect(hint).toMatch(/separador antes de 'idade'/);
  });

  it("mantém a dica genérica para outros erros de ')'", () => {
    expect(getErrorHint("Esperado ')' mas encontrado '}' (linha 4)")).toMatch(/Faltou fechar/);
  });
});
