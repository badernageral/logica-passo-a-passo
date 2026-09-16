/**
 * Análise estática leve do código para destacar erros pedagógicos comuns
 * ANTES da execução. Não substitui o interpretador — apenas alerta o aluno
 * sobre padrões frequentes de erro.
 */

import {
  stripComments,
  stripStrings,
  findMissingIncludes,
  findUnknownIncludes,
  findMalformedIncludes,
  isIncludeLine,
  LIBRARY_FUNCTIONS,
  withinOneEdit,
  isAnagram,
} from "./source-scan";
import { BUILTIN_NAMES } from "./c-builtins";
import { conversionsOf, formatMismatch, kindOfType } from "./format-types";

export interface CodeWarning {
  line: number;
  message: string;
  severity: "warning" | "info";
}

export function analyzeCode(code: string, mode: "arduino" | "c" = "arduino"): CodeWarning[] {
  const warnings: CodeWarning[] = [];
  const cleaned = stripStrings(stripComments(code));
  const lines = cleaned.split("\n");
  const rawLines = code.split("\n");

  // 0) Problemas de #include. Vêm primeiro de propósito: são os erros mais
  // fundamentais e, no fim da lista, seriam cortados pelo slice(0, 8) em
  // códigos com muitos outros problemas. A ordem entre eles vai da causa raiz
  // para a consequência: sintaxe da diretiva → nome inexistente → falta incluir.

  // 0a) Diretiva mal escrita: sem '#', sem fechar '>'/aspas, sem nome.
  for (const bad of findMalformedIncludes(code)) {
    warnings.push({
      line: bad.line,
      severity: "warning",
      message: `${bad.problem} O correto é '${bad.fix}'.`,
    });
  }

  // 0b) Nome de biblioteca digitado errado (ex.: <sdtio.h>).
  for (const unk of findUnknownIncludes(code)) {
    warnings.push({
      line: unk.line,
      severity: "warning",
      message: `A biblioteca '${unk.name}' não existe. Você quis dizer '${unk.suggestion}'? Confira a digitação no '#include'.`,
    });
  }

  // 0c) Função de biblioteca usada sem o #include correspondente. Não depende
  // do seletor de modo — qualquer 'printf' escrito no código exige <stdio.h>,
  // inclusive num sketch Arduino (lá printf sequer existe). 'Serial.print' só
  // vira 'printf' no pré-processamento, e a varredura lê o fonte ORIGINAL,
  // então sketches normais não são acusados.
  const missingIncludes = findMissingIncludes(code);
  for (const miss of missingIncludes) {
    warnings.push({
      line: miss.line,
      severity: "warning",
      message: `'${miss.fn}' precisa da biblioteca <${miss.header}>, que não foi incluída. Adicione '#include <${miss.header}>' no topo do programa.`,
    });
  }

  // 1) Declaração com valor mas sem '=' . Ex.: int x 0;
  const declAssignRe = new RegExp(`^\\s*(?:${TYPE_KW})\\s+([A-Za-z_]\\w*)\\s+([^=;{}\\s][^;{}]*);`);
  lines.forEach((ln, i) => {
    const m = ln.match(declAssignRe);
    if (!m) return;
    // Ignorar se o "nome" capturado é ele próprio um tipo (ex.: unsigned long tempoAtual)
    if (new RegExp(`^(?:${TYPE_KW})$`).test(m[1])) return;
    // Ignorar se for declaração de função: nome seguido de '('
    if (/^\s*\(/.test(m[2])) return;
    warnings.push({
      line: i + 1,
      severity: "warning",
      message: `Falta o operador '=' ao atribuir um valor a '${m[1]}'. Use 'tipo ${m[1]} = ${m[2].trim()};' (com '=' entre o nome e o valor).`,
    });
  });

  // 2) `=` em condição de if/while
  lines.forEach((ln, i) => {
    const m = ln.match(/\b(if|while)\s*\(([^)]*)\)/);
    if (m) {
      const inside = m[2];
      // procurar '=' que não seja '==', '<=', '>=', '!=', '+=', '-=', '*=', '/=', '%='
      if (/(?<![=!<>+\-*/%])=(?!=)/.test(inside)) {
        warnings.push({
          line: i + 1,
          severity: "warning",
          message: `Dentro de '${m[1]}(...)' há um '=' (atribuição). Para comparar use '==' (igualdade). Ex.: 'if (x == 5)' em vez de 'if (x = 5)'.`,
        });
      }
      // procurar '&' único (não '&&', não '&=') usado como lógico
      if (/(?<![&])&(?![&=])/.test(inside)) {
        warnings.push({
          line: i + 1,
          severity: "warning",
          message: `Dentro de '${m[1]}(...)' há um '&' simples. Para "E" lógico use '&&'. Ex.: 'if (a == 1 && b == 2)' em vez de 'if (a == 1 & b == 2)'. ('&' sozinho é operação bit a bit.)`,
        });
      }
      // procurar '|' único (não '||', não '|=')
      if (/(?<![|])\|(?![|=])/.test(inside)) {
        warnings.push({
          line: i + 1,
          severity: "warning",
          message: `Dentro de '${m[1]}(...)' há um '|' simples. Para "OU" lógico use '||'. Ex.: 'if (a == 1 || b == 2)' em vez de 'if (a == 1 | b == 2)'. ('|' sozinho é operação bit a bit.)`,
        });
      }
      // dois identificadores/valores adjacentes sem operador lógico entre eles
      if (/[A-Za-z_0-9)\]]\s+[A-Za-z_(]/.test(inside.replace(/\b(?:sizeof|return)\b/g, ""))) {
        warnings.push({
          line: i + 1,
          severity: "warning",
          message: `Dentro de '${m[1]}(...)' parece faltar um operador lógico ('&&' ou '||') entre duas comparações. Ex.: 'if (a == 1 && b == 2)' em vez de 'if (a == 1  b == 2)'.`,
        });
      }
    }
  });

  // 2b) `else` seguido direto de parênteses — em C 'else' não recebe condição
  // ('else(x) { }' vira um '(x)' solto seguido de um bloco, e o parser morre
  // com "Token inesperado '{'", uma mensagem que não aponta a causa real).
  // 'else if (x)' não é pego aqui: entre 'else' e '(' há o 'if', que o '\s*'
  // não consome.
  lines.forEach((ln, i) => {
    if (/\belse\s*\(/.test(ln)) {
      warnings.push({
        line: i + 1,
        severity: "warning",
        message: `'else' não recebe condição entre parênteses — em C ele sempre representa "senão, em qualquer outro caso". Para testar outra condição use 'else if (...)'; para o caso padrão, use só 'else { ... }'.`,
      });
    }
  });

  // 3) Linha que parece instrução mas falta ';'
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (!t) return;
    // Ignorar linhas que terminam com chave, ponto-e-vírgula, dois-pontos, vírgula,
    // ou que claramente abrem bloco (if/for/while/else/switch/case/função).
    if (/[;{},:]$/.test(t)) return;
    if (/^[})]/.test(t)) return;
    if (/\b(if|else|for|while|do|switch|case|default)\b/.test(t)) return;
    // Diretivas de inclusão não são instruções (e não levam ';').
    // Cobre também o caso sem '#', já apontado por findMalformedIncludes.
    if (isIncludeLine(t) || t.startsWith("#")) return;
    // Cabeçalho de função: termina com ')' e a próxima linha não-vazia começa com '{'
    if (/\)\s*$/.test(t)) {
      const next = lines.slice(i + 1).find((x) => x.trim().length > 0);
      if (next && next.trim().startsWith("{")) return;
    }
    // Possível continuação multilinha (operador no fim)?
    if (/[+\-*/%<>=&|,^?]$/.test(t)) return;

    // Detectar se a linha contém algo "executável" (palavra+algo)
    if (/[A-Za-z_]\w*/.test(t)) {
      warnings.push({
        line: i + 1,
        severity: "warning",
        message: `A linha ${i + 1} parece ser uma instrução, mas não termina com ';'. Em C, toda instrução precisa terminar com ponto-e-vírgula.`,
      });
    }
  });

  // 4) Balanço de chaves
  let open = 0,
    close = 0;
  for (const ch of cleaned) {
    if (ch === "{") open++;
    else if (ch === "}") close++;
  }
  if (open !== close) {
    warnings.push({
      line: rawLines.length,
      severity: "warning",
      message:
        open > close
          ? `Faltam ${open - close} chave(s) de fechamento '}'. Cada '{' precisa de um '}' correspondente.`
          : `Há ${close - open} chave(s) de fechamento '}' a mais. Cada '}' precisa ter um '{' correspondente.`,
    });
  }

  // 5) Balanço de parênteses por linha
  lines.forEach((ln, i) => {
    let o = 0,
      c = 0;
    for (const ch of ln) {
      if (ch === "(") o++;
      else if (ch === ")") c++;
    }
    if (o !== c) {
      warnings.push({
        line: i + 1,
        severity: "warning",
        message: `Parênteses não balanceados na linha ${i + 1}: ${o} '(' e ${c} ')'.`,
      });
    }
  });

  // 6) Strings não fechadas (linha a linha — em C strings normalmente não cruzam linhas)
  rawLines.forEach((ln, i) => {
    const noComments = ln.replace(/\/\/.*$/, "");
    let inStr = false;
    let esc = false;
    for (const ch of noComments) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\" && inStr) {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = !inStr;
    }
    if (inStr) {
      warnings.push({
        line: i + 1,
        severity: "warning",
        message: `String sem fechamento na linha ${i + 1}. Toda " precisa de outra " na mesma linha.`,
      });
    }
  });

  // 7) Arduino: setup/loop ausentes (apenas se já existe pelo menos uma função)
  if (mode === "arduino") {
    const hasAnyFn = /\b\w+\s+\w+\s*\([^)]*\)\s*\{/.test(cleaned);
    if (hasAnyFn) {
      if (!/\bvoid\s+setup\s*\(\s*\)/.test(cleaned)) {
        warnings.push({
          line: 1,
          severity: "info",
          message: "Sketch Arduino normalmente tem 'void setup()' (executa uma vez ao ligar).",
        });
      }
      if (!/\bvoid\s+loop\s*\(\s*\)/.test(cleaned)) {
        warnings.push({
          line: 1,
          severity: "info",
          message: "Sketch Arduino normalmente tem 'void loop()' (repete continuamente).",
        });
      }
    }
  }

  // 8) Separadores de argumentos: ';' no lugar da ',' e vírgula ausente.
  warnings.push(...findSemicolonInArgs(cleaned));
  warnings.push(...findMissingComma(stripComments(code)));

  // 9) scanf sem o '&' antes da variável.
  warnings.push(...findScanfWithoutAddress(stripComments(code)));

  // 10) Identificador de formato incompatível com o tipo declarado.
  warnings.push(...findFormatTypeMismatch(stripComments(code), cleaned));

  // 10b) `char` inicializado com aspas duplas (deveria ser aspas simples).
  warnings.push(...findCharStringInit(stripComments(code)));

  // 11) C: falta a função main — inclusive quando o nome só está digitado errado.
  if (mode === "c") warnings.push(...findMissingEntryPoint(cleaned));

  // 12) Variáveis usadas sem declaração prévia. Funções já apontadas acima são
  // puladas para o aluno não receber dois avisos sobre o mesmo nome.
  warnings.push(...findUndeclaredUsages(cleaned, new Set(missingIncludes.map((mi) => mi.fn))));

  // Limita a quantidade exibida para não poluir
  return warnings.slice(0, 8);
}

