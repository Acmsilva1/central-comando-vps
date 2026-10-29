# Central de Comando VPS

Painel privado para acompanhar recursos da VPS e seus containers. Projeto novo e independente da central antiga. Publicado em **https://central-comando-vps.duckdns.org**.

A aplicação usa Node.js 24 e APIs nativas, sem dependências npm de execução e sem banco adicional. A coleta Linux usa apenas Python 3 e Docker CLI do próprio host.

## Primeira versão

- CPU, RAM disponível/em uso, disco, uptime e carga da VPS.
- Containers com estado, saúde, CPU, memória, limites, reinícios e tráfego acumulado.
- Histórico de CPU/RAM/disco com retenção de sete dias e uma amostra por minuto.
- Pesquisa e detalhes de cada container; interface adaptada ao celular.
- PWA com ícones, modo standalone, atualização e página offline.
- Acesso por chave de administração, como no painel da mensageria, com hash scrypt, sessão em cookie HttpOnly e proteção de origem.
- Alertas de instabilidade e recuperação pelo WhatsApp do perfil 1; relatório breve às 20h de São Paulo, agendados pelo processo Node.

O monitoramento dos containers opera **somente em leitura**. A aplicação não recebe socket Docker, chave SSH, envs de containers ou credenciais administrativas dos outros serviços. O envio de alertas usa apenas o token de integração da mensageria, montado em arquivo privado em leitura.

## Executar localmente

Requisito: Node.js 24.

```powershell
npm run demo
```

Abra **http://127.0.0.1:8081**. O modo demo usa dados ilustrativos e não consulta a VPS; o histórico começa quando o processo inicia. O botão de instalação aparece quando o navegador oferece a instalação. No iPhone, o aviso explica o caminho pelo menu Compartilhar.

```powershell
npm run check
npm test
```

Os testes Python do coletor são independentes do Docker e da VPS:

```powershell
python scripts/test_collector.py
```

## Operação real

1. Prepare o coletor no host e o diretório de snapshots conforme [o procedimento de implantação](docs/deploy.md).
2. Construa a imagem com `docker compose -p central-comando-vps build central`.
3. Cadastre a chave administrativa antes de iniciar o servidor: `docker compose -p central-comando-vps run --rm --no-deps central node scripts/admin-create.mjs`. O assistente solicita uma chave de 32 a 256 caracteres com entrada oculta. Não há chave padrão nem campo de usuário.
4. Publique o container somente após validar o HTTPS, o login e os limites em homologação.

O cadastro persiste no volume `central-data`, em `/data/auth/admin.json`, somente com versão e hash scrypt da chave; a chave nunca é armazenada em texto. O mesmo volume guarda o histórico. A aplicação não cria credencial automaticamente e não sobe no modo real sem cadastro válido. No desenvolvimento local, `npm run admin:create` usa o caminho privado configurado em `AUTH_FILE`.

O acesso segue o mesmo modelo visual da mensageria: um único campo **Chave de administração**. Cada aplicação mantém sua própria chave e seu próprio cookie. A chave de produção já foi cadastrada no volume e entregue ao proprietário; não executar novamente o cadastro nem usar `--reset` em atualizações normais.

O Compose publica apenas `127.0.0.1:8081`, prevê teto de **192 MB de RAM** e **0,5 CPU**, filesystem em leitura, usuário sem root e volume de dados persistente. Limites configurados não equivalem a consumo medido ou teste de capacidade.

## Situação do domínio

Publicado com vhost próprio, certificado válido e encaminhamento para `127.0.0.1:8081`. O problema inicial de certificado incompatível foi corrigido. O certificado atual vence em 26/01/2027 e a renovação via Certbot está agendada. Login e métricas reais foram conferidos no navegador; a API sem sessão retorna 401.

## Documentação

- [Arquitetura e contrato de coleta](docs/architecture.md)
- [Implantação e rollback](docs/deploy.md)
- [Validações e limites da evidência](docs/validation.md)
- [Publicação e verificações em produção](docs/deployment-status.md)
- [Alertas e relatório diário](docs/monitoring.md)

O BMad foi inicializado no ambiente de desenvolvimento conforme as instruções locais. Arquivos de ferramenta e estado de execução ficam ignorados; PRD e decisões do produto ficam em `docs/`.

Padrão visual e publicação automática do PWA: [UI-PWA](docs/UI-PWA.md).
