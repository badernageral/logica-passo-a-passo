# Lógica passo a passo — contexto para o Claude

## O que é este projeto
Interpretador didático de C e Arduino executado linha a linha no navegador.
Professores colam o código, avançam passo a passo e veem variáveis, pinos e saída serial animados em tempo real.
URL de produção: `http://localhost/logica-passo-a-passo/`
Repositório: `git@github.com:badernageral/logica-passo-a-passo.git`

## Stack
- React 19 + TanStack Router v1 (client-side only, sem SSR)
- Vite 7 com `base: "/logica-passo-a-passo/"` para subdiretório Apache
- Tailwind CSS v4 + shadcn/ui
- Bun (preferido) ou Node/npm

## Dois modos de execução
O interpretador (`src/lib/c-interpreter.ts`) detecta o modo automaticamente:
- **Linguagem C**: programa com `main()` — exemplo padrão ao abrir
- **Arduino**: programa com `setup()` + `loop()` — exemplo alternativo

O seletor de modo fica no cabeçalho. Em **Linguagem C**, os botões
"Entradas de pinos" e o campo "ms/loop" ficam ocultos (são conceitos Arduino).
A análise estática de avisos também é filtrada por modo (`analyzeCode(code, sampleType)`).

## Deploy
```bash
bash deploy.sh --no-pull   # sem git pull (quando já editou localmente)
bash deploy.sh             # com git pull (padrão)
```
O `index.html` da raiz é um **artefato de build** (gitignored). A entrada do Vite
é o `index.template.html` (rastreado no git, com `<script src="/src/main.tsx">`).

O deploy:
1. `npm install` / `bun install`
2. `cp index.template.html index.html` (gera a entrada do Vite)
3. `vite build` → gera `dist/`
4. Copia `dist/assets/` → raiz, `dist/index.html` → raiz, `dist/.htaccess` → raiz
5. Remove `dist/`

Arquivos de build na raiz (`index.html`, `.htaccess`, `assets/`) estão no `.gitignore`,
então o working tree não fica sujo após o deploy.

## Arquivos principais
| Arquivo | Papel |
|---|---|
| `src/lib/c-interpreter.ts` | Interpretador C/Arduino (não alterar sem cautela) |
| `src/lib/code-warnings.ts` | Análise estática pedagógica (avisos antes da execução) |
| `src/lib/error-hints.ts` | Dicas didáticas mapeadas de mensagens de erro |
| `src/routes/index.tsx` | UI principal: editor, variáveis, console, controles |
| `src/routes/__root.tsx` | Root route (sem SSR — apenas `<Outlet />`) |
| `src/router.tsx` | `createRouter` com `basepath: "/logica-passo-a-passo"` |
| `public/.htaccess` | Regra de rewrite para SPA (copiado para raiz no deploy) |
| `deploy.sh` | Script de build + publicação |

## Armadilhas conhecidas
- **Entrada do Vite**: editar `index.template.html` (rastreado), nunca o `index.html`
  da raiz — este é gerado pelo deploy e está no `.gitignore`.
- **`COMMENT_RE`**: usa `[^\n]*` (não `.*$`) para remover comentários `//` em todas
  as linhas — sem isso a flag `m` é necessária mas estava faltando.
- **Tipos compostos**: `unsigned long`, `signed int`, etc. — o `declRe` em
  `findUndeclaredUsages` usa `(?:unsigned|signed|long\s+)*` como prefixo opcional.
- **Basepath**: o `createRouter` tem `basepath: "/logica-passo-a-passo"` e o Vite
  tem `base: "/logica-passo-a-passo/"`. Ambos são necessários — sem um deles ou a
  página fica em branco ou o roteador mostra 404.
