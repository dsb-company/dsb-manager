# DSB Manager

Dashboard administrativo em HTML, CSS e JavaScript com autenticação e persistência via Supabase.

## Estrutura

- `index.html` — tela de login e shell do dashboard
- `css/styles.css` — estilos, responsividade e temas claro/escuro
- `js/app.js` — aplicação e integração com o Supabase
- `js/core.js` — validações e indicadores
- `js/theme.js` — alternância de tema e preferência salva no navegador
- `supabase/config.js` — URL + chave pública do projeto
- `supabase/schema.sql` — tabelas, funções e RLS
- `supabase/supabase.js` — SDK local
- `assets/images/` — imagens da DSB
- `docs/GUIA.html` — guia de configuração

## Antes de publicar

1. Execute `supabase/schema.sql` no SQL Editor do seu projeto Supabase.
2. Crie o primeiro usuário em Authentication e autorize-o conforme o fim do SQL.
3. Preencha `supabase/config.js` com **somente** a Project URL e a chave publishable/anon.
4. Nunca coloque `service_role`, `sb_secret_`, senha do banco ou senha pessoal no frontend.
5. Abra o projeto por um servidor HTTP, como Live Server.

A tela pública possui somente login, recuperação de senha e alternância de tema. Não há cadastro público nem configuração do banco pela interface.
## Módulo de chamados

A versão inclui uma central de chamados isolada do restante do Manager. Antes de usar a aba **Chamados**, execute `supabase/chamados.sql` no SQL Editor do mesmo projeto Supabase. O arquivo adiciona as tabelas, RLS e bucket privado de anexos sem alterar os registros existentes.

A aba permite filtrar chamados, abrir um chamado interno para testes, definir status/prioridade/responsável, conversar com o cliente e anexar arquivos. A estrutura do banco já foi preparada para o futuro Portal do Cliente.



## Acessos ao DSB Client

A versão inclui o módulo de administração dos usuários do Portal do Cliente. Para ativá-lo, execute `supabase/portal-access.sql`. Para convidar e-mails que ainda não existem no Authentication, publique também `supabase/functions/dsb-portal-admin`. O passo a passo completo está em `docs/ACESSO-PORTAL.md`.

## Realtime, mensagens não lidas, notificações e fotos de perfil

Execute **uma vez** no mesmo projeto Supabase:

`supabase/realtime-perfis.sql`

Esse arquivo:
- ativa Realtime para chamados, mensagens e anexos;
- cria o controle de mensagens não lidas;
- adiciona o bucket privado `dsb-avatars`;
- permite que membros da equipe e clientes definam a própria foto de perfil;
- disponibiliza os perfis necessários para mostrar avatares nas conversas.

Depois de publicar esta versão, faça um `Ctrl + F5` para substituir o cache antigo da PWA.

### O que muda nos Chamados

- novas mensagens aparecem sem recarregar a página;
- a conversa rola automaticamente para a mensagem mais recente;
- chamados com resposta ainda não lida exibem **Nova mensagem**;
- o menu **Chamados** mostra a quantidade de mensagens não lidas;
- mudanças de status/prioridade/responsável aparecem em tempo real;
- data e horário das mensagens aparecem imediatamente;
- um som discreto pode tocar somente quando a conversa correspondente não está aberta;
- ao abrir a conversa, as mensagens recebidas são marcadas como lidas.

### Notificações do Windows

Em **Configurações → Perfil e notificações**, cada membro pode ativar as notificações do navegador/PWA para novos chamados/mensagens. A permissão é individual por navegador/dispositivo.

Nesta versão, a página/PWA precisa estar aberta ou em execução em segundo plano para receber o evento Realtime. Notificação push com o aplicativo totalmente fechado exigiria uma etapa posterior com Web Push.

### Foto de perfil

Em **Configurações → Perfil e notificações**, cada membro da equipe pode adicionar, reposicionar, aplicar zoom, trocar ou remover a própria foto. O arquivo final é recortado em formato quadrado e armazenado em bucket privado.