// ── Ponto-e-vírgula no lugar da vírgula ───────────────────────

/**
 * Acha `;` dentro dos parênteses de uma chamada, como em `scanf("%d";&a)`.
 * O parser já morre nesse caso, mas com a mensagem "Esperado ')'" — e só ao
 * executar (ou, no modo C, no dry-run). Aqui o aluno vê o problema real
 * enquanto digita, nos dois modos.
 *
 * O `for (i = 0; i < n; i++)` é a exceção legítima: seus ';' separam as três
 * partes do laço. A dispensa vale só para o parêntese do próprio `for` — um ';'
 * mais fundo, como em `for (i = f(a;b); ...)`, continua sendo erro.
 */
function findSemicolonInArgs(cleaned: string): CodeWarning[] {
  const out: CodeWarning[] = [];
  // Pilha com um item por '(' aberto: o nome que veio antes dele ("" se nenhum).
  const open: string[] = [];
  let line = 1;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "\n") {
      line++;
      continue;
    }
    if (ch === "(") {
      const before = cleaned.slice(0, i).match(/([A-Za-z_]\w*)\s*$/);
      open.push(before ? before[1] : "");
      continue;
    }
    if (ch === ")") {
      open.pop();
      continue;
    }
    if (ch === ";" && open.length > 0 && open[open.length - 1] !== "for") {
      const fn = open[open.length - 1];
      const exemplo = fn === "scanf" ? `scanf("%d", &a);` : `printf("%d", x);`;
      out.push({
        line,
        severity: "warning",
        message: `Há um ';' dentro dos parênteses${fn ? ` de '${fn}'` : ""}. Os argumentos são separados por vírgula e o ';' só vem depois do ')' — ex.: ${exemplo}. Confira também se o '(' chegou a ser fechado.`,
      });
      break; // um aviso basta: os seguintes costumam ser consequência do mesmo erro
    }
  }
  return out;
}

