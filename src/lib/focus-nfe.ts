// SPEC-154 (2026-09-21): chamada da Edge Function `emitir-nota-fiscal` a
// partir do frontend de Vendas. Mesmo padrão já usado em
// `gestao-financeira-clone-544cb/src/lib/envio-inicial-cliente.ts::downloadBudgetPdf`
// (fetch direto com `Authorization: Bearer <access_token>` da sessão do
// usuário, token da Focus NFe nunca exposto aqui -- só existe dentro da
// Edge Function, lido de `Deno.env.get(...)`).
//
// O formato completo de cada resposta possível está documentado no corpo de
// `04-Sistemas/vendas-lucenera/supabase/functions/emitir-nota-fiscal/index.ts`
// (não duplicar a lógica de decisão aqui -- este arquivo só faz o fetch cru e
// devolve `{ ok, status, body }`; quem decide o que mostrar é
// `Vendas.tsx::handleConfirmarEmissao`).

export interface EmitirNotaFiscalErroPreValidacao {
  campo: string | null
  codigo: string | null
  mensagem: string
}

export interface EmitirNotaFiscalBody {
  error?: string
  status_emissao?: string | null
  tipo?: 'pre_validacao_interna' | 'pre_validacao_focus' | 'configuracao' | 'retry_esgotado'
  bloqueantes?: string[]
  erros?: EmitirNotaFiscalErroPreValidacao[]
  mensagem?: string
  ref?: string
  http_status_focus?: number
}

export interface EmitirNotaFiscalResultado {
  ok: boolean
  status: number
  body: EmitirNotaFiscalBody | null
}

/**
 * Chama a Edge Function `emitir-nota-fiscal` para a nota (rascunho, já criada
 * por `registrar_nota_fiscal_parcial`, SPEC-153) informada. Sempre tenta
 * parsear o corpo como JSON, mesmo em respostas de erro HTTP (400/401/403/
 * 404/409/500) -- a Edge Function sempre devolve JSON, mesmo nos casos de
 * erro (ver `jsonResponse` em `emitir-nota-fiscal/index.ts`).
 */
export async function emitirNotaFiscal(
  notaFiscalId: string,
  accessToken: string,
): Promise<EmitirNotaFiscalResultado> {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/emitir-nota-fiscal`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ nota_fiscal_id: notaFiscalId }),
    },
  )

  let body: EmitirNotaFiscalBody | null = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  return { ok: response.ok, status: response.status, body }
}
