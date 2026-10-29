# Central de Comando — primeira entrega

## Objetivo

Permitir que o administrador acompanhe no computador e no celular a capacidade da VPS e o estado dos containers, sem depender de comandos SSH para a consulta diária.

## Escopo implementado

1. Visão geral com CPU, RAM, disco, uptime, containers ativos e margem de memória.
2. Lista pesquisável de containers e detalhes de saúde, limites, reinícios, processos e tráfego acumulado.
3. Histórico de recursos com períodos de 1 h, 6 h, 24 h e 7 dias, sem preencher lacunas com zero.
4. Aplicação instalável como PWA; ícones próprios, modo standalone, aviso de atualização e tela offline pública.
5. Cadastro administrativo em volume persistente, senha derivada com scrypt e sessão revogável em cookie protegido.
6. Coletor Linux de leitura, separado da aplicação web, publicando somente campos permitidos.

## Critérios de aceite

- Dados reais só aparecem após uma coleta válida; a demonstração informa explicitamente que os valores são ilustrativos.
- Leitura com mais de 60 segundos é marcada como antiga.
- API de métricas exige sessão no modo real; há proteção de origem e limite de tentativas de login.
- Não há senha padrão, credencial no frontend nem cache persistente de APIs ou sessões.
- A central não recebe socket Docker nem chave SSH.
- Credencial e histórico sobrevivem à recriação do container quando o volume é preservado.
- Interface adapta-se a telas estreitas e desktop; detalhes aparecem mediante seleção.

## Fora desta entrega

Controle de iniciar/parar serviços, terminal remoto, editor de arquivos, leitura de logs dos outros serviços, alertas externos e gerenciamento de usuários. Publicação na VPS e instalação em aparelho físico permanecem etapas posteriores, sujeitas a autorização e validação.

## Decisões

- Node.js 24 com APIs nativas e frontend sem framework para reduzir instalação e consumo.
- Python padrão e Docker CLI no host para coletar os indicadores sem ampliar os privilégios do painel.
- Histórico no servidor e um único volume de dados, sem introduzir um banco.
- A Central e a Mensageria são PWAs independentes; a Mensageria mantém seus fluxos de envio e pareamento.

## Estado

Implementação e validação local em 28/10/2026. A configuração de implantação está preparada, mas não foi executada. O resultado detalhado e os limites da evidência estão em `validation.md`.
