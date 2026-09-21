// SPEC-154 (2026-09-21): aplica um resultado de status da Focus NFe (seja
// vindo do 201 síncrono do POST /nfe, do webhook `focus-nfe-webhook` ou do
// polling de fallback `verificar-notas-pendentes`) em `notas_fiscais` +
// `notas_fiscais_erros`. Um único lugar faz essa gravação pelos 3 chamadores
// -- evita divergência entre "o que o webhook faz" e "o que o polling faz"
// (a SPEC-154 pede explicitamente que o polling "atualize como o webhook
// faria").
//
// Identifica a nota SEMPRE por `ref` (nunca por nota_fiscal_id direto),
// porque é exatamente assim que o webhook chega (só tem o `ref` no corpo) --
// regra de idempotência da SPEC-154: "UPDATE ... WHERE ref = $1 (upsert por
// ref, nunca duplica)". Se o `ref` recebido já foi substituído por uma
// tentativa mais nova (nota reemitida depois que este evento foi gerado),
// não encontra nada -- é um no-op seguro, não um erro.
//
// IMPORTANTE (regra 5.1 do briefing): nenhum status_sefaz/mensagem_sefaz é
// inventado -- os dois são gravados literalmente como vieram no corpo da
// resposta, mesmo quando o valor de `status` da Focus não é um dos que a
// gente reconhece.

// deno-lint-ignore no-explicit-any
type SupabaseAdminClient = any

export interface AplicarStatusFocusParams {
  ref: string
  body: Record<string, unknown> | null
}

export interface AplicarStatusFocusResultado {
  encontrado: boolean
  statusEmissaoAplicado?: string
  notaFiscalId?: string
}

const STATUS_EMISSAO_CONHECIDOS = new Set([
  'nao_emitida',
  'processando_autorizacao',
  'autorizado',
  'erro_autorizacao',
  'cancelado',
])

/**
 * Mapeia o `status` cru devolvido pela Focus para o nosso
 * `notas_fiscais.status_emissao` (CHECK constraint fixo, ver migration
 * 20260921_154_focus_nfe_integracao/001). A Focus tem um status a mais que a
 * gente não modela separado ("denegado" -- CNPJ irregular etc.): mapeamos
 * pra `erro_autorizacao` (é uma rejeição definitiva do ponto de vista do
 * usuário) mas preservamos o valor real em `status_sefaz`/`erro_codigo`,
 * então nada da informação original se perde.
 */
function mapearStatusFocus(statusFocus: unknown): { statusEmissao: string; erroCodigoExtra: string | null } {
  const valor = typeof statusFocus === 'string' ? statusFocus : null

  if (valor && STATUS_EMISSAO_CONHECIDOS.has(valor)) {
    return { statusEmissao: valor, erroCodigoExtra: null }
  }
  if (valor === 'denegado') {
    return { statusEmissao: 'erro_autorizacao', erroCodigoExtra: 'denegado' }
  }
  // Status ausente ou desconhecido: trata como pendência de erro pra nunca
  // ficar "silenciosamente perdido" -- nunca inventa o que seria o status
  // certo, só registra explicitamente que não reconhecemos o valor.
  return {
    statusEmissao: 'erro_autorizacao',
    erroCodigoExtra: valor ? `status_desconhecido_${valor}` : 'status_ausente',
  }
}

