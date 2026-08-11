/**
 * Compatibilidade entre o identificador de formato (`%d`, `%f`, `%c`, `%s`) e o
 * tipo da variável — usada tanto pela análise estática quanto pelo interpretador.
 */

/** Conversões de um formato, na ordem. O `%%` não consome argumento e fica de fora. */
const CONVERSION_RE =
  /%([-+ 0#]*)(\d+|\*)?(?:\.(?:\d*|\*))?(?:hh|h|ll|l|L|z|j|t)?([diufFeEgGxXoscp%])/g;

/** Famílias de valor que o printf/scanf distinguem para o aluno. */
export type ValueKind = "int" | "float" | "char" | "string";

/** Letras de conversão na ordem em que consomem argumentos, ou `null` se houver `*`. */
export function conversionsOf(fmt: string): string[] | null {
  const out: string[] = [];
  CONVERSION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CONVERSION_RE.exec(fmt)) !== null) {
    if (m[3] === "%") continue;
    // Largura/precisão por '*' consomem argumentos extras e desalinham a
    // correspondência — nesse caso é melhor não checar nada.
    if (m[2] === "*" || m[0].includes(".*")) return null;
    out.push(m[3]);
  }
  return out;
}

/** Família exigida pela conversão (`d` → inteiro, `f` → real…). */
export function kindOfConversion(conv: string): ValueKind | null {
  if ("diuxXo".includes(conv)) return "int";
  if ("fFeEgG".includes(conv)) return "float";
  if (conv === "c") return "char";
  if (conv === "s") return "string";
  return null; // %p e afins: sem checagem
}

/** Família do tipo declarado. Vetores de char (e String do Arduino) contam como texto. */
export function kindOfType(type: string, isArray = false): ValueKind | null {
  const t = type.trim();
  if (t === "String") return "string";
  if (t === "char") return isArray ? "string" : "char";
  if (isArray) return null; // vetor de números: o uso normal é indexado
  if (t === "float" || t === "double") return "float";
  if (/^(?:unsigned |signed )?(?:int|long|short|bool|byte|boolean)$/.test(t)) return "int";
  return null;
}

/** Nome amigável da família, para a mensagem. */
const KIND_LABEL: Record<ValueKind, string> = {
  int: "números inteiros",
  float: "números com casas decimais",
  char: "um único caractere",
  string: "texto (vetor de char)",
};

/** Identificador que o aluno deveria ter usado para cada família. */
const KIND_SPEC: Record<ValueKind, string> = {
  int: "%d",
  float: "%f",
  char: "%c",
  string: "%s",
};

/**
 * Se `%${conv}` não serve para uma variável dessa família, devolve a explicação.
 *
 * `printf` é mais tolerante que `scanf`: ele recebe uma cópia já promovida, e
 * `printf("%d", letra)` mostrando o código ASCII do char é uso corrente em aula.
 * O `scanf` escreve na variável através do endereço, então int e char não podem
 * ser trocados — o tamanho na memória é outro.
 */
export function formatMismatch(
  conv: string,
  varKind: ValueKind,
  varName: string,
  varType: string,
  fn: "printf" | "scanf",
): string | null {
  const specKind = kindOfConversion(conv);
  if (!specKind || specKind === varKind) return null;
  const intAndChar =
    (specKind === "int" && varKind === "char") || (specKind === "char" && varKind === "int");
  if (fn === "printf" && intAndChar) return null;

  return (
    `'%${conv}' é o identificador de ${KIND_LABEL[specKind]}, mas '${varName}' foi declarada como ${varType}. ` +
    `Use '${KIND_SPEC[varKind]}' para ${KIND_LABEL[varKind]} — ou declare '${varName}' com outro tipo.`
  );
}
