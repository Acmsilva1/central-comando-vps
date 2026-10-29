# Publicação e validação em produção

Registro de 28/10/2026 em São Paulo; os timestamps UTC dos backups podem corresponder ao dia seguinte.

## Resultado

- Central publicada em https://central-comando-vps.duckdns.org com certificado válido, healthcheck saudável e API privada retornando401 sem sessão.
- Login real e persistência da chave no volume conferidos no navegador, inclusive após reinício da central.
- Coletor systemd e agendador Node ativos; métricas reais de quatro containers e histórico persistente.
- Mensageria PWA publicada; manifest, service worker e ícones verificados por HTTPS.
- Perfil1 confirmado pelo usuário: somente o evento `infra.vps_status` foi acrescentado ao destinatário individual existente, preservando telefone, referência e demais permissões.
- Aviso de teste e primeiro relatório registrados como `sent` pela mensageria, sem erro. Fila do monitor vazia; marcador diário persistido. O primeiro relatório foi executado após a implantação, que ocorreu depois das20h locais.
- Relatório diário:20h em America/Sao_Paulo; alertas por mudança de estado e recuperação, com deduplicação e retries.
- Worker WhatsApp preservado: mesmo container, imagem, início e zero reinícios. Super App saudável.

`sent` comprova aceitação do envio pela biblioteca, sem comprovar recebimento ou leitura física no celular.

## Testes

- Central:26 testes Node aprovados, incluindo10 cenários de monitoramento; `npm run check` aprovado.
- Coletor:3 testes Python aprovados.
- Mensageria:115 testes aprovados e sintaxe verificada, incluindo dois testes do evento de infraestrutura.
- Compose, unidades systemd, build e execução Docker na VPS validados.
- HTTPS dos três domínios funcionando; timers de coleta e renovação de certificado ativos.
- Gitleaks no código da central e nos testes sem achados.

## Recursos e recuperação

A central tem limite192MB e0,5CPU. Após estabilização, as amostras de RAM ficaram aproximadamente entre26 e86MB; isso não equivale a teste de carga.

Backups privados:

- `/root/central-comando-backups/20261028T182222Z`
- `/root/mensageria-backups/pwa-20261028T182316Z`
- `/root/mensageria-backups/infra-20261029T003740Z`
- `/root/mensageria-backups/profile-1-infra-20261029T004006Z`

O snapshot de release está identificado por `source_sha256` em `/opt/central-comando-vps/release.json`. Credenciais e estado não foram incluídos no artefato.

## Limites

- Instalação/atualização/offline em Android ou iPhone real não executados; manifest, assets e HTTPS verificados.
- Teste de carga e simulação destrutiva de falhas em produção não executados. Limiares, recuperações, retries, deduplicação e horário diário foram testados com relógio e transporte simulados.
- Queda total da VPS impede o próprio monitor e a mensageria de enviarem avisos; exige uma sonda externa independente.
- `infra.vps_status` foi publicado no backend em volume desta VPS. Uso no backend PostgreSQL exigiria migração específica.
- O worker preservado ainda acrescenta seu fechamento genérico; o prefixo da central impede o cabeçalho financeiro.
- Não houve commit/push nesta publicação; código local e snapshot de release preservados.

## Atualização visual de 29/10/2026

- Mensageria e Central publicadas com padrão do Super App: temas claro/escuro, tipografia, cores, modais e feedback.
- Mensageria: lista pesquisável e filtrável, novo alerta e edição em modal, exclusão lógica de contatos com cancelamento de pendentes e preservação do histórico. PostgreSQL requer migration008; VPS usa volume, sem alteração de banco externo.
- Central: padrão visual e modais existentes; sem CRUD de regras.
- Versões PWA geradas automaticamente por conteúdo durante check/build: Mensageria6dbd2703a3b38bcf; Central5ed83146349af4c4. O fluxo de atualizar/recarregar foi conferido no navegador, inclusive na Central publicada.
- Mensageria: regressão123cenários,122aprovados inicialmente e um spawnEPERM do sandbox; o cenário bloqueado passou na reexecução apropriada. Após proteção transacional, os31testes de CRUD/contratos/grupos e4testes PWA passaram. Central26/26; checks de sintaxe aprovados.
- CRUD completo, busca, filtro, cancelamento, proteção de formulário não salvo e temas conferidos no demo. Login e leitura reais conferidos nos dois painéis; não foram alterados contatos reais nem enviados testes de WhatsApp nesta atualização.
- HTTPS/401 sem sessão, assets idênticos às fontes publicadas e Cache-Control no-store do SW conferidos. Central saudável; Mensageria conectada com3contatos.
- Backup privado: /root/ui-backups/20261029t102016z. Apenas os dois painéis foram recriados. Worker preservado no mesmo ID/imagem/início; hash de credencial e configuração de alertas preservados.
- Instalação e atualização em celular físico não executadas. Não equivale a validação de dispositivo nem teste de carga.
- Commit e push desta atualização registrados no Git nas branches de implementação; o item histórico de ausência de commit acima pertence à publicação anterior.
