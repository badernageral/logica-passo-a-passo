/**
 * Interpretador didático de um subset da linguagem C.
 * Suporta:
 *  - Tipos: int, float, double, char
 *  - Declaração com/sem inicialização: int x = 5;  float a, b = 2.0;
 *  - Atribuições e expressões aritméticas (+ - * / %), comparações (== != < > <= >=), lógicos (&& || !)
 *  - printf("...", args)  com %d %i %u %f %e %g %x %o %c %s, flags/largura/precisão (%.2f, %-5d) e \n
 *  - scanf("...", &var)  — como comando e também como expressão
 *    (`while (scanf("%d", &n) == 1)`), devolvendo quantos itens leu
 *  - if / else  com blocos { }
 *  - while ( ... ) { ... }
 *  - for (init; cond; step) { ... }
 *  - Funções com e sem retorno (sem recursão profunda — mas funcional)
 *  - return expr;
 *
 * A execução é incremental: cada chamada a step() avança UMA "linha lógica"
 * (ou uma sub-etapa relevante para visualização).
 */

import type {
  CType,
  Variable,
  OutputLine,
  StepEvent,
  StepEventKind,
  InterpreterState,
  PinState,
  ReturnRecord,
  Expr,
  Stmt,
  FnDef,
  ScanfTarget,
  ArrayInit,
  Range,
  Directive,
} from "./interpreter-types";
import { tokenize, Parser } from "./interpreter-lex";
import {
  describeDirective,
  preprocessLibraryTypeDeclarations,
  preprocessGetEvent,
  preprocessArduinoSerial,
  preprocessLibraryMethodCalls,
  preprocessStructMemberAccess,
  checkBraceBalance,
} from "./interpreter-preprocess";
import {
  findMalformedIncludes,
  findMissingIncludes,
  findUnknownIncludes,
  withinOneEdit,
  isAnagram,
} from "./source-scan";
import { formatPrintf } from "./printf-format";
import { BUILTIN_FUNCTIONS } from "./c-builtins";
import { conversionsOf, formatMismatch, kindOfType } from "./format-types";

// Re-exporta os tipos públicos para manter a API de importação estável.
export type {
  CType,
  Variable,
  OutputLine,
  StepEvent,
  StepEventKind,
  InterpreterState,
  PinState,
  ReturnRecord,
  Directive,
} from "./interpreter-types";

/** Constantes pré-definidas do Arduino reconhecidas pelo interpretador. */
const ARDUINO_CONSTANTS: Record<string, number> = {
  HIGH: 1,
  LOW: 0,
  INPUT: 0,
  OUTPUT: 1,
  INPUT_PULLUP: 2,
  LED_BUILTIN: 13,
  true: 1,
  false: 0,
  TRUE: 1,
  FALSE: 0,
  PI: 3.14159265358979,
  HALF_PI: 1.5707963267948966,
  TWO_PI: 6.283185307179586,
  // Pinos analógicos do Arduino UNO/Nano (mapeados para 14..19)
  A0: 14,
  A1: 15,
  A2: 16,
  A3: 17,
  A4: 18,
  A5: 19,
  // Placas com mais entradas analógicas (Mega etc.)
  A6: 20,
  A7: 21,
};

/** Sinal interno lançado por 'break' e capturado pelo laço/switch que o contém. */
function isBreakSignal(e: unknown): e is { __break: true } {
  return typeof e === "object" && e !== null && "__break" in e;
}

/** Sinal interno lançado por 'return' e capturado pela chamada de função síncrona. */
function isReturnSignal(e: unknown): e is { __return: number | string } {
  return typeof e === "object" && e !== null && "__return" in e;
}

/** Extrai a mensagem de um erro desconhecido capturado em catch. */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Uma variável declarada duas vezes no mesmo bloco. */
interface Redeclaration {
  name: string;
  /** Linha da declaração repetida (a que o aluno precisa apagar). */
  line: number;
  /** Linha da primeira declaração, a válida. */
  first: number;
}

/**
 * Procura declarações repetidas percorrendo cada bloco do programa.
 *
 * A regra é a do C: só é erro quando o MESMO bloco declara o nome duas vezes.
 * Um bloco interno pode repetir o nome de um externo (sombreamento) e um mesmo
 * `int x;` dentro de um laço vale uma vez por iteração — por isso a checagem é
 * estática, sobre a AST, e não durante a execução: no runtime não há como
 * distinguir a segunda iteração de uma segunda declaração.
 */
function findRedeclarations(fns: FnDef[], globals: Stmt[]): Redeclaration[] {
  const found: Redeclaration[] = [];

  const scanBlock = (body: Stmt[], seed: [string, number][] = []) => {
    const seen = new Map<string, number>(seed);
    for (const s of body) {
      switch (s.k) {
        case "decl":
          for (const it of s.items) {
            const first = seen.get(it.name);
            if (first !== undefined) found.push({ name: it.name, line: s.line, first });
            else seen.set(it.name, s.line);
          }
          break;
        case "if":
          scanBlock(s.then);
          if (s.else) scanBlock(s.else);
          break;
        case "while":
        case "dowhile":
        case "block":
          scanBlock(s.body);
          break;
        case "for":
          // O 'init' vive no escopo do próprio for, que ENVOLVE o corpo: por
          // isso os dois são blocos separados — `for (int i…) { int i; }`
          // é sombreamento legítimo, não redeclaração.
          if (s.init) scanBlock([s.init]);
          scanBlock(s.body);
          break;
        case "switch":
          // Todos os 'case' compartilham um único bloco em C.
          scanBlock(s.cases.flatMap((c) => c.body));
          break;
      }
    }
  };

  scanBlock(globals);
  for (const fn of fns) {
    // Os parâmetros pertencem ao bloco do corpo: `void f(int a){ int a; }` é erro.
    scanBlock(
      fn.body,
      fn.params.map((p) => [p.name, fn.line ?? 0] as [string, number]),
    );
  }

  return found.sort((a, b) => a.line - b.line);
}

/** Visita todo statement do programa, entrando em blocos aninhados. */
function walkStmts(body: Stmt[], visit: (s: Stmt) => void) {
  for (const s of body) {
    visit(s);
    switch (s.k) {
      case "if":
        walkStmts(s.then, visit);
        if (s.else) walkStmts(s.else, visit);
        break;
      case "while":
      case "dowhile":
      case "block":
        walkStmts(s.body, visit);
        break;
      case "for":
        if (s.init) walkStmts([s.init], visit);
        walkStmts(s.body, visit);
        break;
      case "switch":
        for (const c of s.cases) walkStmts(c.body, visit);
        break;
    }
  }
}

/** Expressões escritas diretamente numa stmt (sem entrar nos sub-blocos). */
function exprsOfStmt(s: Stmt): Expr[] {
  switch (s.k) {
    case "decl":
      return s.items.map((it) => it.init).filter((e): e is Expr => !!e);
    case "expr":
      return [s.e];
    case "printf":
      return s.args;
    case "if":
    case "while":
    case "dowhile":
      return [s.cond];
    case "switch":
      return [s.disc, ...s.cases.map((c) => c.test)].filter((e): e is Expr => !!e);
    case "for":
      return [s.cond, s.step].filter((e): e is Expr => !!e);
    case "return":
      return s.e ? [s.e] : [];
    default:
      return [];
  }
}

/** Chama `cb` em cada `scanf(...)` usado como expressão dentro de `e`. */
function forEachScanfCall(e: Expr, cb: (x: Extract<Expr, { k: "scanfcall" }>) => void) {
  switch (e.k) {
    case "scanfcall":
      cb(e);
      break;
    case "bin":
      forEachScanfCall(e.a, cb);
      forEachScanfCall(e.b, cb);
      break;
    case "un":
      forEachScanfCall(e.a, cb);
      break;
    case "assign":
      forEachScanfCall(e.v, cb);
      break;
    case "call":
      for (const a of e.args) forEachScanfCall(a, cb);
      break;
    case "ternary":
      forEachScanfCall(e.cond, cb);
      forEachScanfCall(e.a, cb);
      forEachScanfCall(e.b, cb);
      break;
    case "index":
      for (const ix of e.indices) forEachScanfCall(ix, cb);
      break;
  }
}

/** printf/scanf cujo formato pede mais (ou menos) valores do que os passados. */
interface ArityMismatch {
  fn: "printf" | "scanf";
  line: number;
  /** Conversões do formato, na ordem: `["d", "d", "d"]`. */
  convs: string[];
  /** Quantos argumentos vieram depois do formato. */
  given: number;
}

/**
 * Confere se a quantidade de identificadores de formato bate com a de argumentos.
 *
 * `printf("%d %d %d", a, a)` lê lixo no terceiro `%d`; `printf("%d", a, b)`
 * ignora `b` calado. Os dois são erro de aluno e nenhum aparece sozinho.
 *
 * Formatos com `*` (largura por argumento) desalinham a correspondência e o
 * `conversionsOf` devolve `null` — nesses casos não há o que conferir.
 */
