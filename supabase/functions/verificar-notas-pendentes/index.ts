// SPEC-154 (2026-09-21): job de fallback (polling), chamado por `pg_cron`
// via `pg_net` a cada 15 minutos (ver migration
// 20260921_154_focus_nfe_integracao/004_agendar_verificar_notas_pendentes.sql).
// Rede de segurança pro caso do webhook (`focus-nfe-webhook`) falhar ou
// atrasar além do último retry da própria Focus (24h) -- NÃO substitui o
// webhook, só cobre a lacuna.
//
// Busca `notas_fiscais` com `status_emissao = 'processando_autorizacao'` e
// `ultima_consulta_em` nula ou mais velha que 10 minutos, consulta
// `GET /nfe/{ref}` pra cada uma, e atualiza como o webhook faria --
// literalmente a mesma função `aplicarStatusFocusNaNota`.
//
// `verify_jwt = false` (config.toml) -- quem chama é o Postgres via
// `pg_net`, não um usuário logado. Autenticação própria por secret
// (`FOCUS_NFE_CRON_SECRET`), mesmo padrão do `focus-nfe-webhook`.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { chamarFocusComRetry, resolverConfigFocus, FocusConfigError } from '../_shared/focus-client.ts'
import { aplicarStatusFocusNaNota } from '../_shared/aplicar-resultado-focus.ts'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const DEZ_MINUTOS_MS = 10 * 60 * 1000

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const secretConfigurado = Deno.env.get('FOCUS_NFE_CRON_SECRET') ?? ''
    if (!secretConfigurado) {
      console.error('[verificar-notas-pendentes] FOCUS_NFE_CRON_SECRET não configurado -- recusando.')
      return jsonResponse({ error: 'Job não configurado.' }, 500)
    }
    const authHeader = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (authHeader !== secretConfigurado) {
      return jsonResponse({ error: 'Não autorizado.' }, 401)
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const limite = new Date(Date.now() - DEZ_MINUTOS_MS).toISOString()

    const { data: pendentes, error: erroBusca } = await supabaseAdmin
      .from('notas_fiscais')
      .select('id, ref, orcamento:orcamentos(empresa_id)')
      .eq('status_emissao', 'processando_autorizacao')
      .not('ref', 'is', null)
      .or(`ultima_consulta_em.is.null,ultima_consulta_em.lt.${limite}`)

    if (erroBusca) throw erroBusca

    const resultados: Array<{ ref: string; ok: boolean; status_emissao?: string | null; erro?: string }> = []

    for (const nota of pendentes || []) {
      const ref = nota.ref as string
      try {
        const orcamento = Array.isArray((nota as any).orcamento) ? (nota as any).orcamento[0] : (nota as any).orcamento
        let config
        try {
          config = resolverConfigFocus(orcamento?.empresa_id ?? null)
        } catch (err) {
          if (err instanceof FocusConfigError) {
            resultados.push({ ref, ok: false, erro: err.message })
            continue
          }
          throw err
        }

        const resultado = await chamarFocusComRetry(
          `${config.baseUrl}/v2/nfe/${encodeURIComponent(ref)}`,
          { method: 'GET' },
          config,
        )

        if (resultado.status === 200) {
          const aplicado = await aplicarStatusFocusNaNota(supabaseAdmin, {
            ref,
            body: resultado.body as Record<string, unknown> | null,
          })
          resultados.push({ ref, ok: true, status_emissao: aplicado.statusEmissaoAplicado ?? null })
        } else {
          // Não achou / erro ao consultar -- só atualiza `ultima_consulta_em`
          // pra não martelar a mesma nota a cada execução do cron, sem
          // mudar status_emissao (não temos uma resposta confiável ainda).
          await supabaseAdmin
            .from('notas_fiscais')
            .update({ ultima_consulta_em: new Date().toISOString() })
            .eq('id', nota.id)
          resultados.push({ ref, ok: false, erro: `GET /nfe/${ref} devolveu status ${resultado.status}` })
        }
      } catch (err: any) {
        console.error(`[verificar-notas-pendentes] erro ao consultar ref=${ref}:`, err)
        resultados.push({ ref, ok: false, erro: err.message ?? String(err) })
      }
    }

    return jsonResponse({ verificadas: resultados.length, resultados })
  } catch (error: any) {
    console.error('[verificar-notas-pendentes] erro inesperado:', error)
    return jsonResponse({ error: error.message ?? String(error) }, 500)
  }
})
