import type { Directive } from "./interpreter-types";
import { KEYWORDS } from "./interpreter-lex";

export function describeDirective(d: Directive): string {
  const name = d.name.toLowerCase();
  if (name === "stdio.h")
    return "Incluindo a biblioteca <stdio.h> — necessária para usar printf e scanf (entrada e saída padrão).";
  if (name === "stdlib.h")
    return "Incluindo a biblioteca <stdlib.h> — funções utilitárias (malloc, free, rand, exit, etc.).";
  if (name === "string.h")
    return "Incluindo a biblioteca <string.h> — funções para manipulação de strings (strlen, strcpy, strcmp, etc.).";
  if (name === "math.h")
    return "Incluindo a biblioteca <math.h> — funções matemáticas (sqrt, pow, sin, cos, etc.).";
  if (d.text.trim().startsWith("#include"))
    return `Incluindo a biblioteca '${d.name}' no programa.`;
  if (d.text.trim().startsWith("#define")) return `Diretiva do pré-processador: ${d.text.trim()}`;
  return `Diretiva do pré-processador: ${d.text.trim()}`;
}

/** Funções nativas do "ambiente Arduino" reconhecidas pelo interpretador. */
const ARDUINO_BUILTINS = new Set([
  "digitalRead",
  "analogRead",
  "digitalWrite",
  "analogWrite",
  "pinMode",
  "delay",
  "delayMicroseconds",
  "millis",
  "micros",
  "Serial_begin", // não usado, placeholder
]);

/**
 * Transforma declarações com tipos de biblioteca desconhecidos antes do parser.
 *
 * - Construtor com primeiro argumento numérico (pin):
 *     DHT_Unified dht(8, DHT11);  →  pinMode(8, INPUT);   (cria card do pino)
 * - Qualquer outro (struct sem pino, etc.):
 *     sensors_event_t temperatura;  →  apagado (espaços)
 *
 * Preserva comprimento da linha para manter numeração de linhas intacta.
 */
export function preprocessLibraryTypeDeclarations(src: string): string {
  const KNOWN_TYPES = new Set([
    "int",
    "float",
    "double",
    "char",
    "void",
    "long",
    "short",
    "unsigned",
    "signed",
    "bool",
    "byte",
    "boolean",
    "String",
  ]);
  const C_KEYWORDS = new Set([
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "default",
    "break",
    "continue",
    "return",
    "struct",
    "typedef",
    "enum",
    "union",
    "const",
    "static",
    "extern",
    "volatile",
    "sizeof",
    "printf",
    "scanf",
    "Serial",
    "pinMode",
    "digitalWrite",
    "digitalRead",
    "analogRead",
    "analogWrite",
    "delay",
    "millis",
    "micros",
    "map",
    "setup",
    "loop",
    "main",
  ]);
  const findMatchingParen = (s: string, openIdx: number): number => {
    let depth = 0;
    for (let i = openIdx; i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'") {
        const q = c;
        i++;
        while (i < s.length && s[i] !== q) {
          if (s[i] === "\\") i++;
          i++;
        }
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  };
  const pad = (content: string, targetLen: number, nls: number) =>
    content + " ".repeat(Math.max(0, targetLen - content.length - nls)) + "\n".repeat(nls);

  const re = /^([ \t]*)([A-Za-z_]\w*)([ \t]+)([A-Za-z_]\w*)([ \t]*)([;(])/gm;
  let out = src;
  let match: RegExpExecArray | null;
  while ((match = re.exec(out)) !== null) {
    const typeName = match[2];
    if (KNOWN_TYPES.has(typeName) || C_KEYWORDS.has(typeName)) continue;
    const startIdx = match.index;
    let endIdx: number;
    let firstArg = "";

    if (match[6] === ";") {
      endIdx = match.index + match[0].length;
    } else {
      const openParen = match.index + match[0].length - 1;
      const closeParen = findMatchingParen(out, openParen);
      if (closeParen < 0) continue;
      const args = out.slice(openParen + 1, closeParen);
      firstArg = args.split(",")[0].trim();
      endIdx = closeParen + 1;
      while (endIdx < out.length && out[endIdx] === " ") endIdx++;
      if (endIdx < out.length && out[endIdx] === ";") endIdx++;
    }

    const original = out.slice(startIdx, endIdx);
    const nls = (original.match(/\n/g) || []).length;
    let replacement: string;

    if (match[6] === ";") {
      // Declaração simples sem construtor: cria variável float para cards de memória
      const content = `${match[1]}float ${match[4]};`;
      replacement = pad(content, original.length, nls);
    } else if (/^\d+$/.test(firstArg)) {
      // Construtor com número de pino → cria card via pinMode
      const content = `${match[1]}pinMode(${firstArg}, INPUT);`;
      replacement = pad(content, original.length, nls);
    } else {
      replacement = original.replace(/[^\n]/g, " ");
    }

    out = out.slice(0, startIdx) + replacement + out.slice(endIdx);
    re.lastIndex = startIdx + replacement.length;
  }
  return out;
}

/**
 * Converte chamadas getEvent(&var) em scanf para simular leitura de sensor.
 *   dht.temperature().getEvent(&temperatura);  →  scanf("%f", &temperatura);
 * Deve rodar antes de preprocessLibraryMethodCalls.
 */
export function preprocessGetEvent(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      const m = line.match(/^([ \t]*).*\.getEvent\s*\(\s*&\s*([A-Za-z_]\w*)\s*\)([ \t]*;?)[ \t]*$/);
      if (!m) return line;
      const [, indent, varName, semi] = m;
      const content = `${indent}scanf("%f", &${varName})${semi || ""}`;
      return content.padEnd(line.length, " ");
    })
    .join("\n");
}

