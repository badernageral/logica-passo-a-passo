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

  it("cada aviso traz a linha e a severidade", () => {
    const src = `int main(){ int x = 0; if (x = 5) { } }`;
    const ws = analyzeCode(src, "c");
    expect(ws.length).toBeGreaterThan(0);
    expect(ws[0]).toHaveProperty("line");
    expect(ws[0]).toHaveProperty("severity");
  });
});
