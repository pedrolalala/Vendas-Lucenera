// SPEC-154 (2026-09-21): endpoint público (sem sessão Supabase) que recebe
// o webhook da Focus NFe a cada mudança de status de uma NF-e. IDEMPOTENTE
// (a Focus reenvia em 1min/30min/1h/3h/24h se não receber 2xx) -- identifica
// a nota pelo `ref` do corpo, faz UPDATE (nunca duplica a nota), e sempre
// responde 2xx mesmo em reentrega/reprocessamento do mesmo evento, para a
// Focus parar de reenviar.
//
// `verify_jwt` fica no padrão (true) só porque o gateway do Supabase não
// tem como validar um JWT que a Focus não tem -- por isso este projeto usa
// `config.toml` com `verify_jwt = false` (mesmo padrão já usado em
// `lucenera-crm-3bd29/supabase/functions/salvar-projeto/config.toml`, outro
// endpoint que precisa ser chamado sem contexto de usuário Supabase).
// Autenticação real deste endpoint é o header configurável abaixo
// (FOCUS_NFE_WEBHOOK_SECRET), nunca o JWT.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { aplicarStatusFocusNaNota } from '../_shared/aplicar-resultado-focus.ts'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Mesmo em erro de autenticação/parsing, o corpo é lido só depois de
  // validar o secret -- mas SEMPRE devolvemos 2xx pra reentregas que já
  // batem o secret certo, mesmo que o `ref` não seja reconhecido (regra de
  // idempotência: no-op silencioso, nunca erro 4xx/5xx pra Focus insistir
  // em reenviar pra sempre um evento que não conseguimos processar de novo).
  try {
    const secretConfigurado = Deno.env.get('FOCUS_NFE_WEBHOOK_SECRET') ?? ''
    if (!secretConfigurado) {
      console.error('[focus-nfe-webhook] FOCUS_NFE_WEBHOOK_SECRET não configurado -- recusando todas as chamadas.')
      return jsonResponse({ error: 'Webhook não configurado.' }, 500)
    }

    // A Focus permite configurar o NOME do header de autorização
    // (`authorization_header`) e o VALOR (`authorization`) na hora de
    // registrar o hook (`POST /hooks`, ver Passos manuais da SPEC-154).
    // Aceita tanto `Authorization: Bearer <secret>` quanto um header
    // customizado `X-Focus-Webhook-Secret`, pra não travar em qual nome o
    // usuário escolheu ao cadastrar o hook.
    const authHeader = req.headers.get('Authorization') || ''
    const secretHeader = req.headers.get('X-Focus-Webhook-Secret') || ''
    const tokenRecebido = authHeader.replace(/^Bearer\s+/i, '') || secretHeader

    if (tokenRecebido !== secretConfigurado) {
      console.warn('[focus-nfe-webhook] tentativa com secret inválido.')
      return jsonResponse({ error: 'Não autorizado.' }, 401)
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const ref = typeof body?.ref === 'string' ? body.ref : null

    if (!ref) {
      // Corpo sem `ref` reconhecível -- não há o que fazer, mas ainda assim
      // 200 (não é um problema pra Focus reenviar igual).
      console.warn('[focus-nfe-webhook] payload sem `ref` reconhecível:', JSON.stringify(body))
      return jsonResponse({ ok: true, aplicado: false, motivo: 'ref_ausente' })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const resultado = await aplicarStatusFocusNaNota(supabaseAdmin, { ref, body })

    return jsonResponse({ ok: true, aplicado: resultado.encontrado, status_emissao: resultado.statusEmissaoAplicado ?? null })
  } catch (error: any) {
    // Mesmo em erro inesperado nosso, devolver 2xx evitaria mascarar bug de
    // verdade -- aqui optamos por 200 mesmo assim, porque um 5xx faria a
    // Focus reagendar reentregas por até 24h pelo MESMO evento, e o job de
    // fallback (verificar-notas-pendentes) já cobre esse caso via polling.
    // O erro real fica logado pra investigação.
    console.error('[focus-nfe-webhook] erro inesperado:', error)
    return jsonResponse({ ok: false, error: error.message ?? String(error) }, 200)
  }
})