function findFormatArityMismatches(
  fns: FnDef[],
  globals: Stmt[],
  serialLines: Set<number>,
): ArityMismatch[] {
  const found: ArityMismatch[] = [];
  const visit = (s: Stmt) => {
    // scanf usado como expressão (`while (scanf("%d %d", &n))`) não é uma stmt,
    // mas erra a contagem do mesmo jeito.
    for (const e of exprsOfStmt(s)) {
      forEachScanfCall(e, (x) => {
        if (serialLines.has(x.line)) return;
        const cs = conversionsOf(x.fmt);
        if (cs && cs.length !== x.targets.length)
          found.push({ fn: "scanf", line: x.line, convs: cs, given: x.targets.length });
      });
    }
    if (s.k !== "printf" && s.k !== "scanf") return;
    // Um printf que na verdade é um Serial.print reescrito: ali o '%' do texto
    // é literal ("100% pronto") e a contagem seria um falso positivo.
    if (serialLines.has(s.line)) return;
    const convs = conversionsOf(s.fmt);
    if (!convs) return;
    const given = s.k === "printf" ? s.args.length : s.targets.length;
    if (convs.length !== given) found.push({ fn: s.k, line: s.line, convs, given });
  };
  walkStmts(globals, visit);
  for (const fn of fns) walkStmts(fn.body, visit);
  return found.sort((a, b) => a.line - b.line);
}

/** Monta a mensagem de erro de um printf/scanf com quantidade errada de argumentos. */
function arityMessage(bad: ArityMismatch): string {
  // printf recebe VALORES (masculino); scanf recebe VARIÁVEIS (feminino).
  const fem = bad.fn === "scanf";
  const pede = bad.convs.length;
  const substantivo = (n: number) =>
    n === 1 ? (fem ? "variável" : "valor") : fem ? "variáveis" : "valores";

  const passados =
    bad.given === 0
      ? fem
        ? "nenhuma foi passada"
        : "nenhum foi passado"
      : `${bad.given} ${
          bad.given === 1
            ? fem
              ? "foi passada"
              : "foi passado"
            : fem
              ? "foram passadas"
              : "foram passados"
        }`;

  const dif = Math.abs(pede - bad.given);
  const detalhe =
    bad.given < pede
      ? `${dif === 1 ? "sobra 1 identificador" : `sobram ${dif} identificadores`} sem argumento correspondente`
      : dif === 1
        ? "1 argumento ficaria ignorado"
        : `${dif} argumentos ficariam ignorados`;

  return (
    `${bad.fn} da linha ${bad.line}: o formato pede ${pede} ${substantivo(pede)} ` +
    `(${bad.convs.map((c) => "%" + c).join(", ")}), mas ${passados} — ${detalhe}. ` +
    `Cada identificador de formato consome um argumento, na ordem: a quantidade tem que bater.`
  );
}

/** Extrai o número da linha de uma mensagem de erro do parser/interpretador. */
function extractLineFromError(msg: string): number | null {
  if (!msg) return null;
  // Pega o ÚLTIMO "linha N" da string (no caso de ';' faltante temos duas linhas; queremos a primeira reportada).
  const matches = [...msg.matchAll(/linha\s+(\d+)/gi)];
  if (matches.length === 0) return null;
  return parseInt(matches[0][1], 10);
}

/**
 * Frame de execução: representa um statement ou sub-tarefa pendente.
 * Usamos uma pilha de "tarefas" para permitir avanço passo-a-passo.
 */
type Task =
  | { kind: "stmt"; stmt: Stmt; scope: string }
  | {
      kind: "block-end";
      scope: string;
      isFunctionFrame?: boolean;
      line: number;
      fnName?: string;
      callExpr?: Expr;
    }
  | {
      kind: "while-check";
      cond: Expr;
      body: Stmt[];
      scope: string;
      line: number;
      endLine?: number;
      loopKind?: "while" | "dowhile";
    }
  | { kind: "switch-end"; scope: string; line: number }
  | { kind: "for-init"; forStmt: Extract<Stmt, { k: "for" }>; scope: string }
  | { kind: "for-cond"; forStmt: Extract<Stmt, { k: "for" }>; scope: string }
  | { kind: "for-step"; forStmt: Extract<Stmt, { k: "for" }>; scope: string }
  /**
   * `scanf` usado como expressão: roda a leitura com o MESMO comando `scanf`
   * (uma variável por vez) e, ao terminar, o `scanf-expr-done` publica o valor
   * da expressão — o número de itens lidos.
   */
  | { kind: "scanf-expr"; expr: Extract<Expr, { k: "scanfcall" }>; scope: string; line: number }
  | { kind: "scanf-expr-done"; callExpr: Expr; count: number; line: number }
  | {
      kind: "scanf-pending";
      targets: string[];
      idx: number;
      scope: string;
      line: number;
      prompt: string;
    }
  | { kind: "info"; event: StepEvent }
  /** Marca o início de uma chamada de função executada passo-a-passo. */
  | { kind: "fn-call-start"; fn: FnDef; args: Expr[]; argScope: string; callExpr: Expr }
  /** Encerra a chamada: limpa escopo e grava valor de retorno no cache. */
  | { kind: "fn-call-end"; scope: string; fnName: string; line: number; callExpr: Expr }
  /** Avança o relógio simulado e re-empilha uma nova iteração de loop(). */
  | { kind: "loop-iteration"; line: number }
  /** Aguarda valor de leitura de pino (digitalRead/analogRead). */
  | {
      kind: "pin-read";
      fn: "digitalRead" | "analogRead";
      pin: number;
      callExpr: Expr;
      line: number;
      scope: string;
    };

/** Chamada dentro de uma expressão que precisa rodar passo-a-passo antes dela. */
type PendingCall =
  | { kind: "fn"; expr: Extract<Expr, { k: "call" }>; fn: FnDef }
  | {
      kind: "pin";
      expr: Extract<Expr, { k: "call" }>;
      fnName: "digitalRead" | "analogRead";
      pin: number;
    }
  | { kind: "scanfx"; expr: Extract<Expr, { k: "scanfcall" }> };

export class CInterpreter {
  private fns: Record<string, FnDef> = {};
  private vars: Variable[] = [];
  private stack: Task[] = [];
  private outputCounter = 0;
  private outputs: OutputLine[] = [];
  /** Stmts cujas chamadas a funções do usuário já foram anunciadas. */
  private announcedCalls = new WeakSet<Stmt>();
  /** Cache de valores de retorno por nó AST de chamada (preenchido após execução step-by-step). */
  private callResults = new WeakMap<Expr, number | string>();
  private returns: ReturnRecord[] = [];
  private returnCounter = 0;
  /** Definição de loop() salva para re-empilhar a cada iteração. */
  private loopFn: FnDef | null = null;
  /** Linhas (1-based) do fonte original que contêm Serial.begin(...) — usadas para mensagem didática. */
  private serialBeginLines: Set<number> = new Set();
  state: InterpreterState;

