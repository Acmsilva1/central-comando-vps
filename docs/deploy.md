# Preparação de implantação e rollback

Procedimento de implantação autorizado separadamente do desenvolvimento local. O estado efetivamente executado, evidências e pendências devem ser registrados em `docs/validation.md`; os comandos abaixo não comprovam por si só que a publicação ocorreu.

## Pré-condições

- Host Linux com Docker Compose, Python 3 e Nginx; scripts e arquivos do coletor pertencem a root e não são editáveis pelo usuário da aplicação.
- Backup privado da configuração Nginx, das unidades systemd e de qualquer release/volume de dados existente da central. O volume contém o cadastro e hash da chave administrativa e deve receber proteção de credencial.
- Terminal seguro para cadastrar explicitamente uma chave de 32 a 256 caracteres; não há chave padrão. A chave é digitada sem eco e persistida apenas como hash scrypt. Não há campo de usuário no acesso.
- Certificado válido para `central-comando-vps.duckdns.org`, com renovação preservada. Na inspeção de 28/10/2026 o certificado apresentado não correspondia a esse hostname.
- Confirmar que `127.0.0.1:8081` está disponível. Não alterar as portas da mensageria nem do Super App.
- Medir recursos em homologação. Os 192 MB de RAM e 0,5 CPU do Compose são limites propostos; não garantias de consumo.

Os comandos abaixo pertencem ao shell Linux da VPS. Não fornecer a chave como argumento de processo, variável versionada ou comando que possa permanecer no histórico do terminal. Criar uma credencial independente; não copiar a chave da mensageria.

## Preparar o coletor

Instalar o código revisado em `/opt/central-comando-vps`, mantendo o novo projeto separado de `/opt/central-de-controle-vps` e dos outros aplicativos.

```sh
sudo install -d -o root -g root -m 0755 /var/lib/central-comando-vps/metrics
sudo chown root:root /opt/central-comando-vps/scripts/collect_metrics.py
sudo chmod 0644 /opt/central-comando-vps/scripts/collect_metrics.py
sudo install -o root -g root -m 0644 deploy/central-metrics.service /etc/systemd/system/central-metrics.service
sudo install -o root -g root -m 0644 deploy/central-metrics.timer /etc/systemd/system/central-metrics.timer
sudo systemd-analyze verify /etc/systemd/system/central-metrics.service /etc/systemd/system/central-metrics.timer
sudo systemctl daemon-reload
sudo systemctl start central-metrics.service
```

Conferir o snapshot localmente sem publicá-lo. Ele precisa ter `version: 1`, timestamp recente e os containers esperados. Só então habilitar o timer:

```sh
sudo systemctl enable --now central-metrics.timer
```

O timer agenda nova coleta 15 segundos após a anterior terminar; uma coleta pode demorar alguns segundos. Não é cron com precisão fixa de 15 segundos. Em caso de erro, o snapshot anterior permanece e o painel mostra leitura antiga.

## Subir a central isoladamente

No diretório do projeto, construir a imagem e criar o cadastro **antes de `up`**:

```sh
docker compose -p central-comando-vps config --quiet
docker compose -p central-comando-vps build central
docker compose -p central-comando-vps run --rm --no-deps central node scripts/admin-create.mjs
docker compose -p central-comando-vps up -d central
docker compose -p central-comando-vps ps
```

A criação interativa solicita somente a chave administrativa oculta e grava `{version:1,tokenHash}` em `/data/auth/admin.json`, pelo caminho `AUTH_FILE`. Não usar `--reset` durante a primeira criação nem apenas para contornar um erro de cadastro existente: o comando recusa sobrescrever o arquivo por padrão.

A aplicação roda com UID do usuário `node`; o Dockerfile prepara `/data` para o volume `central-data`, que preserva cadastro e histórico. O container não recebe socket Docker, chave SSH ou filesystem do host. O Compose publica somente no loopback. A aplicação não exige usuário, chave ou hash em variáveis de ambiente; apenas o caminho do cadastro privado.

Conferir healthcheck, leitura do snapshot e escrita do histórico. Testar o login no HTTPS configurado; não desabilitar o atributo Secure do cookie para facilitar um teste em HTTP.

## Rotacionar a chave administrativa

Somente com autorização para trocar a credencial, fazer backup privado do volume e executar:

