/** Tipos compartilhados do interpretador C/Arduino. */

export type CType = "int" | "float" | "double" | "char" | "long" | "unsigned long" | "unsigned int";

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

export type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "char"; v: string }
  | { k: "ident"; name: string }
  | { k: "bin"; op: string; a: Expr; b: Expr }
  | { k: "un"; op: string; a: Expr }
  | { k: "assign"; name: string; v: Expr; indices?: Expr[] }
  | { k: "call"; name: string; args: Expr[] }
  | { k: "index"; name: string; indices: Expr[] };

export type Stmt =
  | {
      k: "decl";
      type: CType;
      items: { name: string; init: Expr | null; dims?: number[]; arrayInit?: ArrayInit }[];
      line: number;
    }
  | { k: "expr"; e: Expr; line: number }
  | { k: "printf"; fmt: string; args: Expr[]; line: number }
  | { k: "scanf"; fmt: string; targets: ScanfTarget[]; line: number }
  | {
      k: "if";
      cond: Expr;
      then: Stmt[];
      else: Stmt[] | null;
      line: number;
      thenEndLine?: number;
      elseEndLine?: number;
    }
  | { k: "while"; cond: Expr; body: Stmt[]; line: number; endLine?: number }
  | {
      k: "for";
      init: Stmt | null;
      cond: Expr | null;
      step: Expr | null;
      body: Stmt[];
      line: number;
      endLine?: number;
      initRange?: Range;
      condRange?: Range;
      stepRange?: Range;
    }
  | { k: "return"; e: Expr | null; line: number }
  | { k: "block"; body: Stmt[]; line: number; endLine?: number };

export interface Range {
  line: number;
  colStart: number;
  colEnd: number;
}

/** Inicializador de array: lista plana (1D) ou aninhada (2D). */
export type ArrayInit = (number | string)[] | (number | string)[][];

/** Alvo de scanf: nome de variável, com índices opcionais para vetor/matriz. */
export interface ScanfTarget {
  name: string;
  indices?: Expr[];
}

export interface FnDef {
  name: string;
  retType: CType | "void";
  params: { type: CType; name: string }[];
  body: Stmt[];
  line?: number; // linha da declaração 'int main() {'
  headerEndCol?: number; // coluna final do '{' de abertura (para destaque)
  endLine?: number; // linha do '}' de fechamento da função
}

export interface Directive {
  line: number;
  text: string; // ex: "#include <stdio.h>"
  name: string; // ex: "stdio.h"
  colStart: number;
  colEnd: number;
}
