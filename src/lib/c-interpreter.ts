/**
 * Interpretador didático de um subset da linguagem C.
 * Suporta:
 *  - Tipos: int, float, double, char
 *  - Declaração com/sem inicialização: int x = 5;  float a, b = 2.0;
 *  - Atribuições e expressões aritméticas (+ - * / %), comparações (== != < > <= >=), lógicos (&& || !)
 *  - printf("...", args)  com %d %f %lf %c %s e \n
 *  - scanf("...", &var)  (uma variável por chamada para simplicidade didática)
 *  - if / else  com blocos { }
 *  - while ( ... ) { ... }
 *  - for (init; cond; step) { ... }
 *  - Funções com e sem retorno (sem recursão profunda — mas funcional)
 *  - return expr;
 *
 * A execução é incremental: cada chamada a step() avança UMA "linha lógica"
 * (ou uma sub-etapa relevante para visualização).
 */

export type CType = "int" | "float" | "double" | "char" | "long" | "unsigned long" | "unsigned int";

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
  A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19,
  // Placas com mais entradas analógicas (Mega etc.)
  A6: 20, A7: 21,
};

/** Extrai o número da linha de uma mensagem de erro do parser/interpretador. */
function extractLineFromError(msg: string): number | null {
  if (!msg) return null;
  // Pega o ÚLTIMO "linha N" da string (no caso de ';' faltante temos duas linhas; queremos a primeira reportada).
  const matches = [...msg.matchAll(/linha\s+(\d+)/gi)];
  if (matches.length === 0) return null;
  return parseInt(matches[0][1], 10);
}

export interface Variable {
  name: string;
  type: CType;
  value: number | string | (number | string)[] | (number | string)[][];
  scope: string; // nome da função / "global"
  justChanged?: boolean;
  justCreated?: boolean;
  /** Dimensões para arrays/matrizes. undefined = escalar. [n] = vetor. [r,c] = matriz. */
  dims?: number[];
  /** Índice(s) modificado(s) recentemente (para destaque visual). */
  lastIndex?: number[];
}

export interface OutputLine {
  text: string;
  id: number;
}

export type StepEventKind =
  | "create-var"
  | "update-var"
  | "print"
  | "input-request"
  | "enter-block"
  | "exit-block"
  | "call-function"
  | "return"
  | "noop"
  | "finished"
  | "error";

export interface StepEvent {
  kind: StepEventKind;
  line: number; // linha de origem (1-based)
  message: string;
  varName?: string;
  /** Destaque por trecho na linha: [colStart, colEnd] (1-based, inclusivos). Quando ausente, destaca a linha inteira. */
  highlight?: { line: number; colStart: number; colEnd: number };
}

export interface InterpreterState {
  variables: Variable[];
  output: OutputLine[];
  currentLine: number;
  finished: boolean;
  awaitingInput: null | {
    /** Quando há variável destino (scanf). */
    varName?: string;
    type: CType;
    prompt: string;
    indices?: number[];
    scope?: string;
    /** Quando a entrada vem de uma leitura de pino do Arduino (digitalRead/analogRead). */
    pinRead?: { fn: "digitalRead" | "analogRead"; pin: number; callExpr: Expr };
  };
  lastEvent: StepEvent | null;
  error: string | null;
  highlight: StepEvent["highlight"] | null;
  returns: ReturnRecord[];
  /** Tempo de execução simulado em milissegundos (avança com delay() e a cada iteração de loop). */
  simMillis: number;
  /** Quantos ms o relógio avança automaticamente a cada iteração da função loop. */
  msPerLoop: number;
  /** Quantas iterações de loop() já foram executadas. */
  loopIterations: number;
  /** True quando o programa estiver no modelo Arduino (setup/loop) em vez de main. */
  arduinoMode: boolean;
  /** Pinos configurados como OUTPUT (via pinMode) e seus valores atuais (digital/analogWrite). */
  pinStates: PinState[];
}

export interface PinState {
  pin: number;
  /** "digital"/"analog" para OUTPUT (write); "input-digital"/"input-analog" para INPUT (read). */
  kind: "digital" | "analog" | "input-digital" | "input-analog";
  /** Direção do pino. */
  direction: "OUTPUT" | "INPUT" | "INPUT_PULLUP";
  /** Último valor escrito/lido. null = configurado mas ainda sem write/read. */
  value: number | null;
  justChanged?: boolean;
  justCreated?: boolean;
}

export interface ReturnRecord {
  id: number;
  fnName: string;
  value: number | string;
  line: number;
  justReturned?: boolean;
}

// ---------------- AST ----------------

type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "char"; v: string }
  | { k: "ident"; name: string }
  | { k: "bin"; op: string; a: Expr; b: Expr }
  | { k: "un"; op: string; a: Expr }
  | { k: "assign"; name: string; v: Expr; indices?: Expr[] }
  | { k: "call"; name: string; args: Expr[] }
  | { k: "index"; name: string; indices: Expr[] };

type Stmt =
  | { k: "decl"; type: CType; items: { name: string; init: Expr | null; dims?: number[]; arrayInit?: ArrayInit }[]; line: number }
  | { k: "expr"; e: Expr; line: number }
  | { k: "printf"; fmt: string; args: Expr[]; line: number }
  | { k: "scanf"; fmt: string; targets: ScanfTarget[]; line: number }
  | { k: "if"; cond: Expr; then: Stmt[]; else: Stmt[] | null; line: number; thenEndLine?: number; elseEndLine?: number }
  | { k: "while"; cond: Expr; body: Stmt[]; line: number; endLine?: number }
  | { k: "for"; init: Stmt | null; cond: Expr | null; step: Expr | null; body: Stmt[]; line: number; endLine?: number;
      initRange?: Range; condRange?: Range; stepRange?: Range }
  | { k: "return"; e: Expr | null; line: number }
  | { k: "block"; body: Stmt[]; line: number; endLine?: number };

interface Range { line: number; colStart: number; colEnd: number }

/** Inicializador de array: lista plana (1D) ou aninhada (2D). */
type ArrayInit = (number | string)[] | (number | string)[][];

/** Alvo de scanf: nome de variável, com índices opcionais para vetor/matriz. */
interface ScanfTarget { name: string; indices?: Expr[] }

interface FnDef {
  name: string;
  retType: CType | "void";
  params: { type: CType; name: string }[];
  body: Stmt[];
  line?: number;       // linha da declaração 'int main() {'
  headerEndCol?: number; // coluna final do '{' de abertura (para destaque)
  endLine?: number;      // linha do '}' de fechamento da função
}

// ---------------- Tokenizer ----------------

interface Tok {
  t: string;       // categoria
  v: string;       // valor
  line: number;
  col: number;     // 1-based, posição inicial
  endCol: number;  // 1-based, posição final inclusiva
}

const KEYWORDS = new Set([
  "int", "float", "double", "char", "void",
  "unsigned", "long",
  "if", "else", "while", "for", "return",
  "printf", "scanf",
]);

export interface Directive {
  line: number;
  text: string;        // ex: "#include <stdio.h>"
  name: string;        // ex: "stdio.h"
  colStart: number;
  colEnd: number;
}

