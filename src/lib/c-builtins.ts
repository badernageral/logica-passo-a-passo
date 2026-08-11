/**
 * Funções numéricas embutidas: as de `<math.h>` e as auxiliares do Arduino.
 *
 * São todas puras (só dependem dos argumentos), o que mantém o "voltar um passo"
 * determinístico — ele recria o interpretador e reexecuta as ações desde o início.
 * Built-ins que dependem do estado da simulação (millis, delay, leitura de pinos)
 * ficam no próprio interpretador.
 */

export interface Builtin {
  /** Quantos argumentos a função exige. Os excedentes são ignorados. */
  arity: number;
  fn: (a: number[]) => number;
}

/** `round` do C arredonda o empate para longe do zero — o `Math.round` sobe sempre. */
function roundC(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

const f1 = (fn: (x: number) => number): Builtin => ({ arity: 1, fn: (a) => fn(a[0]) });
const f2 = (fn: (x: number, y: number) => number): Builtin => ({
  arity: 2,
  fn: (a) => fn(a[0], a[1]),
});

export const BUILTIN_FUNCTIONS: Record<string, Builtin> = {
  // <math.h>
  sqrt: f1(Math.sqrt),
  cbrt: f1(Math.cbrt),
  pow: f2(Math.pow),
  fabs: f1(Math.abs),
  ceil: f1(Math.ceil),
  floor: f1(Math.floor),
  round: f1(roundC),
  trunc: f1(Math.trunc),
  exp: f1(Math.exp),
  log: f1(Math.log),
  log10: f1(Math.log10),
  log2: f1(Math.log2),
  sin: f1(Math.sin),
  cos: f1(Math.cos),
  tan: f1(Math.tan),
  asin: f1(Math.asin),
  acos: f1(Math.acos),
  atan: f1(Math.atan),
  atan2: f2(Math.atan2),
  sinh: f1(Math.sinh),
  cosh: f1(Math.cosh),
  tanh: f1(Math.tanh),
  hypot: f2(Math.hypot),
  fmod: f2((x, y) => x % y),
  // <stdlib.h> e macros do Arduino
  abs: f1(Math.abs),
  min: f2(Math.min),
  max: f2(Math.max),
  sq: f1((x) => x * x),
  constrain: { arity: 3, fn: (a) => Math.min(Math.max(a[0], a[1]), a[2]) },
  // map() do Arduino usa aritmética inteira — a divisão trunca.
  map: {
    arity: 5,
    fn: ([x, inMin, inMax, outMin, outMax]) =>
      Math.trunc(((x - inMin) * (outMax - outMin)) / (inMax - inMin)) + outMin,
  },
};

/** Nomes das funções embutidas — usado também pela análise estática. */
export const BUILTIN_NAMES = Object.keys(BUILTIN_FUNCTIONS);
