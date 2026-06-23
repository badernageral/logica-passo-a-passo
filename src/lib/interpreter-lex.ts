import type {
  CType,
  Expr,
  Stmt,
  FnDef,
  Range,
  ArrayInit,
  ScanfTarget,
  Directive,
} from "./interpreter-types";

// ---------------- Tokenizer ----------------

interface Tok {
  t: string; // categoria
  v: string; // valor
  line: number;
  col: number; // 1-based, posição inicial
  endCol: number; // 1-based, posição final inclusiva
}

export const KEYWORDS = new Set([
  "int",
  "float",
  "double",
  "char",
  "void",
  "unsigned",
  "long",
  "if",
  "else",
  "while",
  "for",
  "return",
  "printf",
  "scanf",
]);

export function tokenize(src: string, directives?: Directive[]): Tok[] {
  const toks: Tok[] = [];
  let i = 0,
    line = 1,
    lineStart = 0;
  const colOf = (pos: number) => pos - lineStart + 1;
  const push = (
    t: string,
    v: string,
    ln: number,
    startPos: number,
    endPos: number,
    startLineStart: number,
  ) => {
    toks.push({
      t,
      v,
      line: ln,
      col: startPos - startLineStart + 1,
      endCol: endPos - startLineStart,
    });
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      lineStart = i;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // comentários
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") {
          line++;
          lineStart = i + 1;
        }
        i++;
      }
      i += 2;
      continue;
    }
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
      const start = i;
      const sLineStart = lineStart;
      let s = "";
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < src.length) {
          const n = src[i + 1];
          s += n === "n" ? "\n" : n === "t" ? "\t" : n === "\\" ? "\\" : n === '"' ? '"' : n;
          i += 2;
        } else {
          s += src[i++];
        }
      }
      i++;
      push("str", s, line, start, i, sLineStart);
      continue;
    }
    // char literal
    if (c === "'") {
      const start = i;
      const sLineStart = lineStart;
      i++;
      let ch = "";
      if (src[i] === "\\") {
        ch = src[i + 1] === "n" ? "\n" : src[i + 1];
        i += 2;
      } else {
        ch = src[i];
        i++;
      }
      i++; // closing '
      push("char", ch, line, start, i, sLineStart);
      continue;
    }
    // número
    if (/[0-9]/.test(c)) {
      const start = i;
      const sLineStart = lineStart;
      let s = "";
      while (i < src.length && /[0-9.]/.test(src[i])) s += src[i++];
      push("num", s, line, start, i, sLineStart);
      continue;
    }
    // identificador / keyword
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      const sLineStart = lineStart;
      let s = "";
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) s += src[i++];
      push(KEYWORDS.has(s) ? s : "id", s, line, start, i, sLineStart);
      continue;
    }
    // operadores compostos
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "*=", "/="].includes(two)) {
      const start = i;
      push(two, two, line, start, i + 2, lineStart);
      i += 2;
      continue;
    }
    // simples
    if ("+-*/%=<>!(){};,&[]".includes(c)) {
      const start = i;
      push(c, c, line, start, i + 1, lineStart);
      i++;
      continue;
    }
    throw new Error(`Caractere inesperado '${c}' na linha ${line}`);
  }
  toks.push({ t: "eof", v: "", line, col: i - lineStart + 1, endCol: i - lineStart + 1 });
  void colOf;
  return toks;
}

// ---------------- Parser ----------------

