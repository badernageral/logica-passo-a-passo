#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# deploy.sh — Build estático e publicação na raiz do projeto.
#
# Após o build, copia os arquivos gerados (index.html, assets/, .htaccess)
# para a raiz do projeto, que é o DocumentRoot do Apache.
#
# Uso:
#   ./deploy.sh              # git pull + install + build + publica na raiz
#   ./deploy.sh --no-pull    # pula git pull
#
# Pré-requisitos:
#   - Node.js 20+ com npm  (ou bun)
#   - Apache com mod_rewrite:  sudo a2enmod rewrite && sudo systemctl restart apache2
# ----------------------------------------------------------------------------

set -euo pipefail

DO_PULL=1

for arg in "$@"; do
  case "$arg" in
    --no-pull) DO_PULL=0 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
  esac
done

cd "$(dirname "$0")"
ROOT="$(pwd)"

echo "==> Diretório : $ROOT"
echo "==> Node      : $(node -v 2>/dev/null || echo 'NÃO INSTALADO')"

# Escolhe gerenciador de pacotes
if command -v bun >/dev/null 2>&1; then
  INSTALL="bun install"; RUN="bun run"
else
  INSTALL="npm install"; RUN="npm run"
fi

# 1) Atualizar código
if [ "$DO_PULL" -eq 1 ] && [ -d .git ]; then
  echo "==> git pull"
  git pull --ff-only
fi

# 2) Instalar dependências
echo "==> $INSTALL"
$INSTALL

# 3) Garantir que o index.html fonte está no lugar antes de buildar
git checkout -- index.html 2>/dev/null || true

# 4) Build estático
echo "==> Build"
$RUN build

[ -f dist/index.html ] || { echo "ERRO: dist/index.html não gerado." >&2; exit 1; }

# 5) Publicar na raiz: substitui assets/ e index.html pelo build gerado
echo "==> Publicando em $ROOT"
rm -rf "$ROOT/assets"
cp -r dist/assets "$ROOT/"
cp dist/.htaccess "$ROOT/.htaccess" 2>/dev/null || true
cp dist/index.html "$ROOT/index.html"   # substitui o fonte pelo build
rm -rf "$ROOT/dist"

echo ""
echo "==> Deploy concluído. Arquivos servidos de: $ROOT"