// ── Vírgula ausente entre argumentos ──────────────────────────

/** Literal de string, com os escapes tratados (`\"` não fecha a string). */
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"/g;

/**
 * Acha a vírgula que faltou entre um texto e o resto dos argumentos, como em
 * `printf("Idade: %d\n"idade)` ou `printf(idade"\n")`.
 *
 * Recebe o fonte só sem COMENTÁRIOS: as aspas precisam estar de pé, já que são
 * elas que delimitam o argumento. Em C, depois de um literal de string só podem
 * vir ',' ')' ';' ']' '}' ou outro literal (concatenação) — qualquer letra,
 * dígito ou '&' colado ali é vírgula faltando.
 */
function findMissingComma(noComments: string): CodeWarning[] {
  const out: CodeWarning[] = [];
  const lines = noComments.split("\n");

  STRING_LITERAL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STRING_LITERAL.exec(noComments)) !== null) {
    const head = noComments.slice(0, m.index);
    const line = head.split("\n").length;
    // Diretivas ficam de fora: em `#include "stdio.h"` as aspas são a sintaxe.
    if (/^\s*#/.test(lines[line - 1] ?? "")) continue;

    // Depois do texto: qualquer letra, dígito ou '&' é vírgula faltando.
    const afterMissing = /^\s*[A-Za-z_&0-9]/.test(noComments.slice(m.index + m[0].length));
    // Antes do texto: um identificador que não seja palavra reservada nem o
    // nome da própria função (`printf(` já é o começo legítimo da chamada).
    const wordBefore = head.match(/([A-Za-z_]\w*)\s*$/);
    const beforeMissing =
      !!wordBefore && !RESERVED.has(wordBefore[1]) && !/[A-Za-z_]\w*\s*\(\s*$/.test(head);

    if (!afterMissing && !beforeMissing) continue;
    out.push({
      line,
      severity: "warning",
      message: `Faltou a vírgula entre o texto entre aspas e o argumento seguinte. Cada argumento é separado por vírgula — ex.: printf("Idade: %d\\n", idade);`,
    });
    break; // o primeiro basta: o parser para aí de qualquer forma
  }
  return out;
}

// ── Identificador de formato x tipo da variável ───────────────

interface DeclaredVar {
  type: string;
  isArray: boolean;
}

/**
 * Tipo de cada variável declarada no fonte, incluindo parâmetros de função.
 *
 * O `[^;{}()]*` para a lista de nomes exclui parênteses de propósito: assim
 * `void soma(int a, float b)` casa primeiro só com `void soma`, e a varredura
 * continua de dentro dos parênteses, pegando os parâmetros como declarações.
 */
function collectDeclaredVars(cleaned: string): Map<string, DeclaredVar> {
  const out = new Map<string, DeclaredVar>();
  const declRe = new RegExp(`\\b((?:unsigned|signed|long)\\s+)*(${TYPE_KW})\\b([^;{}()]*)`, "g");
  const typeAtStart = new RegExp(`^((?:unsigned|signed|long)\\s+)*(${TYPE_KW})\\b(.*)$`);
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(cleaned)) !== null) {
    let type = ((m[1] ?? "") + m[2]).trim();
    for (const raw of splitTopLevel(m[3])) {
      const part = raw.trim();
      if (!part) continue;
      // `float a, int b` (parâmetros): o tipo pode mudar no meio da lista.
      const again = part.match(typeAtStart);
      const body = again ? ((type = ((again[1] ?? "") + again[2]).trim()), again[3]) : part;
      const name = body.match(/^\s*\**\s*([A-Za-z_]\w*)/)?.[1];
      if (!name || out.has(name)) continue;
      out.set(name, { type, isArray: /^\s*\**\s*[A-Za-z_]\w*\s*\[/.test(body) });
    }
  }
  return out;
}