function tokenize(src: string, directives?: Directive[]): Tok[] {
  const toks: Tok[] = [];
  let i = 0, line = 1, lineStart = 0;
  const colOf = (pos: number) => pos - lineStart + 1;
  const push = (t: string, v: string, ln: number, startPos: number, endPos: number, startLineStart: number) => {
    toks.push({ t, v, line: ln, col: startPos - startLineStart + 1, endCol: endPos - startLineStart });
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") { line++; i++; lineStart = i; continue; }
    if (/\s/.test(c)) { i++; continue; }
    // comentários
    if (c === "/" && src[i+1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i+1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i+1] === "/")) { if (src[i] === "\n") { line++; lineStart = i + 1; } i++; } i += 2; continue; }
    // diretivas do pré-processador — capturadas como "directives" para fins didáticos
    if (c === "#") {
      const dirStart = i;
      const dirLineStart = lineStart;
      const dirLine = line;
      while (i < src.length && src[i] !== "\n") i++;
      const text = src.slice(dirStart, i);
      if (directives) {
        const m = text.match(/^#\s*include\s*[<"]([^>"]+)[>"]/);
        directives.push({
          line: dirLine,
          text,
          name: m ? m[1] : text.replace(/^#\s*\w+\s*/, "").trim(),
          colStart: dirStart - dirLineStart + 1,
          colEnd: i - dirLineStart,
        });
      }
      continue;
    }
    // string
    if (c === '"') {
      const start = i; const sLineStart = lineStart; let s = ""; i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && i+1 < src.length) {
          const n = src[i+1];
          s += n === "n" ? "\n" : n === "t" ? "\t" : n === "\\" ? "\\" : n === '"' ? '"' : n;
          i += 2;
        } else { s += src[i++]; }
      }
      i++; push("str", s, line, start, i, sLineStart); continue;
    }
    // char literal
    if (c === "'") {
      const start = i; const sLineStart = lineStart; i++;
      let ch = "";
      if (src[i] === "\\") { ch = src[i+1] === "n" ? "\n" : src[i+1]; i += 2; }
      else { ch = src[i]; i++; }
      i++; // closing '
      push("char", ch, line, start, i, sLineStart); continue;
    }
    // número
    if (/[0-9]/.test(c)) {
      const start = i; const sLineStart = lineStart; let s = "";
      while (i < src.length && /[0-9.]/.test(src[i])) s += src[i++];
      push("num", s, line, start, i, sLineStart); continue;
    }
    // identificador / keyword
    if (/[A-Za-z_]/.test(c)) {
      const start = i; const sLineStart = lineStart; let s = "";
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) s += src[i++];
      push(KEYWORDS.has(s) ? s : "id", s, line, start, i, sLineStart); continue;
    }
    // operadores compostos
    const two = src.slice(i, i+2);
    if (["==","!=","<=",">=","&&","||","++","--","+=","-=","*=","/="].includes(two)) {
      const start = i; push(two, two, line, start, i + 2, lineStart); i += 2; continue;
    }
    // simples
    if ("+-*/%=<>!(){};,&[]".includes(c)) {
      const start = i; push(c, c, line, start, i + 1, lineStart); i++; continue;
    }
    throw new Error(`Caractere inesperado '${c}' na linha ${line}`);
  }
  toks.push({ t: "eof", v: "", line, col: i - lineStart + 1, endCol: i - lineStart + 1 });
  void colOf;
  return toks;
}

// ---------------- Parser ----------------

class Parser {
  i = 0;
  constructor(public toks: Tok[]) {}
  peek(o = 0) { return this.toks[this.i + o]; }
  eat(t?: string): Tok {
    const tk = this.toks[this.i];
    if (t && tk.t !== t) {
      // Para ';' faltante, o erro real está no fim da instrução anterior.
      // Reportar a linha do token anterior ajuda o aluno a localizar a causa.
      if (t === ";") {
        const prev = this.toks[this.i - 1];
        const reportLine = prev ? prev.line : tk.line;
        // Se o token encontrado está na MESMA linha do token anterior, o problema
        // provavelmente NÃO é um ';' faltante — é um token inesperado no meio
        // da instrução (ex.: "int x 5;" — falta o '=' antes do 5).
        if (prev && prev.line === tk.line) {
          // Caso especial: instrução do tipo "in x = 5;" — "in" foi lido como id
          // (não é palavra-chave), e logo em seguida vem outro id. Provável tipo
          // digitado errado.
          const prev2 = this.toks[this.i - 2];
          const isStartOfStmt = !prev2 || prev2.t === ";" || prev2.t === "{" || prev2.t === "}";
          if (prev.t === "id" && tk.t === "id" && isStartOfStmt) {
            throw new Error(`Declaração inválida na linha ${tk.line}: '${prev.v}' não é um tipo válido. Você quis dizer 'int', 'float', 'double' ou 'char'? (encontrado: '${prev.v} ${tk.v}')`);
          }
          if (prev.t === "id" && isStartOfStmt) {
            throw new Error(`Token inesperado '${tk.v}' na linha ${tk.line} — '${prev.v}' não é um tipo nem uma instrução reconhecida. Verifique se você digitou o tipo corretamente (int, float, double, char) ou se falta um operador como '='.`);
          }
          throw new Error(`Token inesperado '${tk.v}' na linha ${tk.line} — verifique a sintaxe da instrução (talvez falte um operador como '=').`);
        }
        throw new Error(`Esperado ';' ao final da linha ${reportLine} (encontrado '${tk.v}' na linha ${tk.line})`);
      }
      if (t === "id") {
        const prev = this.toks[this.i - 1];
        // Tipo seguido de algo que não é identificador → declaração inválida.
        if (prev && ["int", "float", "double", "char"].includes(prev.t)) {
          throw new Error(`Declaração de variável inválida na linha ${tk.line}: após o tipo '${prev.v}' era esperado um nome de variável, mas foi encontrado '${tk.v}'. Lembre-se: nomes de variáveis não podem começar com número e não podem ser palavras reservadas.`);
        }
        throw new Error(`Esperado um identificador (nome) mas encontrado '${tk.v}' na linha ${tk.line}.`);
      }
      throw new Error(`Esperado '${t}' mas encontrado '${tk.v}' (linha ${tk.line})`);
    }
    this.i++; return tk;
  }
  match(...ts: string[]) { return ts.includes(this.peek().t); }

  parseProgram(): { fns: FnDef[]; globals: Stmt[] } {
    const fns: FnDef[] = [];
    const globals: Stmt[] = [];
    while (!this.match("eof")) {
      if (this.isFnDecl()) fns.push(this.parseFn());
      else globals.push(this.parseStmt());
    }
    return { fns, globals };
  }

  isFnDecl(): boolean {
    // tipo  ident  (
    // Handle multi-word types: unsigned long, unsigned int, long
    let offset = 0;
    const a = this.peek(0);
    if (a.v === "unsigned") {
      const b = this.peek(1);
      if (b && (b.v === "long" || b.v === "int")) {
        offset = 2;
      } else {
        offset = 1; // "unsigned" alone → treat as unsigned int
      }
    } else if (a.v === "long") {
      offset = 1;
    } else {
      const isType = ["int","float","double","char","void"].includes(a.t);
      if (!isType) return false;
      offset = 1;
    }
    const nameT = this.peek(offset);
    const parenT = this.peek(offset + 1);
    return nameT?.t === "id" && parenT?.t === "(";
  }

  parseType(): CType | "void" {
    const tk = this.peek();
    if (tk.v === "unsigned") {
      this.eat();
      const next = this.peek();
      if (next.v === "long") { this.eat(); return "unsigned long"; }
      if (next.v === "int") { this.eat(); return "unsigned int"; }
      return "unsigned int"; // "unsigned" alone → unsigned int
    }
    if (tk.v === "long") {
      this.eat();
      return "long";
    }
    const t = this.eat().t;
    return t as CType | "void";
  }

