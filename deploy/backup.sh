#!/bin/sh
# Backup diário do banco e dos arquivos. Agende com: crontab -e  →  30 3 * * * /opt/laudo-ecv/deploy/backup.sh
set -e
cd "$(dirname "$0")/.."
mkdir -p backups
docker compose exec -T app node -e "require('node:sqlite');const {db}=require('./server/db');db.exec(\"VACUUM INTO '/data/backup.db'\")"
tar -czf "backups/laudo-$(date +%Y%m%d).tar.gz" -C dados backup.db files demo-cnpjs.json 2>/dev/null || tar -czf "backups/laudo-$(date +%Y%m%d).tar.gz" -C dados backup.db files
rm -f dados/backup.db
find backups -name 'laudo-*.tar.gz' -mtime +30 -delete
