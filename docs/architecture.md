# Arquitetura e contrato

## ADR-001 — Monitoramento leve, sem banco adicional

Contexto: VPS com 1 vCPU, aproximadamente 2 GB de RAM e três containers ativos na inspeção inicial. O worker do WhatsApp é o maior consumidor. A prioridade desta entrega é visualizar capacidade sem acrescentar uma pilha pesada de observabilidade.

Decisão: aplicação Node.js 24 com APIs nativas; HTML, CSS e JavaScript sem framework de build; coletor Python no host; snapshots JSON e histórico local limitado a sete dias. Acesso por chave administrativa, com o mesmo mecanismo de entrada usado no painel da mensageria e credencial isolada, sem dependência de bancos ou credenciais do Super App.

O cadastro da chave é criado explicitamente pelo comando `npm run admin:create`. O arquivo privado `AUTH_FILE=/data/auth/admin.json` contém `{version:1,tokenHash}`; apenas o hash scrypt é persistido, nunca a chave em texto. A entrada exige uma chave de 32 a 256 caracteres e não solicita nome de usuário. O volume `central-data` preserva cadastro e histórico entre recriações do container. O modo real recusa inicialização sem cadastro válido. O cadastro existente não é sobrescrito pelo assistente sem `--reset` explícito. A sessão opaca e revogável é temporária em memória, com validade de oito horas; um reinício da central encerra as sessões existentes. Rotação da chave deve ser seguida de reinício para aplicar a credencial e invalidar sessões.

O mecanismo acompanha a mensageria, mas as credenciais e os cookies são independentes: não se copia a chave existente da mensageria nem se compartilha uma sessão entre os aplicativos. Nenhuma chave de produção foi criada durante a implementação local.

Fluxo:

1. Um timer systemd executa `scripts/collect_metrics.py` no host.
2. O coletor consulta `/proc`, disco raiz e `docker ps`, `inspect` e `stats` em leitura.
3. Publica atomicamente um snapshot sanitizado em `/var/lib/central-comando-vps/metrics/snapshot.json`.
4. O container recebe somente esse diretório montado em leitura.
5. A API valida o contrato, descarta campos extras e expõe os KPIs após autenticação.
6. O navegador consulta a API a cada 15 segundos enquanto a tela está visível.

Não se monta `/var/run/docker.sock`, `/proc` ou o filesystem raiz na aplicação. O coletor precisa de permissão Docker no host; essa permissão fica restrita ao processo local confiável, não ao servidor HTTP.

## Contrato de dados v1

Envelope: `version: 1`, `sampledAt` ISO 8601, `host`, `containers`.

`host` contém apenas hostname, CPU, totais/disponíveis de memória, disco raiz, swap, uptime, carga e bytes de rede acumulados das interfaces físicas reconhecidas. RAM usada = total − `MemAvailable`: inclui o fato de o Linux poder recuperar cache. CPU é uma amostra curta de `/proc/stat`, não a média histórica do minuto.

Cada container contém ID curto, nome, imagem, projeto Compose, estado, saúde, CPU, memória de trabalho, limite explícito de memória, reinícios, PIDs, início e contadores acumulados de rede/disco. A memória é a apresentada por `docker stats`, que desconsidera cache recuperável no Linux. `memoryLimit: null` significa ausência de teto configurado, não consumo zero. Contadores de rede e disco são acumulados, não taxas por segundo; containers em rede host podem não ter atribuição individual útil.

Nunca publicar `Config.Env`, payload de mensagens, credenciais, caminhos de volumes, chaves de sessão, certificados ou saída completa de `docker inspect`. O arquivo de snapshot fica fora do Git e não deve ser servido como estático pelo Nginx.

Falha de coleta não substitui dados válidos por zeros. A API preserva a última leitura e sinaliza `stale`; sem nenhuma leitura válida retorna indisponibilidade. Leituras com mais de 60 segundos são consideradas antigas. O dashboard precisa mostrar essa situação explicitamente.

## Histórico

Uma amostra válida por minuto, até 10.080 pontos, no volume persistente `central-data`, em `/data/history.json`; o cadastro fica em subdiretório separado `/data/auth`. O histórico começa com a primeira coleta; não inventa passado para preencher gráficos. Queda do coletor não equivale a consumo zero. Retenção de sete dias também se aplica à série recuperada após reinício. Backups do volume contêm hashes de credenciais e precisam de proteção privada.

## ADR-002 — PWA sem cache de dados autenticados

O service worker guarda somente página offline pública, CSS dessa página e ícones. APIs, HTML do painel, sessão, QR Code e dados operacionais não entram no cache do PWA. Sem internet, a interface deve apresentar a página de reconexão, não fingir que as métricas antigas são atuais.

Manifest usa `display: standalone`, escopo raiz e ícones PNG 192/512, incluindo versões maskable. O ícone Apple usa 180 px. A instalação real depende do navegador, do dispositivo e do domínio HTTPS correto.

## PRD inicial

Objetivo: permitir que o administrador veja rapidamente se a VPS tem capacidade, identifique o container que mais consome e consulte tendências no celular.

Critérios: dados reais separados de demo; acesso por um único campo de chave administrativa no modo real, com o mesmo padrão de entrada da mensageria e credencial independente; tabelas e detalhes legíveis no celular; indicação de falta de conexão/coleta; métricas sem segredos; PWA instalável; nenhuma modificação dos serviços monitorados.

Fora desta primeira versão: start/stop/restart, terminal remoto, gerenciamento de credenciais dos aplicativos, logs de mensagens, alertas externos, multiusuário e instalação automática na VPS.
