#!/usr/bin/env bash
# Stands up a real SSH server + a real MySQL-compatible (MariaDB) server on
# this box, for test:integration to run C-Cloud's actual SSH/rsync/scp
# transport and database-import code against — not mocks. Intended for a
# disposable dev container/VM; creates a system user and starts services
# outside of systemd (works in minimal containers with no init system).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (creates a system user, installs packages, binds low-ish ports)." >&2
  exit 1
fi

SSH_PORT="${CCLOUD_IT_SSH_PORT:-2200}"
SSH_USER="${CCLOUD_IT_SSH_USER:-ccloud_test}"
SSH_KEY_PATH="${CCLOUD_IT_SSH_KEY_PATH:-/tmp/ccloud_test_key}"
MYSQL_PORT="${CCLOUD_IT_MYSQL_PORT:-3306}"
MYSQL_USER="${CCLOUD_IT_MYSQL_USER:-ccloud_master}"
MYSQL_PASSWORD="${CCLOUD_IT_MYSQL_PASSWORD:-master-pw-for-test}"

echo "==> Installing openssh-server, rsync, cron, mariadb-server..."
apt-get update -qq
apt-get install -y -qq openssh-server openssh-client rsync cron mariadb-server mariadb-client >/dev/null

echo "==> Creating SSH target user '$SSH_USER' and key pair..."
id -u "$SSH_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$SSH_USER"
mkdir -p "/home/$SSH_USER/.ssh"
if [ ! -f "$SSH_KEY_PATH" ]; then
  ssh-keygen -t ed25519 -f "$SSH_KEY_PATH" -N "" -q
fi
cp "$SSH_KEY_PATH.pub" "/home/$SSH_USER/.ssh/authorized_keys"
chown -R "$SSH_USER:$SSH_USER" "/home/$SSH_USER/.ssh"
chmod 700 "/home/$SSH_USER/.ssh"
chmod 600 "/home/$SSH_USER/.ssh/authorized_keys"

echo "==> Starting sshd on port $SSH_PORT..."
mkdir -p /run/sshd
pkill -f "sshd: /usr/sbin/sshd -p $SSH_PORT" 2>/dev/null || true
/usr/sbin/sshd -p "$SSH_PORT" -o PidFile="/tmp/ccloud_it_sshd_${SSH_PORT}.pid"

echo "==> Starting mariadbd..."
mkdir -p /run/mysqld
chown mysql:mysql /run/mysqld
if ! mysqladmin ping >/dev/null 2>&1; then
  nohup mariadbd --user=mysql >/tmp/ccloud_it_mariadb.log 2>&1 &
  disown
  for _ in $(seq 1 30); do
    mysqladmin ping >/dev/null 2>&1 && break
    sleep 1
  done
fi

echo "==> Creating MySQL master user '$MYSQL_USER'..."
mysql -uroot <<SQL
CREATE USER IF NOT EXISTS '${MYSQL_USER}'@'%' IDENTIFIED BY '${MYSQL_PASSWORD}';
GRANT ALL PRIVILEGES ON *.* TO '${MYSQL_USER}'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
SQL

echo "==> Verifying..."
ssh -i "$SSH_KEY_PATH" -p "$SSH_PORT" -o StrictHostKeyChecking=accept-new -o BatchMode=yes \
  "$SSH_USER@127.0.0.1" 'echo "  ssh: ok ($(whoami))"'
mysql -h127.0.0.1 -P"$MYSQL_PORT" -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -e "SELECT '  mysql: ok' AS status;" -N

cat <<EOF

Ready. Run:
  CCLOUD_IT_SSH_PORT=$SSH_PORT CCLOUD_IT_SSH_USER=$SSH_USER CCLOUD_IT_SSH_KEY_PATH=$SSH_KEY_PATH \\
  CCLOUD_IT_MYSQL_PORT=$MYSQL_PORT CCLOUD_IT_MYSQL_USER=$MYSQL_USER CCLOUD_IT_MYSQL_PASSWORD=$MYSQL_PASSWORD \\
  npm run test:integration --workspace packages/migration-engine
EOF
