import { describe, it, expect } from "vitest";
import { CInterpreter } from "./c-interpreter";

/**
 * Executa um programa do início ao fim, avançando passo a passo.
 * @param src    código C/Arduino
 * @param inputs respostas para scanf/leitura de pino, na ordem em que forem pedidas
 * @param maxSteps trava de segurança contra loops infinitos (ex.: loop() do Arduino)
 */
function run(src: string, inputs: string[] = [], maxSteps = 2000) {
  const interp = new CInterpreter(src);
  let steps = 0;
  let inputIdx = 0;
  while (!interp.state.finished && !interp.state.error && steps < maxSteps) {
    if (interp.state.awaitingInput) {
      const raw = inputs[inputIdx++] ?? "0";
      interp.provideInput(raw);
    } else {
      interp.step();
    }
    steps++;
  }
  const serial = interp.state.output.map((o) => o.text).join("\n");
  return { interp, serial, state: interp.state, steps };
}

/** Texto da saída serial concatenado e com espaços de borda removidos. */
const out = (src: string, inputs: string[] = []) => run(src, inputs).serial.trim();

/** Valor de uma variável por nome (primeiro escopo que casar). */
function varValue(interp: CInterpreter, name: string) {
  return interp.state.variables.find((v) => v.name === name)?.value;
}

describe("Linguagem C — básico", () => {
  it("imprime uma string literal", () => {
    expect(out(`#include <stdio.h>\nint main(){ printf("Ola, mundo!\\n"); }`)).toBe("Ola, mundo!");
  });

  it("declara variáveis e imprime inteiros (%d)", () => {
    expect(out(`#include <stdio.h>\nint main(){ int x = 7; printf("%d", x); }`)).toBe("7");
  });

  it("avalia expressões aritméticas com precedência", () => {
    expect(out(`#include <stdio.h>\nint main(){ printf("%d", 2 + 3 * 4); }`)).toBe("14");
  });

  it("formata float com %f", () => {
    expect(out(`#include <stdio.h>\nint main(){ float a = 1.5; printf("%f", a); }`)).toBe(
      "1.500000",
    );
  });

  it("imprime caractere com %c", () => {
    expect(out(`#include <stdio.h>\nint main(){ char c = 'A'; printf("%c", c); }`)).toBe("A");
  });
});

describe("Linguagem C — controle de fluxo", () => {
  it("if/else escolhe o ramo correto", () => {
    const src = `#include <stdio.h>\nint main(){ int x = 10; if (x > 5) { printf("maior"); } else { printf("menor"); } }`;
    expect(out(src)).toBe("maior");
  });

  it("while soma de 1 a 5", () => {
    const src = `#include <stdio.h>\nint main(){ int i = 1; int s = 0; while (i <= 5) { s = s + i; i = i + 1; } printf("%d", s); }`;
    expect(out(src)).toBe("15");
  });

  it("for acumula produto", () => {
    const src = `#include <stdio.h>\nint main(){ int p = 1; for (int i = 1; i <= 4; i = i + 1) { p = p * i; } printf("%d", p); }`;
    expect(out(src)).toBe("24");
  });
});

describe("Linguagem C — do/while, switch, ternário, break", () => {
  it("do-while executa o corpo ao menos uma vez", () => {
    const src = `#include <stdio.h>\nint main(){ int i = 10; int n = 0; do { n = n + 1; i = i + 1; } while (i < 5); printf("%d", n); }`;
    expect(out(src)).toBe("1");
  });

  it("do-while repete enquanto a condição é verdadeira", () => {
    const src = `#include <stdio.h>\nint main(){ int i = 0; int s = 0; do { s = s + i; i = i + 1; } while (i <= 3); printf("%d", s); }`;
    expect(out(src)).toBe("6");
  });

  it("switch escolhe o case correspondente e para no break", () => {
    const src = `#include <stdio.h>\nint main(){ int x = 2; switch (x) { case 1: printf("um"); break; case 2: printf("dois"); break; default: printf("outro"); } }`;
    expect(out(src)).toBe("dois");
  });

  it("switch cai para o default quando nenhum case casa", () => {
    const src = `#include <stdio.h>\nint main(){ int x = 9; switch (x) { case 1: printf("um"); break; default: printf("outro"); } }`;
    expect(out(src)).toBe("outro");
  });

  it("switch faz fall-through sem break", () => {
    const src = `#include <stdio.h>\nint main(){ int x = 1; switch (x) { case 1: printf("a"); case 2: printf("b"); break; case 3: printf("c"); } }`;
    expect(out(src)).toBe("ab");
  });

  it("operador ternário escolhe o ramo certo", () => {
    expect(
      out(`#include <stdio.h>\nint main(){ int x = 7; printf("%d", x > 5 ? 100 : 200); }`),
    ).toBe("100");
  });

  it("break interrompe um while", () => {
    const src = `#include <stdio.h>\nint main(){ int i = 0; while (1) { if (i == 3) { break; } i = i + 1; } printf("%d", i); }`;
    expect(out(src)).toBe("3");
  });

  it("break interrompe um for", () => {
    const src = `#include <stdio.h>\nint main(){ int soma = 0; for (int i = 0; i < 100; i = i + 1) { if (i == 5) break; soma = soma + i; } printf("%d", soma); }`;
    expect(out(src)).toBe("10");
  });
});

