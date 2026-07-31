/**
 * Varredura leve do código-fonte, compartilhada pela análise estática
 * (`code-warnings.ts`) e pelo interpretador (`c-interpreter.ts`).
 *
 * Aqui ficam apenas checagens que dependem do TEXTO original — antes de
 * qualquer pré-processamento — como descobrir se uma função de biblioteca foi
 * usada sem o `#include` correspondente.
 */

const COMMENT_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/** Substitui comentários por espaços, preservando linhas e colunas. */
export function stripComments(src: string): string {
  return src.replace(COMMENT_RE, (m) => m.replace(/[^\n]/g, " "));
}

/** Substitui literais de string e char por espaços, preservando linhas e colunas. */
export function stripStrings(src: string): string {
  return src.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * Função da biblioteca padrão → cabeçalho que a declara.
 * Cobre apenas o que um aluno usa nas primeiras aulas; funções fora desta
 * tabela seguem o caminho normal ("função não definida").
 */
export const LIBRARY_FUNCTIONS: Record<string, string> = {
  // <stdio.h> — entrada e saída padrão
  printf: "stdio.h",
  scanf: "stdio.h",
  puts: "stdio.h",
  putchar: "stdio.h",
  getchar: "stdio.h",
  gets: "stdio.h",
  sprintf: "stdio.h",
  fgets: "stdio.h",
  // <math.h> — funções matemáticas
  sqrt: "math.h",
  pow: "math.h",
  fabs: "math.h",
  ceil: "math.h",
  floor: "math.h",
  exp: "math.h",
  log: "math.h",
  log10: "math.h",
  sin: "math.h",
  cos: "math.h",
  tan: "math.h",
  asin: "math.h",
  acos: "math.h",
  atan: "math.h",
  fmod: "math.h",
  // <string.h> — manipulação de texto
  strlen: "string.h",
  strcpy: "string.h",
  strncpy: "string.h",
  strcat: "string.h",
  strncat: "string.h",
  strcmp: "string.h",
  strncmp: "string.h",
  strchr: "string.h",
  strstr: "string.h",
};

export interface MissingInclude {
  /** Nome da função usada. */
  fn: string;
  /** Cabeçalho que deveria ter sido incluído (ex.: "stdio.h"). */
  header: string;
  /** Linha (1-based) da primeira ocorrência. */
  line: number;
}

function lineOf(src: string, idx: number): number {
  let ln = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") ln++;
  return ln;
}

/**
 * Toda linha que o aluno claramente quis que fosse um `#include`, com o nome da
 * biblioteca extraído.
 *
 * Tolerante de propósito: aceita `#` ausente e delimitadores faltando, para que
 * `#include <stdio.h` (sem o '>') ainda conte como "stdio.h foi incluída" — o
 * problema real dessa linha é reportado por `findMalformedIncludes`, e seria
 * confuso acusar também que falta incluir stdio.h.
 *
 * Recebe o fonte só com os COMENTÁRIOS removidos, nunca com as strings: em
 * `#include "stdio.h"` o nome está entre aspas e seria apagado. A âncora `^` é
 * o que evita confundir um `printf("#include <x>")` com uma diretiva de verdade.
 */
const INCLUDE_RE = /^[ \t]*(#[ \t]*)?include\b[ \t]*([<"])?[ \t]*([A-Za-z0-9_./\\+-]+)?/gm;

function collectIncludes(commentStripped: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  INCLUDE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INCLUDE_RE.exec(commentStripped)) !== null) {
    if (m[3]) out.push({ name: m[3].trim(), line: lineOf(commentStripped, m.index) });
  }
  return out;
}

/**
 * Verdadeiro para linhas que são (ou tentam ser) uma diretiva de inclusão,
 * inclusive sem o `#`. As outras análises usam isto para não tratar a linha
 * como código C e empilhar avisos irrelevantes em cima do erro real.
 */