export async function aplicarStatusFocusNaNota(
  supabaseAdmin: SupabaseAdminClient,
  { ref, body }: AplicarStatusFocusParams,
): Promise<AplicarStatusFocusResultado> {
  const { data: nota, error: erroBusca } = await supabaseAdmin
    .from('notas_fiscais')
    .select('id, tentativa_atual, status_emissao')
    .eq('ref', ref)
    .maybeSingle()

  if (erroBusca) throw erroBusca
  if (!nota) {
    // Reentrega de um `ref` já substituído por uma tentativa mais nova, ou
    // ref desconhecido -- no-op idempotente, não é erro.
    return { encontrado: false }
  }

  const statusFocusCru = body?.status
  const statusSefaz = typeof body?.status_sefaz === 'string' ? body.status_sefaz : (body?.status_sefaz ?? null)
  const mensagemSefaz = typeof body?.mensagem_sefaz === 'string' ? body.mensagem_sefaz : null
  const chaveNfe = typeof body?.chave_nfe === 'string' ? body.chave_nfe : null
  const numero = body?.numero != null ? String(body.numero) : null
  const serie = body?.serie != null ? String(body.serie) : null
  const arquivoUrl =
    (typeof body?.caminho_danfe === 'string' && body.caminho_danfe) ||
    (typeof body?.caminho_xml_nota_fiscal === 'string' && body.caminho_xml_nota_fiscal) ||
    (typeof body?.caminho_xml === 'string' && body.caminho_xml) ||
    null

  const { statusEmissao, erroCodigoExtra } = mapearStatusFocus(statusFocusCru)

  const updatePayload: Record<string, unknown> = {
    status_emissao: statusEmissao,
    status_sefaz: statusSefaz,
    mensagem_sefaz: mensagemSefaz,
    ultima_consulta_em: new Date().toISOString(),
  }

  if (statusEmissao === 'autorizado') {
    if (chaveNfe) updatePayload.chave_nfe = chaveNfe
    if (numero) updatePayload.numero_nf = numero
    if (serie) updatePayload.serie = serie
    if (arquivoUrl) updatePayload.arquivo_url = arquivoUrl
  }

  const { error: erroUpdate } = await supabaseAdmin
    .from('notas_fiscais')
    .update(updatePayload)
    .eq('id', nota.id)

  if (erroUpdate) throw erroUpdate

  if (statusEmissao === 'autorizado') {
    // Autorização de uma tentativa posterior resolve implicitamente as
    // pendências anteriores desta mesma nota (regra descrita na SPEC-154,
    // seção Frontend -- "Pendências de Nota Fiscal": fica implícito quando
    // uma nova tentativa da mesma nota é autorizada).
    const { error: erroResolver } = await supabaseAdmin
      .from('notas_fiscais_erros')
      .update({ resolvido: true, data_resolucao: new Date().toISOString() })
      .eq('nota_fiscal_id', nota.id)
      .eq('resolvido', false)
    if (erroResolver) throw erroResolver
  } else if (statusEmissao === 'erro_autorizacao') {
    // Evita duplicar a MESMA pendência quando a Focus reenvia o mesmo
    // evento (webhook idempotente) -- checa se já existe uma linha idêntica
    // não resolvida antes de inserir de novo. Isso não é "sobrescrever"
    // (regra 8 do briefing continua valendo: tentativas diferentes sempre
    // geram linhas diferentes), é só evitar ruído do MESMO evento reentregue.
    // `.eq()` nunca casa com NULL no Postgres/PostgREST -- para os campos
    // que podem vir nulos usamos `.is()` (IS NULL) quando é o caso, senão
    // `.eq()` normal, montando a query condicionalmente.
    let queryExistente = supabaseAdmin
      .from('notas_fiscais_erros')
      .select('id')
      .eq('nota_fiscal_id', nota.id)
      .eq('ref', ref)
      .eq('numero_tentativa', nota.tentativa_atual)
      .eq('resolvido', false)
    queryExistente =
      statusSefaz === null
        ? queryExistente.is('status_sefaz', null)
        : queryExistente.eq('status_sefaz', statusSefaz)
    queryExistente =
      mensagemSefaz === null
        ? queryExistente.is('mensagem_sefaz', null)
        : queryExistente.eq('mensagem_sefaz', mensagemSefaz)

    const { data: existente, error: erroExistente } = await queryExistente.limit(1).maybeSingle()
    if (erroExistente) {
      // Não aborta (a nota já foi atualizada com sucesso acima, o que
      // importa mais) -- só loga, e no pior caso insere uma linha de erro
      // duplicada em vez de deduplicar (consequência branda, achado do
      // revisor 2026-09-21).
      console.error('[aplicar-resultado-focus] falha ao checar duplicata de erro:', erroExistente)
    }

    if (!existente) {
      const { error: erroInsert } = await supabaseAdmin.from('notas_fiscais_erros').insert({
        nota_fiscal_id: nota.id,
        ref,
        numero_tentativa: nota.tentativa_atual,
        status_sefaz: statusSefaz,
        mensagem_sefaz: mensagemSefaz,
        erro_codigo: erroCodigoExtra,
        erro_campo: null,
        resposta_bruta: body ?? {},
      })
      if (erroInsert) throw erroInsert
    }
  }

  return { encontrado: true, statusEmissaoAplicado: statusEmissao, notaFiscalId: nota.id }
}