  constructor(
    public source: string,
    msPerLoop = 100,
    // strictEscapes: usado pelo dry-run do modo C (live-check.ts) para acusar
    // escapes desconhecidos como o gcc faria. A execução normal não ativa.
    private opts: { strictEscapes?: boolean } = {},
  ) {
    this.state = {
      variables: [],
      output: [],
      currentLine: 0,
      finished: false,
      awaitingInput: null,
      lastEvent: null,
      error: null,
      highlight: null,
      returns: [],
      simMillis: 0,
      msPerLoop: Math.max(0, Math.trunc(msPerLoop)),
      loopIterations: 0,
      arduinoMode: false,
      pinStates: [],
    };
    try {
      const directives: Directive[] = [];
      const afterTypeDecls = preprocessLibraryTypeDeclarations(source);
      const { source: afterSerial, beginLines } = preprocessArduinoSerial(afterTypeDecls);
      this.serialBeginLines = beginLines;
      const afterGetEvent = preprocessGetEvent(afterSerial);
      const afterMethods = preprocessLibraryMethodCalls(afterGetEvent);
      const preprocessed = preprocessStructMemberAccess(afterMethods);

      // Verificação de balanceamento de chaves '{' e '}' antes do parsing.
      // Ignora ocorrências dentro de strings, chars e comentários.
      const braceCheck = checkBraceBalance(preprocessed);
      if (braceCheck.open !== braceCheck.close) {
        const diff = braceCheck.open - braceCheck.close;
        if (diff > 0) {
          throw new Error(
            `Chaves desbalanceadas: há ${braceCheck.open} '{' e ${braceCheck.close} '}'. Faltou fechar ${diff} '}' no código.`,
          );
        } else {
          throw new Error(
            `Chaves desbalanceadas: há ${braceCheck.open} '{' e ${braceCheck.close} '}'. Há ${-diff} '}' a mais (ou faltou abrir '{').`,
          );
        }
      }

      // Diretivas #include mal escritas. Precisa vir ANTES do tokenizer: um
      // 'include' sem '#' vira expressão solta e o parser falharia com um
      // "Token inesperado" que não diz nada ao aluno.
      const [badSyntax] = findMalformedIncludes(source);
      if (badSyntax) {
        throw new Error(
          `Erro na diretiva include da linha ${badSyntax.line}: ${badSyntax.problem} O correto é '${badSyntax.fix}'.`,
        );
      }

      // Nome de biblioteca inexistente no #include (ex.: <sdtio.h>). Só acusa
      // quando há um candidato óbvio, então bibliotecas de terceiros passam.
      const [badInclude] = findUnknownIncludes(source);
      if (badInclude) {
        throw new Error(
          `A biblioteca '${badInclude.name}' incluída na linha ${badInclude.line} não existe. Você quis dizer '${badInclude.suggestion}'?`,
        );
      }

      const toks = tokenize(preprocessed, directives, this.opts);
      const parser = new Parser(toks);
      const { fns, globals } = parser.parseProgram();
      for (const f of fns) this.fns[f.name] = f;

      // Declaração repetida no mesmo bloco. A linha da repetição vem primeiro na
      // mensagem de propósito: é ela que o extractLineFromError destaca no editor.
      const [dup] = findRedeclarations(fns, globals);
      if (dup) {
        const onde =
          dup.line === dup.first
            ? `a linha ${dup.line} declara '${dup.name}' duas vezes`
            : `a linha ${dup.line} declara de novo o que a linha ${dup.first} já declarou`;
        throw new Error(
          `Variável '${dup.name}' já declarada: ${onde}. ` +
            `Em C o tipo aparece uma única vez — para mudar o valor escreva só '${dup.name} = …;'.`,
        );
      }

      // Formato x quantidade de argumentos do printf/scanf. As linhas de
      // Serial.* ficam de fora: ali o printf é gerado pelo pré-processamento e
      // um '%' no meio do texto ("100% pronto") é literal, não identificador.
      const serialLines = new Set<number>();
      source.split("\n").forEach((ln, i) => {
        if (/\bSerial\s*\./.test(ln)) serialLines.add(i + 1);
      });
      const [arity] = findFormatArityMismatches(fns, globals, serialLines);
      if (arity) throw new Error(arityMessage(arity));

      // Tarefas didáticas iniciais: descrever cada diretiva #include.
      const intro: Task[] = [];
      for (const d of directives) {
        const msg = describeDirective(d);
        intro.push({
          kind: "info",
          event: {
            kind: "noop",
            line: d.line,
            message: msg,
            highlight: { line: d.line, colStart: d.colStart, colEnd: d.colEnd },
          },
        });
      }

      // Executar globais primeiro (declarações). Os cards são criados passo a passo,
      // conforme a linha de cada declaração é interpretada.
      for (const g of globals) intro.push({ kind: "stmt", stmt: g, scope: "global" });

      const setupFn = this.fns["setup"];
      const loopFn = this.fns["loop"];
      const mainFn = this.fns["main"];

      // Em C, usar uma função da biblioteca padrão exige o #include correspondente.
      // Checado sobre o fonte ORIGINAL: o pré-processamento converte Serial.print
      // em printf, o que acusaria um falso positivo em sketches Arduino.
      if (!setupFn && !loopFn) {
        const [miss] = findMissingIncludes(source);
        if (miss) {
          throw new Error(
            `'${miss.fn}' foi usado na linha ${miss.line}, mas a biblioteca <${miss.header}> não foi incluída. Adicione '#include <${miss.header}>' no topo do programa.`,
          );
        }
      }

      if (setupFn || loopFn) {
        // Modo Arduino — exigir ambas as funções.
        this.state.arduinoMode = true;
        if (!setupFn)
          throw new Error(
            "Função 'setup' não encontrada. Em Arduino, 'setup' é executada uma vez no início.",
          );
        if (!loopFn)
          throw new Error(
            "Função 'loop' não encontrada. Em Arduino, 'loop' é executada continuamente.",
          );
        this.loopFn = loopFn;

        if (setupFn.line) {
          intro.push({
            kind: "info",
            event: {
              kind: "call-function",
              line: setupFn.line,
              message: "Executando a função setup() — chamada uma única vez ao iniciar o Arduino.",
              highlight: { line: setupFn.line, colStart: 1, colEnd: setupFn.headerEndCol ?? 9999 },
            },
          });
        }
        // Primeiro empilha o "trampolim" do loop (executará após setup terminar),
        // depois empilha o setup. Como a pilha é montada abaixo, a ordem aqui é
        // cronológica.
        this.pushFunctionCall("setup", []);
        // Marcador especial que dispara a próxima iteração de loop().
        this.stack.unshift({ kind: "loop-iteration", line: loopFn.line ?? 0 });
      } else if (mainFn) {
        if (mainFn.line) {
          intro.push({
            kind: "info",
            event: {
              kind: "call-function",
              line: mainFn.line,
              message: "Iniciando a execução da função main — ponto de entrada do programa.",
              highlight: { line: mainFn.line, colStart: 1, colEnd: mainFn.headerEndCol ?? 9999 },
            },
          });
        }
        this.pushFunctionCall("main", []);
      } else {
        if (globals.length === 0) {
          // Nome parecido com 'main' quase sempre é erro de digitação — apontar
          // isso ajuda muito mais que dizer que nenhum ponto de entrada existe.
          const typo = Object.keys(this.fns).find(
            (n) => withinOneEdit(n.toLowerCase(), "main") || isAnagram(n.toLowerCase(), "main"),
          );
          throw new Error(
            typo
              ? `A função '${typo}' está escrita diferente de 'main'. Todo programa em C começa pela função 'main' — corrija para 'int main()'.`
              : "Nenhuma função 'setup'/'loop' (Arduino) nem 'main' (C) encontrada.",
          );
        }
      }

      // Empilhar intro na ordem correta.
      this.stack = [...this.stack, ...intro.reverse()];
    } catch (e) {
      this.state.error = errorMessage(e);
      this.state.finished = true;
      const ln = extractLineFromError(this.state.error);
      if (ln) {
        this.state.currentLine = ln;
        this.state.highlight = null;
      }
      this.stack = [];
    }
    this.syncState();
  }

  private syncState() {
    this.state.variables = [...this.vars];
    this.state.output = [...this.outputs];
    this.state.returns = [...this.returns];
  }

  private clearFlags() {
    for (const v of this.vars) {
      v.justChanged = false;
      v.justCreated = false;
    }
    for (const r of this.returns) r.justReturned = false;
    for (const p of this.state.pinStates) {
      p.justChanged = false;
      p.justCreated = false;
    }
  }

  private findVar(name: string, scope: string): Variable | undefined {
    return (
      this.vars.find((v) => v.name === name && v.scope === scope) ??
      this.vars.find((v) => v.name === name && v.scope === "global")
    );
  }

  private setVar(name: string, scope: string, value: number | string) {
    const v = this.findVar(name, scope);
    if (!v) throw new Error(`Variável '${name}' não declarada.`);
    if (v.dims) {
      throw new Error(
        `'${name}' é um vetor/matriz — use índices para atribuir, ex.: '${name}[0] = ...'.`,
      );
    }
    v.value = this.coerce(v.type, value);
    v.uninit = false;
    v.justChanged = true;
  }

  private setIndexed(name: string, scope: string, idxs: number[], value: number | string) {
    const v = this.findVar(name, scope);
    if (!v) throw new Error(`Variável '${name}' não declarada.`);
    if (!v.dims) throw new Error(`'${name}' não é um vetor — não pode ser indexado.`);
    if (idxs.length !== v.dims.length) {
      throw new Error(
        `'${name}' tem ${v.dims.length} dimensão(ões), mas foi indexado com ${idxs.length}.`,
      );
    }
    for (let i = 0; i < idxs.length; i++) {
      if (idxs[i] < 0 || idxs[i] >= v.dims[i]) {
        throw new Error(
          `Índice fora do limite ao acessar '${name}': posição ${idxs[i]} (válido: 0 a ${v.dims[i] - 1}).`,
        );
      }
    }
    const coerced = this.coerce(v.type, value);
    if (v.dims.length === 1) {
      (v.value as (number | string)[])[idxs[0]] = coerced;
      if (v.uninitCells) (v.uninitCells as boolean[])[idxs[0]] = false;
    } else {
      (v.value as (number | string)[][])[idxs[0]][idxs[1]] = coerced;
      if (v.uninitCells) (v.uninitCells as boolean[][])[idxs[0]][idxs[1]] = false;
    }
    v.justChanged = true;
    v.lastIndex = idxs.slice();
  }

  private getIndexed(name: string, scope: string, idxs: number[]): number | string {
    const v = this.findVar(name, scope);
    if (!v) throw new Error(`Variável '${name}' não declarada.`);
    if (!v.dims) throw new Error(`'${name}' não é um vetor — não pode ser indexado.`);
    if (idxs.length !== v.dims.length) {
      throw new Error(
        `'${name}' tem ${v.dims.length} dimensão(ões), mas foi indexado com ${idxs.length}.`,
      );
    }
    for (let i = 0; i < idxs.length; i++) {
      if (idxs[i] < 0 || idxs[i] >= v.dims[i]) {
        throw new Error(
          `Índice fora do limite ao acessar '${name}': posição ${idxs[i]} (válido: 0 a ${v.dims[i] - 1}).`,
        );
      }
    }
    if (v.dims.length === 1) return (v.value as (number | string)[])[idxs[0]];
    return (v.value as (number | string)[][])[idxs[0]][idxs[1]];
  }

  /**
   * Declara a variável no escopo, substituindo uma homônima já existente.
   *
   * Redeclaração de verdade já foi barrada por `findRedeclarations` antes de
   * executar; então um nome repetido aqui só acontece quando o mesmo `int x;`
   * roda de novo (nova iteração do laço) ou num bloco interno. Nos dois casos
   * a variável é nova em C — empilhar uma segunda deixaria o `findVar`
   * enxergando eternamente a primeira, com o valor congelado da 1ª iteração.
   */
  private declareVar(
    type: CType,
    it: { name: string; init: Expr | null; dims?: number[]; arrayInit?: ArrayInit },
    scope: string,
    justCreated: boolean,
  ) {
    const v = this.makeVarFromItem(type, it, scope, justCreated);
    const at = this.vars.findIndex((x) => x.name === v.name && x.scope === scope);
    if (at >= 0) this.vars[at] = v;
    else this.vars.push(v);
  }

