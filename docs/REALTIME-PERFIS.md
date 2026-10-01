# DSB · Realtime, não lidos, notificações e perfis

## Ativação

1. Abra o mesmo projeto Supabase do DSB Manager/Client.
2. Vá em **SQL Editor**.
3. Execute todo o arquivo `supabase/realtime-perfis.sql` uma única vez.
4. Publique as versões atualizadas do Manager e do Client.
5. Faça `Ctrl + F5` nos dois para limpar o cache das versões anteriores.

## Realtime

As tabelas `dsb_tickets`, `dsb_ticket_messages` e `dsb_ticket_attachments` são adicionadas à publicação `supabase_realtime`.

## Não lidas

`dsb_ticket_reads` guarda, por usuário e chamado, o instante da última leitura. O contador considera somente mensagens recebidas do outro lado: cliente recebe mensagens da equipe; equipe recebe mensagens do cliente.

## Notificações

A permissão é solicitada somente quando o usuário clica em **Ativar notificações**. A preferência fica salva naquele navegador/dispositivo.

O som é opcional e só é disparado quando chega mensagem do outro lado e a conversa daquele chamado não está aberta.

## Fotos

O bucket `dsb-avatars` é privado. Cada usuário pode gravar/remover somente arquivos dentro da própria pasta (`<user_id>/...`). A interface gera uma imagem WEBP quadrada após o usuário ajustar enquadramento e zoom.