describe("Linguagem C — funções", () => {
  it("chama função com retorno", () => {
    const src = `#include <stdio.h>\nint soma(int a, int b){ return a + b; } int main(){ printf("%d", soma(3, 4)); }`;
    expect(out(src)).toBe("7");
  });

  it("função void com efeito via printf", () => {
    const src = `#include <stdio.h>\nvoid oi(){ printf("oi"); } int main(){ oi(); }`;
    expect(out(src)).toBe("oi");
  });
});

describe("Linguagem C — arrays", () => {
  it("lê e escreve elementos de vetor", () => {
    const src = `#include <stdio.h>\nint main(){ int v[3]; v[0] = 10; v[1] = 20; v[2] = 30; printf("%d", v[1]); }`;
    expect(out(src)).toBe("20");
  });
});

describe("Linguagem C — entrada (scanf)", () => {
  it("lê um inteiro e usa no cálculo", () => {
    const src = `#include <stdio.h>\nint main(){ int n; scanf("%d", &n); printf("%d", n * 2); }`;
    expect(out(src, ["21"])).toBe("42");
  });

  it("lê duas variáveis em scanfs consecutivos", () => {
    const src = `#include <stdio.h>\nint main(){ int a; int b; scanf("%d", &a); scanf("%d", &b); printf("%d", a + b); }`;
    expect(out(src, ["10", "32"])).toBe("42");
  });
});

describe("Linguagem C — casos de borda", () => {
  it("acessa elemento de matriz 2D", () => {
    const src = `#include <stdio.h>\nint main(){ int m[2][2]; m[0][0] = 1; m[1][1] = 9; printf("%d", m[1][1]); }`;
    expect(out(src)).toBe("9");
  });

  it("compara char por igualdade", () => {
    const src = `#include <stdio.h>\nint main(){ char c = 'A'; if (c == 'A') { printf("sim"); } else { printf("nao"); } }`;
    expect(out(src)).toBe("sim");
  });

  it("divisão por zero não trava (retorna 0)", () => {
    const { state, serial } = run(
      `#include <stdio.h>\nint main(){ int x = 10; printf("%d", x / 0); }`,
    );
    expect(state.error).toBeFalsy();
    expect(serial.trim()).toBe("0");
  });

  it("chamadas de função aninhadas", () => {
    const src = `#include <stdio.h>\nint dobro(int n){ return n * 2; }
int main(){ printf("%d", dobro(dobro(3))); }`;
    expect(out(src)).toBe("12");
  });

  it("módulo e precedência combinados", () => {
    expect(out(`#include <stdio.h>\nint main(){ printf("%d", 17 % 5 + 2 * 3); }`)).toBe("8");
  });
});

describe("Arduino", () => {
  const blink = `int led = 13;
void setup(){ pinMode(led, OUTPUT); }
void loop(){ digitalWrite(led, HIGH); }`;

  it("detecta modo Arduino e configura pino OUTPUT", () => {
    const { state } = run(blink, [], 60);
    expect(state.arduinoMode).toBe(true);
    expect(state.pinStates.some((p) => p.pin === 13)).toBe(true);
  });

  it("Serial.println escreve no monitor serial", () => {
    const src = `void setup(){ Serial.begin(9600); Serial.println("ola"); }
void loop(){}`;
    const { serial } = run(src, [], 60);
    expect(serial).toContain("ola");
  });
});

