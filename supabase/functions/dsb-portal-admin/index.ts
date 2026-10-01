import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
});

const normalizeEmail = (value: unknown) => String(value ?? '').trim().toLowerCase();
const normalizeName = (value: unknown) => String(value ?? '').trim();
const validUuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ''));
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const actionLinkFrom = (data: any) =>
  data?.properties?.action_link ||
  data?.properties?.actionLink ||
  data?.action_link ||
  data?.actionLink ||
  null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const adminKey = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !adminKey) return json({ error: 'A função não possui a chave administrativa do Supabase.' }, 500);

    const authorization = req.headers.get('Authorization') || '';
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Sessão ausente.' }, 401);

    const admin = createClient(supabaseUrl, adminKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: 'Sessão inválida ou expirada.' }, 401);

    const { data: member, error: memberError } = await admin
      .from('dsb_members')
      .select('user_id,role,name')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member || member.role !== 'admin') return json({ error: 'Apenas administradores podem gerenciar acessos ao portal.' }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');

    const getAuthUserByEmail = async (email: string) => {
      const perPage = 200;
      for (let page = 1; page <= 50; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
        if (error) throw error;
        const match = data.users.find((u) => normalizeEmail(u.email) === email);
        if (match) return match;
        if (data.users.length < perPage) return null;
      }
      throw new Error('Há usuários demais para localizar esta conta automaticamente.');
    };

    const assertClient = async (clientId: string) => {
      const { data, error } = await admin.from('dsb_records').select('id,data').eq('id', clientId).eq('type', 'client').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Cliente não encontrado.');
      return data;
    };

    if (action === 'invite') {
      const clientId = String(body?.clientId || '');
      const name = normalizeName(body?.name);
      const email = normalizeEmail(body?.email);
      if (!validUuid(clientId)) return json({ error: 'Cliente inválido.' }, 400);
      if (name.length < 2 || name.length > 120) return json({ error: 'Informe um nome entre 2 e 120 caracteres.' }, 400);
      if (!validEmail(email) || email.length > 254) return json({ error: 'Informe um e-mail válido.' }, 400);
      await assertClient(clientId);

      const { data: sameEmailLink, error: sameEmailError } = await admin
        .from('dsb_customer_users')
        .select('*')
        .ilike('email', email)
        .maybeSingle();
      if (sameEmailError) throw sameEmailError;
      if (sameEmailLink && sameEmailLink.client_id !== clientId) {
        return json({ error: 'Este e-mail já está vinculado a outra empresa.' }, 409);
      }

      let authUser = await getAuthUserByEmail(email);
      const existedBefore = Boolean(authUser);
      let sent = false;
      let manualLink: string | null = null;

      if (!authUser) {
        const redirectTo = String(Deno.env.get('DSB_CLIENT_URL') || '').trim() || undefined;
        const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { name, dsb_client_id: clientId },
          ...(redirectTo ? { redirectTo } : {}),
        });

        if (!inviteError && inviteData.user) {
          authUser = inviteData.user;
          sent = true;
        } else {
          // Em projetos sem SMTP próprio, o envio pode falhar. Tentamos gerar um link
          // para o administrador copiar e encaminhar por um canal seguro.
          authUser = await getAuthUserByEmail(email);
          if (!authUser) {
            const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
              type: 'invite',
              email,
              options: {
                data: { name, dsb_client_id: clientId },
                ...(redirectTo ? { redirectTo } : {}),
              },
            });
            if (linkError) throw inviteError || linkError;
            authUser = linkData.user;
            manualLink = actionLinkFrom(linkData);
          } else {
            const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
              type: 'invite',
              email,
              options: { ...(redirectTo ? { redirectTo } : {}) },
            });
            if (linkError) throw inviteError || linkError;
            manualLink = actionLinkFrom(linkData);
            if (!manualLink) throw new Error('Não foi possível gerar o link manual de convite.');
          }
        }
      }

      if (!authUser) throw new Error('Não foi possível criar ou localizar a conta de acesso.');

      const confirmed = Boolean(authUser.email_confirmed_at || authUser.last_sign_in_at);

      // Se a conta já existia no Authentication, mas ainda não foi ativada,
      // gere um link manual imediatamente. Isso evita o falso cenário de
      // "usuário existente" sem uma forma de concluir o primeiro acesso.
      if (existedBefore && !confirmed && !manualLink) {
        const redirectTo = String(Deno.env.get('DSB_CLIENT_URL') || '').trim() || undefined;
        const makeLink = async (type: 'invite' | 'magiclink') => {
          const { data, error } = await admin.auth.admin.generateLink({
            type,
            email,
            options: { ...(redirectTo ? { redirectTo } : {}) },
          });
          return { data, error };
        };

        let generated = await makeLink('invite');
        manualLink = generated.error ? null : actionLinkFrom(generated.data);
        if (!manualLink) {
          generated = await makeLink('magiclink');
          if (generated.error) throw generated.error;
          manualLink = actionLinkFrom(generated.data);
        }
      }

      const { data: existingByUser, error: existingError } = await admin
        .from('dsb_customer_users')
        .select('*')
        .eq('user_id', authUser.id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existingByUser && existingByUser.client_id !== clientId) {
        return json({ error: 'Esta conta já está vinculada a outra empresa.' }, 409);
      }

      const payload = {
        user_id: authUser.id,
        client_id: clientId,
        name,
        email,
        active: true,
        portal_status: confirmed ? 'active' : 'pending',
        invited_at: existingByUser?.invited_at || new Date().toISOString(),
        activated_at: confirmed ? (existingByUser?.activated_at || new Date().toISOString()) : existingByUser?.activated_at || null,
        invited_by: userData.user.id,
      };
      const { data: access, error: accessError } = await admin
        .from('dsb_customer_users')
        .upsert(payload, { onConflict: 'user_id' })
        .select('*')
        .single();
      if (accessError) throw accessError;

      const mode = existedBefore
        ? (confirmed ? 'linked_existing' : 'existing_pending')
        : (sent ? 'invite_sent' : 'invite_link');

      return json({
        ok: true,
        access,
        mode,
        manualLink,
        linkType: existedBefore && !confirmed && manualLink ? 'invite' : undefined,
      });
    }

    if (action === 'generate_recovery_link') {
      const userId = String(body?.userId || '');
      if (!validUuid(userId)) return json({ error: 'Usuário inválido.' }, 400);
      const { data: access, error: accessError } = await admin
        .from('dsb_customer_users')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (accessError) throw accessError;
      if (!access) return json({ error: 'Acesso não encontrado.' }, 404);
      if (!access.active) return json({ error: 'O acesso está desativado.' }, 400);

      const redirectTo = String(Deno.env.get('DSB_CLIENT_URL') || '').trim() || undefined;
      const params: Record<string, unknown> = { type: 'recovery', email: access.email };
      if (redirectTo) params.options = { redirectTo };
      const { data, error } = await admin.auth.admin.generateLink(params as any);
      if (error) throw error;
      const link = actionLinkFrom(data);
      if (!link) return json({ error: 'O Supabase gerou a recuperação, mas não devolveu o link de redefinição.' }, 502);
      return json({ ok: true, type: 'recovery', link });
    }

    if (action === 'generate_link') {
      const userId = String(body?.userId || '');
      if (!validUuid(userId)) return json({ error: 'Usuário inválido.' }, 400);
      const { data: access, error: accessError } = await admin
        .from('dsb_customer_users')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (accessError) throw accessError;
      if (!access) return json({ error: 'Acesso não encontrado.' }, 404);

      // Para contas pendentes, gere convite. Para contas já ativas, gere um magic link
      // de acesso direto; o cliente pode definir/alterar a senha dentro do DSB Client.
      let type = access.portal_status === 'pending' ? 'invite' : 'magiclink';
      const redirectTo = String(Deno.env.get('DSB_CLIENT_URL') || '').trim() || undefined;
      const makeLink = async (linkType: string) => {
        const params: Record<string, unknown> = { type: linkType, email: access.email };
        if (redirectTo) params.options = { redirectTo };
        return await admin.auth.admin.generateLink(params as any);
      };

      let { data, error } = await makeLink(type);
      if (error) throw error;
      let link = actionLinkFrom(data);

      // Alguns estados intermediários de contas convidadas podem não devolver
      // action_link para um novo invite. Nessa situação, um magic link para a
      // mesma conta existente é um fallback seguro para concluir o acesso.
      if (!link && type === 'invite') {
        type = 'magiclink';
        const fallback = await makeLink(type);
        if (fallback.error) throw fallback.error;
        data = fallback.data;
        link = actionLinkFrom(data);
      }

      if (!link) return json({ error: 'O Supabase gerou a operação, mas não devolveu um link de acesso.' }, 502);
      return json({ ok: true, type, link });
    }

    return json({ error: 'Ação inválida.' }, 400);
  } catch (error) {
    console.error('dsb-portal-admin:', error);
    return json({ error: error instanceof Error ? error.message : 'Erro interno.' }, 500);
  }
});
