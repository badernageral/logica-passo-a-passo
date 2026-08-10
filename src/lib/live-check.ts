/**
 * Verificação em tempo de digitação (somente modo Linguagem C).
 *
 * Reusa o front-end do interpretador — pré-processamento, tokenize e parse —
 * sem executar nada: o construtor do CInterpreter faz todo o parse e captura
 * qualquer erro em state.error antes do primeiro step(). Assim, qualquer
 * código que viole a gramática é acusado aqui sem precisar prever cada erro
 * numa lista, e a mensagem passa pelo error-hints como na execução.
 */

import { CInterpreter } from "./c-interpreter";
import { getErrorHint } from "./error-hints";

export interface LiveError {
  line: number | null;
  message: string;
  hint: string | null;
}

// Erros suprimidos no dry-run: ou são o estado normal de um programa ainda
// sendo digitado, ou o analyzeCode já exibe um card próprio para eles no
// mesmo painel (duplicar seria ruído).
const SUPPRESSED = [
  /Nenhuma função 'setup'\/'loop'/i, // programa incompleto é esperado ao digitar
  /Chaves desbalanceadas/i, // card do analyzeCode (balanço de chaves)
  /diretiva include/i, // card do analyzeCode (include mal escrito)
  /não existe\. Você quis dizer/i, // card do analyzeCode (biblioteca com nome errado)
  /não foi incluída/i, // card do analyzeCode (falta #include)
];

export function liveCheck(code: string): LiveError | null {
  if (!code.trim()) return null;
  const probe = new CInterpreter(code, 100, { strictEscapes: true });
  const error = probe.state.error;
  if (!error) return null;
  if (SUPPRESSED.some((re) => re.test(error))) return null;
  return {
    line: probe.state.currentLine || null,
    message: error,
    hint: getErrorHint(error),
  };
}
