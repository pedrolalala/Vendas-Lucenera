// Mesmo padrão já usado no ecossistema (ex.
// gestao-financeira-clone-544cb/supabase/functions/_shared/cors.ts).
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, x-supabase-client-platform, apikey, content-type',
}