/** `printf("fmt", args…)` / `scanf("fmt", args…)` com a lista de argumentos crua. */
const FORMAT_CALL = /\b(printf|scanf)\s*\(\s*("(?:[^"\\\n]|\\.)*")\s*,([^)]*)\)/g;

/**
 * Confere se cada `%d`, `%f`, `%c` ou `%s` combina com o tipo da variável
 * passada naquela posição — `printf("%d", media)` com `media` float é o caso
 * clássico. Só checa argumentos que são o nome puro de uma variável conhecida;
 * expressões (`a + b`, chamadas) ficam de fora para não gerar falso alarme.
 */
function findFormatTypeMismatch(noComments: string, cleaned: string): CodeWarning[] {
  const out: CodeWarning[] = [];
  const vars = collectDeclaredVars(cleaned);

  FORMAT_CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FORMAT_CALL.exec(noComments)) !== null) {
    const fn = m[1] as "printf" | "scanf";
    const convs = conversionsOf(m[2]);
    if (!convs) continue;
    const args = splitTopLevel(m[3]);
    for (let i = 0; i < args.length && i < convs.length; i++) {
      const name = args[i].trim().replace(/^&/, "");
      if (!/^[A-Za-z_]\w*$/.test(name)) continue; // só nome puro de variável
      const decl = vars.get(name);
      if (!decl) continue;
      const kind = kindOfType(decl.type, decl.isArray);
      if (!kind) continue;
      const problem = formatMismatch(convs[i], kind, name, decl.type, fn);
      if (!problem) continue;
      out.push({
        line: noComments.slice(0, m.index).split("\n").length,
        severity: "warning",
        message: problem,
      });
      break; // um por chamada basta
    }
  }
  return out;
}

