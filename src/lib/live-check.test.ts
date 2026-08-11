import { describe, it, expect } from "vitest";
import { liveCheck } from "./live-check";
import { CInterpreter } from "./c-interpreter";

const HELLO = `#include <stdio.h>

int main() {
\tprintf("Olá, mundo!\\n");
}`;

describe("liveCheck (dry-run em modo C)", () => {
  it("não acusa nada em código correto", () => {
    expect(liveCheck(HELLO)).toBeNull();
  });

  it("não acusa nada em código vazio ou só espaços", () => {
    expect(liveCheck("")).toBeNull();
    expect(liveCheck("   \n\t")).toBeNull();
  });

  it("não duplica o card do analyzeCode quando 'main' está digitado errado", () => {
    expect(liveCheck(HELLO.replace("int main()", "int mian()"))).toBeNull();
  });

  it("não duplica o card do analyzeCode do ';' dentro dos parênteses", () => {
    expect(liveCheck(HELLO.replace(`printf("Olá, mundo!\\n")`, `printf("oi";1)`))).toBeNull();
  });

  it("acusa sequência de escape desconhecida (\\m) com dica didática", () => {
    const code = HELLO.replace("Olá, mundo!\\n", "Olá, \\mundo!\\n");
    const err = liveCheck(code);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/escape desconhecida: '\\m'/);
    expect(err!.line).toBe(4);
    expect(err!.hint).toMatch(/\\n/);
  });

  it("acusa ';' faltando", () => {
    const code = HELLO.replace(";", "");
    const err = liveCheck(code);
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/;/);
  });

  it("acusa erro de sintaxe não previsto em lista (token inesperado)", () => {
    const err = liveCheck(`int main() {\n\tint x 5;\n}`);
    expect(err).not.toBeNull();
    expect(err!.hint).toBeTruthy();
  });

  it("não acusa programa ainda incompleto (sem main) durante a digitação", () => {
    expect(liveCheck("// começando a escrever")).toBeNull();
  });

  it("suprime erros que o analyzeCode já mostra como aviso", () => {
    // chave desbalanceada
    expect(liveCheck(`int main() {\n\tprintf("x");\n`)).toBeNull();
    // falta #include
    expect(liveCheck(`int main() {\n\tprintf("x");\n}`)).toBeNull();
    // include mal escrito
    expect(liveCheck(`include <stdio.h>\nint main() {\n\tprintf("x");\n}`)).toBeNull();
  });
});

describe("modo estrito de escapes não afeta a execução normal", () => {
  it("interpretador sem strictEscapes continua aceitando '\\m'", () => {
    const code = HELLO.replace("Olá, mundo!\\n", "Olá, \\mundo!\\n");
    const interp = new CInterpreter(code);
    expect(interp.state.error).toBeNull();
  });

  it('escapes válidos (\\n, \\t, \\\\, \\") passam no modo estrito', () => {
    const code = `#include <stdio.h>\n\nint main() {\n\tprintf("a\\tb\\n\\"c\\"\\\\d");\n}`;
    expect(liveCheck(code)).toBeNull();
  });
});
