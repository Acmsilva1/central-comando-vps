# Validação local anterior à publicação

> Registro histórico da construção local. A publicação autorizada posterior e as verificações atuais estão em `deployment-status.md`; pendências descritas abaixo podem ter sido resolvidas nessa etapa.

Data: 28/10/2026. Este registro distingue verificações locais, consulta remota de leitura e implantação real.

## Coletor e infraestrutura

| Verificação | Resultado |
| --- | --- |
| Parser de unidades Docker e pares de bytes | Aprovado nos testes Python locais |
| Placeholders de container parado | Aprovado nos testes Python locais |
| Cálculo de CPU, RAM/disco e minimização do contrato | Aprovado com `/proc` e Docker simulados |
| Execução do coletor via SSH, sem `--output` | Aprovada: snapshot sanitizado recebido com 3 containers reais |
| Escrita persistente na VPS | Não executada; a saída remota foi gravada somente na pasta local ignorada `.runtime/` |
| `docker compose config --quiet` | Aprovado localmente sem usuário, senha ou hash em variáveis; o Compose usa apenas `AUTH_FILE` no volume |
| Build e execução do container local | NÃO EXECUTADO — Docker Desktop Linux Engine indisponível neste ambiente |
| Unidades systemd em execução | NÃO EXECUTADO — nenhuma instalação ou ativação de serviço na VPS |
| Publicação Nginx e certificado | NÃO EXECUTADO — depende de ajuste e autorização de publicação |

Comando dos três testes do coletor: `python scripts/test_collector.py`. Não acessa Docker nem rede. A primeira execução revelou diferença de caminhos Windows no mock do teste; foi corrigida normalizando separadores no fixture, sem alterar o contrato Linux.

A consulta real de leitura registrou aproximadamente **838 MB de RAM disponíveis**, CPU de **4,76%** em amostra curta, e containers `mensageria-painel`, `mensageria-worker` e `super-app`. Esses valores pertencem àquela coleta; não são evidência de consumo futuro ou teste de carga. O snapshot não é incluído no Git.

## HTTPS

O registro A de `central-comando-vps.duckdns.org` apontava para a VPS. A consulta HTTPS validando certificados, feita na própria VPS, falhou por **hostname mismatch**. Os sites habilitados do Nginx inspecionados eram mensageria e Super App, sem vhost da nova central. Nenhuma configuração foi modificada.

## Aplicação e PWA

Os 16 testes Node de autenticação, API, credencial persistente e métricas passaram, incluindo o último ajuste para campo único de chave administrativa. A API exige `{token}`, `Origin` correto e `X-Panel-Request: 1`; a sessão tem oito horas e é revogada no logout. O arquivo em volume contém exatamente `{version: 1, tokenHash}`; o schema anterior de usuário e senha é rejeitado. `npm run check` também passou, incluindo a sintaxe JavaScript e as dimensões dos ícones finais do manifest. A criação da credencial por CLI foi validada com arquivos temporários; a execução precisou de permissão para subprocessos devido a `spawn EPERM` do sandbox Windows.

No navegador local foram conferidos a visão geral, a lista pesquisável, o modal de detalhes e o gráfico de histórico. A interface foi inspecionada em viewport estreito e desktop. Não surgiram erros ou avisos nos logs de console consultados. A demonstração usa dados ilustrativos explicitamente identificados; o histórico nela corresponde ao tempo de execução da prévia.

A integração visual/PWA da Mensageria passou em `npm run check` e 113 testes, incluindo quatro testes específicos de manifest, ícones, rotas e exclusão de APIs/QR/sessões do cache. Uma primeira rodada apresentou `EPERM` temporário de arquivo no Windows; o cenário passou isoladamente e a execução completa final passou com permissão adequada a subprocessos. O worker e a API funcional da Mensageria não foram alterados.

Criação real da chave administrativa no volume Docker e persistência após recriação do container: **NÃO EXECUTADO — Docker Desktop Linux Engine indisponível**. Os testes locais do cadastro em arquivo temporário não equivalem a comprovação de volume em produção. Nenhuma chave de produção foi criada nesta etapa.

Gitleaks no código do aplicativo: sem achados. A varredura ampla que incluía as ferramentas locais BMad sinalizou um item em `_bmad/_config/files-manifest.csv`; a inspeção confirmou um checksum hexadecimal de 64 caracteres de um arquivo Markdown, sem credencial. Essa pasta de ferramenta é ignorada e não integra o artefato Docker. O PWA da Mensageria também foi verificado sem achados nos arquivos novos.

Instalação real no Android/iPhone, autenticação pelo domínio publicado, atualização do app instalado e comportamento offline no dispositivo: **NÃO EXECUTADO — depende da publicação HTTPS e do dispositivo real**. Não confundir arquivos PWA e manifest válidos com instalação comprovada.

## Risco residual

- Ausência de teste de carga e de medição do quarto container em funcionamento.
- Só 1 vCPU/2 GB de RAM; reconexões do WhatsApp podem provocar picos. Não configurar limites do worker sem analisar seu comportamento e o pareamento.
- Coletor é um processo local confiável com acesso Docker; proteger sua origem, permissões e atualização.
- Histórico em arquivo é adequado à escala inicial, sem pretensão de substituir uma plataforma completa de observabilidade.
- HTTPS do hostname precisa ser corrigido antes de validar sessão Secure e instalação do PWA em produção.
