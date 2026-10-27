// SPEC-154 (2026-09-21): emissão real de Nota Fiscal via Focus NFe.
// Chamada autenticada pelo frontend de Vendas depois que a nota já existe
// como rascunho (RPC `registrar_nota_fiscal_parcial`, SPEC-153, com itens e
// pagador já definidos). Token da Focus NUNCA é exposto no frontend --
// só existe aqui, lido de `Deno.env.get(...)`.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { chamarFocusComRetry, resolverConfigFocus, FocusConfigError } from '../_shared/focus-client.ts'
import { aplicarStatusFocusNaNota } from '../_shared/aplicar-resultado-focus.ts'
import { montarPayloadNFe, type ItemNotaDados } from '../_shared/montar-payload-nfe.ts'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Extrai {campo, codigo, mensagem}[] do corpo de erro 400/422 da Focus.
 * A Focus não tem um único formato fixo documentado publicamente para toda
 * classe de erro de pré-validação -- esta função é DEFENSIVA (cobre os
 * formatos mais comuns) mas NUNCA inventa uma mensagem: se não conseguir
 * reconhecer a estrutura, guarda o corpo cru como a própria mensagem, sem
 * reescrever nada.
 */
function normalizarErrosPreValidacao(body: unknown): Array<{ campo: string | null; codigo: string | null; mensagem: string }> {
  if (Array.isArray(body)) {
    return body.map((item) => {
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>
        return {
          campo: typeof obj.campo === 'string' ? obj.campo : null,
          codigo: typeof obj.codigo === 'string' ? obj.codigo : null,
          mensagem: typeof obj.mensagem === 'string' ? obj.mensagem : JSON.stringify(obj),
        }
      }
      return { campo: null, codigo: null, mensagem: String(item) }
    })
  }

  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    if (typeof obj.mensagem === 'string') {
      return [{ campo: null, codigo: typeof obj.codigo === 'string' ? obj.codigo : null, mensagem: obj.mensagem }]
    }
    // Formato tipo "erros por campo": { "campo1": ["msg1", "msg2"], ... }
    const entradas = Object.entries(obj)
    if (entradas.length > 0 && entradas.every(([, v]) => Array.isArray(v))) {
      return entradas.flatMap(([campo, mensagens]) =>
        (mensagens as unknown[]).map((m) => ({ campo, codigo: null, mensagem: String(m) })),
      )
    }
    return [{ campo: null, codigo: null, mensagem: JSON.stringify(obj) }]
  }

  return [{ campo: null, codigo: null, mensagem: String(body) }]
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ error: 'Acesso não autorizado.' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    const {
      data: { user },
    } = await supabaseUser.auth.getUser()
    if (!user) {
      return jsonResponse({ error: 'Usuário não autenticado.' }, 401)
    }

    const { nota_fiscal_id: notaFiscalId } = await req.json()
    if (!notaFiscalId) {
      return jsonResponse({ error: 'nota_fiscal_id é obrigatório.' }, 400)
    }

    // Mesmo guard de permissão usado em registrar_nota_fiscal_parcial
    // (SPEC-153) -- ainda sem RBAC fino, só quem tem 'emitir_nota_fiscal'
    // no sistema 'vendas'.
    const { data: podeExecutar, error: erroPermissao } = await supabaseAdmin.rpc('hub_pode_executar', {
      p_usuario_id: user.id,
      p_system_slug: 'vendas',
      p_modulo_chave: null,
      p_acao: 'emitir_nota_fiscal',
    })
    if (erroPermissao) throw erroPermissao
    if (!podeExecutar) {
      return jsonResponse({ error: 'Permissão negada para emitir nota fiscal.' }, 403)
    }

    const { data: nota, error: erroNota } = await supabaseAdmin
      .from('notas_fiscais')
      .select(
        `
        id, ref, tentativa_atual, status_emissao, cliente_id, nome_destinatario, orcamento_id,
        dados_adicionais, modalidade_frete, transportadora_nome, transportadora_cnpj, valor_desconto,
        destinatario_cpf_cnpj, destinatario_ie,
        cliente:contatos(id, nome, razao_social, cpf_cnpj, cnpj, cpf, inscricao_estadual, endereco, numero, bairro, cidade, estado, cep, telefone, email),
        orcamento:orcamentos(
          id, numero_venda, frete_valor, frete_tipo, forma_pagamento, cliente_id, empresa_id,
          empresa:empresas(nome, razao_social, cnpj, inscricao_estadual, logradouro, numero, complemento, bairro, cidade, estado, cep, regime_tributario, codigo_municipio_ibge),
          cliente:contatos!orcamentos_cliente_id_fkey(id, nome, razao_social, cpf_cnpj, cnpj, cpf, inscricao_estadual, endereco, numero, bairro, cidade, estado, cep, telefone, email)
        ),
        notas_fiscais_itens(
          id, orcamento_item_id, quantidade_faturada, valor_faturado,
          orcamento_item:orcamento_itens(id, preco_unitario, desconto, descricao,
            produto:produtos(nome, sku, codigo_produto, referencia, ncm, cst, unidade, porc_st, cest))
        )
      `,
      )
      .eq('id', notaFiscalId)
      .maybeSingle()

    if (erroNota) throw erroNota
    if (!nota) return jsonResponse({ error: 'Nota fiscal não encontrada.' }, 404)

    if (nota.status_emissao === 'processando_autorizacao') {
      return jsonResponse(
        {
          error: 'Esta nota já está em processamento na Focus NFe. Aguarde o webhook ou o job de verificação automática.',
          status_emissao: nota.status_emissao,
        },
        409,
      )
    }
    if (nota.status_emissao === 'autorizado') {
      return jsonResponse(
        { error: 'Esta nota já foi autorizada. Não é possível reemitir.', status_emissao: nota.status_emissao },
        409,
      )
    }
    if (nota.status_emissao === 'cancelado') {
      return jsonResponse(
        { error: 'Esta nota está cancelada. Reemissão de nota cancelada não é suportada nesta versão.', status_emissao: nota.status_emissao },
        409,
      )
    }

    const orcamento = Array.isArray(nota.orcamento) ? nota.orcamento[0] : nota.orcamento
    if (!orcamento) return jsonResponse({ error: 'Orçamento/venda vinculado não encontrado.' }, 400)
    const empresaRaw = Array.isArray(orcamento.empresa) ? orcamento.empresa[0] : orcamento.empresa
    if (!empresaRaw) return jsonResponse({ error: 'Empresa emitente não encontrada para este orçamento.' }, 400)

    const clienteNota = Array.isArray(nota.cliente) ? nota.cliente[0] : nota.cliente
    const clienteOrcamento = Array.isArray(orcamento.cliente) ? orcamento.cliente[0] : orcamento.cliente
    // Pagador desta nota: cliente_id próprio da nota (SPEC-153, pode ser
    // diferente do titular da venda) > cliente do orçamento > nome livre.
    const destinatario = clienteNota || (!nota.nome_destinatario ? clienteOrcamento : null)

    // SPEC-154: ao reemitir uma nota que voltou de uma rejeição REAL de
    // SEFAZ (status_sefaz preenchido no último erro registrado), a tentativa
    // avança (nova ref). Quando a última rejeição foi só pré-validação
    // (nunca chegou na SEFAZ -- status_sefaz nulo), a mesma tentativa/ref é
    // reaproveitada (regra explícita da SPEC-154, decisão de implementação
    // documentada aqui e na migration 001).
    let tentativaFinal = nota.tentativa_atual || 1
    if (nota.status_emissao === 'erro_autorizacao') {
      const { data: ultimoErro } = await supabaseAdmin
        .from('notas_fiscais_erros')
        .select('status_sefaz')
        .eq('nota_fiscal_id', nota.id)
        .order('data_hora', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (ultimoErro?.status_sefaz) {
        tentativaFinal = (nota.tentativa_atual || 1) + 1
      }
    }

    const refAtual = `VENDA-${orcamento.numero_venda || orcamento.id}-N${tentativaFinal}`

    const itens: ItemNotaDados[] = (nota.notas_fiscais_itens || []).map((nfi: any) => {
      const orcItem = Array.isArray(nfi.orcamento_item) ? nfi.orcamento_item[0] : nfi.orcamento_item
      const produto = orcItem ? (Array.isArray(orcItem.produto) ? orcItem.produto[0] : orcItem.produto) : null
      return {
        orcamentoItemId: nfi.orcamento_item_id,
        quantidadeFaturada: Number(nfi.quantidade_faturada) || 0,
        valorFaturado: nfi.valor_faturado != null ? Number(nfi.valor_faturado) : null,
        precoUnitario: orcItem?.preco_unitario != null ? Number(orcItem.preco_unitario) : null,
        desconto: orcItem?.desconto != null ? Number(orcItem.desconto) : null,
        descricao: orcItem?.descricao ?? null,
        produto: produto
          ? {
              nome: produto.nome ?? null,
              sku: produto.sku ?? null,
              codigo_produto: produto.codigo_produto ?? null,
              referencia: produto.referencia ?? null,
              ncm: produto.ncm ?? null,
              cst: produto.cst ?? null,
              unidade: produto.unidade ?? null,
              porc_st: produto.porc_st != null ? Number(produto.porc_st) : null,
              cest: produto.cest ?? null,
            }
          : null,
      }
    })

    let config
    try {
      config = resolverConfigFocus(orcamento.empresa_id ?? null)
    } catch (err) {
      if (err instanceof FocusConfigError) {
        const { error: erroInsertConfig } = await supabaseAdmin.from('notas_fiscais_erros').insert({
          nota_fiscal_id: nota.id,
          ref: nota.ref || refAtual,
          numero_tentativa: tentativaFinal,
          status_sefaz: null,
          mensagem_sefaz: null,
          erro_codigo: 'focus_config_secret_ausente',
          erro_campo: null,
          resposta_bruta: { erro: err.message },
        })
        if (erroInsertConfig) {
          console.error('[emitir-nota-fiscal] falha ao registrar erro de configuração:', erroInsertConfig)
        }
        return jsonResponse({ error: err.message, tipo: 'configuracao' }, 500)
      }
      throw err
    }

    const { payload, bloqueantes } = montarPayloadNFe({
      ref: refAtual,
      ambiente: config.ambiente,
      empresa: {
        nome: empresaRaw.nome,
        razao_social: empresaRaw.razao_social ?? null,
        cnpj: empresaRaw.cnpj ?? null,
        inscricao_estadual: empresaRaw.inscricao_estadual ?? null,
        logradouro: empresaRaw.logradouro ?? null,
        numero: empresaRaw.numero ?? null,
        complemento: empresaRaw.complemento ?? null,
        bairro: empresaRaw.bairro ?? null,
        cidade: empresaRaw.cidade,
        estado: empresaRaw.estado,
        cep: empresaRaw.cep ?? null,
        regime_tributario: empresaRaw.regime_tributario ?? null,
        codigo_municipio_ibge: empresaRaw.codigo_municipio_ibge ?? null,
      },
      destinatario: destinatario
        ? {
            nome: destinatario.nome,
            razao_social: destinatario.razao_social ?? null,
            cpf_cnpj: destinatario.cpf_cnpj ?? null,
            cnpj: destinatario.cnpj ?? null,
            cpf: destinatario.cpf ?? null,
            inscricao_estadual: destinatario.inscricao_estadual ?? null,
            endereco: destinatario.endereco ?? null,
            numero: destinatario.numero ?? null,
            bairro: destinatario.bairro ?? null,
            cidade: destinatario.cidade ?? null,
            estado: destinatario.estado ?? null,
            cep: destinatario.cep ?? null,
            telefone: destinatario.telefone ?? null,
            email: destinatario.email ?? null,
          }
        : null,
      nomeDestinatarioLivre: !destinatario ? nota.nome_destinatario : null,
      itens,
      freteValor: orcamento.frete_valor != null ? Number(orcamento.frete_valor) : null,
      freteTipo: orcamento.frete_tipo ?? null,
      formaPagamento: orcamento.forma_pagamento ?? null,
      // SPEC-231 F3: ajustes feitos na tela de emissão (definir_dados_emissao_nota_fiscal)
      ajustes: {
        dadosAdicionais: nota.dados_adicionais ?? null,
        modalidadeFrete: nota.modalidade_frete ?? null,
        transportadoraNome: nota.transportadora_nome ?? null,
        transportadoraDoc: nota.transportadora_cnpj ?? null,
        valorDesconto: nota.valor_desconto != null ? Number(nota.valor_desconto) : null,
        destinatarioDoc: nota.destinatario_cpf_cnpj ?? null,
        destinatarioIe: nota.destinatario_ie ?? null,
      },
    })

    // Pré-validação interna (nunca chegou a ir pra Focus) -- mesmo
    // tratamento de "não incrementa tentativa" do caso 400/422 real,
    // porque tecnicamente é o mesmo tipo de problema (payload nunca chega
    // na SEFAZ). Guarda o `ref` calculado mesmo sem enviar, para manter
    // rastreabilidade de qual teria sido a tentativa.
    if (bloqueantes.length > 0 || !payload) {
      const { error: erroUpdateBloqueio } = await supabaseAdmin
        .from('notas_fiscais')
        .update({ ref: refAtual, tentativa_atual: tentativaFinal, status_emissao: 'erro_autorizacao', ambiente: config.ambiente })
        .eq('id', nota.id)
      if (erroUpdateBloqueio) {
        console.error('[emitir-nota-fiscal] falha ao gravar status de bloqueio interno:', erroUpdateBloqueio)
      }

      const { error: erroInsertBloqueio } = await supabaseAdmin.from('notas_fiscais_erros').insert({
        nota_fiscal_id: nota.id,
        ref: refAtual,
        numero_tentativa: tentativaFinal,
        status_sefaz: null,
        mensagem_sefaz: null,
        erro_codigo: 'pre_validacao_interna',
        erro_campo: null,
        resposta_bruta: { bloqueantes },
      })
      if (erroInsertBloqueio) {
        console.error('[emitir-nota-fiscal] falha ao registrar bloqueio interno:', erroInsertBloqueio)
      }

      return jsonResponse(
        { status_emissao: 'erro_autorizacao', tipo: 'pre_validacao_interna', bloqueantes },
        200,
      )
    }

    // "Sempre grava payload_enviado (o JSON de fato mandado) antes de
    // enviar" -- regra explícita da SPEC-154. Se esse registro de auditoria
    // falhar, ABORTA antes de transmitir à Focus (achado do revisor,
    // 2026-09-21): melhor não emitir do que emitir sem rastro do que foi
    // enviado -- é dado fiscal, não vale arriscar.
    const { error: erroPayloadEnviado } = await supabaseAdmin
      .from('notas_fiscais')
      .update({
        ref: refAtual,
        tentativa_atual: tentativaFinal,
        ambiente: config.ambiente,
        payload_enviado: payload,
      })
      .eq('id', nota.id)
    if (erroPayloadEnviado) {
      console.error('[emitir-nota-fiscal] falha ao registrar payload_enviado, abortando antes de chamar a Focus:', erroPayloadEnviado)
      return jsonResponse(
        { error: 'Falha ao registrar auditoria da emissão. Nada foi enviado à Focus NFe. Tente novamente.' },
        500,
      )
    }

    const resultado = await chamarFocusComRetry(
      `${config.baseUrl}/v2/nfe?ref=${encodeURIComponent(refAtual)}`,
      { method: 'POST', body: JSON.stringify(payload) },
      config,
    )

    const body = resultado.body as Record<string, unknown> | null

    if (resultado.status === 201 || resultado.status === 202) {
      // 201 (síncrono, já resolvido) e 202 (processando_autorizacao) têm o
      // mesmo formato de corpo ({status, status_sefaz, mensagem_sefaz,
      // chave_nfe, ...}) -- um único aplicador cobre os dois, e é o MESMO
      // usado pelo webhook e pelo polling (fonte única de verdade do
      // "o que significa cada status").
      const aplicado = await aplicarStatusFocusNaNota(supabaseAdmin, { ref: refAtual, body })
      return jsonResponse({
        status_emissao: aplicado.statusEmissaoAplicado ?? null,
        ref: refAtual,
        http_status_focus: resultado.status,
      })
    }

    if (resultado.status === 400 || resultado.status === 422) {
      const erros = normalizarErrosPreValidacao(body)
      const { error: erroUpdate400 } = await supabaseAdmin
        .from('notas_fiscais')
        .update({ status_emissao: 'erro_autorizacao' })
        .eq('id', nota.id)
      if (erroUpdate400) {
        console.error('[emitir-nota-fiscal] falha ao gravar status_emissao (400/422):', erroUpdate400)
      }

      // Regra explícita da SPEC-154: pré-validação (nunca chega na SEFAZ)
      // NÃO incrementa tentativa -- o registro já foi feito acima
      // (tentativa_atual = tentativaFinal, sem mudança). Só grava o
      // histórico de erro, um item por entrada de `erros[]`.
      for (const erro of erros) {
        const { error: erroInsert400 } = await supabaseAdmin.from('notas_fiscais_erros').insert({
          nota_fiscal_id: nota.id,
          ref: refAtual,
          numero_tentativa: tentativaFinal,
          status_sefaz: null,
          mensagem_sefaz: erro.mensagem,
          erro_codigo: erro.codigo,
          erro_campo: erro.campo,
          resposta_bruta: body ?? {},
        })
        if (erroInsert400) {
          console.error('[emitir-nota-fiscal] falha ao registrar erro de pré-validação:', erroInsert400)
        }
      }

      return jsonResponse({ status_emissao: 'erro_autorizacao', tipo: 'pre_validacao_focus', erros, ref: refAtual })
    }

    if (resultado.status === 401 || resultado.status === 403) {
      // Erro de configuração (token/CNPJ não habilitado na Focus) -- não é
      // rejeição fiscal da venda. status_emissao NÃO muda (fica como estava
      // antes desta tentativa, provavelmente 'nao_emitida').
      const { error: erroInsert401 } = await supabaseAdmin.from('notas_fiscais_erros').insert({
        nota_fiscal_id: nota.id,
        ref: refAtual,
        numero_tentativa: tentativaFinal,
        status_sefaz: null,
        mensagem_sefaz: typeof body?.mensagem === 'string' ? body.mensagem : JSON.stringify(body),
        erro_codigo: `focus_config_${resultado.status}`,
        erro_campo: null,
        resposta_bruta: body ?? {},
      })
      if (erroInsert401) {
        console.error('[emitir-nota-fiscal] falha ao registrar erro de configuração (401/403):', erroInsert401)
      }

      return jsonResponse(
        {
          status_emissao: nota.status_emissao,
          tipo: 'configuracao',
          mensagem: 'Token/CNPJ não habilitado na Focus NFe para este ambiente. Não é um erro da venda -- verificar configuração (secret FOCUS_NFE_TOKEN / FOCUS_NFE_AMBIENTE).',
          ref: refAtual,
        },
        200,
      )
    }

    // 429 esgotado após retry, 5xx esgotado após retry, ou falha de rede
    // (status sintético 0) -- status_emissao NÃO muda, tentativa NÃO
    // incrementa (ref continua válido pra uma nova tentativa manual depois).
    const erroCodigo = resultado.status === 429 ? 'focus_rate_limit_excedido' : 'focus_erro_servidor_ou_timeout'
    const { error: erroInsertRetry } = await supabaseAdmin.from('notas_fiscais_erros').insert({
      nota_fiscal_id: nota.id,
      ref: refAtual,
      numero_tentativa: tentativaFinal,
      status_sefaz: null,
      mensagem_sefaz: typeof body?.mensagem === 'string' ? body.mensagem : JSON.stringify(body),
      erro_codigo: erroCodigo,
      erro_campo: null,
      resposta_bruta: body ?? {},
    })
    if (erroInsertRetry) {
      console.error('[emitir-nota-fiscal] falha ao registrar erro de retry esgotado:', erroInsertRetry)
    }

    return jsonResponse(
      {
        status_emissao: nota.status_emissao,
        tipo: 'retry_esgotado',
        mensagem: 'Focus NFe indisponível ou limitando requisições no momento. Tente novamente em alguns minutos.',
        ref: refAtual,
        http_status_focus: resultado.status,
      },
      200,
    )
  } catch (error: any) {
    console.error('[emitir-nota-fiscal] erro inesperado:', error)
    return jsonResponse({ error: error.message ?? String(error) }, 500)
  }
})