// ── char inicializado com aspas duplas ────────────────────────

/**
 * `char x = "a";` — string (aspas duplas) atribuída a um `char` escalar. Em C
 * isso é um erro de tipo (`char *` para `char`; gcc recusa ou ao menos avisa
 * "makes integer from pointer without a cast"), mas o interpretador aceitava
 * em silêncio: `coerce` para 'char' só pega o primeiro caractere da string,
 * escondendo o problema em vez de sinalizá-lo.
 *
 * Vetores (`char nome[20] = "abc"`) e ponteiros (`char *p = "abc"`) usam
 * aspas duplas de propósito, e ambos ficam de fora do padrão abaixo: há algo
 * entre o tipo e o '=' — o '[...]' do vetor ou o '*' do ponteiro — então o
 * nome não fica colado direto em `char <nome> =`.
 */
function findCharStringInit(noComments: string): CodeWarning[] {
  const out: CodeWarning[] = [];
  const re = /\bchar\s+([A-Za-z_]\w*)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments)) !== null) {
    const [, name, text] = m;
    const suggestion = text[0] ?? " ";
    out.push({
      line: noComments.slice(0, m.index).split("\n").length,
      severity: "warning",
      message: `'${name}' é do tipo 'char' (um único caractere, entre aspas simples), mas foi inicializada com "${text}" (aspas duplas, texto). Use '${name} = '${suggestion}';' — ou troque para 'char ${name}[...]' se a intenção é guardar um texto.`,
    });
  }
  return out;
}