/**
 * Reescreve chamadas Arduino do tipo Serial.* para equivalentes que o
 * interpretador entende, preservando a numeração de linhas (não inserimos
 * nem removemos quebras de linha).
 *  - Serial.begin(...)        => espaços em branco (no-op)
 *  - Serial.print(arg)        => printf("%s", arg)
 *  - Serial.println(arg)      => printf("%s\n", arg)
 *  - Serial.println()         => printf("\n")
 *  - Serial.print("texto")    => printf("texto")  (mantém literal)
 *  - Serial.println("texto")  => printf("texto\n")
 */
export function preprocessArduinoSerial(src: string): { source: string; beginLines: Set<number> } {
  // Encontra o índice do ')' que casa com o '(' em src[openIdx],
  // respeitando strings "..." e caracteres '...'.
  const findMatchingParen = (s: string, openIdx: number): number => {
    let depth = 0;
    for (let i = openIdx; i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'") {
        const quote = c;
        i++;
        while (i < s.length && s[i] !== quote) {
          if (s[i] === "\\") i++;
          i++;
        }
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  };

  // Mantém o mesmo número de caracteres de uma região, substituindo por espaços
  // para preservar colunas/linhas dos demais tokens.
  const blank = (n: number) => " ".repeat(n);

  // Calcula a linha (1-based) de um índice no fonte.
  const lineOf = (s: string, idx: number) => {
    let ln = 1;
    for (let i = 0; i < idx && i < s.length; i++) if (s[i] === "\n") ln++;
    return ln;
  };

  let out = src;
  const beginLines = new Set<number>();
  // método -> transformação do conteúdo entre parênteses
  const methods: Array<{ name: string; transform: (arg: string) => string; track?: boolean }> = [
    { name: "begin", transform: () => "0", track: true }, // Serial.begin(...); vira "0;" (no-op válido)
    {
      name: "println",
      transform: (arg) => {
        const t = arg.trim();
        if (t === "") return `printf("\\n")`;
        // Se já é uma string literal "..." sem vírgulas, concatena \n dentro.
        if (/^"(?:[^"\\]|\\.)*"$/.test(t)) {
          // remove a aspas final, adiciona \n, recoloca aspas
          return `printf(${t.slice(0, -1)}\\n")`;
        }
        return `printf("%s\\n", ${arg})`;
      },
    },
    {
      name: "print",
      transform: (arg) => {
        const t = arg.trim();
        if (t === "") return `printf("")`;
        if (/^"(?:[^"\\]|\\.)*"$/.test(t)) return `printf(${t})`;
        return `printf("%s", ${arg})`;
      },
    },
  ];

  for (const m of methods) {
    const re = new RegExp(`\\bSerial\\s*\\.\\s*${m.name}\\s*\\(`, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(out)) !== null) {
      const startIdx = match.index;
      const openParen = match.index + match[0].length - 1;
      const closeParen = findMatchingParen(out, openParen);
      if (closeParen < 0) break;
      if (m.track) beginLines.add(lineOf(out, startIdx));
      const argStr = out.slice(openParen + 1, closeParen);
      const replacement = m.transform(argStr);
      const original = out.slice(startIdx, closeParen + 1);
      const newlinesInOriginal = (original.match(/\n/g) || []).length;
      let padded = replacement;
      if (newlinesInOriginal > 0 && !/\n/.test(replacement)) {
        padded = replacement + "\n".repeat(newlinesInOriginal);
      }
      if (padded.length < original.length) {
        padded = padded + blank(original.length - padded.length);
      }
      out = out.slice(0, startIdx) + padded + out.slice(closeParen + 1);
      re.lastIndex = startIdx + padded.length;
    }
  }
  return { source: out, beginLines };
}

