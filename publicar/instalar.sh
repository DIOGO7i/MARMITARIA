#!/usr/bin/env bash
# Instala (ou ATUALIZA) o sistema da marmitaria num servidor Ubuntu 22.04/24.04 — ex.: Oracle Cloud "Always Free".
#
#   sudo bash marmitaria/publicar/instalar.sh  SEU-ENDERECO.duckdns.org  [CHAVE_GOOGLE_MAPS]
#
# Pode rodar quantas vezes quiser: na segunda vez em diante ele só atualiza o programa.
# Os dados (pedidos, caixa, clientes...) ficam em /var/lib/marmitaria e NUNCA são apagados por este script.
set -euo pipefail

DOMINIO="${1:-}"
GOOGLE_KEY="${2:-}"
APP=/opt/marmitaria
DADOS=/var/lib/marmitaria
ENVF=/etc/marmitaria.env
ORIGEM="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ok()   { printf '\n\033[1;32m✔ %s\033[0m\n' "$*"; }
info() { printf '\n\033[1;34m→ %s\033[0m\n' "$*"; }
erro() { printf '\n\033[1;31m✘ %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || erro "Rode com sudo:  sudo bash $0 $*"
[ -f "$ORIGEM/package.json" ] && [ -d "$ORIGEM/server" ] || erro "Não achei o sistema em $ORIGEM. Descompacte o marmitaria.zip e rode o script de dentro da pasta."
if [ -z "$DOMINIO" ] && [ -f "$ENVF" ]; then DOMINIO="$(sed -n 's#^APP_URL=https://##p' "$ENVF")"; fi
[ -n "$DOMINIO" ] || erro "Informe o endereço. Ex.:  sudo bash $0 gisa-marmitas.duckdns.org"
DOMINIO="${DOMINIO#https://}"; DOMINIO="${DOMINIO#http://}"; DOMINIO="${DOMINIO%%/*}"

export DEBIAN_FRONTEND=noninteractive

info "1/8  Fuso horário de São Paulo"
timedatectl set-timezone America/Sao_Paulo 2>/dev/null || ln -sf /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime

info "2/8  Memória extra (swap), para servidores pequenos"
if [ ! -f /swapfile ] && [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 3000000 ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

info "3/8  Programas básicos"
echo iptables-persistent iptables-persistent/autosave_v4 boolean true | debconf-set-selections
echo iptables-persistent iptables-persistent/autosave_v6 boolean true | debconf-set-selections
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg sqlite3 rsync unzip iptables-persistent >/dev/null

info "4/8  Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a===22 && b<13) process.exit(1)' || erro "Node $(node -v) é antigo. Precisa do 22.13 ou mais novo."

info "5/8  Caddy (cadeado HTTPS automático)"
if ! command -v caddy >/dev/null; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null || true
  if curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
     && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list; then
    apt-get update -qq
  fi
  apt-get install -y -qq caddy >/dev/null
fi

info "6/8  Copiando e preparando o sistema (demora uns minutos na primeira vez)"
id marmitaria >/dev/null 2>&1 || useradd --system --home "$DADOS" --shell /usr/sbin/nologin marmitaria
mkdir -p "$APP" "$DADOS/copias"
if [ "$ORIGEM" != "$APP" ]; then
  rsync -a --delete --exclude node_modules --exclude 'server/data' --exclude 'web/dist' --exclude '.env' "$ORIGEM/" "$APP/"
fi
cd "$APP"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent
chown -R marmitaria:marmitaria "$DADOS"
chown -R root:root "$APP"

if [ ! -f "$ENVF" ]; then
  cat > "$ENVF" <<EOF
NODE_ENV=production
PORT=3001
DATA_DIR=$DADOS
TRUST_PROXY=1
APP_URL=https://$DOMINIO
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
# Endereço com sugestão e distância (opcional): GOOGLE_MAPS_API_KEY=AIza...
EOF
fi
sed -i "s#^APP_URL=.*#APP_URL=https://$DOMINIO#" "$ENVF"
if [ -n "$GOOGLE_KEY" ]; then
  sed -i '/^#\? *GOOGLE_MAPS_API_KEY=/d' "$ENVF"; echo "GOOGLE_MAPS_API_KEY=$GOOGLE_KEY" >> "$ENVF"
fi
chmod 600 "$ENVF"

cat > /etc/systemd/system/marmitaria.service <<EOF
[Unit]
Description=Sistema da marmitaria
After=network-online.target
Wants=network-online.target

[Service]
User=marmitaria
WorkingDirectory=$APP
EnvironmentFile=$ENVF
ExecStart=/usr/bin/npm start --silent
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DADOS /tmp

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable marmitaria >/dev/null 2>&1
systemctl restart marmitaria

info "7/8  Portas 80/443 liberadas e HTTPS para $DOMINIO"
for P in 80 443; do
  iptables -C INPUT -p tcp --dport $P -m state --state NEW -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 5 -p tcp --dport $P -m state --state NEW -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 1 -p tcp --dport $P -m state --state NEW -j ACCEPT
done
netfilter-persistent save >/dev/null 2>&1 || true
cat > /etc/caddy/Caddyfile <<EOF
$DOMINIO {
	encode gzip
	reverse_proxy 127.0.0.1:3001
}
EOF
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy

info "8/8  Cópia de segurança automática todo dia às 3h30 (guarda 30 dias)"
cat > /usr/local/bin/marmitaria-copia <<'EOF'
#!/usr/bin/env bash
# Faz uma cópia do banco agora. Uso: sudo marmitaria-copia
set -e
D=/var/lib/marmitaria
[ -f "$D/marmitaria.db" ] || exit 0
sqlite3 "$D/marmitaria.db" ".backup '$D/copias/marmitaria-$(date +%F-%H%M).db'"
find "$D/copias" -name 'marmitaria-*.db' -mtime +30 -delete
chown -R marmitaria:marmitaria "$D/copias"
EOF
chmod 755 /usr/local/bin/marmitaria-copia
echo '30 3 * * * root /usr/local/bin/marmitaria-copia' > /etc/cron.d/marmitaria-copia
/usr/local/bin/marmitaria-copia || true

# Confere se o sistema respondeu
for _ in $(seq 1 40); do
  curl -fs -o /dev/null http://127.0.0.1:3001/api/health && break
  sleep 1
done
if ! curl -fs -o /dev/null http://127.0.0.1:3001/api/health; then
  journalctl -u marmitaria -n 30 --no-pager
  erro "O sistema não abriu. Copie as linhas acima e mande para quem instalou."
fi

ok "Pronto! Abra no celular:  https://$DOMINIO"
echo "   (o cadeado HTTPS pode levar 1 a 2 minutos para aparecer na primeira vez)"
echo
echo "   Comandos úteis:"
echo "     sudo systemctl status marmitaria      → ver se está rodando"
echo "     sudo journalctl -u marmitaria -n 50   → ver os últimos avisos"
echo "     sudo marmitaria-copia                 → fazer uma cópia de segurança agora"
echo "     sudo bash $APP/publicar/restaurar.sh ARQUIVO.db  → voltar uma cópia"
