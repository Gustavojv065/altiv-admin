# ALTIV ADMIN

Painel administrativo comercial do ALTIV CODE MOBILE.

## Fase 1

Esta fase mantém o APK separado e prepara:

- login administrativo com Supabase Auth
- dashboard responsivo
- clientes
- planos
- licenças
- dispositivos
- histórico de eventos
- Row Level Security (RLS)
- base para publicação na Vercel

## Arquitetura

ALTIV ADMIN (Web/Vercel) → Supabase ← ALTIV CODE MOBILE (fase futura)

## Segurança

- O frontend usa somente a chave publishable do Supabase.
- Nunca coloque secret key ou service_role no navegador, GitHub ou APK.
- As tabelas administrativas usam RLS.
- A futura validação de licenças do APK será feita por Edge Function, sem acesso direto às tabelas internas.

## Desenvolvimento

1. Copie `.env.example` para `.env`.
2. Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Execute `npm install`.
4. Execute `npm run dev`.

O código deste repositório é separado do APK `altiv-code-mobile`.
