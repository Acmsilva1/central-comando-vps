# Alertas de instabilidade e relatório diário

O agendador roda no processo Node da Central: o servidor chama `createMonitor(...).tick()` a cada minuto, depois da primeira coleta. Não depende do navegador aberto nem de uma automação do Codex. Não executar em modo demonstração.

## Configuração privada

O arquivo de runtime `/run/secrets/mensageria.json` deve ser montado somente para leitura e conter os campos `endpoint`, `token`, `audience`, `project`, `reportHour` e `timeZone`. O token é o `INTEGRATION_TOKEN` da mensageria, nunca a chave de administração. Não versionar o arquivo nem seus valores. `enabled: false` desabilita o envio.

- `endpoint`: URL HTTPS da mensageria, caminho `/api/control?action=event`.
- `audience`: perfil autorizado, configurado como `1`. O destinatário individual precisa estar habilitado para `infra.vps_status`, sem acompanhar a sessão do remetente (`follow_session: false`).
- `project`: identificador interno `central-comando-vps`; não é enviado no payload do evento.
- `reportHour`: 20; `timeZone`: `America/Sao_Paulo`.

O estado é persistido em `/data/monitor-state.json` no volume da Central, separado das credenciais e sem token de integração. O processo Node precisa de acesso de gravação ao arquivo. Uma única instância deve ser responsável por esse volume/agendador.

## Regras

- CPU, RAM e disco a partir de 90% por dois minutos observados consecutivamente geram incidente. Uma lacuna de coleta interrompe a contagem inicial. Recuperação ocorre abaixo de 85%, para evitar alternância de avisos perto do limite.
- Coletor sem leitura atual por mais de 60 segundos, containers parados/ausentes ou com healthcheck falhando, OOM e aumento de reinícios geram alterações de estado. Leituras de saúde sem healthcheck não são classificadas como falha.
- O mesmo estado não gera avisos repetidos. Mudanças do mesmo ciclo são agrupadas em um aviso. Recuperações também são notificadas.
- No máximo oito tentativas de envio por hora para evitar congestionamento. Até 128 avisos aguardam na fila; excedentes são contados no estado como `queueOverflow`. Não existe reenvio periódico de incidentes já aceitos e ainda ativos.
- Falhas de transporte e respostas diferentes de HTTP 202 permanecem na fila, com nova tentativa após 30 minutos. HTTP 422 é reportado como `recipient_unavailable`, sem gravar sucesso. O operador deve conferir a autorização do destinatário individual para o perfil configurado.

O payload usa `source: central`, `event_type: infra.vps_status`, `audience: 1`, título/mensagem sanitizados e `idempotency_key` com UUID persistente. Não usa `agent_project`, `agent_request` nem `agent-arm`, pois é um evento normal unidirecional, sem abrir conversa nem esperar resposta. UUID e payload completo são congelados antes da primeira tentativa; retries preservam a audiência. A autorização é enviada apenas no header Bearer, sem redirects.

HTTP 202 confirma entrada na fila da mensageria, não entrega ou leitura física no WhatsApp. A conta remetente precisa estar pareada, e um destinatário individual do perfil 1 deve estar habilitado para `infra.vps_status`. O evento não consulta nem modifica o proprietário do canal de perguntas do agente.

As mensagens começam com `📊 Central de Comando`, compatível com o formatador do worker já em execução, evitando um cabeçalho financeiro. Enquanto esse worker não for atualizado, ele ainda pode acrescentar seu fechamento genérico ao texto; a Central não precisa reiniciar a conexão do WhatsApp para enfileirar esses avisos.

## Relatório

Às 20h do fuso configurado, uma vez por data local, o resumo informa a janela realmente observada, quantidade de amostras, picos de CPU/RAM, espaço livre na última leitura, estado dos containers e incidentes detectados. Se o serviço iniciar depois das 20h, agenda o resumo na primeira execução desse dia. Não presume métricas anteriores à implantação nem converte amostras em percentual de disponibilidade. Sem amostras, os picos ficam explicitamente indisponíveis.

O estado e o marcador diário sobrevivem à recriação do container. Falha ao ler um estado existente ou gravar o estado impede o envio: o operador deve restaurar uma cópia válida, sem apagar o arquivo às cegas e provocar duplicatas.

## Limitação de disponibilidade

O monitor e a mensageria ficam na mesma VPS. Se a máquina desligar, a rede cair ou o Docker/Node parar completamente, eles não conseguem enviar um alerta naquele momento. Detectar indisponibilidade total exige uma sonda externa independente; este monitor cobre apenas condições observadas enquanto o processo e a rota de envio estão operantes.

Testes locais usam relógio, snapshots e `fetch` simulados. Nenhuma mensagem real é enviada pela suíte.
