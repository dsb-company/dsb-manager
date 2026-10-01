# Sons de notificação — DSB Manager

A tela de perfil oferece quatro opções: **Sem som**, **DSB Suave**, **DSB Pop** e **DSB Alerta**.

Os três arquivos ficam em `assets/notification/` e a preferência é salva por usuário no Supabase.

## Ativação no banco

Se `realtime-perfis.sql` já foi executado anteriormente, execute apenas:

`supabase/sound-preferences.sql`

Depois atualize a página com `Ctrl + F5`.

O botão **Testar som** toca a opção selecionada. Em mensagens reais, o som continua respeitando a regra do sistema: só toca quando a conversa do chamado não está sendo visualizada.