  parseFn(): FnDef {
    const startTok = this.peek();
    const retType = this.parseType();
    const name = this.eat("id").v;
    this.eat("(");
    const params: { type: CType; name: string }[] = [];
    if (!this.match(")")) {
      do {
        const pt = this.parseType() as CType;
        const pn = this.eat("id").v;
        params.push({ type: pt, name: pn });
      } while (this.match(",") && (this.eat(","), true));
    }
    this.eat(")");
    const braceTok = this.eat("{");
    const body: Stmt[] = [];
    while (!this.match("}")) body.push(this.parseStmt());
    const closeBrace = this.eat("}");
    return { name, retType, params, body, line: startTok.line, headerEndCol: braceTok.endCol, endLine: closeBrace.line };
  }

  parseStmt(): Stmt {
    const tk = this.peek();
    if (["int","float","double","char"].includes(tk.t) || tk.v === "unsigned" || tk.v === "long") return this.parseDecl();
    if (tk.t === "if") return this.parseIf();
    if (tk.t === "while") return this.parseWhile();
    if (tk.t === "for") return this.parseFor();
    if (tk.t === "return") return this.parseReturn();
    if (tk.t === "printf") return this.parsePrintf();
    if (tk.t === "scanf") return this.parseScanf();
    if (tk.t === "{") {
      const line = tk.line;
      this.eat("{");
      const body: Stmt[] = [];
      while (!this.match("}")) body.push(this.parseStmt());
      const close = this.eat("}");
      return { k: "block", body, line, endLine: close.line };
    }
    const line = tk.line;
    const e = this.parseExpr();
    this.eat(";");
    return { k: "expr", e, line };
  }

  parseDecl(): Stmt {
    const line = this.peek().line;
    const type = this.parseType() as CType;
    const items: { name: string; init: Expr | null; dims?: number[]; arrayInit?: ArrayInit }[] = [];
    do {
      const name = this.eat("id").v;
      // Suporte a arrays: int a[5];  int m[3][4];
      const dims: number[] = [];
      while (this.match("[")) {
        this.eat("[");
        const sizeTok = this.eat("num");
        const n = parseInt(sizeTok.v, 10);
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error(`Tamanho inválido para o vetor '${name}' na linha ${line}: '${sizeTok.v}'. Use um número inteiro positivo.`);
        }
        dims.push(n);
        this.eat("]");
      }
      let init: Expr | null = null;
      let arrayInit: ArrayInit | undefined;
      if (this.match("=")) {
        this.eat("=");
        if (dims.length > 0 && this.match("{")) {
          arrayInit = this.parseArrayInitLiteral(dims.length);
        } else {
          init = this.parseExpr();
        }
      }
      items.push({ name, init, dims: dims.length ? dims : undefined, arrayInit });
    } while (this.match(",") && (this.eat(","), true));
    this.eat(";");
    return { k: "decl", type, items, line };
  }

  /** Lê um literal do tipo {1,2,3} (1D) ou {{1,2},{3,4}} (2D). Os valores são tratados como números/chars literais. */
  parseArrayInitLiteral(depth: number): ArrayInit {
    this.eat("{");
    if (depth === 1) {
      const arr: (number | string)[] = [];
      if (!this.match("}")) {
        do {
          const tk = this.peek();
          if (tk.t === "num") { this.eat(); arr.push(parseFloat(tk.v)); }
          else if (tk.t === "char") { this.eat(); arr.push(tk.v); }
          else if (tk.t === "-" && this.toks[this.i + 1]?.t === "num") {
            this.eat("-"); const n = this.eat("num"); arr.push(-parseFloat(n.v));
          } else {
            throw new Error(`Inicializador de vetor inválido na linha ${tk.line}: esperado número ou caractere, encontrado '${tk.v}'.`);
          }
        } while (this.match(",") && (this.eat(","), true));
      }
      this.eat("}");
      return arr;
    }
    // 2D: lista de listas
    const mat: (number | string)[][] = [];
    if (!this.match("}")) {
      do {
        mat.push(this.parseArrayInitLiteral(1) as (number | string)[]);
      } while (this.match(",") && (this.eat(","), true));
    }
    this.eat("}");
    return mat;
  }

  parseIf(): Stmt {
    const line = this.eat("if").line;
    this.eat("("); const cond = this.parseExpr(); this.eat(")");
    const thenInfo = this.parseBlockOrStmtWithEnd();
    let elseB: Stmt[] | null = null;
    let elseEnd: number | undefined;
    if (this.match("else")) {
      this.eat("else");
      const elseInfo = this.parseBlockOrStmtWithEnd();
      elseB = elseInfo.body;
      elseEnd = elseInfo.endLine;
    }
    return { k: "if", cond, then: thenInfo.body, else: elseB, line, thenEndLine: thenInfo.endLine, elseEndLine: elseEnd };
  }

  parseWhile(): Stmt {
    const line = this.eat("while").line;
    this.eat("("); const cond = this.parseExpr(); this.eat(")");
    const info = this.parseBlockOrStmtWithEnd();
    return { k: "while", cond, body: info.body, line, endLine: info.endLine };
  }

  parseFor(): Stmt {
    const line = this.eat("for").line;
    this.eat("(");
    let init: Stmt | null = null;
    let initRange: Range | undefined;
    const initStartTok = this.peek();
    if (!this.match(";")) {
      if (["int","float","double","char"].includes(this.peek().t) || this.peek().v === "unsigned" || this.peek().v === "long") init = this.parseDecl();
      else { const e = this.parseExpr(); this.eat(";"); init = { k: "expr", e, line }; }
      const semi = this.toks[this.i - 1]; // token ';' que acabou de ser consumido
      initRange = { line: initStartTok.line, colStart: initStartTok.col, colEnd: semi.endCol - 1 };
    } else this.eat(";");
    let cond: Expr | null = null;
    let condRange: Range | undefined;
    const condStartTok = this.peek();
    if (!this.match(";")) cond = this.parseExpr();
    const condEndTok = this.toks[this.i]; // ';'
    if (cond) condRange = { line: condStartTok.line, colStart: condStartTok.col, colEnd: condEndTok.col - 1 };
    this.eat(";");
    let step: Expr | null = null;
    let stepRange: Range | undefined;
    const stepStartTok = this.peek();
    if (!this.match(")")) step = this.parseExpr();
    const stepEndTok = this.toks[this.i]; // ')'
    if (step) stepRange = { line: stepStartTok.line, colStart: stepStartTok.col, colEnd: stepEndTok.col - 1 };
    this.eat(")");
    const info = this.parseBlockOrStmtWithEnd();
    return { k: "for", init, cond, step, body: info.body, line, endLine: info.endLine, initRange, condRange, stepRange };
  }

  parseReturn(): Stmt {
    const line = this.eat("return").line;
    let e: Expr | null = null;
    if (!this.match(";")) e = this.parseExpr();
    this.eat(";");
    return { k: "return", e, line };
  }

  parsePrintf(): Stmt {
    const line = this.eat("printf").line;
    this.eat("("); 
    const fmtTok = this.eat("str");
    const args: Expr[] = [];
    while (this.match(",")) { this.eat(","); args.push(this.parseExpr()); }
    this.eat(")"); this.eat(";");
    return { k: "printf", fmt: fmtTok.v, args, line };
  }

  parseScanf(): Stmt {
    const line = this.eat("scanf").line;
    this.eat("(");
    const fmtTok = this.eat("str");
    const targets: ScanfTarget[] = [];
    while (this.match(",")) {
      this.eat(",");
      if (this.match("&")) this.eat("&");
      const name = this.eat("id").v;
      const indices: Expr[] = [];
      while (this.match("[")) {
        this.eat("[");
        indices.push(this.parseExpr());
        this.eat("]");
      }
      targets.push(indices.length ? { name, indices } : { name });
    }
    this.eat(")"); this.eat(";");
    return { k: "scanf", fmt: fmtTok.v, targets, line };
  }

  parseBlockOrStmt(): Stmt[] {
    if (this.match("{")) {
      this.eat("{");
      const body: Stmt[] = [];
      while (!this.match("}")) body.push(this.parseStmt());
      this.eat("}");
      return body;
    }
    return [this.parseStmt()];
  }

  /** Igual a parseBlockOrStmt mas também devolve a linha do '}' (ou da última stmt). */
  parseBlockOrStmtWithEnd(): { body: Stmt[]; endLine: number } {
    if (this.match("{")) {
      this.eat("{");
      const body: Stmt[] = [];
      while (!this.match("}")) body.push(this.parseStmt());
      const close = this.eat("}");
      return { body, endLine: close.line };
    }
    const s = this.parseStmt();
    return { body: [s], endLine: (s as any).endLine ?? s.line };
  }

  // expressões com precedência
  parseExpr(): Expr { return this.parseAssign(); }
  parseAssign(): Expr {
    const left = this.parseLogicOr();
    if (this.match("=")) {
      this.eat("=");
      const right = this.parseAssign();
      if (left.k === "ident") return { k: "assign", name: left.name, v: right };
      if (left.k === "index") return { k: "assign", name: left.name, v: right, indices: left.indices };
      throw new Error("Lado esquerdo de '=' inválido");
    }
    if (this.match("+=","-=","*=","/=")) {
      const op = this.eat().t[0];
      const right = this.parseAssign();
      if (left.k === "ident") return { k: "assign", name: left.name, v: { k: "bin", op, a: left, b: right } };
      if (left.k === "index") return { k: "assign", name: left.name, v: { k: "bin", op, a: left, b: right }, indices: left.indices };
      throw new Error("Lado esquerdo inválido");
    }
    return left;
  }
  parseLogicOr(): Expr {
    let a = this.parseLogicAnd();
    while (this.match("||")) { this.eat(); a = { k: "bin", op: "||", a, b: this.parseLogicAnd() }; }
    return a;
  }
  parseLogicAnd(): Expr {
    let a = this.parseEq();
    while (this.match("&&")) { this.eat(); a = { k: "bin", op: "&&", a, b: this.parseEq() }; }
    return a;
  }
  parseEq(): Expr {
    let a = this.parseCmp();
    while (this.match("==","!=")) { const op = this.eat().t; a = { k: "bin", op, a, b: this.parseCmp() }; }
    return a;
  }
  parseCmp(): Expr {
    let a = this.parseAdd();
    while (this.match("<",">","<=",">=")) { const op = this.eat().t; a = { k: "bin", op, a, b: this.parseAdd() }; }
    return a;
  }
  parseAdd(): Expr {
    let a = this.parseMul();
    while (this.match("+","-")) { const op = this.eat().t; a = { k: "bin", op, a, b: this.parseMul() }; }
    return a;
  }
  parseMul(): Expr {
    let a = this.parseUnary();
    while (this.match("*","/","%")) { const op = this.eat().t; a = { k: "bin", op, a, b: this.parseUnary() }; }
    return a;
  }
  parseUnary(): Expr {
    if (this.match("-","!","+")) { const op = this.eat().t; return { k: "un", op, a: this.parseUnary() }; }
    if (this.match("++","--")) { const op = this.eat().t; const a = this.parseUnary(); return { k: "un", op: "pre" + op, a }; }
    return this.parsePostfix();
  }
  parsePostfix(): Expr {
    const a = this.parsePrimary();
    if (this.match("++","--")) { const op = this.eat().t; return { k: "un", op: "post" + op, a }; }
    return a;
  }
  parsePrimary(): Expr {
    const tk = this.peek();
    if (tk.t === "num") { this.eat(); return { k: "num", v: parseFloat(tk.v) }; }
    if (tk.t === "str") { this.eat(); return { k: "str", v: tk.v }; }
    if (tk.t === "char") { this.eat(); return { k: "char", v: tk.v }; }
    if (tk.t === "(") { this.eat(); const e = this.parseExpr(); this.eat(")"); return e; }
    if (tk.t === "id") {
      this.eat();
      if (this.match("(")) {
        this.eat("(");
        const args: Expr[] = [];
        if (!this.match(")")) {
          args.push(this.parseExpr());
          while (this.match(",")) { this.eat(","); args.push(this.parseExpr()); }
        }
        this.eat(")");
        return { k: "call", name: tk.v, args };
      }
      if (this.match("[")) {
        const indices: Expr[] = [];
        while (this.match("[")) {
          this.eat("[");
          indices.push(this.parseExpr());
          this.eat("]");
        }
        return { k: "index", name: tk.v, indices };
      }
      return { k: "ident", name: tk.v };
    }
    throw new Error(`Token inesperado '${tk.v}' (linha ${tk.line})`);
  }
}

