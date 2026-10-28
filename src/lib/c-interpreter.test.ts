import { describe, it, expect } from "vitest";
import { CInterpreter, type Variable } from "./c-interpreter";

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

  it("respeita a precisão do formato (%.2f)", () => {
    expect(out(`#include <stdio.h>\nint main(){ float m = 8.456; printf("%.2f", m); }`)).toBe(
      "8.46",
    );
  });

  it("respeita largura e alinhamento (%5d, %-5d)", () => {
    expect(out(`#include <stdio.h>\nint main(){ printf("[%5d][%-5d]", 42, 42); }`)).toBe(
      "[   42][42   ]",
    );
  });

  it("imprime porcentagem com %%", () => {
    expect(out(`#include <stdio.h>\nint main(){ printf("%d%%", 50); }`)).toBe("50%");
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

describe("Linguagem C — funções de <math.h>", () => {
  /** Envolve a expressão num programa completo com as bibliotecas necessárias. */
  const math = (expr: string, fmt = "%.2f") =>
    out(`#include <stdio.h>\n#include <math.h>\nint main(){ printf("${fmt}", ${expr}); }`);

  it("floor e ceil arredondam para baixo e para cima", () => {
    expect(math("floor(2.7)")).toBe("2.00");
    expect(math("ceil(2.1)")).toBe("3.00");
    expect(math("floor(-2.1)")).toBe("-3.00");
    expect(math("ceil(-2.7)")).toBe("-2.00");
  });

  it("o resultado pode ser guardado numa variável", () => {
    const src = `#include <stdio.h>\n#include <math.h>\nint main(){ float x = 7.8; int p = floor(x); printf("%d", p); }`;
    expect(out(src)).toBe("7");
  });

  it("sqrt, pow e fabs", () => {
    expect(math("sqrt(9)")).toBe("3.00");
    expect(math("pow(2, 10)")).toBe("1024.00");
    expect(math("fabs(-4.5)")).toBe("4.50");
  });

  it("round arredonda o empate para longe do zero, como no C", () => {
    expect(math("round(2.5)")).toBe("3.00");
    expect(math("round(-2.5)")).toBe("-3.00");
  });

  it("fmod, log10 e trigonometria", () => {
    expect(math("fmod(7, 3)")).toBe("1.00");
    expect(math("log10(1000)")).toBe("3.00");
    expect(math("sin(0)")).toBe("0.00");
  });

  it("aceita expressões e chamadas aninhadas como argumento", () => {
    const src = `#include <stdio.h>\n#include <math.h>\nint main(){ int n = 5; printf("%.0f", floor(sqrt(n * 5) + 0.9)); }`;
    expect(out(src)).toBe("5");
  });

  it("uma função do aluno com o mesmo nome tem precedência", () => {
    const src = `#include <stdio.h>\n#include <math.h>\nint floor(int x){ return 99; } int main(){ printf("%d", floor(2.7)); }`;
    expect(out(src)).toBe("99");
  });

  it("reclama quando faltam argumentos", () => {
    const src = `#include <stdio.h>\n#include <math.h>\nint main(){ printf("%.2f", pow(2)); }`;
    expect(run(src).state.error).toBe("A função 'pow' precisa de 2 argumentos.");
  });
});

describe("Arduino — funções auxiliares", () => {
  it("map, constrain, min, max e abs", () => {
    const src = `#include <stdio.h>\nint main(){ printf("%d %d %d %d %d", map(512, 0, 1023, 0, 255), constrain(15, 0, 10), min(3, 7), max(3, 7), abs(-8)); }`;
    expect(out(src)).toBe("127 10 3 7 8");
  });
});

describe("Linguagem C — arrays", () => {
  it("lê e escreve elementos de vetor", () => {
    const src = `#include <stdio.h>\nint main(){ int v[3]; v[0] = 10; v[1] = 20; v[2] = 30; printf("%d", v[1]); }`;
    expect(out(src)).toBe("20");
  });
});

describe("Linguagem C — strlen (<string.h>)", () => {
  const H = "#include <stdio.h>\n#include <string.h>\n";

  it("conta as letras até o '\\0' de um vetor lido com scanf", () => {
    const src = H + `int main(){ char a[10]; scanf("%s", a); printf("%d", strlen(a)); }`;
    expect(out(src, ["ola"])).toBe("3");
  });

  it("aceita texto entre aspas e vetor inicializado", () => {
    expect(out(H + `int main(){ printf("%d", strlen("abcde")); }`)).toBe("5");
    const src = H + `int main(){ char a[10] = "oi"; int n = strlen(a); printf("%d", n); }`;
    expect(out(src)).toBe("2");
  });

  it("serve de limite num for e funciona com linha de matriz", () => {
    const loop =
      H +
      `int main(){ char a[10]; int i; scanf("%s", a); for(i=0;i<strlen(a);i++) printf("[%c]", a[i]); }`;
    expect(out(loop, ["abc"])).toBe("[a][b][c]");
    const mat = H + `int main(){ char n[2][8]; scanf("%s", n[1]); printf("%d", strlen(n[1])); }`;
    expect(out(mat, ["casa"])).toBe("4");
  });

  it("char nome[] = \"...\" reserva letras + '\\0' e completa o resto com '\\0'", () => {
    const src =
      H +
      `int main(){ char a[] = "teste"; char b[6] = "oi"; printf("%d %d %s", strlen(a), strlen(b), a); }`;
    expect(out(src)).toBe("5 2 teste");

    const interp = new CInterpreter(src);
    while (!interp.state.variables.some((v) => v.name === "b")) interp.step();
    expect(interp.state.variables.find((v) => v.name === "a")!.dims).toEqual([6]);
    expect(varValue(interp, "b")).toEqual(["o", "i", "\0", "\0", "\0", "\0"]);
  });

  it("texto maior que o vetor ou vetor sem tamanho e sem valor não executa", () => {
    expect(new CInterpreter(H + `int main(){ char a[3] = "abc"; }`).state.error).toMatch(
      /não cabe em 'a' \(char\[3\]\).*char a\[4\]/,
    );
    expect(new CInterpreter(H + `int main(){ char a[]; }`).state.error).toMatch(/sem tamanho/);
    expect(out(H + `int main(){ int v[] = {4, 5, 6}; printf("%d", v[2]); }`)).toBe("6");
  });

  it("argumento que não é texto vira erro explicado", () => {
    const src = H + `int main(){ int x = 3; printf("%d", strlen(x)); }`;
    expect(run(src).state.error).toMatch(/strlen mede o tamanho de um TEXTO/);
  });
});

describe("Vetor como parâmetro de função", () => {
  const H = "#include <stdio.h>\n#include <string.h>\n";

  it("a função lê o vetor de quem chamou", () => {
    const src =
      H +
      `int soma(int v[], int n) { int i, s = 0; for (i = 0; i < n; i++) s += v[i]; return s; }\nint main() { int notas[4] = {7, 8, 5, 10}; printf("%d", soma(notas, 4)); }`;
    expect(out(src)).toBe("30");
  });

  it("o que a função muda no vetor muda o original (não é cópia)", () => {
    const src =
      H +
      `void dobra(int v[], int n) { int i; for (i = 0; i < n; i++) v[i] = v[i] * 2; }\nint main() { int a[3] = {1, 2, 3}; dobra(a, 3); printf("%d %d %d", a[0], a[1], a[2]); }`;
    expect(out(src)).toBe("2 4 6");
  });

  it("ordena no lugar (bolha) e aceita o tamanho escrito no parâmetro", () => {
    const src =
      H +
      `void ordena(int v[5], int n) { int i, j, t; for (i = 0; i < n - 1; i++) for (j = 0; j < n - 1 - i; j++) if (v[j] > v[j + 1]) { t = v[j]; v[j] = v[j + 1]; v[j + 1] = t; } }\nint main() { int v[5] = {4, 1, 5, 2, 3}; int i; ordena(v, 5); for (i = 0; i < 5; i++) printf("%d", v[i]); }`;
    expect(out(src)).toBe("12345");
  });

  it("scanf e strlen dentro da função usam o vetor recebido", () => {
    const src =
      H +
      `void ler(int v[], int n) { int i; for (i = 0; i < n; i++) scanf("%d", &v[i]); }\nint tam(char s[]) { return strlen(s); }\nvoid lerNome(char s[]) { scanf("%s", s); }\nint main() { int v[2]; char nome[10]; ler(v, 2); lerNome(nome); printf("%d %d %s %d", v[0], v[1], nome, tam(nome)); }`;
    expect(out(src, ["3", "9", "ana"])).toBe("3 9 ana 3");
  });

  it("matriz com colunas no parâmetro e linha de matriz como vetor", () => {
    const mat =
      H +
      `int traco(int m[][3]) { return m[0][0] + m[1][1] + m[2][2]; }\nvoid zera(int m[3][3], int i) { m[i][i] = 0; }\nint main() { int m[3][3] = {{1,2,3},{4,5,6},{7,8,9}}; zera(m, 1); printf("%d", traco(m)); }`;
    expect(out(mat)).toBe("10");
    const linha =
      H +
      `int tam(char s[]) { return strlen(s); }\nint main() { char nomes[2][8]; scanf("%s", nomes[1]); printf("%d", tam(nomes[1])); }`;
    expect(out(linha, ["casa"])).toBe("4");
  });

  it("repassar o parâmetro a outra função continua mexendo no original", () => {
    const src =
      H +
      `void um(int v[]) { v[0] = 9; }\nvoid dois(int w[]) { um(w); }\nint main() { int a[2] = {1, 1}; dois(a); printf("%d", a[0]); }`;
    expect(out(src)).toBe("9");
  });

  it("o cartão do vetor original acende e o passo explica que não é cópia", () => {
    const src =
      H +
      `void marca(int v[]) {\n  v[1] = 5;\n}\nint main() {\n  int a[3] = {0, 0, 0};\n  marca(a);\n}`;
    const interp = new CInterpreter(src);
    const msgs: string[] = [];
    let a: Variable | undefined;
    for (let n = 0; n < 50 && !interp.state.finished; n++) {
      const ev = interp.step();
      if (ev?.message) msgs.push(ev.message);
      a = interp.state.variables.find((v) => v.name === "a");
      if (a && (a.value as number[])[1] === 5) break;
    }
    expect(a!.justChanged).toBe(true);
    expect(a!.lastIndex).toEqual([1]);
    expect(msgs.join("\n")).toMatch(/'v' é o próprio vetor 'a', não uma cópia/);
  });

  it("erros de passagem são explicados", () => {
    const err = (body: string) => run(H + body).state.error;
    expect(err(`void f(int v[]) {}\nint main() { int x = 1; f(x); }`)).toMatch(
      /espera um vetor em 'int v\[\]', mas recebeu 'x'/,
    );
    expect(err(`void f(int x) {}\nint main() { int a[3]; f(a); }`)).toMatch(
      /espera um int simples em 'x', mas recebeu o vetor 'a' inteiro/,
    );
    expect(err(`void f(int v[]) {}\nint main() { float a[3]; f(a); }`)).toMatch(
      /vetor de int.*'a' é um vetor de float/,
    );
    expect(err(`void f(int m[][2]) {}\nint main() { int m[2][3]; f(m); }`)).toMatch(
      /2 colunas.*'m' tem 3 colunas/,
    );
    expect(new CInterpreter(H + `void f(int m[][]) {}\nint main() {}`).state.error).toMatch(
      /falta o número de colunas/,
    );
  });
});

describe("Linguagem C — entrada (scanf)", () => {
  it("lê um inteiro e usa no cálculo", () => {
    const src = `#include <stdio.h>\nint main(){ int n; scanf("%d", &n); printf("%d", n * 2); }`;
    expect(out(src, ["21"])).toBe("42");
  });

  it("scanf com formato de outro tipo não executa", () => {
    const src = `#include <stdio.h>\nint main(){ float a; scanf("%d", &a); }`;
    expect(run(src, ["2"]).state.error).toMatch(/'%d'.*'a'.*float/);
  });

  it("scanf confere o formato de cada alvo separadamente", () => {
    const ok = `#include <stdio.h>\nint main(){ int a; float b; scanf("%d %f", &a, &b); printf("%d %.1f", a, b); }`;
    expect(out(ok, ["7", "2.5"])).toBe("7 2.5");
    const bad = `#include <stdio.h>\nint main(){ int a; float b; scanf("%d %d", &a, &b); }`;
    expect(run(bad, ["7", "2"]).state.error).toMatch(/'b'/);
  });

  it("scanf sem '&' não executa e explica o motivo", () => {
    const src = `#include <stdio.h>\nint main(){ float a; scanf("%f", a); }`;
    expect(run(src, ["2.5"]).state.error).toMatch(/Faltou o '&' antes de 'a'/);
  });

  it("vetor de char com %s é lido sem '&'", () => {
    const src = `#include <stdio.h>\nint main(){ char nome[20]; scanf("%s", nome); }`;
    expect(run(src, ["Ana"]).state.error).toBeFalsy();
  });

  it("%s guarda o texto letra por letra, fecha com '\\0' e o printf o lê de volta", () => {
    const src = `#include <stdio.h>\nint main() {\n\tchar a[10];\n\tscanf("%s",a);\n\tprintf("%s",a);\n}`;
    expect(out(src, ["ola"])).toBe("ola");

    const interp = new CInterpreter(src);
    while (!interp.state.awaitingInput) interp.step();
    interp.provideInput("ola");
    const a = interp.state.variables.find((v) => v.name === "a")!;
    expect((a.value as string[]).slice(0, 4)).toEqual(["o", "l", "a", "\0"]);
    expect((a.uninitCells as boolean[]).slice(0, 5)).toEqual([false, false, false, false, true]);
  });

  it("%s para no primeiro espaço, como em C", () => {
    const src = `#include <stdio.h>\nint main(){ char a[10]; scanf("%s", a); printf("[%s]", a); }`;
    expect(out(src, ["José Silva"])).toBe("[José]");
  });

  it("%s respeita largura e precisão do printf", () => {
    const src = `#include <stdio.h>\nint main(){ char a[10]; scanf("%s", &a); printf("[%5s|%-4s|%.1s]", a, a, a); }`;
    expect(out(src, ["ab"])).toBe("[   ab|ab  |a]");
  });

  it("texto maior que o vetor (contando o '\\0') não executa", () => {
    const src = `#include <stdio.h>\nint main(){ char a[4]; scanf("%s", a); }`;
    expect(run(src, ["abc"]).state.error).toBeFalsy();
    expect(run(src, ["abcd"]).state.error).toMatch(/4 letras.*char\[4\].*no máximo 3/);
  });

  it("linha de matriz de char funciona como texto (nomes[i])", () => {
    const src = `#include <stdio.h>\nint main(){ char nomes[3][8]; int i;\n for(i=0;i<3;i++) scanf("%s", nomes[i]);\n for(i=2;i>=0;i--) printf("%s ", nomes[i]);\n printf("%c", nomes[0][1]); }`;
    expect(out(src, ["ana", "bia", "caio"])).toBe("caio bia ana n");
  });

  it("posição de vetor exige o '&', como em C", () => {
    const ok = `#include <stdio.h>\nint main(){ int v[3]; scanf("%d", &v[0]); printf("%d", v[0]); }`;
    expect(out(ok, ["7"])).toBe("7");
    const bad = `#include <stdio.h>\nint main(){ int v[3]; scanf("%d", v[0]); }`;
    expect(run(bad, ["7"]).state.error).toMatch(/Faltou o '&'/);
  });

  it("lê duas variáveis em scanfs consecutivos", () => {
    const src = `#include <stdio.h>\nint main(){ int a; int b; scanf("%d", &a); scanf("%d", &b); printf("%d", a + b); }`;
    expect(out(src, ["10", "32"])).toBe("42");
  });
});

describe("scanf usado como expressão", () => {
  it("soma até o 0 com scanf dentro da condição do while", () => {
    const src = `#include <stdio.h>
int main() {
  int n, soma = 0;
  while (scanf("%d", &n) && n != 0) {
    soma += n;
  }
  printf("%d", soma);
}`;
    expect(out(src, ["10", "20", "12", "0"])).toBe("42");
  });

  it("devolve a quantidade de itens lidos, como em C", () => {
    const um = `#include <stdio.h>\nint main(){ int n; printf("%d", scanf("%d", &n)); }`;
    expect(out(um, ["7"])).toBe("1");
    const dois = `#include <stdio.h>\nint main(){ int a, b; printf("%d", scanf("%d %d", &a, &b)); }`;
    expect(out(dois, ["1", "2"])).toBe("2");
  });

  it("lê de novo a cada volta do laço", () => {
    const src = `#include <stdio.h>
int main() {
  int n;
  while (scanf("%d", &n) == 1 && n > 0) {
    printf("%d;", n);
  }
}`;
    expect(out(src, ["3", "2", "-1"])).toBe("3;2;");
  });

  it("vale também na condição do for e em atribuição", () => {
    const paraFor = `#include <stdio.h>
int main() {
  int n, total = 0;
  for (; scanf("%d", &n) && n > 0; ) {
    total += n;
  }
  printf("%d", total);
}`;
    expect(out(paraFor, ["5", "6", "0"])).toBe("11");
    const atrib = `#include <stdio.h>\nint main(){ int n, lidos; lidos = scanf("%d", &n); printf("%d-%d", lidos, n); }`;
    expect(out(atrib, ["9"])).toBe("1-9");
  });

  it("mantém as checagens do scanf comum (falta do '&')", () => {
    const src = `#include <stdio.h>\nint main(){ int n; while (scanf("%d", n)) { } }`;
    expect(run(src, ["1"]).state.error).toMatch(/Faltou o '&' antes de 'n'/);
  });

  it("if com scanf na condição executa o bloco certo", () => {
    const src = `#include <stdio.h>\nint main(){ int n; if (scanf("%d", &n) == 1) printf("li %d", n); else printf("nada"); }`;
    expect(out(src, ["4"])).toBe("li 4");
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

  it("'main' digitado errado é apontado como erro de digitação", () => {
    const interp = new CInterpreter(`#include <stdio.h>\nint mian(){ printf("oi"); }`);
    expect(interp.state.error).toMatch(/'mian'.*'main'/);
  });

  it("sem nenhum ponto de entrada, a mensagem cita main e setup/loop", () => {
    const interp = new CInterpreter(`#include <stdio.h>\nint soma(int a){ return a; }`);
    expect(interp.state.error).toMatch(/setup.*main|main.*setup/);
  });
});

describe("Redeclaração de variável", () => {
  it("declarar o mesmo nome duas vezes no bloco é erro", () => {
    const interp = new CInterpreter(
      `#include <stdio.h>\nint main(){\n  float c;\n  float c = 1.2;\n}`,
    );
    expect(interp.state.error).toMatch(/Variável 'c' já declarada/);
  });

  it("o erro aponta a linha da repetição, não a da primeira declaração", () => {
    const interp = new CInterpreter(
      `#include <stdio.h>\nint main(){\n  float c;\n  float c = 1.2;\n}`,
    );
    expect(interp.state.currentLine).toBe(4);
  });

  it("repetir o nome na mesma declaração também é erro", () => {
    expect(new CInterpreter(`int main(){ int a, a; }`).state.error).toMatch(/já declarada/);
  });

  it("parâmetro redeclarado no corpo da função é erro", () => {
    const interp = new CInterpreter(
      `#include <stdio.h>\nvoid f(int a){ int a = 2; }\nint main(){}`,
    );
    expect(interp.state.error).toMatch(/Variável 'a' já declarada/);
  });

  it("duas variáveis globais com o mesmo nome são erro", () => {
    expect(new CInterpreter(`int g;\nint g = 1;\nint main(){}`).state.error).toMatch(
      /já declarada/,
    );
  });

  // Casos legítimos: o mesmo nome em blocos diferentes é outra variável em C.
  it("declarar o mesmo nome em blocos irmãos é permitido", () => {
    const { state } = run(`#include <stdio.h>
int main(){
  if (1) { int t = 1; }
  while (0) { int t = 2; }
}`);
    expect(state.error).toBeNull();
  });

  it("local pode ter o mesmo nome de uma global (sombreamento)", () => {
    expect(out(`#include <stdio.h>\nint g = 5;\nint main(){ int g = 7; printf("%d", g); }`)).toBe(
      "7",
    );
  });

  it("mesma função declarando o nome em escopos diferentes (setup/loop)", () => {
    const { state } = run(`void setup(){ int a = 1; }\nvoid loop(){ int a = 2; }`, [], 60);
    expect(state.error).toBeNull();
  });

  it("declaração dentro de laço vale por iteração e não congela o valor", () => {
    // Antes, cada iteração empilhava uma variável nova e a leitura pegava a
    // primeira — 'x' ficava travado no valor da 1ª volta.
    expect(
      out(`#include <stdio.h>
int main(){
  for (int i = 0; i < 3; i++) { int x = i * 2; printf("%d ", x); }
}`),
    ).toBe("0 2 4");
  });
});

describe("Quantidade de identificadores de formato x argumentos", () => {
  it("printf com mais identificadores que argumentos é erro", () => {
    const interp = new CInterpreter(
      `#include <stdio.h>\nint main(){\n  int a = 1;\n  printf("%d %d %d", a, a);\n}`,
    );
    expect(interp.state.error).toMatch(/printf da linha 4: o formato pede 3 valores/);
    expect(interp.state.currentLine).toBe(4);
  });

  it("printf com argumentos sobrando também é erro", () => {
    const interp = new CInterpreter(
      `#include <stdio.h>\nint main(){ int a=1, b=2; printf("%d", a, b); }`,
    );
    expect(interp.state.error).toMatch(/1 argumento ficaria ignorado/);
  });

  it("printf sem nenhum argumento para o identificador", () => {
    const interp = new CInterpreter(`#include <stdio.h>\nint main(){ printf("%d\\n"); }`);
    expect(interp.state.error).toMatch(/nenhum foi passado/);
  });

  it("scanf com menos variáveis que identificadores é erro", () => {
    const interp = new CInterpreter(
      `#include <stdio.h>\nint main(){ int a, b; scanf("%d %d", &a); }`,
    );
    expect(interp.state.error).toMatch(/scanf da linha 2: o formato pede 2 variáveis/);
  });

  it("acusa também dentro de blocos aninhados", () => {
    const interp = new CInterpreter(
      `#include <stdio.h>\nint main(){ int x = 1; if (x) { printf("%d %d", x); } }`,
    );
    expect(interp.state.error).toMatch(/o formato pede 2 valores/);
  });

  // Casos legítimos.
  it("'%%' não consome argumento", () => {
    expect(out(`#include <stdio.h>\nint main(){ int a=1; printf("100%% de %d", a); }`)).toBe(
      "100% de 1",
    );
  });

  it("chamadas de função como argumento contam uma vez cada", () => {
    const src = `#include <stdio.h>
int soma(int a, int b){ return a + b; }
int main(){ printf("%d %d", soma(1, 2), soma(3, 4)); }`;
    expect(out(src)).toBe("3 7");
  });

  it("largura por argumento ('%*d') desativa a checagem", () => {
    const { state } = run(`#include <stdio.h>\nint main(){ printf("%*d", 5, 42); }`);
    expect(state.error).toBeNull();
  });

  it("'%' literal num Serial.print não é contado nem impresso como formato", () => {
    const { state, serial } = run(
      `void setup(){ Serial.begin(9600); Serial.println("100% pronto"); }\nvoid loop(){}`,
      [],
      60,
    );
    expect(state.error).toBeNull();
    expect(serial.trim()).toBe("100% pronto");
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

describe("Variáveis sem valor inicial", () => {
  /**
   * Último estado de uma variável enquanto ela existiu — as locais são descartadas
   * quando a função retorna, então não dá para inspecioná-las no fim da execução.
   */
  function track(src: string, name: string, inputs: string[] = [], maxSteps = 2000) {
    const interp = new CInterpreter(src);
    let last: Variable | undefined;
    let steps = 0;
    let inputIdx = 0;
    while (!interp.state.finished && !interp.state.error && steps < maxSteps) {
      if (interp.state.awaitingInput) interp.provideInput(inputs[inputIdx++] ?? "0");
      else interp.step();
      const v = interp.state.variables.find((vv) => vv.name === name);
      if (v) last = { ...v };
      steps++;
    }
    return last;
  }

  it("declaração sem inicializador marca a variável como sem valor", () => {
    expect(track(`#include <stdio.h>\nint main(){ int x; return 0; }`, "x")?.uninit).toBe(true);
  });

  it("declaração com inicializador não é marcada", () => {
    expect(track(`#include <stdio.h>\nint main(){ int x = 5; return 0; }`, "x")?.uninit).toBe(
      false,
    );
  });

  it("a marcação some após a primeira atribuição", () => {
    const v = track(`#include <stdio.h>\nint main(){ int x; x = 3; return 0; }`, "x");
    expect(v?.uninit).toBe(false);
    expect(v?.value).toBe(3);
  });

  it("scanf também tira a marcação", () => {
    const v = track(`#include <stdio.h>\nint main(){ int x; scanf("%d", &x); return 0; }`, "x", [
      "9",
    ]);
    expect(v?.uninit).toBe(false);
    expect(v?.value).toBe(9);
  });

  it("parâmetro de função recebe o argumento e não fica sem valor", () => {
    const v = track(
      `#include <stdio.h>\nint dobro(int n){ return n * 2; }\nint main(){ printf("%d", dobro(4)); }`,
      "n",
    );
    expect(v?.uninit).toBeFalsy();
    expect(v?.value).toBe(4);
  });

  it("vetor sem inicializador tem as células ainda não escritas sem valor", () => {
    const v = track(`#include <stdio.h>\nint main(){ int v[3]; v[1] = 8; return 0; }`, "v");
    expect(v?.uninitCells).toEqual([true, false, true]);
  });

  it("inicializador parcial zera o resto (nenhuma célula fica sem valor)", () => {
    const v = track(`#include <stdio.h>\nint main(){ int v[3] = {1, 2}; return 0; }`, "v");
    expect(v?.uninitCells).toBeUndefined();
  });

  it("matriz sem inicializador marca só a célula escrita como preenchida", () => {
    const v = track(`#include <stdio.h>\nint main(){ int m[2][2]; m[0][1] = 7; return 0; }`, "m");
    expect(v?.uninitCells).toEqual([
      [true, false],
      [true, true],
    ]);
  });
});