  /** Cria um Variable a partir de um item de declaração, lidando com escalares, vetores e matrizes. */
  private makeVarFromItem(
    type: CType,
    it: { name: string; init: Expr | null; dims?: number[]; arrayInit?: ArrayInit },
    scope: string,
    justCreated: boolean,
  ): Variable {
    if (it.dims && it.dims.length > 0) {
      const zero = type === "char" ? "" : 0;
      let value: (number | string)[] | (number | string)[][];
      // Em C, um inicializador parcial ({1, 2}) zera as demais posições — então só
      // marcamos como "sem valor" o vetor/matriz declarado sem inicializador nenhum.
      let uninitCells: boolean[] | boolean[][] | undefined;
      if (it.dims.length === 1) {
        const arr: (number | string)[] = new Array(it.dims[0]).fill(zero);
        if (it.arrayInit) {
          const src = it.arrayInit as (number | string)[];
          for (let i = 0; i < Math.min(src.length, arr.length); i++)
            arr[i] = this.coerce(type, src[i]);
        } else {
          uninitCells = new Array(it.dims[0]).fill(true);
        }
        value = arr;
      } else {
        const [r, c] = it.dims;
        const mat: (number | string)[][] = Array.from({ length: r }, () => new Array(c).fill(zero));
        if (it.arrayInit) {
          const src = it.arrayInit as (number | string)[][];
          for (let i = 0; i < Math.min(src.length, r); i++) {
            for (let j = 0; j < Math.min(src[i].length, c); j++) {
              mat[i][j] = this.coerce(type, src[i][j]);
            }
          }
        } else {
          uninitCells = Array.from({ length: r }, () => new Array(c).fill(true));
        }
        value = mat;
      }
      return {
        name: it.name,
        type,
        value,
        scope,
        dims: it.dims.slice(),
        justCreated,
        uninitCells,
      };
    }
    const val = it.init ? this.evalExpr(it.init, scope) : 0;
    return {
      name: it.name,
      type,
      value: this.coerce(type, val),
      scope,
      justCreated,
      uninit: !it.init,
    };
  }

  private coerce(type: CType, val: number | string): number | string {
    if (type === "char") {
      if (typeof val === "string") return val[0] ?? "";
      return String.fromCharCode(Math.trunc(val as number));
    }
    if (type === "int") return Math.trunc(typeof val === "string" ? val.charCodeAt(0) || 0 : val);
    return typeof val === "string" ? parseFloat(val) || 0 : val;
  }

  /** Converte uma Expr de volta a uma representação textual legível. */
  private exprToString(e: Expr): string {
    switch (e.k) {
      case "num":
        return String(e.v);
      case "str":
        return `"${e.v}"`;
      case "char":
        return `'${e.v}'`;
      case "ident":
        return e.name;
      case "bin":
        return `${this.exprToString(e.a)} ${e.op} ${this.exprToString(e.b)}`;
      case "un":
        return `${e.op}${this.exprToString(e.a)}`;
      case "assign": {
        const idx = e.indices ? e.indices.map((i) => `[${this.exprToString(i)}]`).join("") : "";
        return `${e.name}${idx} = ${this.exprToString(e.v)}`;
      }
      case "call":
        return `${e.name}(${e.args.map((a) => this.exprToString(a)).join(", ")})`;
      case "index":
        return `${e.name}${e.indices.map((i) => `[${this.exprToString(i)}]`).join("")}`;
      case "ternary":
        return `${this.exprToString(e.cond)} ? ${this.exprToString(e.a)} : ${this.exprToString(e.b)}`;
      case "scanfcall": {
        const alvos = e.targets.map((t) => "&" + t.name).join(", ");
        return `scanf("${e.fmt}"${alvos ? ", " + alvos : ""})`;
      }
    }
  }

  /** Gera dica explicativa para uma condição avaliada. */
  private condHint(cond: Expr, scope: string, result: boolean): string {
    const condStr = this.exprToString(cond);
    // Tentar mostrar os valores das variáveis envolvidas
    const parts: string[] = [];
    this.collectIdentValues(cond, scope, parts);
    const valuesStr = parts.length > 0 ? ` (onde ${parts.join(", ")})` : "";
    return `💡 Porque ${condStr}${valuesStr} é ${result ? "verdadeiro" : "falso"}.`;
  }

  private collectIdentValues(e: Expr, scope: string, out: string[]): void {
    switch (e.k) {
      case "ident": {
        const v = this.findVar(e.name, scope);
        if (v) {
          const val = Array.isArray(v.value) ? "[array]" : v.value;
          out.push(`${e.name} = ${val}`);
        }
        break;
      }
      case "bin":
        this.collectIdentValues(e.a, scope, out);
        this.collectIdentValues(e.b, scope, out);
        break;
      case "un":
        this.collectIdentValues(e.a, scope, out);
        break;
      case "call":
        e.args.forEach((a) => this.collectIdentValues(a, scope, out));
        break;
      case "index": {
        const v = this.findVar(e.name, scope);
        if (v) {
          try {
            const idxs = e.indices.map((ix) => Math.trunc(Number(this.evalExpr(ix, scope))));
            let val: unknown = v.value;
            for (const i of idxs) val = (val as unknown[])[i];
            out.push(`${e.name}[${idxs.join("][")}] = ${val as number | string}`);
          } catch {
            /* ignore */
          }
        }
        break;
      }
      case "assign":
        this.collectIdentValues(e.v, scope, out);
        break;
      default:
        break;
    }
  }

