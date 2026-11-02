# Instalação no VPS da Hostinger

Requisitos: VPS Ubuntu 22.04/24.04, 2 GB de RAM ou mais, e um subdomínio (ex.: `laudo.suaempresa.com.br`) com registro **A** apontando para o IP do VPS (hPanel → Domínios → DNS).

1. Entre no VPS por SSH (hPanel → VPS → Acesso SSH) e instale o Docker:
   `curl -fsSL https://get.docker.com | sh`
2. Baixe o sistema:
   `git clone https://github.com/otaviobmarques/sistema-laudo-tecnico-detran-mg /opt/laudo-ecv && cd /opt/laudo-ecv`
3. Configure: `cp .env.example .env && nano .env` (domínio e senha do Administrador).
4. Suba: `docker compose up -d --build`. O HTTPS é emitido automaticamente pelo Caddy em 1–2 minutos.
5. Backup diário: `crontab -e` e adicione `30 3 * * * /opt/laudo-ecv/deploy/backup.sh`. Copie a pasta `backups/` para fora do servidor (ou ative o backup do VPS no hPanel).

Atualizar para uma nova versão: `cd /opt/laudo-ecv && git pull && docker compose up -d --build`.
Ver os logs: `docker compose logs -f app`.
