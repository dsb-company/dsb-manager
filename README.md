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