// ---------------- Executor ----------------

/**
 * Frame de execução: representa um statement ou sub-tarefa pendente.
 * Usamos uma pilha de "tarefas" para permitir avanço passo-a-passo.
 */
type Task =
  | { kind: "stmt"; stmt: Stmt; scope: string }
  | { kind: "block-end"; scope: string; isFunctionFrame?: boolean; line: number; fnName?: string; callExpr?: Expr }
  | { kind: "while-check"; cond: Expr; body: Stmt[]; scope: string; line: number; endLine?: number }
  | { kind: "for-init"; forStmt: Extract<Stmt, { k: "for" }>; scope: string }
  | { kind: "for-cond"; forStmt: Extract<Stmt, { k: "for" }>; scope: string }
  | { kind: "for-step"; forStmt: Extract<Stmt, { k: "for" }>; scope: string }
  | { kind: "scanf-pending"; targets: string[]; idx: number; scope: string; line: number; prompt: string }
  | { kind: "info"; event: StepEvent }
  /** Marca o início de uma chamada de função executada passo-a-passo. */
  | { kind: "fn-call-start"; fn: FnDef; args: Expr[]; argScope: string; callExpr: Expr }
  /** Encerra a chamada: limpa escopo e grava valor de retorno no cache. */
  | { kind: "fn-call-end"; scope: string; fnName: string; line: number; callExpr: Expr }
  /** Avança o relógio simulado e re-empilha uma nova iteração de loop(). */
  | { kind: "loop-iteration"; line: number }
  /** Aguarda valor de leitura de pino (digitalRead/analogRead). */
  | { kind: "pin-read"; fn: "digitalRead" | "analogRead"; pin: number; callExpr: Expr; line: number; scope: string };