// ── scanf sem '&' ─────────────────────────────────────────────

/** `scanf("fmt", alvo, alvo…)` — a lista de alvos vem crua, para inspecionar cada um. */
const SCANF_CALL = /\bscanf\s*\(\s*("(?:[^"\\\n]|\\.)*")\s*,([^)]*)\)/g;

/**
 * Acha `scanf("%d", a)` — sem o `&`, o scanf recebe uma cópia do valor e não
 * tem onde guardar o que foi lido. É o erro mais comum do primeiro semestre e
 * o interpretador o aceitaria em silêncio, já que o `&` é opcional na gramática.
 *
 * Duas exceções legítimas, ambas dispensadas aqui: `%s` (o nome de um vetor de
 * char já é um endereço) e qualquer alvo declarado como vetor no próprio fonte.
 */
function findScanfWithoutAddress(noComments: string): CodeWarning[] {
  const out: CodeWarning[] = [];
  // Vetores declarados no fonte: `char nome[20];` → não precisam de '&'.
  const arrays = new Set<string>();
  const arrayDeclRe = new RegExp(`\\b(?:${TYPE_KW})\\s+([A-Za-z_]\\w*)\\s*\\[`, "g");
  let am: RegExpExecArray | null;
  while ((am = arrayDeclRe.exec(noComments)) !== null) arrays.add(am[1]);

  SCANF_CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SCANF_CALL.exec(noComments)) !== null) {
    const specs = m[1].match(/%[^%\s]?[diufFeEgGxXoscp]/g) ?? [];
    const args = m[2].split(",");
    for (let i = 0; i < args.length; i++) {
      const arg = args[i].trim();
      if (!arg || arg.startsWith("&")) continue;
      if (specs[i]?.endsWith("s")) continue; // %s recebe o vetor, sem '&'
      const name = arg.match(/^([A-Za-z_]\w*)$/)?.[1];
      if (name && arrays.has(name)) continue;
      out.push({
        line: noComments.slice(0, m.index).split("\n").length,
        severity: "warning",
        message: `Faltou o '&' antes de '${arg}' no scanf. O '&' informa o ENDEREÇO da variável — sem ele o scanf não consegue guardar o valor digitado. Escreva: scanf(${m[1]}, &${arg});`,
      });
      break; // um alvo por scanf já indica o problema
    }
  }
  return out;
}

// ── Função de entrada (main) ──────────────────────────────────

/** Definições de função no fonte já limpo: `tipo nome(...) {`. */
const FN_DEF_RE = /\b(?:[A-Za-z_]\w*[ \t*]+)+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/g;

/**
 * Avisa quando o programa em C não tem `main`. Se alguma função definida tiver
 * nome parecido (`mian`, `mai`, `mainn`), sugere a correção em vez do aviso
 * genérico — é o erro de digitação mais comum e o mais difícil de enxergar.
 */
function findMissingEntryPoint(cleaned: string): CodeWarning[] {
  const defs: Array<{ name: string; line: number }> = [];
  let m: RegExpExecArray | null;
  FN_DEF_RE.lastIndex = 0;
  while ((m = FN_DEF_RE.exec(cleaned)) !== null) {
    defs.push({ name: m[1], line: cleaned.slice(0, m.index).split("\n").length });
  }
  // Sem nenhuma função ainda, o programa só está começando a ser digitado.
  if (defs.length === 0 || defs.some((d) => d.name === "main")) return [];

  const typo = defs.find(
    (d) => withinOneEdit(d.name.toLowerCase(), "main") || isAnagram(d.name.toLowerCase(), "main"),
  );
  if (typo) {
    return [
      {
        line: typo.line,
        severity: "warning",
        message: `'${typo.name}' está escrito diferente de 'main'. Você quis dizer 'int main()'? É por ela que o programa começa.`,
      },
    ];
  }
  return [
    {
      line: 1,
      severity: "warning",
      message:
        "Nenhuma função 'main' foi encontrada. Todo programa em C começa pela 'int main()' — sem ela nada é executado.",
    },
  ];
}

