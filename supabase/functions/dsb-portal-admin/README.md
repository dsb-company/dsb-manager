# Edge Function `dsb-portal-admin`

Esta função é o backend administrativo do módulo **Acessos** do DSB Manager.

Ela é usada somente quando o Manager precisa:

- convidar um e-mail que ainda não existe em `Authentication > Users`;
- gerar um novo link de convite;
- gerar um link de recuperação de senha.

O vínculo de uma conta que **já existe** no Authentication e a ativação/desativação do acesso são feitos por RPCs do `portal-access.sql`, portanto não expõem chave administrativa no navegador.

## Publicação

Pelo Supabase CLI, na raiz do projeto que contém a pasta `supabase`:

```bash
supabase functions deploy dsb-portal-admin
```

No projeto hospedado, a função recebe automaticamente `SUPABASE_URL` e normalmente a chave administrativa disponível ao ambiente. O código aceita `SUPABASE_SECRET_KEY` ou `SUPABASE_SERVICE_ROLE_KEY`.

Opcionalmente, defina `DSB_CLIENT_URL` com a URL pública do DSB Client para os links de convite/recuperação voltarem ao portal, por exemplo:

```bash
supabase secrets set DSB_CLIENT_URL=https://cliente.seudominio.com
```

Não coloque `SUPABASE_SECRET_KEY`, `service_role` ou qualquer outra chave secreta no `config.js` do site.