export function isIncludeLine(line: string): boolean {
  return /^[ \t]*(#[ \t]*)?include\b/.test(line);
}

export interface MalformedInclude {
  /** Linha (1-based) da diretiva. */
  line: number;
  /** O que está errado, em uma frase (sem citar a linha). */
  problem: string;
  /** Como a linha deveria ficar, ex.: `#include <stdio.h>`. */
  fix: string;
}

/**
 * Diretivas `#include` escritas com erro de sintaxe: sem o `#`, sem fechar o
 * `>` ou as aspas, sem delimitador ou sem nome de biblioteca.
 *
 * Precisa rodar ANTES do tokenizer: sem o `#`, a linha vira expressão solta e o
 * parser falha com "Token inesperado", que não ajuda o aluno em nada.
 */
export function findMalformedIncludes(source: string): MalformedInclude[] {
  const out: MalformedInclude[] = [];
  stripComments(source)
    .split("\n")
    .forEach((line, i) => {
      const m = line.match(/^[ \t]*(#[ \t]*)?include\b[ \t]*(.*)$/);
      if (!m) return;
      const hasHash = !!m[1];
      const rest = m[2].trim();
      const opener = rest[0];
      const name = rest
        .replace(/^[<"]/, "")
        .replace(/[>"].*$/, "")
        .trim();
      const fix = `#include <${name || "stdio.h"}>`;
      const push = (problem: string) => out.push({ line: i + 1, problem, fix });

      if (rest === "") return push("Falta o nome da biblioteca depois de 'include'.");
      if (opener !== "<" && opener !== '"')
        return push("O nome da biblioteca precisa vir entre '<' e '>'.");
      const closer = opener === "<" ? ">" : '"';
      if (!rest.slice(1).includes(closer))
        return push(
          opener === "<"
            ? "Falta o '>' para fechar o nome da biblioteca."
            : 'Falta a aspas (") para fechar o nome da biblioteca.',
        );
      if (!hasHash) return push("Falta o '#' antes de 'include'.");
    });
  return out;
}

/**
 * Cabeçalhos que o sistema reconhece como existentes.
 * A lista não precisa ser exaustiva: um nome desconhecido só vira aviso quando
 * é muito parecido com um destes (provável erro de digitação). Bibliotecas de
 * terceiros não listadas passam sem reclamação.
 */
const KNOWN_HEADERS = new Set(
  [
    // Biblioteca padrão de C
    "assert.h",
    "complex.h",
    "ctype.h",
    "errno.h",
    "fenv.h",
    "float.h",
    "inttypes.h",
    "iso646.h",
    "limits.h",
    "locale.h",
    "math.h",
    "setjmp.h",
    "signal.h",
    "stdalign.h",
    "stdarg.h",
    "stdatomic.h",
    "stdbool.h",
    "stddef.h",
    "stdint.h",
    "stdio.h",
    "stdlib.h",
    "stdnoreturn.h",
    "string.h",
    "tgmath.h",
    "threads.h",
    "time.h",
    "uchar.h",
    "wchar.h",
    "wctype.h",
    // Arduino — núcleo e bibliotecas comuns.
    // Uma biblioteca de terceiros parecida com um cabeçalho padrão PRECISA estar
    // aqui, senão vira falso positivo (ex.: "Timer.h" seria acusado de ser
    // "time.h" digitado errado). Se aparecer um caso novo, basta acrescentá-lo.
    "arduino.h",
    "wire.h",
    "spi.h",
    "eeprom.h",
    "servo.h",
    "softwareserial.h",
    "softwarewire.h",
    "liquidcrystal.h",
    "liquidcrystal_i2c.h",
    "dht.h",
    "dht_u.h",
    "adafruit_sensor.h",
    "adafruit_gfx.h",
    "adafruit_ssd1306.h",
    "adafruit_neopixel.h",
    "sd.h",
    "stepper.h",
    "accelstepper.h",
    "wifi.h",
    "esp8266wifi.h",
    "ethernet.h",
    "pubsubclient.h",
    "onewire.h",
    "dallastemperature.h",
    "keypad.h",
    "irremote.h",
    "timer.h",
    "simpletimer.h",
    "tone.h",
    "bounce2.h",
    "onebutton.h",
    "encoder.h",
    "rtclib.h",
    "ds1307.h",
    "ds3231.h",
    "ultrasonic.h",
    "newping.h",
    "hcsr04.h",
    "mfrc522.h",
    "fastled.h",
    "u8g2lib.h",
    "tinygps.h",
    "rf24.h",
    "virtualwire.h",
  ].map((h) => h.toLowerCase()),
);

/** Verdadeiro se `a` e `b` têm exatamente os mesmos caracteres fora de ordem. */
function isAnagram(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return [...a].sort().join("") === [...b].sort().join("");
}

/** Verdadeiro se `a` vira `b` com no máximo uma inserção, remoção ou troca. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diffs = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diffs > 1) return false;
    return diffs === 1;
  }
  // Comprimentos diferem em 1: o menor deve ser o maior sem um caractere.
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
    } else {
      if (skipped) return false;
      skipped = true;
      j++;
    }
  }
  return true;
}

export interface UnknownInclude {
  /** Nome do cabeçalho como o aluno digitou (ex.: "sdtio.h"). */
  name: string;
  /** Cabeçalho real mais provável (ex.: "stdio.h"). */
  suggestion: string;
  /** Linha (1-based) da diretiva. */
  line: number;
}

/**
 * Lista `#include` cujo nome não existe mas é muito parecido com um cabeçalho
 * conhecido — ou seja, quase certamente erro de digitação.
 *
 * Só reporta quando há um candidato claro (erro de ordem das letras, uma letra
 * a mais/a menos/trocada, ou falta do ".h"). Cabeçalhos simplesmente
 * desconhecidos são ignorados, para não acusar bibliotecas de terceiros.
 */
export function findUnknownIncludes(source: string): UnknownInclude[] {
  const out: UnknownInclude[] = [];
  for (const inc of collectIncludes(stripComments(source))) {
    const lower = inc.name.toLowerCase();
    if (KNOWN_HEADERS.has(lower)) continue;
    // Esqueceu o ".h"? Ex.: #include <stdio>
    if (KNOWN_HEADERS.has(lower + ".h")) {
      out.push({ name: inc.name, suggestion: lower + ".h", line: inc.line });
      continue;
    }
    const match = [...KNOWN_HEADERS].find((h) => isAnagram(lower, h) || withinOneEdit(lower, h));
    if (match) out.push({ name: inc.name, suggestion: match, line: inc.line });
  }
  return out;
}

/**
 * Lista funções de biblioteca usadas sem o `#include` correspondente,
 * uma entrada por função, ordenadas pela linha de uso.
 *
 * Deve receber o fonte ORIGINAL: o pré-processamento converte `Serial.print`
 * em `printf`, o que geraria um falso positivo em sketches Arduino.
 */
export function findMissingIncludes(source: string): MissingInclude[] {
  const noComments = stripComments(source);
  const cleaned = stripStrings(noComments);

  // Cabeçalhos já incluídos. Lidos do fonte SEM as strings removidas, senão
  // `#include "stdio.h"` (forma válida em C) seria apagado e daria falso alarme.
  const included = new Set(collectIncludes(noComments).map((i) => i.name.toLowerCase()));

  // Uma função definida pelo próprio aluno tem precedência sobre a da biblioteca.
  const userDefined = new Set<string>();
  let m: RegExpExecArray | null;
  const defRe = /\b(?:[A-Za-z_]\w*[ \t*]+)+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/g;
  while ((m = defRe.exec(cleaned)) !== null) userDefined.add(m[1]);

  const missing: MissingInclude[] = [];
  const seen = new Set<string>();
  const callRe = /\b([A-Za-z_]\w*)\s*\(/g;
  while ((m = callRe.exec(cleaned)) !== null) {
    const fn = m[1];
    const header = LIBRARY_FUNCTIONS[fn];
    if (!header || included.has(header) || userDefined.has(fn) || seen.has(fn)) continue;
    seen.add(fn);
    missing.push({ fn, header, line: lineOf(cleaned, m.index) });
  }
  return missing.sort((a, b) => a.line - b.line);
}
