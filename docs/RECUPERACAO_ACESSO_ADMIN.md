# Recuperação do acesso ao ALTIV ADMIN

## Contexto
O painel usa o Supabase Auth (login por e-mail/senha) e uma segunda verificação em `public.admin_profiles`.
Uma senha correta **não** concede papel administrativo: a conta deve existir em `admin_profiles` com `is_active = true`. O painel encerra a sessão se não encontrar o perfil.

## Para o administrador recuperar a senha
1. Abra o domínio oficial `https://altiv-admin.vercel.app`.
2. Clique em **Esqueci minha senha** e informe o e-mail que já tem cadastro.
3. Abra o e-mail de recuperação e siga o link.
4. Defina uma nova senha de 12 a 128 caracteres; confirme-a.
5. Entre com a nova senha no mesmo painel. O procedimento não altera clientes, planos, licenças ou dispositivos.

O fluxo usa `supabase.auth.resetPasswordForEmail(...)`, redirecionando ao endereço de origem com `?recovery=1`. A atualização usa `supabase.auth.updateUser({password})`, após o token temporário ter sido verificado. Para evitar enumeração de usuários, a tela não informa se um e-mail está cadastrado.

## Verificações necessárias no projeto Supabase correto
- Em **Authentication → URL Configuration**, defina `https://altiv-admin.vercel.app` como Site URL (quando for o domínio oficial) e permita `https://altiv-admin.vercel.app/?recovery=1` nos Redirect URLs.
- Em **Authentication → Users**, confirme o e-mail cadastrado e se foi confirmado. **Não** tente descobrir senhas: elas não são recuperáveis em texto simples.
- Para o usuário já cadastrado, verifique a correspondência de `auth.users.id` e `public.admin_profiles.user_id` e a flag `is_active = true` pelo SQL Editor autorizado. **Não** dê permissão administrativa a uma conta não verificada ou de terceiro.
- Se os e-mails não chegam, revise provedor de SMTP, logs de Auth, restrições de envio e caixa de spam.
- Confirme que as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` no Vercel apontam ao mesmo Supabase do ALTIV ADMIN.
- Teste a recuperação em uma conta administrativa de homologação, incluindo link expirado, confirmação divergente, senha curta e acesso sem `admin_profiles`.

## Separação importante
O `Gustavojv065/altiv-admin` usa o sistema de licenças ALTIV ADMIN; isso não é o mesmo login de `altiv-dev-web`. Não migre contas e não sobrescreva usuários existentes apenas para restaurar acesso.
