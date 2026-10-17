#!/usr/bin/env bash
# Volta uma cópia de segurança do banco.
#   sudo bash /opt/marmitaria/publicar/restaurar.sh /caminho/marmitaria-copia-2026-10-16.db
# Antes de trocar, guarda o banco atual em /var/lib/marmitaria/copias/antes-de-restaurar-*.db
set -euo pipefail
ARQ="${1:-}"
D=/var/lib/marmitaria
[ "$(id -u)" = 0 ] || { echo "Rode com sudo."; exit 1; }
[ -f "$ARQ" ] || { echo "Arquivo não encontrado: $ARQ"; echo "Cópias do servidor:"; ls -1t "$D/copias" | head -20; exit 1; }
[ "$(head -c 15 "$ARQ")" = "SQLite format 3" ] || { echo "Esse arquivo não é uma cópia do sistema."; exit 1; }
sqlite3 "$ARQ" 'PRAGMA integrity_check;' | grep -qx ok || { echo "A cópia está danificada."; exit 1; }
systemctl stop marmitaria
[ -f "$D/marmitaria.db" ] && sqlite3 "$D/marmitaria.db" ".backup '$D/copias/antes-de-restaurar-$(date +%F-%H%M).db'"
rm -f "$D/marmitaria.db-wal" "$D/marmitaria.db-shm"
cp "$ARQ" "$D/marmitaria.db"
chown marmitaria:marmitaria "$D/marmitaria.db"
systemctl start marmitaria
echo "✔ Cópia restaurada e sistema reiniciado."
