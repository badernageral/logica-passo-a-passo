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

  it("alerta quando printf é usado sem #include <stdio.h>", () => {
    const src = `int main() {
  printf("Olá");
}`;
    const ws = analyzeCode(src, "c");
    expect(ws).toHaveLength(1);
    expect(ws[0].line).toBe(2);
    expect(ws[0].message).toMatch(/printf.*<stdio\.h>/);
  });

  it("não alerta quando o #include está presente", () => {
    const src = `#include <stdio.h>
#include <math.h>
int main() {
  printf("%f", sqrt(9));
}`;
    expect(analyzeCode(src, "c")).toHaveLength(0);
  });

  it("cobre math.h e string.h, uma entrada por função", () => {
    const src = `#include <stdio.h>
int main() {
  printf("%f", sqrt(9));
  printf("%f", pow(2, 3));
  printf("%d", strlen("oi"));
}`;
    const ws = analyzeCode(src, "c");
    expect(ws.map((w) => w.message).join("\n")).toMatch(/sqrt.*<math\.h>/);
    expect(ws.map((w) => w.message).join("\n")).toMatch(/strlen.*<string\.h>/);
    // sqrt e pow são da mesma biblioteca, mas cada função é citada uma vez.
    expect(ws).toHaveLength(3);
  });

  it("não alerta se o aluno definiu a própria função com o mesmo nome", () => {
    const src = `int pow(int a, int b) {
  return a * b;
}
int main() {
  return pow(2, 3);
}`;
    expect(analyzeCode(src, "c")).toHaveLength(0);
  });

  it("não alerta em modo Arduino (Serial.print não é printf)", () => {
    const src = `void setup() {
  Serial.begin(9600);
}
void loop() {
  Serial.println("oi");
}`;
    expect(analyzeCode(src, "arduino")).toHaveLength(0);
  });

  it("alerta mesmo com o seletor em Arduino, se houver printf literal", () => {
    const src = `int main() {
  printf("Olá");
}`;
    expect(messages(src, "arduino")).toMatch(/printf.*<stdio\.h>/);
  });

  it("o aviso de include não é cortado pelo limite de 8 avisos", () => {
    const src = `int main() {
  int a 1;
  int b 2;
  int c 3;
  int d 4;
  int e 5;
  int f 6;
  int g 7;
  int h 8;
  printf("%d", a);
}`;
    const ws = analyzeCode(src, "c");
    expect(ws).toHaveLength(8);
    expect(ws[0].message).toMatch(/<stdio\.h>/);
  });

  it("acusa nome de biblioteca digitado errado, sugerindo o correto", () => {
    const src = `#include <sdtio.h>
int main() {
  printf("Olá");
}`;
    const ws = analyzeCode(src, "c");
    expect(ws[0].line).toBe(1);
    expect(ws[0].message).toMatch(/'sdtio\.h' não existe.*'stdio\.h'/);
  });

  it("reconhece os erros de digitação mais comuns", () => {
    const casos: [string, string][] = [
      ["stdio", "stdio.h"], // esqueceu o .h
      ["sdtlib.h", "stdlib.h"], // letras trocadas de ordem
      ["strnig.h", "string.h"],
      ["matth.h", "math.h"], // letra a mais
      ["studio.h", "stdio.h"],
    ];
    for (const [errado, certo] of casos) {
      expect(messages(`#include <${errado}>\nint main(){ return 0; }`)).toMatch(
        new RegExp(`'${errado.replace(".", "\\.")}' não existe.*'${certo.replace(".", "\\.")}'`),
      );
    }
  });

  it("não acusa bibliotecas de terceiros que não são erro de digitação", () => {
    for (const lib of ["DHT.h", "Adafruit_Sensor.h", "Timer.h", "MinhaLib.h", "Wire.h"]) {
      const src = `#include <${lib}>\nvoid setup(){}\nvoid loop(){}`;
      expect(analyzeCode(src, "arduino")).toHaveLength(0);
    }
  });

  it("acusa #include mal escrito, com a correção no texto", () => {
    const casos: [string, RegExp][] = [
      ["#include <stdio.h", /Falta o '>'/],
      ['#include "stdio.h', /Falta a aspas/],
      ["include <stdio.h>", /Falta o '#'/],
      ["#include stdio.h", /precisa vir entre '<' e '>'/],
      ["#include", /Falta o nome da biblioteca/],
    ];
    for (const [diretiva, esperado] of casos) {
      const ws = analyzeCode(`${diretiva}\nint main(){ printf("oi"); }`, "c");
      expect(ws[0].line).toBe(1);
      expect(ws[0].message).toMatch(esperado);
      expect(ws[0].message).toContain("#include <stdio.h>");
    }
  });

  it("diretiva mal escrita não gera avisos irrelevantes em cima", () => {
    // Sem o '#', a linha viraria "variáveis 'include'/'stdio' não declaradas".
    const ws = analyzeCode(`include <stdio.h>\nint main(){ printf("oi"); }`, "c");
    expect(ws).toHaveLength(1);
  });

  it("aceita a forma com aspas, que é C válido", () => {
    const src = `#include "stdio.h"
int main() {
  printf("oi");
}`;
    expect(analyzeCode(src, "c")).toHaveLength(0);
  });

  it("não confunde texto dentro de string com diretiva", () => {
    const src = `#include <stdio.h>
int main() {
  printf("escreva #include <stdio.h");
}`;
    expect(analyzeCode(src, "c")).toHaveLength(0);
  });

  it("funções de <math.h> incluídas corretamente não geram aviso", () => {
    const src = `#include <stdio.h>
#include <math.h>
int main() {
  double a = floor(2.7);
  double b = ceil(2.1);
  printf("%.0f %.0f %.0f", a, b, sqrt(9));
  return 0;
}`;
    expect(analyzeCode(src, "c")).toHaveLength(0);
  });

  it("continua cobrando o #include quando a biblioteca falta", () => {
    const src = `#include <stdio.h>
int main(){ printf("%.0f", floor(2.7)); }`;
    expect(messages(src)).toMatch(/math\.h/);
  });

  it("aponta o erro de capitalização sem sugerir o mesmo nome", () => {
    expect(messages(`int main(){ int x = Floor(2.7); }`)).toMatch(/o correto é 'floor'/i);
  });

  it("acusa %d usado com variável float no printf", () => {
    const src = `#include <stdio.h>
int main() {
  float media = 7.5;
  printf("%d", media);
}`;
    const ws = analyzeCode(src, "c");
    expect(ws[0].message).toMatch(/'%d'.*'media'.*float/);
    expect(ws[0].line).toBe(4);
  });

  it("acusa %d usado com variável float no scanf", () => {
    const src = `#include <stdio.h>\nint main(){ float a; scanf("%d", &a); }`;
    expect(messages(src)).toMatch(/'%d'.*'a'.*float/);
  });

  it("acusa %f usado com variável int", () => {
    const src = `#include <stdio.h>\nint main(){ int n = 3; printf("%f", n); }`;
    expect(messages(src)).toMatch(/'%f'.*'n'.*int/);
  });

  it("acusa o argumento errado mesmo quando os outros batem", () => {
    const src = `#include <stdio.h>\nint main(){ int a = 1; float b = 2; printf("%d %d", a, b); }`;
    expect(messages(src)).toMatch(/'b'/);
  });

  it("aceita %d com char no printf (código ASCII) e recusa no scanf", () => {
    const p = `#include <stdio.h>\nint main(){ char c = 65; printf("%d", c); }`;
    const s = `#include <stdio.h>\nint main(){ char c; scanf("%d", &c); }`;
    expect(analyzeCode(p, "c")).toHaveLength(0);
    expect(messages(s)).toMatch(/'%d'.*'c'.*char/);
  });

  it("não acusa tipos compatíveis nem argumentos que não são variáveis", () => {
    const casos = [
      `#include <stdio.h>\nint main(){ double d = 1.5; printf("%.2f", d); }`,
      `#include <stdio.h>\nint main(){ double d = 1.5; printf("%lf", d); }`,
      `#include <stdio.h>\nint main(){ char nome[20]; scanf("%s", nome); }`,
      `#include <stdio.h>\nint main(){ int a = 1, b = 2; printf("%d", a + b); }`,
      `#include <stdio.h>\nint main(){ printf("%d", 5); }`,
      `#include <stdio.h>\nint main(){ unsigned long t = 5; printf("%d", t); }`,
      `#include <stdio.h>\nint main(){ float v[3]; printf("%f", v[0]); }`,
      `#include <stdio.h>\nvoid mostra(float x){ printf("%.2f", x); }\nint main(){ mostra(1.5); }`,
    ];
    for (const src of casos) expect(analyzeCode(src, "c")).toHaveLength(0);
  });

  it("acusa scanf sem o '&' antes da variável", () => {
    const src = `#include <stdio.h>
int main() {
  float a;
  scanf("%f",a);
}`;
    const ws = analyzeCode(src, "c");
    expect(ws[0].message).toMatch(/Faltou o '&' antes de 'a'/);
    expect(ws[0].line).toBe(4);
  });

  it("acusa o alvo sem '&' mesmo quando os outros têm", () => {
    const src = `#include <stdio.h>\nint main(){ int a, b; scanf("%d %d", &a, b); }`;
    expect(messages(src)).toMatch(/Faltou o '&' antes de 'b'/);
  });

  it("não cobra '&' de vetor com %s nem de posição já endereçada", () => {
    const str = `#include <stdio.h>\nint main(){ char nome[20]; scanf("%s", nome); }`;
    const idx = `#include <stdio.h>\nint main(){ int v[3]; scanf("%d", &v[0]); }`;
    expect(analyzeCode(str, "c")).toHaveLength(0);
    expect(analyzeCode(idx, "c")).toHaveLength(0);
  });

  it("acusa vírgula faltando entre o texto e a variável no printf", () => {
    const src = `#include <stdio.h>
int main() {
  int idade = 5;
  printf("Idade: %d\\n"idade);
}`;
    const ws = analyzeCode(src, "c");
    expect(ws[0].message).toMatch(/Faltou a vírgula/);
    expect(ws[0].line).toBe(4);
  });

  it("acusa vírgula faltando também com espaço e na ordem inversa", () => {
    const dep = `#include <stdio.h>\nint main(){ int x = 1; printf("texto" x); }`;
    const ant = `#include <stdio.h>\nint main(){ int x = 1; printf(x"texto"); }`;
    expect(messages(dep)).toMatch(/Faltou a vírgula/);
    expect(messages(ant)).toMatch(/Faltou a vírgula/);
  });

  it("acusa vírgula faltando em sketch Arduino", () => {
    const src = `void setup(){ int x = 1; Serial.print("oi"x); }\nvoid loop(){}`;
    expect(messages(src, "arduino")).toMatch(/Faltou a vírgula/);
  });

  it("não confunde #include com aspas nem concatenação de textos", () => {
    expect(analyzeCode(`#include "stdio.h"\nint main(){ printf("oi"); }`, "c")).toHaveLength(0);
    expect(analyzeCode(`#include <stdio.h>\nint main(){ printf("a" "b"); }`, "c")).toHaveLength(0);
  });

  it("acusa ';' no lugar da vírgula dentro do scanf", () => {
    const src = `#include <stdio.h>
int main() {
  int a;
  scanf("%d";&a);
}`;
    const ws = analyzeCode(src, "c");
    expect(ws[0].message).toMatch(/';' dentro dos parênteses de 'scanf'/);
    expect(ws[0].line).toBe(4);
  });

  it("acusa o mesmo erro em modo Arduino", () => {
    const src = `void setup(){ analogWrite(9;255); }
void loop(){}`;
    expect(messages(src, "arduino")).toMatch(/';' dentro dos parênteses/);
  });

  it("não confunde os ';' do for com erro", () => {
    const src = `#include <stdio.h>
int main(){ for (int i = 0; i < 3; i++) { printf("%d", i); } }`;
    expect(analyzeCode(src, "c")).toHaveLength(0);
  });

  it("mas acusa ';' numa chamada dentro do for", () => {
    const src = `#include <stdio.h>
int main(){ for (int i = 0; i < max(1;2); i++) { } }`;
    expect(messages(src)).toMatch(/';' dentro dos parênteses de 'max'/);
  });

  it("aponta 'main' digitado errado e a linha certa", () => {
    const src = `#include <stdio.h>
int mian() {
  printf("Ola");
}`;
    const ws = analyzeCode(src, "c");
    expect(ws.map((w) => w.message).join("\n")).toMatch(/'mian'.*'main'/);
    expect(ws[0].line).toBe(2);
  });

  it("avisa quando não há main nenhuma", () => {
    const src = `#include <stdio.h>
int soma(int a, int b){ return a + b; }`;
    expect(messages(src)).toMatch(/'main'/);
  });

  it("não cobra main enquanto o programa ainda não tem função alguma", () => {
    expect(analyzeCode(`#include <stdio.h>\nint x = 5;`, "c")).toHaveLength(0);
  });

  it("não cobra main em sketch Arduino", () => {
    expect(analyzeCode(`void setup(){}\nvoid loop(){}`, "arduino")).toHaveLength(0);
  });

  it("cada aviso traz a linha e a severidade", () => {
    const src = `int main(){ int x = 0; if (x = 5) { } }`;
    const ws = analyzeCode(src, "c");
    expect(ws.length).toBeGreaterThan(0);
    expect(ws[0]).toHaveProperty("line");
    expect(ws[0]).toHaveProperty("severity");
  });
});