/**
 * Reescreve chamadas de método em objetos de biblioteca (não-Serial) para '0',
 * incluindo cadeias como dht.temperature().getEvent(&t).
 * Preserva a contagem de linhas substituindo por espaços de mesmo comprimento.
 */
export function preprocessLibraryMethodCalls(src: string): string {
  const findMatchingParen = (s: string, openIdx: number): number => {
    let depth = 0;
    for (let i = openIdx; i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'") {
        const q = c;
        i++;
        while (i < s.length && s[i] !== q) {
          if (s[i] === "\\") i++;
          i++;
        }
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  };
  const re = /\b([A-Za-z_]\w*)\s*\.\s*[A-Za-z_]\w*\s*\(/g;
  let out = src;
  let match: RegExpExecArray | null;
  while ((match = re.exec(out)) !== null) {
    if (match[1] === "Serial") continue;
    const startIdx = match.index;
    const openParen = match.index + match[0].length - 1;
    const close = findMatchingParen(out, openParen);
    if (close < 0) continue;
    let endIdx = close + 1;
    // estender para chamadas encadeadas: .metodo(...)
    let chain: RegExpMatchArray | null;
    while ((chain = out.slice(endIdx).match(/^\s*\.\s*[A-Za-z_]\w*\s*\(/))) {
      const chainOpen = endIdx + chain[0].length - 1;
      const chainClose = findMatchingParen(out, chainOpen);
      if (chainClose < 0) break;
      endIdx = chainClose + 1;
    }
    const original = out.slice(startIdx, endIdx);
    const nls = (original.match(/\n/g) || []).length;
    const replacement = "0" + " ".repeat(original.length - 1 - nls) + "\n".repeat(nls);
    out = out.slice(0, startIdx) + replacement + out.slice(endIdx);
    re.lastIndex = startIdx + replacement.length;
  }
  return out;
}

/**
 * Reescreve acessos a campos de structs de biblioteca (ex.: temperatura.temperature)
 * para '0', preservando comprimento da linha.
 * Roda após preprocessLibraryMethodCalls para não conflitar com chamadas de método.
 */
export function preprocessStructMemberAccess(src: string): string {
  // Processa linha a linha para não tocar em diretivas #include (ex.: DHT_U.h)
  return src
    .split("\n")
    .map((line) => {
      if (/^\s*#/.test(line)) return line;
      return line.replace(/\b([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)(?!\s*\()/g, (match, obj) => {
        if (obj === "Serial") return match;
        // Retorna o próprio objeto (ex.: temperatura.temperature → temperatura)
        // para que variáveis de sensor declaradas como float sejam usadas corretamente.
        return obj + " ".repeat(match.length - obj.length);
      });
    })
    .join("\n");
}

/**
 * Conta '{' e '}' fora de strings, chars e comentários.
 * Usado para detectar chaves desbalanceadas com mensagem clara.
 */
export function checkBraceBalance(src: string): { open: number; close: number } {
  let open = 0,
    close = 0;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    // comentário de linha
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    // comentário de bloco
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // string
    if (c === '"') {
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < n) i += 2;
        else i++;
      }
      i++;
      continue;
    }
    // char literal
    if (c === "'") {
      i++;
      while (i < n && src[i] !== "'") {
        if (src[i] === "\\" && i + 1 < n) i += 2;
        else i++;
      }
      i++;
      continue;
    }
    if (c === "{") open++;
    else if (c === "}") close++;
    i++;
  }
  return { open, close };
}
