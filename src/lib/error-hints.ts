/**
 * Mapeia mensagens de erro do interpretador para dicas didáticas.
 * Cada entrada testa um padrão (regex) na mensagem original e retorna uma
 * explicação amigável para o aluno.
 */

interface HintRule {
  test: RegExp;
  hint: (m: RegExpMatchArray) => string;
}

const RULES: HintRule[] = [
  {
    test: /Declaração inválida.*'([^']+)' não é um tipo válido/i,
    hint: (m) =>
      `Parece que você tentou declarar uma variável usando '${m[1]}', que não é um tipo reconhecido em C. Os tipos básicos são: int (números inteiros), float/double (números com casas decimais) e char (um caractere). Verifique se houve um erro de digitação.`,
  },
  {
    test: /'([^']+)' não é um tipo nem uma instrução reconhecida/i,
    hint: (m) =>
      `O compilador não reconheceu '${m[1]}' como um tipo (int, float, double, char) nem como uma instrução válida (if, while, for, return, printf, scanf...). Confira a digitação no início da linha.`,
  },
  {
    test: /Declaração de variável inválida.*após o tipo '([^']+)'/i,
    hint: (m) =>
      `Após o tipo '${m[1]}' deve vir o NOME da variável, por exemplo: '${m[1]} idade;' ou '${m[1]} idade = 10;'. Nomes de variáveis precisam começar com uma letra ou underscore (_), nunca com número.`,
  },
  {
    test: /Token inesperado '([^']+)'.*talvez falte um operador como '='/i,
    hint: (m) =>
      `Encontrei '${m[1]}' onde esperava um operador ou ';'. Provavelmente faltou o sinal de '=' (atribuição). Exemplo correto: 'int x = 5;' em vez de 'int x 5;'.`,
  },
  {
    test: /Esperado ';' ao final da linha (\d+)/i,
    hint: (m) =>
      `Toda instrução em C precisa terminar com ponto-e-vírgula (;). Verifique o final da linha ${m[1]} — está faltando o ';'.`,
  },
  {
    test: /Esperado um identificador/i,
    hint: () =>
      `Era esperado um nome (identificador) — por exemplo, o nome de uma variável ou função. Identificadores começam com letra ou '_' e não podem ser palavras reservadas (int, if, while, etc.).`,
  },
  {
    test: /Esperado '\(' /i,
    hint: () =>
      `Faltou abrir parênteses '('. Estruturas como if, while, for e chamadas de função sempre exigem parênteses. Exemplo: 'if (x > 0) { ... }'.`,
  },
  {
    test: /Esperado '\)'/i,
    hint: () =>
      `Faltou fechar parênteses ')'. Confira se cada '(' tem um ')' correspondente na mesma expressão.`,
  },
  {
    test: /Esperado '\{'/i,
    hint: () =>
      `Faltou abrir chave '{'. Blocos de código (corpo de funções, if, while, for) precisam estar entre '{' e '}'.`,
  },
  {
    test: /Esperado '\}'/i,
    hint: () =>
      `Faltou fechar chave '}'. Confira se todos os blocos abertos com '{' foram fechados.`,
  },
  {
    test: /Variável '([^']+)' não declarada/i,
    hint: (m) =>
      `Você usou a variável '${m[1]}' sem declará-la antes. Em C, é preciso declarar o tipo: por exemplo, 'int ${m[1]};' antes de usar.`,
  },
  {
    test: /Variável '([^']+)' já declarada/i,
    hint: (m) =>
      `A variável '${m[1]}' já existe neste escopo. Não é permitido declarar duas vezes — use outro nome ou apenas atribua um novo valor (sem repetir o tipo).`,
  },
  {
    test: /Função '([^']+)' não (definida|encontrada)/i,
    hint: (m) =>
      `A função '${m[1]}' não foi encontrada. Verifique se ela foi definida acima do main e se o nome está escrito exatamente igual (C diferencia maiúsculas/minúsculas).`,
  },
  {
    test: /Divisão por zero/i,
    hint: () =>
      `Você tentou dividir um número por zero, o que é matematicamente indefinido. Antes de dividir, verifique se o divisor é diferente de zero (ex.: 'if (b != 0) { ... }').`,
  },
  {
    test: /String não terminada|aspas/i,
    hint: () =>
      `Uma string (texto entre aspas) não foi fechada corretamente. Toda " precisa de outra " no final, na mesma linha.`,
  },
  {
    test: /Caractere inválido|inesperado/i,
    hint: () =>
      `Há um caractere que o compilador não reconhece. Pode ser um símbolo digitado por engano ou um caractere especial. Apague-o e digite novamente.`,
  },
  {
    test: /Função 'setup' não encontrada/i,
    hint: () =>
      `Todo sketch Arduino precisa de uma função 'setup', executada uma única vez ao iniciar. Adicione: 'void setup() { /* configurações iniciais */ }'.`,
  },
  {
    test: /Função 'loop' não encontrada/i,
    hint: () =>
      `Todo sketch Arduino precisa de uma função 'loop', executada continuamente. Adicione: 'void loop() { /* código que se repete */ }'.`,
  },
  {
    test: /Nenhuma função 'setup'\/'loop'.*nem 'main'/i,
    hint: () =>
      `O programa precisa ter 'void setup()' e 'void loop()' (modelo Arduino). Exemplo mínimo: 'void setup() {}  void loop() { delay(100); }'.`,
  },
  {
    test: /Leitura de pino .* precisa ser tratada passo a passo/i,
    hint: () =>
      `Para usar digitalRead/analogRead avance o programa com 'Próxima linha' — uma janela vai aparecer pedindo o valor lido (0 ou 1 para digital, 0 a 1023 para analógico).`,
  },
  {
    test: /scanf/i,
    hint: () =>
      `Verifique a sintaxe do scanf: 'scanf("%d", &variavel);' — o '&' antes do nome da variável é obrigatório. Em Arduino, prefira digitalRead(pino) ou analogRead(pino) para ler entradas de pinos.`,
  },
  {
    test: /printf/i,
    hint: () =>
      `Verifique a sintaxe do printf: o formato correto é 'printf("texto %d", variavel);' — o número de especificadores (%d, %f, etc.) deve bater com o número de argumentos.`,
  },
  {
    test: /Índice fora do limite ao acessar '([^']+)': posição (-?\d+) \(válido: 0 a (\d+)\)/i,
    hint: (m) =>
      `Você tentou acessar a posição ${m[2]} de '${m[1]}', mas esse vetor só tem índices de 0 a ${m[3]}. Em C, vetores começam em 0 — um vetor 'int v[5]' tem posições válidas v[0] a v[4].`,
  },
  {
    test: /'([^']+)' é um vetor.*use índices/i,
    hint: (m) =>
      `'${m[1]}' é um vetor (ou matriz). Indique qual posição quer usar, por exemplo '${m[1]}[0]' para a primeira posição.`,
  },
  {
    test: /'([^']+)' não é um vetor — não pode ser indexado/i,
    hint: (m) =>
      `'${m[1]}' é uma variável simples (escalar), não um vetor. Para usar índices [ ], declare como vetor, ex.: 'int ${m[1]}[5];'.`,
  },
  {
    test: /Tamanho inválido para o vetor '([^']+)'/i,
    hint: (m) =>
      `O tamanho de um vetor deve ser um inteiro positivo. Exemplo correto: 'int ${m[1]}[10];'.`,
  },
  {
    test: /tem (\d+) dimensão\(ões\), mas foi indexado com (\d+)/i,
    hint: (m) =>
      `Número de índices não bate com a quantidade de dimensões: a variável tem ${m[1]}, mas você usou ${m[2]}. Vetor 1D usa um índice (v[i]); matriz 2D usa dois (m[i][j]).`,
  },
];

export function getErrorHint(message: string): string | null {
  if (!message) return null;
  for (const rule of RULES) {
    const m = message.match(rule.test);
    if (m) return rule.hint(m);
  }
  return null;
}