export class Parser {
  i = 0;
  constructor(public toks: Tok[]) {}
  peek(o = 0) {
    return this.toks[this.i + o];
  }
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
            throw new Error(
              `Declaração inválida na linha ${tk.line}: '${prev.v}' não é um tipo válido. Você quis dizer 'int', 'float', 'double' ou 'char'? (encontrado: '${prev.v} ${tk.v}')`,
            );
          }
          if (prev.t === "id" && isStartOfStmt) {
            throw new Error(
              `Token inesperado '${tk.v}' na linha ${tk.line} — '${prev.v}' não é um tipo nem uma instrução reconhecida. Verifique se você digitou o tipo corretamente (int, float, double, char) ou se falta um operador como '='.`,
            );
          }
          throw new Error(
            `Token inesperado '${tk.v}' na linha ${tk.line} — verifique a sintaxe da instrução (talvez falte um operador como '=').`,
          );
        }
        throw new Error(
          `Esperado ';' ao final da linha ${reportLine} (encontrado '${tk.v}' na linha ${tk.line})`,
        );
      }
      if (t === "id") {
        const prev = this.toks[this.i - 1];
        // Tipo seguido de algo que não é identificador → declaração inválida.
        if (prev && ["int", "float", "double", "char"].includes(prev.t)) {
          throw new Error(
            `Declaração de variável inválida na linha ${tk.line}: após o tipo '${prev.v}' era esperado um nome de variável, mas foi encontrado '${tk.v}'. Lembre-se: nomes de variáveis não podem começar com número e não podem ser palavras reservadas.`,
          );
        }
        throw new Error(
          `Esperado um identificador (nome) mas encontrado '${tk.v}' na linha ${tk.line}.`,
        );
      }
      throw new Error(`Esperado '${t}' mas encontrado '${tk.v}' (linha ${tk.line})`);
    }
    this.i++;
    return tk;
  }
  match(...ts: string[]) {
    return ts.includes(this.peek().t);
  }

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
      const isType = ["int", "float", "double", "char", "void"].includes(a.t);
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
      if (next.v === "long") {
        this.eat();
        return "unsigned long";
      }
      if (next.v === "int") {
        this.eat();
        return "unsigned int";
      }
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
    return {
      name,
      retType,
      params,
      body,
      line: startTok.line,
      headerEndCol: braceTok.endCol,
      endLine: closeBrace.line,
    };
  }

  parseStmt(): Stmt {
    const tk = this.peek();
    if (["int", "float", "double", "char"].includes(tk.t) || tk.v === "unsigned" || tk.v === "long")
      return this.parseDecl();
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
          throw new Error(
            `Tamanho inválido para o vetor '${name}' na linha ${line}: '${sizeTok.v}'. Use um número inteiro positivo.`,
          );
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
          if (tk.t === "num") {
            this.eat();
            arr.push(parseFloat(tk.v));
          } else if (tk.t === "char") {
            this.eat();
            arr.push(tk.v);
          } else if (tk.t === "-" && this.toks[this.i + 1]?.t === "num") {
            this.eat("-");
            const n = this.eat("num");
            arr.push(-parseFloat(n.v));
          } else {
            throw new Error(
              `Inicializador de vetor inválido na linha ${tk.line}: esperado número ou caractere, encontrado '${tk.v}'.`,
            );
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
    this.eat("(");
    const cond = this.parseExpr();
    this.eat(")");
    const thenInfo = this.parseBlockOrStmtWithEnd();
    let elseB: Stmt[] | null = null;
    let elseEnd: number | undefined;
    if (this.match("else")) {
      this.eat("else");
      const elseInfo = this.parseBlockOrStmtWithEnd();
      elseB = elseInfo.body;
      elseEnd = elseInfo.endLine;
    }
    return {
      k: "if",
      cond,
      then: thenInfo.body,
      else: elseB,
      line,
      thenEndLine: thenInfo.endLine,
      elseEndLine: elseEnd,
    };
  }

  parseWhile(): Stmt {
    const line = this.eat("while").line;
    this.eat("(");
    const cond = this.parseExpr();
    this.eat(")");
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
      if (
        ["int", "float", "double", "char"].includes(this.peek().t) ||
        this.peek().v === "unsigned" ||
        this.peek().v === "long"
      )
        init = this.parseDecl();
      else {
        const e = this.parseExpr();
        this.eat(";");
        init = { k: "expr", e, line };
      }
      const semi = this.toks[this.i - 1]; // token ';' que acabou de ser consumido
      initRange = { line: initStartTok.line, colStart: initStartTok.col, colEnd: semi.endCol - 1 };
    } else this.eat(";");
    let cond: Expr | null = null;
    let condRange: Range | undefined;
    const condStartTok = this.peek();
    if (!this.match(";")) cond = this.parseExpr();
    const condEndTok = this.toks[this.i]; // ';'
    if (cond)
      condRange = {
        line: condStartTok.line,
        colStart: condStartTok.col,
        colEnd: condEndTok.col - 1,
      };
    this.eat(";");
    let step: Expr | null = null;
    let stepRange: Range | undefined;
    const stepStartTok = this.peek();
    if (!this.match(")")) step = this.parseExpr();
    const stepEndTok = this.toks[this.i]; // ')'
    if (step)
      stepRange = {
        line: stepStartTok.line,
        colStart: stepStartTok.col,
        colEnd: stepEndTok.col - 1,
      };
    this.eat(")");
    const info = this.parseBlockOrStmtWithEnd();
    return {
      k: "for",
      init,
      cond,
      step,
      body: info.body,
      line,
      endLine: info.endLine,
      initRange,
      condRange,
      stepRange,
    };
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
    while (this.match(",")) {
      this.eat(",");
      args.push(this.parseExpr());
    }
    this.eat(")");
    this.eat(";");
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
    this.eat(")");
    this.eat(";");
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
  parseExpr(): Expr {
    return this.parseAssign();
  }
  parseAssign(): Expr {
    const left = this.parseLogicOr();
    if (this.match("=")) {
      this.eat("=");
      const right = this.parseAssign();
      if (left.k === "ident") return { k: "assign", name: left.name, v: right };
      if (left.k === "index")
        return { k: "assign", name: left.name, v: right, indices: left.indices };
      throw new Error("Lado esquerdo de '=' inválido");
    }
    if (this.match("+=", "-=", "*=", "/=")) {
      const op = this.eat().t[0];
      const right = this.parseAssign();
      if (left.k === "ident")
        return { k: "assign", name: left.name, v: { k: "bin", op, a: left, b: right } };
      if (left.k === "index")
        return {
          k: "assign",
          name: left.name,
          v: { k: "bin", op, a: left, b: right },
          indices: left.indices,
        };
      throw new Error("Lado esquerdo inválido");
    }
    return left;
  }
  parseLogicOr(): Expr {
    let a = this.parseLogicAnd();
    while (this.match("||")) {
      this.eat();
      a = { k: "bin", op: "||", a, b: this.parseLogicAnd() };
    }
    return a;
  }
  parseLogicAnd(): Expr {
    let a = this.parseEq();
    while (this.match("&&")) {
      this.eat();
      a = { k: "bin", op: "&&", a, b: this.parseEq() };
    }
    return a;
  }
  parseEq(): Expr {
    let a = this.parseCmp();
    while (this.match("==", "!=")) {
      const op = this.eat().t;
      a = { k: "bin", op, a, b: this.parseCmp() };
    }
    return a;
  }
  parseCmp(): Expr {
    let a = this.parseAdd();
    while (this.match("<", ">", "<=", ">=")) {
      const op = this.eat().t;
      a = { k: "bin", op, a, b: this.parseAdd() };
    }
    return a;
  }
  parseAdd(): Expr {
    let a = this.parseMul();
    while (this.match("+", "-")) {
      const op = this.eat().t;
      a = { k: "bin", op, a, b: this.parseMul() };
    }
    return a;
  }
  parseMul(): Expr {
    let a = this.parseUnary();
    while (this.match("*", "/", "%")) {
      const op = this.eat().t;
      a = { k: "bin", op, a, b: this.parseUnary() };
    }
    return a;
  }
  parseUnary(): Expr {
    if (this.match("-", "!", "+")) {
      const op = this.eat().t;
      return { k: "un", op, a: this.parseUnary() };
    }
    if (this.match("++", "--")) {
      const op = this.eat().t;
      const a = this.parseUnary();
      return { k: "un", op: "pre" + op, a };
    }
    return this.parsePostfix();
  }
  parsePostfix(): Expr {
    const a = this.parsePrimary();
    if (this.match("++", "--")) {
      const op = this.eat().t;
      return { k: "un", op: "post" + op, a };
    }
    return a;
  }
  parsePrimary(): Expr {
    const tk = this.peek();
    if (tk.t === "num") {
      this.eat();
      return { k: "num", v: parseFloat(tk.v) };
    }
    if (tk.t === "str") {
      this.eat();
      return { k: "str", v: tk.v };
    }
    if (tk.t === "char") {
      this.eat();
      return { k: "char", v: tk.v };
    }
    if (tk.t === "(") {
      this.eat();
      const e = this.parseExpr();
      this.eat(")");
      return e;
    }
    if (tk.t === "id") {
      this.eat();
      if (this.match("(")) {
        this.eat("(");
        const args: Expr[] = [];
        if (!this.match(")")) {
          args.push(this.parseExpr());
          while (this.match(",")) {
            this.eat(",");
            args.push(this.parseExpr());
          }
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
