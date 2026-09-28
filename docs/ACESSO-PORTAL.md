# DSB Manager · Acessos ao DSB Client

Este complemento elimina o processo manual de copiar UUIDs para vincular um cliente ao Portal.

## O que foi adicionado

- nova aba **Acessos** no DSB Manager;
- indicador **Acesso ao Portal** dentro de cada card de cliente;
- vínculo de um usuário existente no `Authentication` apenas informando nome + e-mail;
- convite automático para e-mails novos por Edge Function;
- mais de um usuário por empresa;
- status **Ativo**, **Convite pendente** e **Desativado**;
- desativação/reativação sem apagar a conta do Supabase;
- geração de novo link de convite ou recuperação;
- nenhuma chave administrativa fica no HTML/JavaScript do site.

## 1. Ativar o complemento no banco

No Supabase do DSB Manager, abra **SQL Editor → New query**.

Copie todo o conteúdo de:

`supabase/portal-access.sql`

Execute uma vez.

> Pré-requisito: `supabase/chamados.sql` já deve ter sido executado.

Depois atualize o DSB Manager. A aba **Acessos** deverá aparecer em **Organização**.

## 2. Testar com uma conta que já existe

Se você já criou `teste@gmail.com` em **Authentication → Users**:

1. Entre no DSB Manager.
2. Abra **Acessos**.
3. Clique em **Adicionar acesso**.
4. Selecione a empresa de teste.
5. Informe o nome do responsável.
6. Informe `teste@gmail.com`.
7. Clique em **Criar acesso**.

O Manager procura o e-mail em `auth.users` e cria o vínculo automaticamente. Não é necessário copiar UUID nem executar INSERT manual.

Também é possível ir em **Clientes → empresa desejada → Acesso ao Portal → Gerenciar**.

## 3. Convidar um e-mail que ainda não existe

Para isso é necessário publicar a Edge Function:

`supabase/functions/dsb-portal-admin/index.ts`

Com Supabase CLI:

```bash
supabase functions deploy dsb-portal-admin
```

Se o DSB Client já estiver publicado, configure a URL dele como secret da função:

```bash
supabase secrets set DSB_CLIENT_URL=https://URL-DO-DSB-CLIENT
```

Sem `DSB_CLIENT_URL`, o Supabase usa a configuração de URL do Auth para decidir o destino do link.

## 4. E-mails do Supabase

O convite usa o sistema de Auth do Supabase. Para uso real com clientes, configure o envio de e-mail/SMTP do projeto em **Authentication**. Em ambiente de teste, caso o envio do convite não fique disponível, a função tenta gerar um link de convite para você copiar e encaminhar ao responsável correto.

## Segurança

- `supabase/config.js` continua contendo apenas Project URL + publishable/anon key.
- nunca coloque `service_role`, `sb_secret_...`, senha do banco ou senha pessoal no frontend;
- criação de convites e geração de links acontecem na Edge Function;
- os RPCs de vínculo/ativação conferem no banco se o usuário da equipe é administrador;
- desativar um acesso mantém a conta no Authentication, porém o DSB Client deixa de retornar o perfil e o RLS deixa de liberar os chamados da empresa.