// ── Análise de identificadores não declarados ─────────────────
const TYPE_KW = "int|float|double|char|void|long|short|unsigned|signed|bool|byte|boolean|String";

const RESERVED = new Set<string>([
  // tipos
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
  // palavras-chave C
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
  "register",
  "sizeof",
  "goto",
  "inline",
  "true",
  "false",
  "NULL",
  // Arduino / constantes
  "HIGH",
  "LOW",
  "INPUT",
  "OUTPUT",
  "INPUT_PULLUP",
  "LED_BUILTIN",
  "A0",
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "A7",
  // funções built-in suportadas
  "pinMode",
  "digitalWrite",
  "digitalRead",
  "analogRead",
  "analogWrite",
  "delay",
  "delayMicroseconds",
  "millis",
  "micros",
  "map",
  "constrain",
  "min",
  "max",
  "abs",
  "sqrt",
  "pow",
  "sin",
  "cos",
  "tan",
  "random",
  "randomSeed",
  "setup",
  "loop",
  "main",
  "printf",
  "scanf",
  "puts",
  "putchar",
  "getchar",
  "Serial",
  "print",
  "println",
  "begin",
  "write",
  "available",
  "read",
  // Funções embutidas (math.h etc.) e as demais da biblioteca padrão que a
  // varredura de #include conhece — vêm das próprias tabelas, para não
  // divergirem delas com o tempo.
  ...BUILTIN_NAMES,
  ...Object.keys(LIBRARY_FUNCTIONS),
]);

const KNOWN_FUNCTIONS: string[] = [
  ...BUILTIN_NAMES,
  ...Object.keys(LIBRARY_FUNCTIONS),
  "pinMode",
  "digitalWrite",
  "digitalRead",
  "analogRead",
  "analogWrite",
  "delay",
  "delayMicroseconds",
  "millis",
  "micros",
  "map",
  "constrain",
  "min",
  "max",
  "abs",
  "sqrt",
  "pow",
  "sin",
  "cos",
  "tan",
  "random",
  "randomSeed",
  "setup",
  "loop",
  "main",
  "printf",
  "scanf",
  "puts",
  "putchar",
  "getchar",
  "print",
  "println",
  "begin",
  "write",
  "available",
  "read",
];

/** Separa por vírgulas do nível externo, ignorando as de dentro de (), [] e {}. */
function splitTopLevel(list: string): string[] {
  let depth = 0;
  let buf = "";
  const parts: string[] = [];
  for (const ch of list) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
    } else buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  return parts;
}

function extractNamesFromDeclList(list: string): string[] {
  // Recebe a parte após o tipo, ex.: " a, *b, c[10] = {1,2,3}, d = 5"
  const out: string[] = [];
  for (const p of splitTopLevel(list)) {
    // remover inicializador
    const noInit = p.split("=")[0];
    // remover [...] e *
    const cleaned = noInit
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\*/g, "")
      .trim();
    const m = cleaned.match(/^([A-Za-z_]\w*)/);
    if (m) out.push(m[1]);
  }
  return out;
}

