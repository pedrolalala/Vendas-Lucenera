// SPEC-154 (2026-09-21): cliente HTTP para a API da Focus NFe (v2, NF-e
// modelo 4.00) + resolução de token/ambiente.
//
// Resolução de token -- pendência registrada na SPEC-154 ("Gap de múltiplas
// empresas emissoras"): cada empresa emissora real (Foco/Manoella/Islight)
// vai precisar de token próprio na Focus NFe. Como ainda não sabemos quantas
// contas o usuário vai efetivamente criar, esta primeira versão usa UM
// secret único (`FOCUS_NFE_TOKEN` + `FOCUS_NFE_AMBIENTE`), válido pra
// qualquer empresa. `resolverConfigFocus` já recebe o id/código da empresa
// emitente como parâmetro (mesmo sem usar ainda) para não precisar mudar a
// assinatura da função quando a estrutura multi-empresa for implementada --
// só trocar o corpo por uma busca em `Deno.env.get('FOCUS_NFE_TOKEN_' +
// slugEmpresa + '_' + ambiente)` ou equivalente.

export interface ConfigFocus {
  ambiente: 'homologacao' | 'producao'
  baseUrl: string
  token: string
}

const BASE_URL_HOMOLOGACAO = 'https://homologacao.focusnfe.com.br'
const BASE_URL_PRODUCAO = 'https://api.focusnfe.com.br'

export function resolverConfigFocus(_empresaId?: string | null): ConfigFocus {
  const token = Deno.env.get('FOCUS_NFE_TOKEN') ?? ''
  const ambienteEnv = (Deno.env.get('FOCUS_NFE_AMBIENTE') ?? 'homologacao').trim()
  const ambiente: 'homologacao' | 'producao' = ambienteEnv === 'producao' ? 'producao' : 'homologacao'

  if (!token) {
    throw new FocusConfigError('Secret FOCUS_NFE_TOKEN não configurado nas Edge Functions.')
  }

  return {
    ambiente,
    baseUrl: ambiente === 'producao' ? BASE_URL_PRODUCAO : BASE_URL_HOMOLOGACAO,
    token,
  }
}

/** Erro de configuração (token/secret ausente) -- distinto de erro de negócio/fiscal. */
export class FocusConfigError extends Error {}

export interface ResultadoChamadaFocus {
  status: number
  body: unknown
  /** true quando a resposta não era JSON válido -- body vira o texto cru. */
  bodyNaoJson: boolean
}

/**
 * Faz a chamada HTTP Basic (token como usuário, senha vazia) pra Focus NFe,
 * com retry limitado e backoff exponencial para 429 (rate limit, regra 7 do
 * briefing) e 5xx/timeout (regra 5.2/5) -- nos dois casos SEM reenviar um
 * payload diferente e SEM trocar a query string (mesma `url`), porque
 * nenhuma resposta definitiva chegou a ser recebida da Focus nesses casos.
 * 400/401/403/422 nunca são reretentados aqui -- são respostas definitivas
 * que o chamador (emitir-nota-fiscal) precisa tratar caso a caso.
 */
export async function chamarFocusComRetry(
  url: string,
  init: RequestInit,
  config: ConfigFocus,
  maxTentativas = 3,
): Promise<ResultadoChamadaFocus> {
  const authHeader = 'Basic ' + btoa(`${config.token}:`)
  let ultimoErro: unknown = null

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      const resp = await fetch(url, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      })

      const texto = await resp.text()
      let body: unknown
      let bodyNaoJson = false
      try {
        body = texto ? JSON.parse(texto) : null
      } catch {
        body = texto
        bodyNaoJson = true
      }

      const precisaRetry = resp.status === 429 || resp.status >= 500
      if (!precisaRetry || tentativa === maxTentativas) {
        return { status: resp.status, body, bodyNaoJson }
      }

      const esperaMs = Math.min(2 ** (tentativa - 1) * 1000, 8000)
      console.warn(
        `[focus-client] status ${resp.status} na tentativa ${tentativa}/${maxTentativas}, aguardando ${esperaMs}ms antes de repetir (ref=${url}).`,
      )
      await new Promise((resolve) => setTimeout(resolve, esperaMs))
    } catch (err) {
      ultimoErro = err
      if (tentativa === maxTentativas) break
      const esperaMs = Math.min(2 ** (tentativa - 1) * 1000, 8000)
      console.warn(
        `[focus-client] falha de rede/timeout na tentativa ${tentativa}/${maxTentativas}: ${String(err)}. Aguardando ${esperaMs}ms.`,
      )
      await new Promise((resolve) => setTimeout(resolve, esperaMs))
    }
  }

  // Todas as tentativas falharam por erro de rede/timeout (nunca chegou a
  // ter um status HTTP de resposta) -- devolve um "status" sintético 0 pra
  // o chamador tratar igual a um 5xx, preservando o erro real no body.
  return {
    status: 0,
    body: { erro_interno: 'timeout_ou_falha_de_rede', detalhe: String(ultimoErro) },
    bodyNaoJson: false,
  }
}
