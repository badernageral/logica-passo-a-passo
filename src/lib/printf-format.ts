/**
 * Formatação no estilo `printf` da linguagem C.
 *
 * Suporta a especificação completa que aparece em sala de aula:
 * `%[flags][largura][.precisão][tamanho]conversão`, ex.: `%.2f`, `%5d`, `%-10s`,
 * `%08.3f`, `%+d`, `%x`. O tamanho (`l`, `ll`, `h`, `L`…) é aceito e ignorado —
 * aqui todo número é um `double` do JavaScript.
 */

/** `%[flags][largura][.precisão][tamanho]conversão` — o `.` sem dígitos vale precisão 0. */
const SPEC_RE = /^%([-+ 0#]*)(\d+|\*)?(?:\.(\d*|\*))?(?:hh|h|ll|l|L|z|j|t)?([diufFeEgGxXoscp%])/;

/**
 * Converte um valor do interpretador em número. Variáveis `char` guardam uma
 * string de um caractere — `printf("%d", c)` deve mostrar o código ASCII dela.
 */
function toNumber(val: number | string): number {
  if (typeof val === "number") return val;
  const n = parseFloat(val);
  if (!Number.isNaN(n)) return n;
  return val.length > 0 ? val.charCodeAt(0) : 0;
}

/**
 * `round(x * 10^k)` calculado de forma exata, com empate para o dígito par —
 * é assim que o printf do C arredonda. O `toFixed`/`toExponential` do JavaScript
 * arredondam empates para longe do zero, o que faria `%.0f` de 2.5 virar "3"
 * enquanto o C imprime "2". `x` deve ser finito e não negativo.
 */
function scaledRound(x: number, k: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const fracBits = bits & 0xfffffffffffffn;
  // Subnormais têm expoente fixo e não carregam o bit implícito 1.
  const mant = expBits === 0 ? fracBits : fracBits | (1n << 52n);
  const exp = expBits === 0 ? -1074 : expBits - 1075;

  // x * 10^k = num / den, com num e den inteiros exatos.
  let num = mant;
  let den = 1n;
  if (exp >= 0) num *= 1n << BigInt(exp);
  else den *= 1n << BigInt(-exp);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);

  const q = num / den;
  const twiceRest = (num % den) * 2n;
  if (twiceRest > den || (twiceRest === den && q % 2n === 1n)) return q + 1n;
  return q;
}

/** `%f`: ponto fixo com `prec` casas decimais. */
function exactFixed(x: number, prec: number): string {
  const digits = scaledRound(x, prec)
    .toString()
    .padStart(prec + 1, "0");
  return prec === 0 ? digits : digits.slice(0, -prec) + "." + digits.slice(-prec);
}

/** `%e`: notação científica com expoente de pelo menos dois dígitos, como em C. */
function toExp(n: number, prec: number, upper: boolean): string {
  const exp = n === 0 ? 0 : decimalExponent(n, prec + 1);
  const digits = n === 0 ? "0".repeat(prec + 1) : scaledRound(n, prec - exp).toString();
  const mantissa = prec === 0 ? digits : digits[0] + "." + digits.slice(1);
  const sign = exp < 0 ? "-" : "+";
  const s = `${mantissa}e${sign}${String(Math.abs(exp)).padStart(2, "0")}`;
  return upper ? s.toUpperCase() : s;
}

/** Remove zeros à direita (e o ponto órfão) — comportamento do `%g` sem a flag `#`. */
function trimZeros(s: string): string {
  if (!s.includes(".")) return s;
  const [mant, exp] = s.split(/(?=[eE])/);
  return mant.replace(/0+$/, "").replace(/\.$/, "") + (exp ?? "");
}

/** Expoente decimal de `n` (positivo) depois de arredondado para `sig` dígitos significativos. */
function decimalExponent(n: number, sig: number): number {
  let exp = Math.floor(Math.log10(n));
  // O log10 pode errar por um na fronteira das potências de 10, e o próprio
  // arredondamento pode transbordar (9.99 com 2 dígitos vira 10).
  for (let tries = 0; tries < 3; tries++) {
    const len = scaledRound(n, sig - 1 - exp).toString().length;
    if (len === sig) break;
    exp += len - sig;
  }
  return exp;
}

/** `%g`: escolhe entre `%e` e `%f` conforme o expoente, como manda o C. */
function toG(n: number, prec: number | undefined, upper: boolean, alt: boolean): string {
  const p = prec === undefined ? 6 : prec === 0 ? 1 : prec;
  // O C decide pelo expoente do valor JÁ arredondado a p dígitos significativos:
  // 9.995 com %.1g vira 1e+01, não 10.
  const exp = n === 0 ? 0 : decimalExponent(n, p);
  const s = exp < -4 || exp >= p ? toExp(n, p - 1, upper) : exactFixed(n, Math.max(0, p - 1 - exp));
  return alt ? s : trimZeros(s);
}

/** Inteiro em outra base, com a precisão preenchendo zeros à esquerda. */
function toBase(n: number, base: number, prec: number | undefined, upper: boolean): string {
  const abs = Math.abs(Math.trunc(n));
  // Precisão 0 com valor 0 não imprime nada — é o que o C faz.
  let s = abs === 0 && prec === 0 ? "" : abs.toString(base);
  if (prec !== undefined) s = s.padStart(prec, "0");
  return upper ? s.toUpperCase() : s;
}

/** Complemento de dois em 32 bits — é o que `%u`, `%x` e `%o` mostram para um negativo. */
function unsigned32(n: number): number {
  const i = Math.trunc(n);
  return i < 0 ? i >>> 0 : i;
}

/** A flag `#` obriga o ponto decimal a aparecer mesmo com precisão 0. */
function ensurePoint(s: string, flags: string): string {
  if (!flags.includes("#") || s.includes(".")) return s;
  const at = s.search(/[eE]/);
  return at < 0 ? s + "." : s.slice(0, at) + "." + s.slice(at);
}

interface Spec {
  flags: string;
  width?: number;
  prec?: number;
  conv: string;
}

/** Corpo formatado do valor, já sem o sinal (devolvido à parte para o preenchimento com zeros). */
function render(
  spec: Spec,
  val: number | string,
): { sign: string; body: string; numeric: boolean } {
  const { conv, prec, flags } = spec;

  if (conv === "s") {
    const s = typeof val === "string" ? val : String(val);
    return { sign: "", body: prec !== undefined ? s.slice(0, prec) : s, numeric: false };
  }
  if (conv === "c") {
    const s = typeof val === "string" ? val : String.fromCharCode(Math.trunc(Number(val)));
    return { sign: "", body: s, numeric: false };
  }

  const n = toNumber(val);
  const negative = n < 0 || Object.is(n, -0);
  const abs = Math.abs(n);
  let body: string;

  if (!Number.isFinite(n)) {
    const word = Number.isNaN(n) ? "nan" : "inf";
    const sign = Number.isNaN(n) ? "" : negative ? "-" : flags.includes("+") ? "+" : "";
    const upper = conv === conv.toUpperCase();
    return { sign, body: upper ? word.toUpperCase() : word, numeric: false };
  }

  switch (conv) {
    case "d":
    case "i":
      body = toBase(abs, 10, prec, false);
      break;
    // %u, %x, %X e %o não têm sinal: um negativo dá a volta em 32 bits, como no C.
    case "u":
      body = toBase(unsigned32(n), 10, prec, false);
      return { sign: "", body, numeric: true };
    case "x":
    case "X": {
      // O prefixo 0x fica à esquerda dos zeros de preenchimento, por isso vai no "sinal".
      const prefix = flags.includes("#") && n !== 0 ? (conv === "x" ? "0x" : "0X") : "";
      return { sign: prefix, body: toBase(unsigned32(n), 16, prec, conv === "X"), numeric: true };
    }
    case "o": {
      // Em octal, o '#' garante um zero à esquerda — sem duplicar o que já houver.
      const oct = toBase(unsigned32(n), 8, prec, false);
      body = flags.includes("#") && !oct.startsWith("0") ? "0" + oct : oct;
      return { sign: "", body, numeric: true };
    }
    case "p":
      return { sign: "", body: "0x" + toBase(unsigned32(n), 16, undefined, false), numeric: false };
    case "e":
    case "E":
      body = ensurePoint(toExp(abs, prec ?? 6, conv === "E"), flags);
      break;
    case "g":
    case "G":
      body = ensurePoint(toG(abs, prec, conv === "G", flags.includes("#")), flags);
      break;
    default: // f, F
      body = ensurePoint(exactFixed(abs, prec ?? 6), flags);
      break;
  }

  const sign = negative ? "-" : flags.includes("+") ? "+" : flags.includes(" ") ? " " : "";
  return { sign, body, numeric: true };
}

/** Aplica largura mínima: alinhamento à esquerda, zeros à esquerda ou espaços. */
function pad(sign: string, body: string, spec: Spec, numeric: boolean): string {
  const width = spec.width;
  if (width === undefined || sign.length + body.length >= width) return sign + body;
  const fill = width - sign.length - body.length;
  if (spec.flags.includes("-")) return sign + body + " ".repeat(fill);
  // A flag '0' vale só para números — e é ignorada quando há precisão em inteiros.
  const zeroPad =
    spec.flags.includes("0") &&
    numeric &&
    !(spec.prec !== undefined && "diuxXo".includes(spec.conv));
  if (zeroPad) return sign + "0".repeat(fill) + body;
  return " ".repeat(fill) + sign + body;
}

/**
 * Formata `fmt` consumindo os argumentos sob demanda.
 * @param fmt     string de formato já com os escapes resolvidos
 * @param nextArg devolve o próximo argumento (avaliado no momento do uso)
 */
export function formatPrintf(fmt: string, nextArg: () => number | string): string {
  let out = "";
  let i = 0;
  while (i < fmt.length) {
    if (fmt[i] !== "%") {
      out += fmt[i++];
      continue;
    }
    const m = SPEC_RE.exec(fmt.slice(i));
    if (!m) {
      // Não é uma especificação válida (ex.: '%' no fim da string) — sai como está.
      out += fmt[i++];
      continue;
    }
    const [whole, flags, widthRaw, precRaw, conv] = m;
    i += whole.length;
    if (conv === "%") {
      out += "%";
      continue;
    }

    let width =
      widthRaw === "*" ? Math.trunc(toNumber(nextArg())) : widthRaw ? Number(widthRaw) : undefined;
    let flagsAdj = flags;
    if (width !== undefined && width < 0) {
      // Largura negativa via '*' equivale a alinhar à esquerda.
      flagsAdj += "-";
      width = -width;
    }
    const prec =
      precRaw === undefined
        ? undefined
        : precRaw === "*"
          ? Math.max(0, Math.trunc(toNumber(nextArg())))
          : precRaw === ""
            ? 0
            : Number(precRaw);

    const spec: Spec = { flags: flagsAdj, width, prec, conv };
    const { sign, body, numeric } = render(spec, nextArg());
    out += pad(sign, body, spec, numeric);
  }
  return out;
}
