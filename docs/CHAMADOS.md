# Módulo de Chamados — DSB Manager

O módulo foi adicionado de forma isolada para não alterar os cadastros e fluxos já existentes do DSB Manager.

## Ativação

1. Faça backup do projeto e do banco antes de qualquer alteração de produção.
2. Abra o projeto Supabase que já é usado pelo DSB Manager.
3. Entre em **SQL Editor**.
4. Abra `supabase/chamados.sql`, copie todo o conteúdo e execute uma vez.
5. Publique os arquivos atualizados do DSB Manager.
6. Entre no Manager e abra **Chamados** no menu lateral.

Se o SQL ainda não tiver sido executado, o restante do Manager continua funcionando e a aba Chamados apenas exibe o aviso de configuração.

## O que foi adicionado

- Fila de chamados com contador de novos.
- Número sequencial no formato `DSB-00001`.
- Empresa/cliente, solicitante, categoria, prioridade e página relacionada.
- Status: Novo, Aberto, Em atendimento, Aguardando cliente, Resolvido e Fechado.
- Responsável da equipe DSB.
- Histórico de mensagens.
- Respostas da equipe.
- Anexos privados de até 10 MB (PNG, JPG, WEBP, PDF e TXT).
- Busca e filtros.
- Estrutura de RLS preparada para o futuro Portal do Cliente.

## Arquivos do módulo

- `js/tickets.js` — lógica da central de chamados.
- `css/tickets.css` — visual da central de chamados.
- `supabase/chamados.sql` — tabelas, funções, RLS e bucket privado.

## Próxima etapa

O Portal do Cliente poderá usar as mesmas tabelas. Cada usuário externo será vinculado a um cliente por `dsb_customer_users`, e as políticas RLS já foram desenhadas para impedir que uma empresa visualize chamados de outra.