describe("Erros são reportados, não lançam", () => {
  it("variável não declarada gera state.error", () => {
    const { state } = run(`int main(){ x = 5; }`);
    expect(state.error).toBeTruthy();
  });
});

describe("Bibliotecas obrigatórias (#include)", () => {
  it("printf sem <stdio.h> impede a execução", () => {
    const interp = new CInterpreter(`int main() {\n\tprintf("Olá");\n}`);
    expect(interp.state.error).toMatch(/<stdio\.h>/);
    expect(interp.state.finished).toBe(true);
    expect(interp.state.output).toHaveLength(0);
  });

  it("o erro aponta a linha do uso, para o editor destacá-la", () => {
    const interp = new CInterpreter(`int main() {\n\tint x = 1;\n\tprintf("%d", x);\n}`);
    expect(interp.state.error).toMatch(/linha 3/);
    expect(interp.state.currentLine).toBe(3);
  });

  it("com o #include presente, executa normalmente", () => {
    expect(out(`#include <stdio.h>\nint main(){ printf("ok"); }`)).toBe("ok");
  });

  it("sqrt exige <math.h> e strlen exige <string.h>", () => {
    expect(new CInterpreter(`int main(){ return sqrt(9); }`).state.error).toMatch(/<math\.h>/);
    expect(new CInterpreter(`int main(){ return strlen("oi"); }`).state.error).toMatch(
      /<string\.h>/,
    );
  });

  it("sketch Arduino com Serial.print não é acusado (vira printf só internamente)", () => {
    const src = `void setup(){ Serial.begin(9600); Serial.println("ola"); }
void loop(){}`;
    const { state, serial } = run(src, [], 60);
    expect(state.error).toBeFalsy();
    expect(serial).toContain("ola");
  });

  it("função própria com nome de função de biblioteca não é acusada", () => {
    const src = `int pow(int a, int b){ return a * b; }
int main(){ return pow(2, 3); }`;
    expect(new CInterpreter(src).state.error).toBeFalsy();
  });

  it("nome de biblioteca errado impede a execução e sugere o correto", () => {
    const interp = new CInterpreter(`#include <sdtio.h>\nint main(){ printf("oi"); }`);
    expect(interp.state.error).toMatch(/'sdtio\.h'.*não existe.*'stdio\.h'/);
    expect(interp.state.currentLine).toBe(1);
  });

  it("biblioteca de terceiros não é confundida com erro de digitação", () => {
    const src = `#include <Timer.h>
void setup(){}
void loop(){}`;
    expect(new CInterpreter(src).state.error).toBeFalsy();
  });

  it("#include sem '>' impede a execução", () => {
    const interp = new CInterpreter(`#include <stdio.h\nint main(){ printf("oi"); }`);
    expect(interp.state.error).toMatch(/Falta o '>'/);
    expect(interp.state.currentLine).toBe(1);
  });

  it("include sem '#' dá erro claro em vez de 'Token inesperado'", () => {
    const interp = new CInterpreter(`include <stdio.h>\nint main(){ printf("oi"); }`);
    expect(interp.state.error).toMatch(/Falta o '#'/);
    expect(interp.state.error).not.toMatch(/Token inesperado/);
  });

  it("a forma com aspas é aceita e executa", () => {
    expect(out(`#include "stdio.h"\nint main(){ printf("ok"); }`)).toBe("ok");
  });

  it("printf dentro de comentário ou string não conta como uso", () => {
    const src = `int main(){ /* printf("x"); */ int c = 'a'; return c; }`;
    expect(new CInterpreter(src).state.error).toBeFalsy();
  });
});

describe("Criação de variáveis passo a passo (regressão do commit c275cec)", () => {
  it("nenhuma variável global existe antes de avançar os passos", () => {
    const interp = new CInterpreter(
      `#include <stdio.h>\nint a = 1;\nint b = 2;\nint main(){ printf("%d", a + b); }`,
    );
    expect(interp.state.variables.length).toBe(0);
  });

  it("as globais existem com os valores corretos ao terminar", () => {
    const { interp, serial } = run(
      `#include <stdio.h>\nint a = 1;\nint b = 2;\nint main(){ printf("%d", a + b); }`,
    );
    expect(serial.trim()).toBe("3");
    expect(varValue(interp, "a")).toBe(1);
    expect(varValue(interp, "b")).toBe(2);
  });
});
