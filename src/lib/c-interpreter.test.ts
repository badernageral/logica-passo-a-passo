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
    expect(out(`int main(){ printf("Ola, mundo!\\n"); }`)).toBe("Ola, mundo!");
  });

  it("declara variáveis e imprime inteiros (%d)", () => {
    expect(out(`int main(){ int x = 7; printf("%d", x); }`)).toBe("7");
  });

  it("avalia expressões aritméticas com precedência", () => {
    expect(out(`int main(){ printf("%d", 2 + 3 * 4); }`)).toBe("14");
  });

  it("formata float com %f", () => {
    expect(out(`int main(){ float a = 1.5; printf("%f", a); }`)).toBe("1.500000");
  });

  it("imprime caractere com %c", () => {
    expect(out(`int main(){ char c = 'A'; printf("%c", c); }`)).toBe("A");
  });
});

describe("Linguagem C — controle de fluxo", () => {
  it("if/else escolhe o ramo correto", () => {
    const src = `int main(){ int x = 10; if (x > 5) { printf("maior"); } else { printf("menor"); } }`;
    expect(out(src)).toBe("maior");
  });

  it("while soma de 1 a 5", () => {
    const src = `int main(){ int i = 1; int s = 0; while (i <= 5) { s = s + i; i = i + 1; } printf("%d", s); }`;
    expect(out(src)).toBe("15");
  });

  it("for acumula produto", () => {
    const src = `int main(){ int p = 1; for (int i = 1; i <= 4; i = i + 1) { p = p * i; } printf("%d", p); }`;
    expect(out(src)).toBe("24");
  });
});

describe("Linguagem C — funções", () => {
  it("chama função com retorno", () => {
    const src = `int soma(int a, int b){ return a + b; } int main(){ printf("%d", soma(3, 4)); }`;
    expect(out(src)).toBe("7");
  });

  it("função void com efeito via printf", () => {
    const src = `void oi(){ printf("oi"); } int main(){ oi(); }`;
    expect(out(src)).toBe("oi");
  });
});

describe("Linguagem C — arrays", () => {
  it("lê e escreve elementos de vetor", () => {
    const src = `int main(){ int v[3]; v[0] = 10; v[1] = 20; v[2] = 30; printf("%d", v[1]); }`;
    expect(out(src)).toBe("20");
  });
});

describe("Linguagem C — entrada (scanf)", () => {
  it("lê um inteiro e usa no cálculo", () => {
    const src = `int main(){ int n; scanf("%d", &n); printf("%d", n * 2); }`;
    expect(out(src, ["21"])).toBe("42");
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

describe("Criação de variáveis passo a passo (regressão do commit c275cec)", () => {
  it("nenhuma variável global existe antes de avançar os passos", () => {
    const interp = new CInterpreter(`int a = 1;\nint b = 2;\nint main(){ printf("%d", a + b); }`);
    expect(interp.state.variables.length).toBe(0);
  });

  it("as globais existem com os valores corretos ao terminar", () => {
    const { interp, serial } = run(`int a = 1;\nint b = 2;\nint main(){ printf("%d", a + b); }`);
    expect(serial.trim()).toBe("3");
    expect(varValue(interp, "a")).toBe(1);
    expect(varValue(interp, "b")).toBe(2);
  });
});
