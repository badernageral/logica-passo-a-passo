import { describe, it, expect } from "vitest";
import { formatPrintf } from "./printf-format";

/** Formata com os argumentos dados, na ordem. Os esperados foram conferidos com o gcc. */
function f(fmt: string, ...args: (number | string)[]): string {
  let i = 0;
  return formatPrintf(fmt, () => args[i++]);
}

describe("printf — precisão", () => {
  it("%.2f arredonda para duas casas", () => {
    expect(f("%.2f", 3.14159)).toBe("3.14");
    expect(f("%.2f", 10)).toBe("10.00");
  });

  it("%f sem precisão usa seis casas", () => {
    expect(f("%f", 1.5)).toBe("1.500000");
    expect(f("%lf", 1.5)).toBe("1.500000");
    expect(f("%.2lf", 1.5)).toBe("1.50");
  });

  it("%.0f e %.f não imprimem casas decimais", () => {
    expect(f("%.0f", 2.7)).toBe("3");
    expect(f("%.f", 2.7)).toBe("3");
  });

  it("empate arredonda para o dígito par, como no C", () => {
    expect(f("%.0f", 2.5)).toBe("2");
    expect(f("%.0f", 3.5)).toBe("4");
    expect(f("%.1f", 2.25)).toBe("2.2");
    expect(f("%.2f", 0.125)).toBe("0.12");
  });

  it("%.2f de um valor negativo mantém o sinal", () => {
    expect(f("%.2f", -3.14159)).toBe("-3.14");
  });

  it("%.3s corta a string", () => {
    expect(f("%.2s", "abcdef")).toBe("ab");
  });

  it("%.3d completa com zeros à esquerda", () => {
    expect(f("%.3d", 7)).toBe("007");
  });
});

describe("printf — largura e flags", () => {
  it("largura alinha à direita e '-' à esquerda", () => {
    expect(f("%8.3f", -3.14159)).toBe("  -3.142");
    expect(f("%-8.3f", 3.14159)).toBe("3.142   ");
    expect(f("%5s|", "abc")).toBe("  abc|");
    expect(f("%-5s|", "abc")).toBe("abc  |");
  });

  it("'0' preenche com zeros e respeita o sinal", () => {
    expect(f("%05d", 42)).toBe("00042");
    expect(f("%08.3f", -3.14159)).toBe("-003.142");
  });

  it("'+' e ' ' controlam o sinal dos positivos", () => {
    expect(f("%+d", 42)).toBe("+42");
    expect(f("% d", 42)).toBe(" 42");
  });

  it("largura e precisão por '*' consomem argumentos", () => {
    expect(f("%*d", 5, 42)).toBe("   42");
    expect(f("%-*d|", 5, 42)).toBe("42   |");
    expect(f("%.*f", 3, 3.14159)).toBe("3.142");
  });
});

describe("printf — conversões", () => {
  it("%d trunca e %c/%s continuam funcionando", () => {
    expect(f("%d", 3.99)).toBe("3");
    expect(f("%c", "A")).toBe("A");
    expect(f("%c", 65)).toBe("A");
    expect(f("%s", "oi")).toBe("oi");
  });

  it("%d de um char mostra o código ASCII", () => {
    expect(f("%d", "A")).toBe("65");
  });

  it("%x, %X e %o usam complemento de dois nos negativos", () => {
    expect(f("%x", 255)).toBe("ff");
    expect(f("%X", 255)).toBe("FF");
    expect(f("%#x", 255)).toBe("0xff");
    expect(f("%o", 8)).toBe("10");
    expect(f("%#o", 8)).toBe("010");
    expect(f("%x", -78888)).toBe("fffecbd8");
    expect(f("%u", -1)).toBe("4294967295");
  });

  it("%e e %g seguem o formato do C", () => {
    expect(f("%e", 12345.6789)).toBe("1.234568e+04");
    expect(f("%E", 12345.6789)).toBe("1.234568E+04");
    expect(f("%.2e", 12345.6789)).toBe("1.23e+04");
    expect(f("%g", 100000)).toBe("100000");
    expect(f("%g", 1000000)).toBe("1e+06");
    expect(f("%g", 0.0001)).toBe("0.0001");
    expect(f("%.3g", 3.14159)).toBe("3.14");
    expect(f("%.1g", 9.995)).toBe("1e+01");
  });

  it("%% imprime um por cento literal", () => {
    expect(f("%d%%", 50)).toBe("50%");
  });

  it("um '%' solto ou desconhecido sai como está", () => {
    expect(f("100%")).toBe("100%");
    expect(f("%q", 1)).toBe("%q");
  });
});

describe("printf — texto ao redor", () => {
  it("mistura texto, especificadores e quebras de linha", () => {
    expect(f("Media: %.2f pontos\n", 8.456)).toBe("Media: 8.46 pontos\n");
    expect(f("%d + %d = %d", 2, 3, 5)).toBe("2 + 3 = 5");
  });
});
