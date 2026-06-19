/**
 * Análise estática leve do código para destacar erros pedagógicos comuns
 * ANTES da execução. Não substitui o interpretador — apenas alerta o aluno
 * sobre padrões frequentes de erro.
 */

export interface CodeWarning {
  line: number;
  message: string;
  severity: "warning" | "info";
}

const COMMENT_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

function stripComments(src: string): string {
  return src.replace(COMMENT_RE, (m) => m.replace(/[^\n]/g, " "));
}

function stripStrings(src: string): string {
  return src.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
}

export function analyzeCode(code: string, mode: "arduino" | "c" = "arduino"): CodeWarning[] {
  const warnings: CodeWarning[] = [];
  const cleaned = stripStrings(stripComments(code));
  const lines = cleaned.split("\n");
  const rawLines = code.split("\n");

  // 0) Declaração com valor mas sem '=' . Ex.: int x 0;
  const declAssignRe = new RegExp(
    `^\\s*(?:${TYPE_KW})\\s+([A-Za-z_]\\w*)\\s+([^=;{}\\s][^;{}]*);`,
  );
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

  // 1) `=` em condição de if/while
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

  // 2) Linha que parece instrução mas falta ';'
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (!t) return;
    // Ignorar linhas que terminam com chave, ponto-e-vírgula, dois-pontos, vírgula,
    // ou que claramente abrem bloco (if/for/while/else/switch/case/função).
    if (/[;{},:]$/.test(t)) return;
    if (/^[})]/.test(t)) return;
    if (/\b(if|else|for|while|do|switch|case|default)\b/.test(t)) return;
    // Linhas com apenas '#include' etc.
    if (t.startsWith("#")) return;
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

  // 3) Balanço de chaves
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

  // 4) Balanço de parênteses por linha
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

  // 5) Strings não fechadas (linha a linha — em C strings normalmente não cruzam linhas)
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

  // 6) Arduino: setup/loop ausentes (apenas se já existe pelo menos uma função)
  if (mode === "arduino") {
    const hasAnyFn = /\b\w+\s+\w+\s*\([^)]*\)\s*\{/.test(cleaned);
    if (hasAnyFn) {
      if (!/\bvoid\s+setup\s*\(\s*\)/.test(cleaned)) {
        warnings.push({
          line: 1,
          severity: "info",
          message:
            "Sketch Arduino normalmente tem 'void setup()' (executa uma vez ao ligar).",
        });
      }
      if (!/\bvoid\s+loop\s*\(\s*\)/.test(cleaned)) {
        warnings.push({
          line: 1,
          severity: "info",
          message:
            "Sketch Arduino normalmente tem 'void loop()' (repete continuamente).",
        });
      }
    }
  }

  // 7) Variáveis usadas sem declaração prévia
  warnings.push(...findUndeclaredUsages(cleaned));

  // Limita a quantidade exibida para não poluir
  return warnings.slice(0, 8);
}

// ── Análise de identificadores não declarados ─────────────────
const TYPE_KW =
  "int|float|double|char|void|long|short|unsigned|signed|bool|byte|boolean|String";

const RESERVED = new Set<string>([
  // tipos
  "int","float","double","char","void","long","short","unsigned","signed",
  "bool","byte","boolean","String",
  // palavras-chave C
  "if","else","for","while","do","switch","case","default","break","continue",
  "return","struct","typedef","enum","union","const","static","extern",
  "volatile","register","sizeof","goto","inline","true","false","NULL",
  // Arduino / constantes
  "HIGH","LOW","INPUT","OUTPUT","INPUT_PULLUP","LED_BUILTIN","A0","A1","A2",
  "A3","A4","A5","A6","A7",
  // funções built-in suportadas
  "pinMode","digitalWrite","digitalRead","analogRead","analogWrite",
  "delay","delayMicroseconds","millis","micros","map","constrain",
  "min","max","abs","sqrt","pow","sin","cos","tan","random","randomSeed",
  "setup","loop","main","printf","scanf","puts","putchar","getchar",
  "Serial","print","println","begin","write","available","read",
]);

const KNOWN_FUNCTIONS: string[] = [
  "pinMode","digitalWrite","digitalRead","analogRead","analogWrite",
  "delay","delayMicroseconds","millis","micros","map","constrain",
  "min","max","abs","sqrt","pow","sin","cos","tan","random","randomSeed",
  "setup","loop","main","printf","scanf","puts","putchar","getchar",
  "print","println","begin","write","available","read",
];

function extractNamesFromDeclList(list: string): string[] {
  // Recebe a parte após o tipo, ex.: " a, *b, c[10] = {1,2,3}, d = 5"
  const out: string[] = [];
  // separa por vírgula no nível 0 (ignorando colchetes/parênteses)
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
  for (const p of parts) {
    // remover inicializador
    const noInit = p.split("=")[0];
    // remover [...] e *
    const cleaned = noInit.replace(/\[[^\]]*\]/g, "").replace(/\*/g, "").trim();
    const m = cleaned.match(/^([A-Za-z_]\w*)/);
    if (m) out.push(m[1]);
  }
  return out;
}

function findUndeclaredUsages(cleaned: string): CodeWarning[] {
  const declared = new Set<string>();
  const lines = cleaned.split("\n");

  // Declarações do tipo: <type> name1, name2, ...;
  const declRe = new RegExp(
    `\\b(?:${TYPE_KW})\\b([^;{}]+?)(?=[;{])`,
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
    `\\bfor\\s*\\(\\s*(?:${TYPE_KW})\\s+([A-Za-z_]\\w*)`,
    "g",
  );
  while ((m = forRe.exec(cleaned)) !== null) declared.add(m[1]);

  // Coleta usos: identificadores que NÃO são precedidos por '.', '->' ou tipo,
  // e não aparecem como label (name:)
  const reported = new Set<string>();
  const result: CodeWarning[] = [];
  const idRe = /([A-Za-z_]\w*)/g;
  lines.forEach((ln, i) => {
    let im: RegExpExecArray | null;
    while ((im = idRe.exec(ln)) !== null) {
      const name = im[1];
      if (RESERVED.has(name) || declared.has(name) || reported.has(name)) continue;
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
      // Pular #include <...> e diretivas
      if (/^\s*#/.test(ln)) continue;
      // Pular literais hex/sufixos não capturados
      if (/^[0-9]/.test(name)) continue;

      // É chamada de função? (próximo char não-espaço é '(')
      const isCall = /^\s*\(/.test(after);
      reported.add(name);
      if (isCall) {
        // checar se existe função conhecida com mesmo nome em outra capitalização
        const lower = name.toLowerCase();
        const known = KNOWN_FUNCTIONS.find((f) => f.toLowerCase() === lower);
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