  private evalExpr(e: Expr, scope: string): number | string {
    switch (e.k) {
      case "num":
        return e.v;
      case "str":
        return e.v;
      case "char":
        return e.v;
      case "ident": {
        const c = ARDUINO_CONSTANTS[e.name];
        if (c !== undefined) return c;
        const v = this.findVar(e.name, scope);
        if (!v) throw new Error(`Variável '${e.name}' não declarada.`);
        if (v.dims) throw new Error(`'${e.name}' é um vetor — use índices, ex.: '${e.name}[0]'.`);
        return v.value as number | string;
      }
      case "index": {
        const idxs = e.indices.map((ix) => Math.trunc(Number(this.evalExpr(ix, scope))));
        return this.getIndexed(e.name, scope, idxs);
      }
      case "assign": {
        const v = this.evalExpr(e.v, scope);
        if (e.indices && e.indices.length > 0) {
          const idxs = e.indices.map((ix) => Math.trunc(Number(this.evalExpr(ix, scope))));
          this.setIndexed(e.name, scope, idxs, v);
          return this.getIndexed(e.name, scope, idxs);
        }
        this.setVar(e.name, scope, v);
        return this.findVar(e.name, scope)!.value as number | string;
      }
      case "un": {
        const a = this.evalExpr(e.a, scope);
        if (e.op === "-") return -(a as number);
        if (e.op === "+") return +(a as number);
        if (e.op === "!") return a ? 0 : 1;
        if (e.op === "pre++" || e.op === "pre--") {
          if (e.a.k !== "ident") throw new Error("++/-- requer variável");
          const cur = this.findVar(e.a.name, scope)!.value as number;
          const nv = e.op === "pre++" ? cur + 1 : cur - 1;
          this.setVar(e.a.name, scope, nv);
          return nv;
        }
        if (e.op === "post++" || e.op === "post--") {
          if (e.a.k !== "ident") throw new Error("++/-- requer variável");
          const cur = this.findVar(e.a.name, scope)!.value as number;
          const nv = e.op === "post++" ? cur + 1 : cur - 1;
          this.setVar(e.a.name, scope, nv);
          return cur;
        }
        return 0;
      }
      case "bin": {
        if (e.op === "&&")
          return this.truthy(this.evalExpr(e.a, scope)) && this.truthy(this.evalExpr(e.b, scope))
            ? 1
            : 0;
        if (e.op === "||")
          return this.truthy(this.evalExpr(e.a, scope)) || this.truthy(this.evalExpr(e.b, scope))
            ? 1
            : 0;
        const a = this.evalExpr(e.a, scope) as number;
        const b = this.evalExpr(e.b, scope) as number;
        switch (e.op) {
          case "+":
            return a + b;
          case "-":
            return a - b;
          case "*":
            return a * b;
          case "/":
            return b === 0 ? 0 : a / b;
          case "%":
            return a % b;
          case "==":
            return a === b ? 1 : 0;
          case "!=":
            return a !== b ? 1 : 0;
          case "<":
            return a < b ? 1 : 0;
          case ">":
            return a > b ? 1 : 0;
          case "<=":
            return a <= b ? 1 : 0;
          case ">=":
            return a >= b ? 1 : 0;
        }
        return 0;
      }
      case "scanfcall": {
        // O valor foi publicado pelo 'scanf-expr-done' depois da leitura; é
        // consumido aqui para que a próxima volta do laço leia de novo.
        if (this.callResults.has(e)) {
          const v = this.callResults.get(e)!;
          this.callResults.delete(e);
          return v;
        }
        // Sem leitura prévia significa que a expressão foi avaliada fora dos
        // pontos que sabem pausar (ex.: dentro de uma função chamada por
        // expressão) — mesma limitação do comando scanf nesse contexto.
        throw new Error(
          `O scanf da linha ${e.line} está num lugar onde a execução não consegue parar para pedir a entrada. Escreva-o em uma linha própria: scanf("${e.fmt}", ...);`,
        );
      }
      case "ternary": {
        return this.truthy(this.evalExpr(e.cond, scope))
          ? this.evalExpr(e.a, scope)
          : this.evalExpr(e.b, scope);
      }
      case "call": {
        // Se já foi calculado passo-a-passo, devolve o valor em cache.
        if (this.callResults.has(e)) {
          const v = this.callResults.get(e)!;
          this.callResults.delete(e);
          return v;
        }
        // Built-ins do Arduino que retornam valores síncronos.
        if (e.name === "millis") return Math.trunc(this.state.simMillis);
        if (e.name === "micros") return Math.trunc(this.state.simMillis * 1000);
        if (e.name === "delay") {
          const ms = Math.max(
            0,
            Math.trunc(Number(this.evalExpr(e.args[0] ?? { k: "num", v: 0 }, scope))),
          );
          this.state.simMillis += ms;
          return 0;
        }
        if (e.name === "delayMicroseconds") {
          const us = Math.max(
            0,
            Math.trunc(Number(this.evalExpr(e.args[0] ?? { k: "num", v: 0 }, scope))),
          );
          this.state.simMillis += us / 1000;
          return 0;
        }
        if (e.name === "pinMode") {
          const pin = Math.trunc(Number(this.evalExpr(e.args[0] ?? { k: "num", v: 0 }, scope)));
          const modeRaw = this.evalExpr(e.args[1] ?? { k: "num", v: 0 }, scope);
          const isOutput = modeRaw === 1 || modeRaw === "OUTPUT" || Number(modeRaw) === 1;
          const isPullup = modeRaw === 2 || modeRaw === "INPUT_PULLUP" || Number(modeRaw) === 2;
          const direction: "OUTPUT" | "INPUT" | "INPUT_PULLUP" = isOutput
            ? "OUTPUT"
            : isPullup
              ? "INPUT_PULLUP"
              : "INPUT";
          // Remove configuração anterior do mesmo pino para refletir a nova direção.
          this.state.pinStates = this.state.pinStates.filter((p) => p.pin !== pin);
          if (isOutput) {
            this.state.pinStates.push({
              pin,
              kind: "digital",
              direction,
              value: 0,
              justCreated: true,
            });
          } else {
            // INPUT / INPUT_PULLUP — começamos como input-digital; vira input-analog se um analogRead acontecer.
            const initial = isPullup ? 1 : 0;
            this.state.pinStates.push({
              pin,
              kind: "input-digital",
              direction,
              value: initial,
              justCreated: true,
            });
          }
          return 0;
        }
        if (e.name === "digitalWrite" || e.name === "analogWrite") {
          const pin = Math.trunc(Number(this.evalExpr(e.args[0] ?? { k: "num", v: 0 }, scope)));
          const val = Math.trunc(Number(this.evalExpr(e.args[1] ?? { k: "num", v: 0 }, scope)));
          const kind: "digital" | "analog" = e.name === "digitalWrite" ? "digital" : "analog";
          const existing = this.state.pinStates.find((p) => p.pin === pin);
          if (existing) {
            existing.value = val;
            existing.kind = kind;
            existing.direction = "OUTPUT";
            existing.justChanged = true;
          } else {
            // Escrita sem pinMode prévio — cria o card automaticamente para visualização.
            this.state.pinStates.push({
              pin,
              kind,
              direction: "OUTPUT",
              value: val,
              justCreated: true,
              justChanged: true,
            });
          }
          return 0;
        }
        if (e.name === "digitalRead" || e.name === "analogRead") {
          // Sem cache: não há valor ainda. Lança um erro interno claro — o fluxo
          // step-by-step deve interceptar essa chamada antes (em collectUserCalls)
          // e abrir um diálogo de leitura. Fallback defensivo:
          throw new Error(
            `Leitura de pino '${e.name}' precisa ser tratada passo a passo. Use o botão 'Próxima linha'.`,
          );
        }
        // chamada de função síncrona (sem step-by-step interno; resultado imediato)
        const fn = this.fns[e.name];
        if (fn) {
          const args = e.args.map((a) => this.evalExpr(a, scope));
          return this.callFunctionSync(fn, args);
        }
        // Funções de biblioteca (math.h e afins). Uma função do aluno com o mesmo
        // nome tem precedência — por isso a busca acima vem primeiro.
        const builtin = BUILTIN_FUNCTIONS[e.name];
        if (builtin) {
          if (e.args.length < builtin.arity) {
            const plural = builtin.arity === 1 ? "argumento" : "argumentos";
            throw new Error(`A função '${e.name}' precisa de ${builtin.arity} ${plural}.`);
          }
          const nums = e.args.map((a) => this.toNumber(this.evalExpr(a, scope)));
          return builtin.fn(nums);
        }
        throw new Error(`Função '${e.name}' não definida.`);
      }
    }
  }

  /** Valor numérico de um argumento — um `char` vale o seu código ASCII. */
  private toNumber(v: number | string): number {
    if (typeof v === "number") return v;
    const n = parseFloat(v);
    return Number.isNaN(n) ? (v.length > 0 ? v.charCodeAt(0) : 0) : n;
  }

  private truthy(v: number | string): boolean {
    if (typeof v === "string") return v.length > 0 && v !== "\0";
    return v !== 0;
  }

  /** Executa função inteira de forma síncrona (para uso dentro de expressões). */
  private callFunctionSync(fn: FnDef, args: (number | string)[]): number | string {
    const scope = fn.name + "#" + Math.random().toString(36).slice(2, 6);
    fn.params.forEach((p, i) => {
      this.vars.push({
        name: p.name,
        type: p.type,
        value: this.coerce(p.type, args[i] ?? 0),
        scope,
      });
    });
    let result: number | string = 0;
    try {
      this.runBlockSync(fn.body, scope);
    } catch (e) {
      if (isReturnSignal(e)) result = e.__return;
      else throw e;
    }
    // remover vars do escopo
    this.vars = this.vars.filter((v) => v.scope !== scope);
    return result;
  }

  private runBlockSync(body: Stmt[], scope: string) {
    for (const s of body) this.runStmtSync(s, scope);
  }

  private runStmtSync(s: Stmt, scope: string) {
    switch (s.k) {
      case "decl":
        for (const it of s.items) {
          this.declareVar(s.type, it, scope, false);
        }
        break;
      case "expr":
        this.evalExpr(s.e, scope);
        break;
      case "printf":
        this.doPrintf(s, scope);
        break;
      case "scanf":
        throw new Error("scanf dentro de função chamada por expressão não é suportado.");
      case "if":
        if (this.truthy(this.evalExpr(s.cond, scope))) this.runBlockSync(s.then, scope);
        else if (s.else) this.runBlockSync(s.else, scope);
        break;
      case "while":
        try {
          while (this.truthy(this.evalExpr(s.cond, scope))) this.runBlockSync(s.body, scope);
        } catch (e) {
          if (!isBreakSignal(e)) throw e;
        }
        break;
      case "dowhile":
        try {
          do {
            this.runBlockSync(s.body, scope);
          } while (this.truthy(this.evalExpr(s.cond, scope)));
        } catch (e) {
          if (!isBreakSignal(e)) throw e;
        }
        break;
      case "for":
        if (s.init) this.runStmtSync(s.init, scope);
        try {
          while (s.cond ? this.truthy(this.evalExpr(s.cond, scope)) : true) {
            this.runBlockSync(s.body, scope);
            if (s.step) this.evalExpr(s.step, scope);
          }
        } catch (e) {
          if (!isBreakSignal(e)) throw e;
        }
        break;
      case "switch": {
        const d = this.evalExpr(s.disc, scope);
        const start = this.switchStartIndex(s.cases, d, scope);
        if (start >= 0) {
          try {
            for (let i = start; i < s.cases.length; i++) this.runBlockSync(s.cases[i].body, scope);
          } catch (e) {
            if (!isBreakSignal(e)) throw e;
          }
        }
        break;
      }
      case "break":
        throw { __break: true };
      case "return":
        throw { __return: s.e ? this.evalExpr(s.e, scope) : 0 };
      case "block":
        this.runBlockSync(s.body, scope);
        break;
    }
  }