function findUndeclaredUsages(cleaned: string, skip: Set<string> = new Set()): CodeWarning[] {
  const declared = new Set<string>();
  const lines = cleaned.split("\n");

  // Declarações do tipo: <type> name1, name2, ...;
  // O prefixo (?:unsigned|signed|long\s+)* trata tipos compostos como "unsigned long"
  const declRe = new RegExp(
    `\\b(?:(?:unsigned|signed|long)\\s+)*(?:${TYPE_KW})\\b([^;{}]+?)(?=[;{])`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(cleaned)) !== null) {
    const after = m[1];
    // Se tem '(' é função: nome + parâmetros
    const fn = after.match(/^\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/);
    if (fn) {
      declared.add(fn[1]);
      const params = fn[2];
      // cada parâmetro: tipo nome
      for (const p of params.split(",")) {
        const pm = p.match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*$/);
        if (pm) declared.add(pm[1]);
      }
    } else {
      for (const n of extractNamesFromDeclList(after)) declared.add(n);
    }
  }

  // for (int i = ...; ...) — declRe acima não pega porque está dentro de ()
  const forRe = new RegExp(
    `\\bfor\\s*\\(\\s*(?:(?:unsigned|signed|long)\\s+)*(?:${TYPE_KW})\\s+([A-Za-z_]\\w*)`,
    "g",
  );
  while ((m = forRe.exec(cleaned)) !== null) declared.add(m[1]);

  // Declarações com tipos externos (structs/classes de bibliotecas não em TYPE_KW).
  // Ex.: "DHT_Unified dht(8, DHT11);" e "sensors_event_t temperatura;"
  // → adiciona o tipo e o identificador declarado a conjuntos conhecidos.
  const userTypes = new Set<string>();
  const extTypeDeclRe = /^\s*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:;|\(([^)]*)\)\s*;)/gm;
  let etm: RegExpExecArray | null;
  while ((etm = extTypeDeclRe.exec(cleaned)) !== null) {
    const typeName = etm[1];
    const varName = etm[2];
    if (RESERVED.has(typeName)) continue;
    if (new RegExp(`^(?:${TYPE_KW})$`).test(typeName)) continue;
    userTypes.add(typeName);
    declared.add(varName);
    // Identificadores simples nos argumentos do construtor (ex.: DHT11)
    if (etm[3]) {
      for (const arg of etm[3].split(",")) {
        const am = arg.trim().match(/^([A-Za-z_]\w*)$/);
        if (am && !RESERVED.has(am[1])) userTypes.add(am[1]);
      }
    }
  }

  // Coleta usos: identificadores que NÃO são precedidos por '.', '->' ou tipo,
  // e não aparecem como label (name:)
  const reported = new Set<string>();
  const result: CodeWarning[] = [];
  const idRe = /([A-Za-z_]\w*)/g;
  lines.forEach((ln, i) => {
    let im: RegExpExecArray | null;
    while ((im = idRe.exec(ln)) !== null) {
      const name = im[1];
      if (
        RESERVED.has(name) ||
        declared.has(name) ||
        reported.has(name) ||
        userTypes.has(name) ||
        skip.has(name)
      )
        continue;
      // pular números puros (regex já exclui)
      const start = im.index;
      const before = ln.slice(0, start);
      const after = ln.slice(start + name.length);
      // Pular se for membro de struct (.x ou ->x)
      if (/(\.|->)\s*$/.test(before)) continue;
      // Pular se logo após um tipo (declaração que não capturamos por algum motivo)
      if (new RegExp(`\\b(?:${TYPE_KW})\\s*\\*?\\s*$`).test(before)) continue;
      // Pular labels: name:
      if (/^\s*:/.test(after) && !/^\s*::/.test(after)) continue;
      // Pular diretivas de inclusão (com ou sem '#') e demais diretivas
      if (isIncludeLine(ln) || /^\s*#/.test(ln)) continue;
      // Pular literais hex/sufixos não capturados
      if (/^[0-9]/.test(name)) continue;

      // É chamada de função? (próximo char não-espaço é '(')
      const isCall = /^\s*\(/.test(after);
      reported.add(name);
      if (isCall) {
        // checar se existe função conhecida com mesmo nome em outra capitalização
        const lower = name.toLowerCase();
        // Só é "erro de capitalização" se a grafia correta for diferente da usada.
        const known = KNOWN_FUNCTIONS.find((f) => f.toLowerCase() === lower && f !== name);
        if (known) {
          result.push({
            line: i + 1,
            severity: "warning",
            message: `Nome de função incorreto: '${name}'. O correto é '${known}' (C diferencia maiúsculas e minúsculas).`,
          });
        } else {
          result.push({
            line: i + 1,
            severity: "warning",
            message: `Função '${name}' não foi reconhecida. Verifique se o nome está correto ou se a função foi definida neste código.`,
          });
        }
      } else {
        result.push({
          line: i + 1,
          severity: "warning",
          message: `'${name}' está sendo usado, mas não foi declarado antes. Em C, toda variável precisa ser declarada com seu tipo, ex.: 'int ${name};' ou 'float ${name} = 0;'.`,
        });
      }
    }
  });

  return result;
}