```sh
docker compose -p central-comando-vps run --rm --no-deps central node scripts/admin-create.mjs --reset
docker compose -p central-comando-vps restart central
```

O reinício aplica o novo cadastro e invalida sessões anteriores. Não reiniciar os outros serviços. Fazer uma nova autenticação e verificar o bloqueio da chave anterior. Não enviar o arquivo `admin.json`, hash, chave ou backup pelo chat. O cookie da central é separado do cookie da mensageria; rotação na central não altera o acesso da mensageria.

## Encaminhar o domínio

Usar `deploy/nginx-location.conf` como **trecho** do vhost HTTPS dedicado. Não substituir o vhost da mensageria, do Super App ou arquivos de certificado existentes. Conferir `server_name`, cadeia do certificado e configuração de renovação.

```sh
sudo nginx -t
sudo systemctl reload nginx
```

Após publicação autorizada, verificar: certificado e hostname; `/api/health`; bloqueio da API sem sessão; login e logout; métricas recentes; atualização do histórico; manifest, service worker e ícones; instalação Android/iPhone; atualização/offline; memória e CPU do conjunto. Um HTTP 200 não comprova instalação nem estabilidade sob carga.

## Alertas WhatsApp e relatório das 20h

O agendamento pertence ao processo Node da central. O relatório diário deve considerar **20:00 em `America/Sao_Paulo`**, independentemente do fuso do host ou container. Não instalar um segundo serviço de envio nem usar credenciais de administrador do painel da mensageria.

Guardar a configuração privada da integração fora do repositório e montá-la no container em `/run/secrets/mensageria.json`, em leitura, acessível apenas ao processo da central e ao administrador do host. O estado de agendamento e tentativas fica em `/data/monitor-state.json`, no volume persistente. Nunca exibir o conteúdo desses arquivos no terminal, chat, documentação, API do painel ou logs.

O arquivo privado aceita `endpoint`, `token` (token de integração da mensageria), `audience`, `project`, `reportHour`, `timeZone` e `enabled`. Para esta central, o destino autorizado pelo usuário é `audience: "1"`, o projeto é `central-comando-vps`, o horário é `20` e o fuso é `America/Sao_Paulo`. `enabled: false` mantém a integração desligada para preparação. O agendador consulta o relógio uma vez por minuto dentro do processo Node; não depende do cron do Linux.

Antes de habilitar envios, confirmar sessão conectada e um único destinatário individual ativo do perfil `1`, com `infra.vps_status` habilitado e `follow_session: false`. O evento não altera o proprietário nem as perguntas/respostas do canal de agentes.

O envio usa `POST /api/control?action=event`, token de integração no header Bearer e JSON `source: "central"`, `event_type: "infra.vps_status"`, `audience: "1"`, título, mensagem e chave de idempotência. Não incluir campos do canal de agentes.

Retries preservam chave e payload completo, persistidos antes da rede. Uma falha agenda nova tentativa em30min; o limite de8tentativas/h evita congestionamento e não é a quota do canal de agentes. Não versionar tokens ou arquivos de runtime.

HTTP `202` comprova aceitação na fila, não recebimento no aparelho. Após o teste expressamente autorizado, conferir o estado do job no painel e, separadamente, o recebimento físico. Erros de autenticação, destinatário, quota, conexão e entrega devem ficar visíveis e saneados; não marcar relatório como enviado se a fila não o aceitou. A política de catch-up, limiares e cooldowns está em `docs/monitoring.md`.

## Atualização e rollback

Antes de atualizar, registrar o commit e o ID da imagem atual da central, manter a imagem anterior com tag local de rollback e copiar a configuração Nginx para backup privado. Não usar `docker system prune` nem remover volumes como parte de uma atualização.

Se a central degradar:

1. Restaurar o trecho Nginx anterior, executar `nginx -t` e recarregar somente após sucesso.
2. Parar somente a nova central: `docker compose -p central-comando-vps stop central`.
3. Se houve release anterior, retornar à imagem anterior preservada e à configuração compatível, usando `up -d --no-build central`.
4. Se o coletor novo for a causa, desabilitar apenas `central-metrics.timer` e restaurar as unidades anteriores, se existirem.
5. Preservar o volume `central-data`, snapshots e backups privados para diagnóstico. Não substituir o cadastro por uma versão antiga sem autorização de restauração da credencial.

Não executar `down -v`. Não reiniciar mensageria, worker ou Super App para desfazer a central.