function describeDirective(d: Directive): string {
  const name = d.name.toLowerCase();
  if (name === "stdio.h") return "Incluindo a biblioteca <stdio.h> — necessária para usar printf e scanf (entrada e saída padrão).";
  if (name === "stdlib.h") return "Incluindo a biblioteca <stdlib.h> — funções utilitárias (malloc, free, rand, exit, etc.).";
  if (name === "string.h") return "Incluindo a biblioteca <string.h> — funções para manipulação de strings (strlen, strcpy, strcmp, etc.).";
  if (name === "math.h") return "Incluindo a biblioteca <math.h> — funções matemáticas (sqrt, pow, sin, cos, etc.).";
  if (d.text.trim().startsWith("#include")) return `Incluindo a biblioteca '${d.name}' no programa.`;
  if (d.text.trim().startsWith("#define")) return `Diretiva do pré-processador: ${d.text.trim()}`;
  return `Diretiva do pré-processador: ${d.text.trim()}`;
}

/** Funções nativas do "ambiente Arduino" reconhecidas pelo interpretador. */
const ARDUINO_BUILTINS = new Set([
  "digitalRead", "analogRead",
  "digitalWrite", "analogWrite",
  "pinMode", "delay", "delayMicroseconds", "millis", "micros",
  "Serial_begin", // não usado, placeholder
]);

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
function preprocessArduinoSerial(src: string): { source: string; beginLines: Set<number> } {
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
 * Conta '{' e '}' fora de strings, chars e comentários.
 * Usado para detectar chaves desbalanceadas com mensagem clara.
 */
function checkBraceBalance(src: string): { open: number; close: number } {
  let open = 0, close = 0;
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

  constructor(public source: string, msPerLoop = 100) {
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
      const { source: preprocessed, beginLines } = preprocessArduinoSerial(source);
      this.serialBeginLines = beginLines;

      // Verificação de balanceamento de chaves '{' e '}' antes do parsing.
      // Ignora ocorrências dentro de strings, chars e comentários.
      const braceCheck = checkBraceBalance(preprocessed);
      if (braceCheck.open !== braceCheck.close) {
        const diff = braceCheck.open - braceCheck.close;
        if (diff > 0) {
          throw new Error(
            `Chaves desbalanceadas: há ${braceCheck.open} '{' e ${braceCheck.close} '}'. Faltou fechar ${diff} '}' no código.`
          );
        } else {
          throw new Error(
            `Chaves desbalanceadas: há ${braceCheck.open} '{' e ${braceCheck.close} '}'. Há ${-diff} '}' a mais (ou faltou abrir '{').`
          );
        }
      }

      const toks = tokenize(preprocessed, directives);
      const parser = new Parser(toks);
      const { fns, globals } = parser.parseProgram();
      for (const f of fns) this.fns[f.name] = f;

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

      // executar globais primeiro (declarações)
      for (const g of globals) intro.push({ kind: "stmt", stmt: g, scope: "global" });

      const setupFn = this.fns["setup"];
      const loopFn = this.fns["loop"];
      const mainFn = this.fns["main"];

      if (setupFn || loopFn) {
        // Modo Arduino — exigir ambas as funções.
        this.state.arduinoMode = true;
        if (!setupFn) throw new Error("Função 'setup' não encontrada. Em Arduino, 'setup' é executada uma vez no início.");
        if (!loopFn) throw new Error("Função 'loop' não encontrada. Em Arduino, 'loop' é executada continuamente.");
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
          throw new Error("Nenhuma função 'setup'/'loop' (Arduino) nem 'main' (C) encontrada.");
        }
      }

      // Empilhar intro na ordem correta.
      this.stack = [...this.stack, ...intro.reverse()];
    } catch (e: any) {
      this.state.error = e.message;
      this.state.finished = true;
      const ln = extractLineFromError(e.message);
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
    for (const v of this.vars) { v.justChanged = false; v.justCreated = false; }
    for (const r of this.returns) r.justReturned = false;
    for (const p of this.state.pinStates) { p.justChanged = false; p.justCreated = false; }
  }

  private findVar(name: string, scope: string): Variable | undefined {
    return this.vars.find(v => v.name === name && v.scope === scope)
        ?? this.vars.find(v => v.name === name && v.scope === "global");
  }

  private setVar(name: string, scope: string, value: number | string) {
    const v = this.findVar(name, scope);
    if (!v) throw new Error(`Variável '${name}' não declarada.`);
    if (v.dims) {
      throw new Error(`'${name}' é um vetor/matriz — use índices para atribuir, ex.: '${name}[0] = ...'.`);
    }
    v.value = this.coerce(v.type, value);
    v.justChanged = true;
  }

  private setIndexed(name: string, scope: string, idxs: number[], value: number | string) {
    const v = this.findVar(name, scope);
    if (!v) throw new Error(`Variável '${name}' não declarada.`);
    if (!v.dims) throw new Error(`'${name}' não é um vetor — não pode ser indexado.`);
    if (idxs.length !== v.dims.length) {
      throw new Error(`'${name}' tem ${v.dims.length} dimensão(ões), mas foi indexado com ${idxs.length}.`);
    }
    for (let i = 0; i < idxs.length; i++) {
      if (idxs[i] < 0 || idxs[i] >= v.dims[i]) {
        throw new Error(`Índice fora do limite ao acessar '${name}': posição ${idxs[i]} (válido: 0 a ${v.dims[i] - 1}).`);
      }
    }
    const coerced = this.coerce(v.type, value);
    if (v.dims.length === 1) {
      (v.value as (number | string)[])[idxs[0]] = coerced;
    } else {
      (v.value as (number | string)[][])[idxs[0]][idxs[1]] = coerced;
    }
    v.justChanged = true;
    v.lastIndex = idxs.slice();
  }

  private getIndexed(name: string, scope: string, idxs: number[]): number | string {
    const v = this.findVar(name, scope);
    if (!v) throw new Error(`Variável '${name}' não declarada.`);
    if (!v.dims) throw new Error(`'${name}' não é um vetor — não pode ser indexado.`);
    if (idxs.length !== v.dims.length) {
      throw new Error(`'${name}' tem ${v.dims.length} dimensão(ões), mas foi indexado com ${idxs.length}.`);
    }
    for (let i = 0; i < idxs.length; i++) {
      if (idxs[i] < 0 || idxs[i] >= v.dims[i]) {
        throw new Error(`Índice fora do limite ao acessar '${name}': posição ${idxs[i]} (válido: 0 a ${v.dims[i] - 1}).`);
      }
    }
    if (v.dims.length === 1) return (v.value as (number | string)[])[idxs[0]];
    return (v.value as (number | string)[][])[idxs[0]][idxs[1]];
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
      if (it.dims.length === 1) {
        const arr: (number | string)[] = new Array(it.dims[0]).fill(zero);
        if (it.arrayInit) {
          const src = it.arrayInit as (number | string)[];
          for (let i = 0; i < Math.min(src.length, arr.length); i++) arr[i] = this.coerce(type, src[i]);
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
        }
        value = mat;
      }
      return { name: it.name, type, value, scope, dims: it.dims.slice(), justCreated };
    }
    const val = it.init ? this.evalExpr(it.init, scope) : 0;
    return { name: it.name, type, value: this.coerce(type, val), scope, justCreated };
  }

  private coerce(type: CType, val: number | string): number | string {
    if (type === "char") {
      if (typeof val === "string") return val[0] ?? "";
      return String.fromCharCode(Math.trunc(val as number));
    }
    if (type === "int") return Math.trunc(typeof val === "string" ? (val.charCodeAt(0) || 0) : val);
    return typeof val === "string" ? parseFloat(val) || 0 : val;
  }

  /** Converte uma Expr de volta a uma representação textual legível. */
  private exprToString(e: Expr): string {
    switch (e.k) {
      case "num": return String(e.v);
      case "str": return `"${e.v}"`;
      case "char": return `'${e.v}'`;
      case "ident": return e.name;
      case "bin": return `${this.exprToString(e.a)} ${e.op} ${this.exprToString(e.b)}`;
      case "un": return `${e.op}${this.exprToString(e.a)}`;
      case "assign": {
        const idx = e.indices ? e.indices.map(i => `[${this.exprToString(i)}]`).join("") : "";
        return `${e.name}${idx} = ${this.exprToString(e.v)}`;
      }
      case "call": return `${e.name}(${e.args.map(a => this.exprToString(a)).join(", ")})`;
      case "index": return `${e.name}${e.indices.map(i => `[${this.exprToString(i)}]`).join("")}`;
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
      case "bin": this.collectIdentValues(e.a, scope, out); this.collectIdentValues(e.b, scope, out); break;
      case "un": this.collectIdentValues(e.a, scope, out); break;
      case "call": e.args.forEach(a => this.collectIdentValues(a, scope, out)); break;
      case "index": {
        const v = this.findVar(e.name, scope);
        if (v) {
          try {
            const idxs = e.indices.map(ix => Math.trunc(Number(this.evalExpr(ix, scope))));
            let val: any = v.value;
            for (const i of idxs) val = (val as any[])[i];
            out.push(`${e.name}[${idxs.join("][")}] = ${val}`);
          } catch { /* ignore */ }
        }
        break;
      }
      case "assign": this.collectIdentValues(e.v, scope, out); break;
      default: break;
    }
  }

  private evalExpr(e: Expr, scope: string): number | string {
    switch (e.k) {
      case "num": return e.v;
      case "str": return e.v;
      case "char": return e.v;
      case "ident": {
        const c = ARDUINO_CONSTANTS[e.name];
        if (c !== undefined) return c;
        const v = this.findVar(e.name, scope);
        if (!v) throw new Error(`Variável '${e.name}' não declarada.`);
        if (v.dims) throw new Error(`'${e.name}' é um vetor — use índices, ex.: '${e.name}[0]'.`);
        return v.value as number | string;
      }
      case "index": {
        const idxs = e.indices.map(ix => Math.trunc(Number(this.evalExpr(ix, scope))));
        return this.getIndexed(e.name, scope, idxs);
      }
      case "assign": {
        const v = this.evalExpr(e.v, scope);
        if (e.indices && e.indices.length > 0) {
          const idxs = e.indices.map(ix => Math.trunc(Number(this.evalExpr(ix, scope))));
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
        if (e.op === "&&") return this.truthy(this.evalExpr(e.a, scope)) && this.truthy(this.evalExpr(e.b, scope)) ? 1 : 0;
        if (e.op === "||") return this.truthy(this.evalExpr(e.a, scope)) || this.truthy(this.evalExpr(e.b, scope)) ? 1 : 0;
        const a = this.evalExpr(e.a, scope) as number;
        const b = this.evalExpr(e.b, scope) as number;
        switch (e.op) {
          case "+": return (a as any) + (b as any);
          case "-": return a - b;
          case "*": return a * b;
          case "/": return b === 0 ? 0 : a / b;
          case "%": return a % b;
          case "==": return a === b ? 1 : 0;
          case "!=": return a !== b ? 1 : 0;
          case "<": return a < b ? 1 : 0;
          case ">": return a > b ? 1 : 0;
          case "<=": return a <= b ? 1 : 0;
          case ">=": return a >= b ? 1 : 0;
        }
        return 0;
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
          const ms = Math.max(0, Math.trunc(Number(this.evalExpr(e.args[0] ?? { k: "num", v: 0 }, scope))));
          this.state.simMillis += ms;
          return 0;
        }
        if (e.name === "delayMicroseconds") {
          const us = Math.max(0, Math.trunc(Number(this.evalExpr(e.args[0] ?? { k: "num", v: 0 }, scope))));
          this.state.simMillis += us / 1000;
          return 0;
        }
        if (e.name === "pinMode") {
          const pin = Math.trunc(Number(this.evalExpr(e.args[0] ?? { k: "num", v: 0 }, scope)));
          const modeRaw = this.evalExpr(e.args[1] ?? { k: "num", v: 0 }, scope);
          const isOutput = modeRaw === 1 || modeRaw === "OUTPUT" || Number(modeRaw) === 1;
          const isPullup = modeRaw === 2 || modeRaw === "INPUT_PULLUP" || Number(modeRaw) === 2;
          const direction: "OUTPUT" | "INPUT" | "INPUT_PULLUP" = isOutput ? "OUTPUT" : isPullup ? "INPUT_PULLUP" : "INPUT";
          // Remove configuração anterior do mesmo pino para refletir a nova direção.
          this.state.pinStates = this.state.pinStates.filter(p => p.pin !== pin);
          if (isOutput) {
            this.state.pinStates.push({ pin, kind: "digital", direction, value: 0, justCreated: true });
          } else {
            // INPUT / INPUT_PULLUP — começamos como input-digital; vira input-analog se um analogRead acontecer.
            const initial = isPullup ? 1 : 0;
            this.state.pinStates.push({ pin, kind: "input-digital", direction, value: initial, justCreated: true });
          }
          return 0;
        }
        if (e.name === "digitalWrite" || e.name === "analogWrite") {
          const pin = Math.trunc(Number(this.evalExpr(e.args[0] ?? { k: "num", v: 0 }, scope)));
          const val = Math.trunc(Number(this.evalExpr(e.args[1] ?? { k: "num", v: 0 }, scope)));
          const kind: "digital" | "analog" = e.name === "digitalWrite" ? "digital" : "analog";
          const existing = this.state.pinStates.find(p => p.pin === pin);
          if (existing) {
            existing.value = val;
            existing.kind = kind;
            existing.direction = "OUTPUT";
            existing.justChanged = true;
          } else {
            // Escrita sem pinMode prévio — cria o card automaticamente para visualização.
            this.state.pinStates.push({ pin, kind, direction: "OUTPUT", value: val, justCreated: true, justChanged: true });
          }
          return 0;
        }
        if (e.name === "digitalRead" || e.name === "analogRead") {
          // Sem cache: não há valor ainda. Lança um erro interno claro — o fluxo
          // step-by-step deve interceptar essa chamada antes (em collectUserCalls)
          // e abrir um diálogo de leitura. Fallback defensivo:
          throw new Error(`Leitura de pino '${e.name}' precisa ser tratada passo a passo. Use o botão 'Próxima linha'.`);
        }
        // chamada de função síncrona (sem step-by-step interno; resultado imediato)
        const fn = this.fns[e.name];
        if (!fn) throw new Error(`Função '${e.name}' não definida.`);
        const args = e.args.map(a => this.evalExpr(a, scope));
        return this.callFunctionSync(fn, args);
      }
    }
  }

  private truthy(v: number | string): boolean {
    if (typeof v === "string") return v.length > 0 && v !== "\0";
    return v !== 0;
  }

  /** Executa função inteira de forma síncrona (para uso dentro de expressões). */
  private callFunctionSync(fn: FnDef, args: (number | string)[]): number | string {
    const scope = fn.name + "#" + Math.random().toString(36).slice(2, 6);
    fn.params.forEach((p, i) => {
      this.vars.push({ name: p.name, type: p.type, value: this.coerce(p.type, args[i] ?? 0), scope });
    });
    let result: number | string = 0;
    try {
      this.runBlockSync(fn.body, scope);
    } catch (e: any) {
      if (e && e.__return !== undefined) result = e.__return;
      else throw e;
    }
    // remover vars do escopo
    this.vars = this.vars.filter(v => v.scope !== scope);
    return result;
  }

  private runBlockSync(body: Stmt[], scope: string) {
    for (const s of body) this.runStmtSync(s, scope);
  }

  private runStmtSync(s: Stmt, scope: string) {
    switch (s.k) {
      case "decl":
        for (const it of s.items) {
          this.vars.push(this.makeVarFromItem(s.type, it, scope, false));
        }
        break;
      case "expr": this.evalExpr(s.e, scope); break;
      case "printf": this.doPrintf(s, scope); break;
      case "scanf": throw new Error("scanf dentro de função chamada por expressão não é suportado.");
      case "if":
        if (this.truthy(this.evalExpr(s.cond, scope))) this.runBlockSync(s.then, scope);
        else if (s.else) this.runBlockSync(s.else, scope);
        break;
      case "while":
        while (this.truthy(this.evalExpr(s.cond, scope))) this.runBlockSync(s.body, scope);
        break;
      case "for":
        if (s.init) this.runStmtSync(s.init, scope);
        while (s.cond ? this.truthy(this.evalExpr(s.cond, scope)) : true) {
          this.runBlockSync(s.body, scope);
          if (s.step) this.evalExpr(s.step, scope);
        }
        break;
      case "return":
        throw { __return: s.e ? this.evalExpr(s.e, scope) : 0 };
      case "block": this.runBlockSync(s.body, scope); break;
    }
  }

  private doPrintf(s: Extract<Stmt, { k: "printf" }>, scope: string): string {
    let out = ""; let ai = 0;
    const fmt = s.fmt;
    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] === "%" && i + 1 < fmt.length) {
        const next = fmt[i + 1];
        const arg = s.args[ai++];
        const val = arg !== undefined ? this.evalExpr(arg, scope) : "";
        if (next === "d") out += String(Math.trunc(Number(val)));
        else if (next === "f") out += Number(val).toFixed(6);
        else if (next === "l" && fmt[i+2] === "f") { out += Number(val).toFixed(6); i++; }
        else if (next === "c") out += typeof val === "string" ? val : String.fromCharCode(Number(val));
        else if (next === "s") out += String(val);
        else out += "%" + next;
        i++;
      } else out += fmt[i];
    }
    // dividir em linhas para o console — preserva quebras
    const lines = out.split("\n");
    lines.forEach((ln, idx) => {
      if (idx === 0 && this.outputs.length > 0 && !this.outputs[this.outputs.length - 1].text.endsWith("\n")) {
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
    const scope = fn.name === "main" ? "main" : fn.name + "#" + Math.random().toString(36).slice(2, 6);
    fn.params.forEach((p, i) => {
      this.vars.push({ name: p.name, type: p.type, value: this.coerce(p.type, args[i] ?? 0), scope, justCreated: true });
    });
    // empilhar corpo (na ordem: primeiro stmt no topo)
    this.stack.push({ kind: "block-end", scope, isFunctionFrame: true, line: fn.endLine ?? fn.line ?? 0, fnName: fn.name });
    for (let i = fn.body.length - 1; i >= 0; i--) {
      this.stack.push({ kind: "stmt", stmt: fn.body[i], scope });
    }
  }

  /** Avança um passo. Retorna o evento gerado. */
  step(): StepEvent {
    this.clearFlags();
    if (this.state.error) return { kind: "error", line: 0, message: this.state.error };
    if (this.state.awaitingInput) return { kind: "input-request", line: this.state.currentLine, message: "Aguardando entrada do usuário..." };

    if (this.stack.length === 0) {
      this.state.finished = true;
      this.syncState();
      return { kind: "finished", line: this.state.currentLine, message: "Programa finalizado." };
    }

    let event: StepEvent;
    try {
      event = this.execNext();
    } catch (e: any) {
      this.state.error = e.message || String(e);
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
      case "stmt": return this.execStmt(task.stmt, task.scope);
      case "info": return task.event;
      case "block-end":
        if (task.isFunctionFrame) {
          this.vars = this.vars.filter(v => v.scope !== task.scope);
          // Se a função foi chamada via expressão, garantir que o cache tenha um valor (default 0).
          if (task.callExpr && !this.callResults.has(task.callExpr)) {
            this.callResults.set(task.callExpr, 0);
          }
          return { kind: "exit-block", line: task.line, message: task.fnName ? `Fim da função '${task.fnName}'.` : `Saindo do escopo da função.` };
        }
        return { kind: "exit-block", line: task.line, message: "Fim do bloco." };
      case "fn-call-start": {
        const fn = task.fn;
        // Avaliar argumentos no escopo do chamador (já podem ter resultados em cache).
        const argVals = task.args.map(a => this.evalExpr(a, task.argScope));
        const newScope = fn.name + "#" + Math.random().toString(36).slice(2, 6);
        fn.params.forEach((p, i) => {
          this.vars.push({ name: p.name, type: p.type, value: this.coerce(p.type, argVals[i] ?? 0), scope: newScope, justCreated: true });
        });
        // Empilhar o block-end (com callExpr para gravar valor de retorno) e o corpo.
        this.stack.push({ kind: "block-end", scope: newScope, isFunctionFrame: true, line: fn.endLine ?? fn.line ?? 0, fnName: fn.name, callExpr: task.callExpr });
        for (let i = fn.body.length - 1; i >= 0; i--) {
          this.stack.push({ kind: "stmt", stmt: fn.body[i], scope: newScope });
        }
        return {
          kind: "call-function",
          line: fn.line ?? 0,
          message: `Executando a função '${fn.name}' (definida na linha ${fn.line ?? "?"}) — vamos percorrê-la passo a passo.`,
          highlight: fn.line ? { line: fn.line, colStart: 1, colEnd: fn.headerEndCol ?? 9999 } : undefined,
        };
      }
      case "fn-call-end": {
        // Reservado para uso futuro; atualmente o block-end já trata o cleanup.
        return { kind: "noop", line: task.line, message: "" };
      }
      case "while-check": {
        const ok = this.truthy(this.evalExpr(task.cond, task.scope));
        if (ok) {
          this.stack.push(task); // re-avalia depois
          for (let i = task.body.length - 1; i >= 0; i--) this.stack.push({ kind: "stmt", stmt: task.body[i], scope: task.scope });
          return { kind: "enter-block", line: task.line, message: `Condição verdadeira → entrando no while.\n${this.condHint(task.cond, task.scope, true)}` };
        }
        return { kind: "exit-block", line: task.endLine ?? task.line, message: `Condição falsa → saindo do while.\n${this.condHint(task.cond, task.scope, false)}` };
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
        const ok = f.cond ? this.truthy(this.evalExpr(f.cond, task.scope)) : true;
        if (ok) {
          this.stack.push({ kind: "for-step", forStmt: f, scope: task.scope });
          for (let i = f.body.length - 1; i >= 0; i--) this.stack.push({ kind: "stmt", stmt: f.body[i], scope: task.scope });
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
        return { kind: "input-request", line: task.line, message: `Aguardando leitura de ${fnLabel}(pino ${task.pin}).` };
      }
    }
  }

  /**
   * Coleta chamadas que precisam ser executadas passo-a-passo ANTES da stmt:
   *  - chamadas a funções definidas pelo usuário (kind 'fn');
   *  - chamadas a digitalRead/analogRead (kind 'pin') — abrem diálogo de entrada.
   */
  private collectUserCalls(s: Stmt, scope: string):
    Array<
      | { kind: "fn"; expr: Extract<Expr, { k: "call" }>; fn: FnDef }
      | { kind: "pin"; expr: Extract<Expr, { k: "call" }>; fnName: "digitalRead" | "analogRead"; pin: number }
    > {
    type Item =
      | { kind: "fn"; expr: Extract<Expr, { k: "call" }>; fn: FnDef }
      | { kind: "pin"; expr: Extract<Expr, { k: "call" }>; fnName: "digitalRead" | "analogRead"; pin: number };
    const out: Item[] = [];
    const visitExpr = (e: Expr | null | undefined) => {
      if (!e) return;
      switch (e.k) {
        case "call": {
          // Visita argumentos primeiro (chamadas internas executam antes).
          for (const a of e.args) visitExpr(a);
          if (e.name === "digitalRead" || e.name === "analogRead") {
            // Avalia o argumento (número do pino) — pode usar valores em cache.
            const pin = Math.trunc(Number(this.evalExpr(e.args[0] ?? { k: "num", v: 0 }, scope)));
            out.push({ kind: "pin", expr: e, fnName: e.name, pin });
          } else {
            const fn = this.fns[e.name];
            if (fn) out.push({ kind: "fn", expr: e, fn });
          }
          break;
        }
        case "bin": visitExpr(e.a); visitExpr(e.b); break;
        case "un": visitExpr(e.a); break;
        case "assign": visitExpr(e.v); break;
      }
    };
    switch (s.k) {
      case "decl": for (const it of s.items) visitExpr(it.init); break;
      case "expr": visitExpr(s.e); break;
      case "printf": for (const a of s.args) visitExpr(a); break;
      case "return": visitExpr(s.e); break;
      case "if": visitExpr(s.cond); break;
      case "while": visitExpr(s.cond); break;
      // for/scanf/block: chamadas dentro de sub-stmts serão tratadas quando executadas
    }
    return out;
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
          } else {
            this.stack.push({
              kind: "pin-read",
              fn: c.fnName,
              pin: c.pin,
              callExpr: c.expr,
              line: s.line,
              scope,
            });
          }
        }
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
          this.vars.push(this.makeVarFromItem(s.type, it, scope, true));
          const dimsStr = it.dims ? "[" + it.dims.join("][") + "]" : "";
          names.push(it.name + dimsStr);
        }
        return { kind: "create-var", line: s.line, message: `Criando variável(is): ${names.join(", ")}`, varName: s.items[0].name };
      }
      case "expr": {
        // detectar atribuição para mensagem mais clara
        if (s.e.k === "assign") {
          this.evalExpr(s.e, scope);
          return { kind: "update-var", line: s.line, message: `Atualizando '${s.e.name}'`, varName: s.e.name };
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
        if (s.targets.length > 1) {
          const rest: Stmt = { k: "scanf", fmt: s.fmt, targets: s.targets.slice(1), line: s.line };
          this.stack.push({ kind: "stmt", stmt: rest, scope });
        }
        const idxs = tgt.indices ? tgt.indices.map(ix => Math.trunc(Number(this.evalExpr(ix, scope)))) : undefined;
        const display = idxs ? `${tgt.name}[${idxs.join("][")}]` : tgt.name;
        this.state.awaitingInput = { varName: tgt.name, type: v.type, prompt: `Digite o valor para '${display}' (${v.type}):`, indices: idxs, scope };
        return { kind: "input-request", line: s.line, message: `Aguardando entrada para '${display}'.`, varName: tgt.name };
      }
      case "if": {
        if (this.truthy(this.evalExpr(s.cond, scope))) {
          this.stack.push({ kind: "block-end", scope, line: s.thenEndLine ?? s.line });
          for (let i = s.then.length - 1; i >= 0; i--) this.stack.push({ kind: "stmt", stmt: s.then[i], scope });
          return { kind: "enter-block", line: s.line, message: `Condição verdadeira → entrando no if.\n${this.condHint(s.cond, scope, true)}` };
        }
        if (s.else) {
          this.stack.push({ kind: "block-end", scope, line: s.elseEndLine ?? s.line });
          for (let i = s.else.length - 1; i >= 0; i--) this.stack.push({ kind: "stmt", stmt: s.else[i], scope });
          return { kind: "enter-block", line: s.line, message: `Condição falsa → entrando no else.\n${this.condHint(s.cond, scope, false)}` };
        }
        return { kind: "noop", line: s.line, message: `Condição falsa → pulando if.\n${this.condHint(s.cond, scope, false)}` };
      }
      case "while": {
        this.stack.push({ kind: "while-check", cond: s.cond, body: s.body, scope, line: s.line, endLine: s.endLine });
        return { kind: "noop", line: s.line, message: "Avaliando condição do while." };
      }
      case "for": {
        // empilha sub-passos: init → cond → ... ; o for-init executa init e empilha cond.
        this.stack.push({ kind: "for-init", forStmt: s, scope });
        return { kind: "noop", line: s.line, message: "Iniciando laço for…" };
      }
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
            this.vars = this.vars.filter(v => v.scope !== t.scope);
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
        return { kind: "return", line: s.line, message: `Retornando da função (valor: ${retVal}).` };
      }
      case "block": {
        this.stack.push({ kind: "block-end", scope, line: s.endLine ?? s.line });
        for (let i = s.body.length - 1; i >= 0; i--) this.stack.push({ kind: "stmt", stmt: s.body[i], scope });
        return { kind: "enter-block", line: s.line, message: "Entrando em bloco." };
      }
    }
  }

  /** Fornece valor de entrada (scanf ou leitura de pino do Arduino). */
  provideInput(raw: string): StepEvent {
    if (!this.state.awaitingInput) return { kind: "noop", line: this.state.currentLine, message: "Nada esperando entrada." };
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
      const kind: "input-digital" | "input-analog" = fn === "digitalRead" ? "input-digital" : "input-analog";
      const existing = this.state.pinStates.find(p => p.pin === pin);
      if (existing) {
        existing.value = n;
        existing.kind = kind;
        if (existing.direction === "OUTPUT") existing.direction = "INPUT";
        existing.justChanged = true;
      } else {
        this.state.pinStates.push({ pin, kind, direction: "INPUT", value: n, justCreated: true, justChanged: true });
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
    const v = this.vars.find(vv => vv.name === varName);
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
        v.justChanged = true;
      }
    } catch (e: any) {
      this.state.error = e.message;
      this.state.awaitingInput = null;
      this.state.finished = true;
      return { kind: "error", line: this.state.currentLine, message: this.state.error! };
    }
    this.state.awaitingInput = null;
    this.syncState();
    const display = indices ? `${varName}[${indices.join("][")}]` : varName;
    const ev: StepEvent = { kind: "update-var", line: this.state.currentLine, message: `'${display}' recebeu o valor digitado.`, varName };
    this.state.lastEvent = ev;
    return ev;
  }

  /** Atualiza dinamicamente quanto tempo o relógio avança a cada iteração de loop. */
  setMsPerLoop(ms: number) {
    this.state.msPerLoop = Math.max(0, Math.trunc(ms));
  }
}