  /**
   * Índice da primeira clause a executar num switch: o 'case' cujo valor
   * casa com o discriminante; senão o 'default'; senão -1 (nenhuma).
   */
  private switchStartIndex(
    cases: Extract<Stmt, { k: "switch" }>["cases"],
    discVal: number | string,
    scope: string,
  ): number {
    let defaultIdx = -1;
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      if (c.test === null) {
        defaultIdx = i;
        continue;
      }
      const cv = this.evalExpr(c.test, scope);
      if (cv === discVal || Number(cv) === Number(discVal)) return i;
    }
    return defaultIdx;
  }

  private doPrintf(s: Extract<Stmt, { k: "printf" }>, scope: string): string {
    let ai = 0;
    const out = formatPrintf(s.fmt, () => {
      const arg = s.args[ai++];
      return arg !== undefined ? this.evalExpr(arg, scope) : "";
    });
    // dividir em linhas para o console — preserva quebras
    const lines = out.split("\n");
    lines.forEach((ln, idx) => {
      if (
        idx === 0 &&
        this.outputs.length > 0 &&
        !this.outputs[this.outputs.length - 1].text.endsWith("\n")
      ) {
        this.outputs[this.outputs.length - 1] = {
          ...this.outputs[this.outputs.length - 1],
          text: this.outputs[this.outputs.length - 1].text + ln,
        };
      } else {
        this.outputs.push({ id: this.outputCounter++, text: ln });
      }
    });
    return out;
  }

  private pushFunctionCall(name: string, args: (number | string)[]) {
    const fn = this.fns[name];
    if (!fn) throw new Error(`Função '${name}' não definida.`);
    const scope =
      fn.name === "main" ? "main" : fn.name + "#" + Math.random().toString(36).slice(2, 6);
    fn.params.forEach((p, i) => {
      this.vars.push({
        name: p.name,
        type: p.type,
        value: this.coerce(p.type, args[i] ?? 0),
        scope,
        justCreated: true,
      });
    });
    // empilhar corpo (na ordem: primeiro stmt no topo)
    this.stack.push({
      kind: "block-end",
      scope,
      isFunctionFrame: true,
      line: fn.endLine ?? fn.line ?? 0,
      fnName: fn.name,
    });
    for (let i = fn.body.length - 1; i >= 0; i--) {
      this.stack.push({ kind: "stmt", stmt: fn.body[i], scope });
    }
  }

  /** Avança um passo. Retorna o evento gerado. */
  step(): StepEvent {
    this.clearFlags();
    if (this.state.error) return { kind: "error", line: 0, message: this.state.error };
    if (this.state.awaitingInput)
      return {
        kind: "input-request",
        line: this.state.currentLine,
        message: "Aguardando entrada do usuário...",
      };

    if (this.stack.length === 0) {
      this.state.finished = true;
      this.syncState();
      return { kind: "finished", line: this.state.currentLine, message: "Programa finalizado." };
    }

    let event: StepEvent;
    try {
      event = this.execNext();
    } catch (e) {
      this.state.error = errorMessage(e);
      this.state.finished = true;
      event = { kind: "error", line: this.state.currentLine, message: this.state.error! };
      const ln = extractLineFromError(this.state.error!);
      if (ln) {
        this.state.currentLine = ln;
        event = { ...event, line: ln };
      }
      this.state.highlight = null;
      this.stack = [];
    }
    this.state.lastEvent = event;
    this.state.currentLine = event.line || this.state.currentLine;
    this.state.highlight = event.highlight ?? null;
    // Mensagem didática para Serial.begin(...) (que internamente vira no-op "0;").
    if (event.line && this.serialBeginLines.has(event.line)) {
      const friendly: StepEvent = { ...event, message: "Inicializando o monitor serial" };
      this.state.lastEvent = friendly;
      this.syncState();
      return friendly;
    }
    this.syncState();
    return event;
  }

  private execNext(): StepEvent {
    const task = this.stack.pop()!;
    switch (task.kind) {
      case "stmt":
        return this.execStmt(task.stmt, task.scope);
      case "info":
        return task.event;
      case "block-end":
        if (task.isFunctionFrame) {
          this.vars = this.vars.filter((v) => v.scope !== task.scope);
          // Se a função foi chamada via expressão, garantir que o cache tenha um valor (default 0).
          if (task.callExpr && !this.callResults.has(task.callExpr)) {
            this.callResults.set(task.callExpr, 0);
          }
          return {
            kind: "exit-block",
            line: task.line,
            message: task.fnName
              ? `Fim da função '${task.fnName}'.`
              : `Saindo do escopo da função.`,
          };
        }
        return { kind: "exit-block", line: task.line, message: "Fim do bloco." };
      case "fn-call-start": {
        const fn = task.fn;
        // Avaliar argumentos no escopo do chamador (já podem ter resultados em cache).
        const argVals = task.args.map((a) => this.evalExpr(a, task.argScope));
        const newScope = fn.name + "#" + Math.random().toString(36).slice(2, 6);
        fn.params.forEach((p, i) => {
          this.vars.push({
            name: p.name,
            type: p.type,
            value: this.coerce(p.type, argVals[i] ?? 0),
            scope: newScope,
            justCreated: true,
          });
        });
        // Empilhar o block-end (com callExpr para gravar valor de retorno) e o corpo.
        this.stack.push({
          kind: "block-end",
          scope: newScope,
          isFunctionFrame: true,
          line: fn.endLine ?? fn.line ?? 0,
          fnName: fn.name,
          callExpr: task.callExpr,
        });
        for (let i = fn.body.length - 1; i >= 0; i--) {
          this.stack.push({ kind: "stmt", stmt: fn.body[i], scope: newScope });
        }
        return {
          kind: "call-function",
          line: fn.line ?? 0,
          message: `Executando a função '${fn.name}' (definida na linha ${fn.line ?? "?"}) — vamos percorrê-la passo a passo.`,
          highlight: fn.line
            ? { line: fn.line, colStart: 1, colEnd: fn.headerEndCol ?? 9999 }
            : undefined,
        };
      }
      case "fn-call-end": {
        // Reservado para uso futuro; atualmente o block-end já trata o cleanup.
        return { kind: "noop", line: task.line, message: "" };
      }
      case "switch-end": {
        // Switch terminou normalmente (chegou ao fim sem break).
        return { kind: "exit-block", line: task.line, message: "Fim do switch." };
      }
      case "while-check": {
        const loop = task.loopKind === "dowhile" ? "do-while" : "while";
        // A condição pode conter um scanf (`while (scanf("%d", &n) == 1)`): a
        // leitura pausa a execução, então roda ANTES, e a condição é avaliada
        // na volta. Só o scanf é resolvido aqui — chamadas de função e pinos
        // seguem o caminho de sempre.
        const pend = this.collectCallsInExpr(task.cond, task.scope).filter(
          (c) => c.kind === "scanfx",
        );
        if (pend.length > 0) {
          this.stack.push(task);
          this.pushPendingCalls(pend, task.scope, task.line);
          return {
            kind: "noop",
            line: task.line,
            message: `A condição do ${loop} usa scanf — lendo a entrada antes de testá-la.`,
          };
        }
        const ok = this.truthy(this.evalExpr(task.cond, task.scope));
        if (ok) {
          this.stack.push(task); // re-avalia depois
          for (let i = task.body.length - 1; i >= 0; i--)
            this.stack.push({ kind: "stmt", stmt: task.body[i], scope: task.scope });
          return {
            kind: "enter-block",
            line: task.line,
            message: `Condição verdadeira → repetindo o ${loop}.\n${this.condHint(task.cond, task.scope, true)}`,
          };
        }
        return {
          kind: "exit-block",
          line: task.endLine ?? task.line,
          message: `Condição falsa → saindo do ${loop}.\n${this.condHint(task.cond, task.scope, false)}`,
        };
      }
      case "for-init": {
        const f = task.forStmt;
        if (f.init) this.runStmtSync(f.init, task.scope);
        // empilha avaliação da condição em seguida
        this.stack.push({ kind: "for-cond", forStmt: f, scope: task.scope });
        return {
          kind: "create-var",
          line: f.line,
          message: "for: inicialização",
          highlight: f.initRange ?? { line: f.line, colStart: 1, colEnd: 9999 },
        };
      }
      case "for-cond": {
        const f = task.forStmt;
        // Mesmo caso do while: um scanf na condição lê antes de ela ser testada.
        const pendFor = this.collectCallsInExpr(f.cond, task.scope).filter(
          (c) => c.kind === "scanfx",
        );
        if (pendFor.length > 0) {
          this.stack.push(task);
          this.pushPendingCalls(pendFor, task.scope, f.line);
          return {
            kind: "noop",
            line: f.line,
            message: "A condição do for usa scanf — lendo a entrada antes de testá-la.",
            highlight: f.condRange ?? { line: f.line, colStart: 1, colEnd: 9999 },
          };
        }
        const ok = f.cond ? this.truthy(this.evalExpr(f.cond, task.scope)) : true;
        if (ok) {
          this.stack.push({ kind: "for-step", forStmt: f, scope: task.scope });
          for (let i = f.body.length - 1; i >= 0; i--)
            this.stack.push({ kind: "stmt", stmt: f.body[i], scope: task.scope });
          return {
            kind: "enter-block",
            line: f.line,
            message: `for: condição verdadeira → entrando no corpo${f.cond ? `\n${this.condHint(f.cond, task.scope, true)}` : ""}`,
            highlight: f.condRange ?? { line: f.line, colStart: 1, colEnd: 9999 },
          };
        }
        return {
          kind: "exit-block",
          line: f.endLine ?? f.line,
          message: `for: condição falsa → saindo do laço${f.cond ? `\n${this.condHint(f.cond, task.scope, false)}` : ""}`,
          highlight: f.condRange ?? { line: f.line, colStart: 1, colEnd: 9999 },
        };
      }
      case "for-step": {
        const f = task.forStmt;
        if (f.step) this.evalExpr(f.step, task.scope);
        this.stack.push({ kind: "for-cond", forStmt: f, scope: task.scope });
        return {
          kind: "update-var",
          line: f.line,
          message: "for: incremento",
          highlight: f.stepRange ?? { line: f.line, colStart: 1, colEnd: 9999 },
        };
      }
      case "scanf-expr": {
        // Já lido (executando o passo seguinte)? Nada a fazer.
        if (this.callResults.has(task.expr)) return { kind: "noop", line: task.line, message: "" };
        const n = task.expr.targets.length;
        // LIFO: o 'done' entra primeiro e roda por último, depois que o comando
        // scanf tiver lido todos os alvos (ele empilha um resto por alvo).
        this.stack.push({
          kind: "scanf-expr-done",
          callExpr: task.expr,
          count: n,
          line: task.line,
        });
        this.stack.push({
          kind: "stmt",
          stmt: { k: "scanf", fmt: task.expr.fmt, targets: task.expr.targets, line: task.line },
          scope: task.scope,
        });
        return {
          kind: "noop",
          line: task.line,
          message: `O scanf da linha ${task.line} é lido primeiro; o valor dele (quantos itens leu) entra na expressão depois.`,
        };
      }
      case "scanf-expr-done": {
        this.callResults.set(task.callExpr, task.count);
        return {
          kind: "noop",
          line: task.line,
          message: `scanf leu ${task.count} ${task.count === 1 ? "valor" : "valores"} — é esse o resultado do scanf na expressão.`,
        };
      }
      case "scanf-pending": {
        // não deve aparecer aqui (tratado em provideInput)
        return { kind: "noop", line: task.line, message: "" };
      }
      case "loop-iteration": {
        // Avança o relógio simulado e re-empilha uma nova execução de loop().
        if (!this.loopFn) return { kind: "noop", line: task.line, message: "" };
        if (this.state.loopIterations > 0) {
          this.state.simMillis += this.state.msPerLoop;
        }
        this.state.loopIterations += 1;
        // Cada iteração de loop é "recente" — esquecer anúncios anteriores
        // para que pin-reads e chamadas de função sejam re-executados passo a passo.
        this.announcedCalls = new WeakSet<Stmt>();
        const iter = this.state.loopIterations;
        // Re-empilha o trampolim (próxima iteração) por baixo.
        this.stack.unshift({ kind: "loop-iteration", line: this.loopFn.line ?? 0 });
        // Empilha o corpo de loop() no topo.
        this.pushFunctionCall("loop", []);
        return {
          kind: "call-function",
          line: this.loopFn.line ?? 0,
          message: `Iniciando iteração #${iter} da função loop() — relógio: ${Math.trunc(this.state.simMillis)} ms.`,
          highlight: this.loopFn.line
            ? { line: this.loopFn.line, colStart: 1, colEnd: this.loopFn.headerEndCol ?? 9999 }
            : undefined,
        };
      }
      case "pin-read": {
        // Já existe um valor em cache? (executando segundo passo após o usuário responder)
        if (this.callResults.has(task.callExpr)) {
          return { kind: "noop", line: task.line, message: "" };
        }
        const fnLabel = task.fn === "digitalRead" ? "digitalRead" : "analogRead";
        const range = task.fn === "digitalRead" ? "0 ou 1" : "0 a 1023";
        this.state.awaitingInput = {
          type: "int",
          prompt: `${fnLabel}(pino ${task.pin}) — informe o valor lido (${range}):`,
          pinRead: { fn: task.fn, pin: task.pin, callExpr: task.callExpr },
        };
        return {
          kind: "input-request",
          line: task.line,
          message: `Aguardando leitura de ${fnLabel}(pino ${task.pin}).`,
        };
      }
    }
  }

  /**
   * Coleta chamadas dentro de UMA expressão que precisam rodar passo-a-passo:
   *  - chamadas a funções definidas pelo usuário (kind 'fn');
   *  - chamadas a digitalRead/analogRead (kind 'pin') — abrem diálogo de entrada;
   *  - `scanf` usado como expressão (kind 'scanfx') — idem.
   * Itens já resolvidos (valor no cache `callResults`) ficam de fora: é o que
   * permite chamar de novo a cada volta do laço sem repetir a mesma leitura.
   */
  private collectCallsInExpr(e: Expr | null | undefined, scope: string): PendingCall[] {
    const out: PendingCall[] = [];
    const visitExpr = (x: Expr | null | undefined) => {
      if (!x) return;
      switch (x.k) {
        case "call": {
          // Visita argumentos primeiro (chamadas internas executam antes).
          for (const a of x.args) visitExpr(a);
          if (this.callResults.has(x)) break;
          if (x.name === "digitalRead" || x.name === "analogRead") {
            // Avalia o argumento (número do pino) — pode usar valores em cache.
            const pin = Math.trunc(Number(this.evalExpr(x.args[0] ?? { k: "num", v: 0 }, scope)));
            out.push({ kind: "pin", expr: x, fnName: x.name, pin });
          } else {
            const fn = this.fns[x.name];
            if (fn) out.push({ kind: "fn", expr: x, fn });
          }
          break;
        }
        case "scanfcall":
          if (!this.callResults.has(x)) out.push({ kind: "scanfx", expr: x });
          break;
        case "bin":
          visitExpr(x.a);
          visitExpr(x.b);
          break;
        case "un":
          visitExpr(x.a);
          break;
        case "assign":
          visitExpr(x.v);
          break;
      }
    };
    visitExpr(e);
    return out;
  }

  /**
   * Coleta chamadas que precisam ser executadas passo-a-passo ANTES da stmt.
   */
  private collectUserCalls(s: Stmt, scope: string): PendingCall[] {
    const out: PendingCall[] = [];
    const visitExpr = (e: Expr | null | undefined) => {
      out.push(...this.collectCallsInExpr(e, scope));
    };
    switch (s.k) {
      case "decl":
        for (const it of s.items) visitExpr(it.init);
        break;
      case "expr":
        visitExpr(s.e);
        break;
      case "printf":
        for (const a of s.args) visitExpr(a);
        break;
      case "return":
        visitExpr(s.e);
        break;
      case "if":
        visitExpr(s.cond);
        break;
      case "while":
        visitExpr(s.cond);
        break;
      // for/scanf/block: chamadas dentro de sub-stmts serão tratadas quando executadas
    }
    return out;
  }

  /** Empilha as tarefas de `collectCallsInExpr` na ordem em que devem rodar. */
  private pushPendingCalls(calls: PendingCall[], scope: string, line: number) {
    // Empilha em ordem reversa (LIFO) — primeira chamada executa primeiro.
    for (let i = calls.length - 1; i >= 0; i--) {
      const c = calls[i];
      if (c.kind === "fn") {
        this.stack.push({
          kind: "fn-call-start",
          fn: c.fn,
          args: c.expr.args,
          argScope: scope,
          callExpr: c.expr,
        });
      } else if (c.kind === "pin") {
        this.stack.push({
          kind: "pin-read",
          fn: c.fnName,
          pin: c.pin,
          callExpr: c.expr,
          line,
          scope,
        });
      } else {
        this.stack.push({ kind: "scanf-expr", expr: c.expr, scope, line: c.expr.line || line });
      }
    }
  }

  /** Executa 'break': desempilha tarefas até o laço/switch mais interno. */
  private execBreak(line: number): StepEvent {
    while (this.stack.length) {
      const top = this.stack[this.stack.length - 1];
      // Não atravessa fronteiras de função: aí seria 'break' fora de laço.
      if (top.kind === "block-end" && top.isFunctionFrame) break;
      const t = this.stack.pop()!;
      if (
        t.kind === "switch-end" ||
        t.kind === "while-check" ||
        t.kind === "for-cond" ||
        t.kind === "for-step"
      ) {
        return { kind: "exit-block", line, message: "break → saindo do laço/switch." };
      }
    }
    throw new Error(`'break' fora de um laço ou switch (linha ${line}).`);
  }

  private execStmt(s: Stmt, scope: string): StepEvent {
    // Antes de executar a stmt, se ela contém chamadas a funções do usuário ou
    // leituras de pino, executamos cada uma passo-a-passo antes de re-executar.
    if (!this.announcedCalls.has(s)) {
      const calls = this.collectUserCalls(s, scope);
      if (calls.length > 0) {
        this.announcedCalls.add(s);
        // Re-empilha a stmt para ser executada DEPOIS que todas as chamadas rodarem.
        this.stack.push({ kind: "stmt", stmt: s, scope });
        this.pushPendingCalls(calls, scope, s.line);
        return {
          kind: "noop",
          line: s.line,
          message: `Linha ${s.line} usa chamada(s) que serão resolvidas passo a passo.`,
        };
      }
    }
    switch (s.k) {
      case "decl": {
        const names: string[] = [];
        for (const it of s.items) {
          this.declareVar(s.type, it, scope, true);
          const dimsStr = it.dims ? "[" + it.dims.join("][") + "]" : "";
          names.push(it.name + dimsStr);
        }
        return {
          kind: "create-var",
          line: s.line,
          message: `Criando variável(is): ${names.join(", ")}`,
          varName: s.items[0].name,
        };
      }
      case "expr": {
        // detectar atribuição para mensagem mais clara
        if (s.e.k === "assign") {
          this.evalExpr(s.e, scope);
          return {
            kind: "update-var",
            line: s.line,
            message: `Atualizando '${s.e.name}'`,
            varName: s.e.name,
          };
        }
        this.evalExpr(s.e, scope);
        return { kind: "noop", line: s.line, message: "Expressão executada." };
      }
      case "printf": {
        this.doPrintf(s, scope);
        return { kind: "print", line: s.line, message: "Imprimindo na tela." };
      }
      case "scanf": {
        if (s.targets.length === 0) return { kind: "noop", line: s.line, message: "scanf vazio." };
        const tgt = s.targets[0];
        const v = this.findVar(tgt.name, scope);
        if (!v) throw new Error(`Variável '${tgt.name}' não declarada (scanf).`);
        // Sem o '&', o scanf recebe o VALOR e não teria onde guardar a leitura.
        // A exceção é o nome de um vetor, que já é o endereço do primeiro item.
        if (!tgt.byAddress && !(v.dims && !tgt.indices)) {
          throw new Error(
            `Faltou o '&' antes de '${tgt.name}' no scanf da linha ${s.line}. O scanf precisa do ENDEREÇO da variável para guardar o valor lido: scanf("...", &${tgt.name});`,
          );
        }
        // O scanf escreve na memória da variável: um formato de outro tipo
        // guardaria o valor errado (aqui o tipo do alvo é conhecido de verdade).
        if (tgt.spec) {
          const kind = kindOfType(v.type, !!v.dims && !tgt.indices);
          const problem = kind && formatMismatch(tgt.spec, kind, tgt.name, v.type, "scanf");
          if (problem) throw new Error(`${problem} (linha ${s.line})`);
        }
        if (s.targets.length > 1) {
          const rest: Stmt = { k: "scanf", fmt: s.fmt, targets: s.targets.slice(1), line: s.line };
          this.stack.push({ kind: "stmt", stmt: rest, scope });
        }
        const idxs = tgt.indices
          ? tgt.indices.map((ix) => Math.trunc(Number(this.evalExpr(ix, scope))))
          : undefined;
        const display = idxs ? `${tgt.name}[${idxs.join("][")}]` : tgt.name;
        this.state.awaitingInput = {
          varName: tgt.name,
          type: v.type,
          prompt: `Digite o valor para '${display}' (${v.type}):`,
          indices: idxs,
          scope,
        };
        return {
          kind: "input-request",
          line: s.line,
          message: `Aguardando entrada para '${display}'.`,
          varName: tgt.name,
        };
      }
      case "if": {
        if (this.truthy(this.evalExpr(s.cond, scope))) {
          this.stack.push({ kind: "block-end", scope, line: s.thenEndLine ?? s.line });
          for (let i = s.then.length - 1; i >= 0; i--)
            this.stack.push({ kind: "stmt", stmt: s.then[i], scope });
          return {
            kind: "enter-block",
            line: s.line,
            message: `Condição verdadeira → entrando no if.\n${this.condHint(s.cond, scope, true)}`,
          };
        }
        if (s.else) {
          this.stack.push({ kind: "block-end", scope, line: s.elseEndLine ?? s.line });
          for (let i = s.else.length - 1; i >= 0; i--)
            this.stack.push({ kind: "stmt", stmt: s.else[i], scope });
          return {
            kind: "enter-block",
            line: s.line,
            message: `Condição falsa → entrando no else.\n${this.condHint(s.cond, scope, false)}`,
          };
        }
        return {
          kind: "noop",
          line: s.line,
          message: `Condição falsa → pulando if.\n${this.condHint(s.cond, scope, false)}`,
        };
      }
      case "while": {
        this.stack.push({
          kind: "while-check",
          cond: s.cond,
          body: s.body,
          scope,
          line: s.line,
          endLine: s.endLine,
        });
        return { kind: "noop", line: s.line, message: "Avaliando condição do while." };
      }
      case "for": {
        // empilha sub-passos: init → cond → ... ; o for-init executa init e empilha cond.
        this.stack.push({ kind: "for-init", forStmt: s, scope });
        return { kind: "noop", line: s.line, message: "Iniciando laço for…" };
      }
      case "dowhile": {
        // O corpo executa ao menos uma vez; a condição é testada no final.
        this.stack.push({
          kind: "while-check",
          cond: s.cond,
          body: s.body,
          scope,
          line: s.line,
          endLine: s.endLine,
          loopKind: "dowhile",
        });
        for (let i = s.body.length - 1; i >= 0; i--)
          this.stack.push({ kind: "stmt", stmt: s.body[i], scope });
        return {
          kind: "enter-block",
          line: s.line,
          message: "do-while: executando o corpo (a condição é testada no final).",
        };
      }
      case "switch": {
        const d = this.evalExpr(s.disc, scope);
        const start = this.switchStartIndex(s.cases, d, scope);
        this.stack.push({ kind: "switch-end", scope, line: s.endLine ?? s.line });
        if (start >= 0) {
          // Fall-through: empilha o corpo de start..fim em sequência.
          const flat: Stmt[] = [];
          for (let i = start; i < s.cases.length; i++) flat.push(...s.cases[i].body);
          for (let i = flat.length - 1; i >= 0; i--)
            this.stack.push({ kind: "stmt", stmt: flat[i], scope });
          const label = s.cases[start].test === null ? "default" : "case";
          return {
            kind: "enter-block",
            line: s.cases[start].line,
            message: `switch: entrando no '${label}' correspondente (valor ${d}).`,
          };
        }
        return {
          kind: "noop",
          line: s.line,
          message: `switch: nenhum case corresponde ao valor ${d} (e não há default).`,
        };
      }
      case "break":
        return this.execBreak(s.line);
      case "return": {
        // Avaliar valor de retorno no escopo atual (antes de remover variáveis).
        const retVal = s.e ? this.evalExpr(s.e, scope) : 0;
        let returnedFrom: string | undefined;
        // descartar pilha até function frame
        while (this.stack.length) {
          const t = this.stack.pop()!;
          if (t.kind === "block-end" && t.isFunctionFrame) {
            if (t.callExpr) this.callResults.set(t.callExpr, retVal);
            returnedFrom = t.fnName;
            this.vars = this.vars.filter((v) => v.scope !== t.scope);
            break;
          }
        }
        // Registrar o retorno (exceto main, que tipicamente é status do programa).
        if (returnedFrom && returnedFrom !== "main" && s.e) {
          this.returns.push({
            id: this.returnCounter++,
            fnName: returnedFrom,
            value: retVal,
            line: s.line,
            justReturned: true,
          });
        }
        return {
          kind: "return",
          line: s.line,
          message: `Retornando da função (valor: ${retVal}).`,
        };
      }
      case "block": {
        this.stack.push({ kind: "block-end", scope, line: s.endLine ?? s.line });
        for (let i = s.body.length - 1; i >= 0; i--)
          this.stack.push({ kind: "stmt", stmt: s.body[i], scope });
        return { kind: "enter-block", line: s.line, message: "Entrando em bloco." };
      }
    }
  }

  /** Fornece valor de entrada (scanf ou leitura de pino do Arduino). */
  provideInput(raw: string): StepEvent {
    if (!this.state.awaitingInput)
      return { kind: "noop", line: this.state.currentLine, message: "Nada esperando entrada." };
    const ai = this.state.awaitingInput;

    // Caso 1: leitura de pino do Arduino — armazena o valor no cache da chamada.
    if (ai.pinRead) {
      const { fn, pin, callExpr } = ai.pinRead;
      let n = Math.trunc(parseFloat(raw));
      if (!Number.isFinite(n)) n = 0;
      if (fn === "digitalRead") n = n !== 0 ? 1 : 0;
      else n = Math.max(0, Math.min(1023, n));
      this.callResults.set(callExpr, n);
      // Atualiza/cria o card do pino INPUT com o valor lido.
      const kind: "input-digital" | "input-analog" =
        fn === "digitalRead" ? "input-digital" : "input-analog";
      const existing = this.state.pinStates.find((p) => p.pin === pin);
      if (existing) {
        existing.value = n;
        existing.kind = kind;
        if (existing.direction === "OUTPUT") existing.direction = "INPUT";
        existing.justChanged = true;
      } else {
        this.state.pinStates.push({
          pin,
          kind,
          direction: "INPUT",
          value: n,
          justCreated: true,
          justChanged: true,
        });
      }
      this.state.awaitingInput = null;
      this.clearFlags();
      this.syncState();
      const ev: StepEvent = {
        kind: "input-request",
        line: this.state.currentLine,
        message: `${fn}(pino ${pin}) leu o valor ${n}.`,
      };
      this.state.lastEvent = ev;
      return ev;
    }

    // Caso 2: scanf tradicional.
    const varName = ai.varName!;
    const { type, indices, scope } = ai;
    let val: number | string = raw;
    if (type === "int") val = Math.trunc(parseFloat(raw) || 0);
    else if (type === "float" || type === "double") val = parseFloat(raw) || 0;
    else if (type === "char") val = raw[0] ?? "";
    const v = this.vars.find((vv) => vv.name === varName);
    if (!v) {
      this.state.error = `Variável '${varName}' não encontrada.`;
      this.state.awaitingInput = null;
      return { kind: "error", line: this.state.currentLine, message: this.state.error };
    }
    this.clearFlags();
    try {
      if (indices && indices.length > 0) {
        this.setIndexed(varName, scope ?? v.scope, indices, val);
      } else {
        v.value = this.coerce(type, val);
        v.uninit = false;
        v.justChanged = true;
      }
    } catch (e) {
      this.state.error = errorMessage(e);
      this.state.awaitingInput = null;
      this.state.finished = true;
      return { kind: "error", line: this.state.currentLine, message: this.state.error! };
    }
    this.state.awaitingInput = null;
    this.syncState();
    const display = indices ? `${varName}[${indices.join("][")}]` : varName;
    const ev: StepEvent = {
      kind: "update-var",
      line: this.state.currentLine,
      message: `'${display}' recebeu o valor digitado.`,
      varName,
    };
    this.state.lastEvent = ev;
    return ev;
  }

  /** Atualiza dinamicamente quanto tempo o relógio avança a cada iteração de loop. */
  setMsPerLoop(ms: number) {
    this.state.msPerLoop = Math.max(0, Math.trunc(ms));
  }
}
