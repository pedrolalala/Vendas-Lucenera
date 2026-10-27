// SPEC-154 (2026-09-21): monta o payload NF-e 4.00 no formato da Focus NFe
// (POST /v2/nfe) a partir dos MESMOS dados já usados no espelho DANFE
// (DanfePreview.tsx/danfe.ts, SPEC-153) -- fonte única de montagem (regra R1
// do briefing: o espelho e o payload real nunca podem divergir). CFOP usa
// literalmente `cfopHeuristico` de `_shared/cfop.ts` (mesma duplicação
// documentada lá).
//
// Nunca inventa dado fiscal que deveria vir do cadastro real (NCM, CST,
// CNPJ/CPF, IE, endereço) -- quando falta algo indispensável pro schema da
// Focus, a função devolve em `bloqueantes` em vez de inventar um valor, e
// quem chama (emitir-nota-fiscal) precisa tratar isso como uma
// pré-validação interna que nunca chega a ir pra Focus (mesmo efeito prático
// de um 400/422 da própria Focus, só que detectado antes).
//
// Para os poucos campos que o schema da Focus exige mas o nosso cadastro
// ainda não modela por produto/venda (PIS/COFINS CST, origem do ICMS,
// indicador de presença do comprador, modalidade de frete, indicador de IE
// do destinatário), usamos um valor-default documentado abaixo em vez de
// bloquear a emissão -- são simplificações registradas como pendência na
// SPEC-154 (não é dado fiscal "inventado" no sentido da regra 5.1, é uma
// escolha de default de integração, sempre a mesma e sempre visível no
// `payload_enviado` gravado).

import { cfopDevolucao, cfopHeuristico } from './cfop.ts'

export interface EmpresaEmitenteDados {
  nome: string
  razao_social: string | null
  cnpj: string | null
  inscricao_estadual: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string
  estado: string
  cep: string | null
  regime_tributario: string | null
  codigo_municipio_ibge: string | null
}

export interface DestinatarioDados {
  nome: string
  razao_social: string | null
  cpf_cnpj: string | null
  cnpj: string | null
  cpf: string | null
  inscricao_estadual: string | null
  endereco: string | null
  numero: string | null
  bairro: string | null
  cidade: string | null
  estado: string | null
  cep: string | null
  telefone: string | null
  email?: string | null
}

export interface ItemNotaDados {
  orcamentoItemId: string
  quantidadeFaturada: number
  valorFaturado: number | null
  precoUnitario: number | null
  desconto: number | null
  descricao: string | null
  produto: {
    nome: string | null
    sku: string | null
    codigo_produto: number | null
    referencia: string | null
    ncm: string | null
    cst: string | null
    unidade: string | null
    porc_st: number | null
    cest?: string | null
  } | null
}

export interface MontarPayloadInput {
  ref: string
  ambiente: 'homologacao' | 'producao'
  empresa: EmpresaEmitenteDados
  destinatario: DestinatarioDados | null
  nomeDestinatarioLivre: string | null
  itens: ItemNotaDados[]
  freteValor: number | null
  freteTipo: string | null
  /** SPEC-165: orcamentos.forma_pagamento (pix, boleto, cartao, dinheiro...). */
  formaPagamento?: string | null
  /** SPEC-231 F3: o que o faturamento ajustou nesta nota (nulo = cadastro/orçamento). */
  ajustes?: AjustesNota | null
  /** SPEC-231 F1: venda (padrão) ou devolução de venda (só documento fiscal, referencia a NF original). */
  tipoNota?: 'venda' | 'devolucao'
  /** SPEC-231 F1: chave (44 dígitos) da NF de venda original, obrigatória na devolução. */
  chaveReferenciada?: string | null
}

export interface AjustesNota {
  dadosAdicionais: string | null
  /** modFrete: 0 CIF, 1 FOB, 2 terceiros, 9 sem frete */
  modalidadeFrete: string | null
  transportadoraNome: string | null
  transportadoraDoc: string | null
  valorDesconto: number | null
  destinatarioDoc: string | null
  destinatarioIe: string | null
}

export interface MontarPayloadResultado {
  payload: Record<string, unknown> | null
  /** Impede a emissão -- nunca chega a chamar a Focus. */
  bloqueantes: string[]
  /** Default aplicado por falta de dado no cadastro -- não impede, só documenta. */
  avisos: string[]
}

function soDigitos(v: string | null | undefined): string {
  return (v || '').replace(/\D/g, '')
}

function valorUnitario(item: ItemNotaDados): number {
  const preco = item.precoUnitario || 0
  const desconto = item.desconto || 0
  return preco * (1 - desconto / 100)
}

/** ISO 8601 com offset de São Paulo (Brasil não usa mais horário de verão desde 2019). */
function agoraIsoSaoPaulo(): string {
  const agora = new Date()
  const utcMs = agora.getTime() + agora.getTimezoneOffset() * 60000
  const spMs = utcMs - 3 * 60 * 60 * 1000
  const sp = new Date(spMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${sp.getFullYear()}-${pad(sp.getMonth() + 1)}-${pad(sp.getDate())}` +
    `T${pad(sp.getHours())}:${pad(sp.getMinutes())}:${pad(sp.getSeconds())}-03:00`
  )
}

// SPEC-165: código de regime tributário (CRT) a partir do texto livre de
// empresas.regime_tributario. null = não informado (bloqueia a emissão: sem
// regime não dá pra saber se o ICMS vai como CST ou CSOSN).
export function crtDoRegime(regime: string | null | undefined): '1' | '2' | '3' | null {
  const r = (regime || '').trim().toLowerCase()
  if (!r) return null
  if (r === '2' || r.includes('sublimite')) return '2'
  if (r === '1' || r.includes('simples') || r === 'mei') return '1'
  if (r === '3' || r.includes('presumido') || r.includes('real') || r.includes('normal')) return '3'
  return null
}

// SPEC-165: grupo de pagamento (obrigatório na NF-e 4.00), tPag da SEFAZ.
const FORMA_PAGAMENTO_NFE: Record<string, string> = {
  dinheiro: '01',
  cartao: '03',
  cartao_credito: '03',
  cartao_debito: '04',
  boleto: '15',
  pix: '17',
  transferencia: '18',
}

export function montarPayloadNFe(input: MontarPayloadInput): MontarPayloadResultado {
  const bloqueantes: string[] = []
  const avisos: string[] = []

  const cnpjEmitente = soDigitos(input.empresa.cnpj)
  if (!cnpjEmitente) bloqueantes.push('empresa.cnpj ausente para a empresa emitente.')
  if (!input.empresa.codigo_municipio_ibge) {
    bloqueantes.push(
      'empresas.codigo_municipio_ibge ausente -- preencher antes da primeira emissão real (ver Passos manuais da SPEC-154).',
    )
  }

  const aj = input.ajustes ?? null
  // SPEC-231 F3: CPF/CNPJ e IE corrigidos na tela valem só para esta nota
  const destinatarioDoc =
    soDigitos(aj?.destinatarioDoc) ||
    (input.destinatario
      ? soDigitos(input.destinatario.cpf_cnpj || input.destinatario.cnpj || input.destinatario.cpf)
      : '')
  const ieInformada = (aj?.destinatarioIe ?? input.destinatario?.inscricao_estadual ?? '').trim()
  const ieIsento = ieInformada.toUpperCase() === 'ISENTO'
  const ieDestinatario = ieIsento ? null : ieInformada || null
  // indIEDest: 1 contribuinte, 2 isento, 9 não contribuinte
  const indicadorIe = ieDestinatario ? '1' : ieIsento ? '2' : '9'
  if (!destinatarioDoc) {
    // Pendência aberta na SPEC-154 ("política de pagador sem CPF/CNPJ" --
    // decisão de negócio não tomada nesta SPEC): até essa decisão existir,
    // bloqueamos a emissão REAL (a Focus rejeitaria mesmo assim, não tem
    // como emitir NF-e sem documento do destinatário) em vez de inventar um
    // CPF/CNPJ genérico.
    bloqueantes.push(
      input.nomeDestinatarioLivre
        ? `Destinatário "${input.nomeDestinatarioLivre}" não tem CPF/CNPJ cadastrado -- emissão real bloqueada até a política de pagador sem documento ser decidida (ver Pendências da SPEC-154).`
        : 'Destinatário sem CPF/CNPJ cadastrado em contatos -- emissão real bloqueada.',
    )
  }

  if (input.itens.length === 0) {
    bloqueantes.push('Nenhum item informado para a nota fiscal.')
  }

  const ehDevolucao = input.tipoNota === 'devolucao'
  const chaveReferenciada = soDigitos(input.chaveReferenciada)
  if (ehDevolucao && chaveReferenciada.length !== 44) {
    bloqueantes.push(
      'Nota de devolução precisa da chave (44 dígitos) da NF de venda original — informe na tela de emissão.',
    )
  }

  const crt = crtDoRegime(input.empresa.regime_tributario)
  if (!crt) {
    bloqueantes.push(
      'empresas.regime_tributario vazio ou não reconhecido -- informar o regime (Simples Nacional / Lucro Presumido / Lucro Real) antes de emitir (SPEC-165).',
    )
  }

  // SPEC-165: destino da operação. Interestadual exige CFOP 6xxx e, para
  // consumidor final não contribuinte, DIFAL -- regra ainda não validada com
  // o contador, então bloqueia em vez de emitir com CFOP de operação interna.
  const ufEmitente = (input.empresa.estado || '').trim().toUpperCase()
  const ufDestino = (input.destinatario?.estado || '').trim().toUpperCase()
  const interestadual = !!ufDestino && !!ufEmitente && ufDestino !== ufEmitente
  if (interestadual) {
    bloqueantes.push(
      `Destinatário em ${ufDestino} (emitente em ${ufEmitente}): venda interestadual exige CFOP 6xxx/DIFAL, pendente de validação do contador (SPEC-165).`,
    )
  }
  const consumidorFinal = ieDestinatario ? '0' : '1'

  const itensPayload = input.itens.map((item, idx) => {
    const numeroItem = idx + 1
    const produto = item.produto
    if (!produto?.ncm) {
      bloqueantes.push(`Item ${numeroItem} (${produto?.nome || item.descricao || 'sem nome'}): produto sem NCM cadastrado.`)
    }
    if (!produto?.cst) {
      bloqueantes.push(`Item ${numeroItem} (${produto?.nome || item.descricao || 'sem nome'}): produto sem CST cadastrado.`)
    } else if (crt) {
      // Simples Nacional usa CSOSN (3 dígitos, ex. 102/500); regime normal usa CST (2 dígitos).
      const digitos = produto.cst.replace(/\D/g, '').length
      if (crt === '1' && digitos !== 3) {
        bloqueantes.push(`Item ${numeroItem} (${produto?.nome || item.descricao || 'sem nome'}): empresa do Simples Nacional exige CSOSN (3 dígitos), cadastrado "${produto.cst}".`)
      }
      if (crt === '3' && digitos !== 2) {
        bloqueantes.push(`Item ${numeroItem} (${produto?.nome || item.descricao || 'sem nome'}): regime normal exige CST (2 dígitos), cadastrado "${produto.cst}".`)
      }
    }

    const unit = valorUnitario(item)
    const valorTotalItem = item.valorFaturado ?? item.quantidadeFaturada * unit
    const codigoProduto =
      produto?.referencia || produto?.sku || (produto?.codigo_produto != null ? String(produto.codigo_produto) : null) || 'SEM-CODIGO'
    const unidade = produto?.unidade || 'UN'
    // CFOP: heurística provisória compartilhada com o espelho DANFE -- ver
    // _shared/cfop.ts (Gap de CFOP, pendência aberta na SPEC-154).
    const cfop = ehDevolucao ? cfopDevolucao(produto?.porc_st) : cfopHeuristico(produto?.porc_st)

    return {
      numero_item: numeroItem,
      codigo_produto: codigoProduto,
      descricao: item.descricao || produto?.nome || 'Produto sem descrição',
      cfop,
      unidade_comercial: unidade,
      quantidade_comercial: item.quantidadeFaturada,
      valor_unitario_comercial: unit,
      valor_bruto: valorTotalItem,
      unidade_tributavel: unidade,
      quantidade_tributavel: item.quantidadeFaturada,
      valor_unitario_tributavel: unit,
      codigo_ncm: produto?.ncm || null,
      icms_origem: '0', // SPEC-154: default (nacional) -- produtos não rastreia origem por item, ver comentário no topo do arquivo.
      icms_situacao_tributaria: produto?.cst || null,
      pis_situacao_tributaria: '99', // SPEC-154: default -- produtos não tem CST de PIS por item ainda (pendência).
      cofins_situacao_tributaria: '99', // SPEC-154: default -- idem, COFINS.
      // SPEC-165: CEST obrigatório quando há substituição tributária.
      ...(produto?.cest ? { cest: String(produto.cest).replace(/\D/g, '') } : {}),
    }
  })

  if (!input.destinatario && !input.nomeDestinatarioLivre) {
    bloqueantes.push('Nenhum destinatário definido para a nota (nem cliente cadastrado, nem nome livre).')
  }

  if (bloqueantes.length > 0) {
    return { payload: null, bloqueantes, avisos }
  }

  const semFrete = input.freteTipo === 'sem_frete' || !input.freteValor
  const valorProdutos =
    Math.round(itensPayload.reduce((acc, it) => acc + Number(it.valor_bruto || 0), 0) * 100) / 100

  // SPEC-231 F3: desconto da nota rateado nos itens pelo valor (o último leva o arredondamento)
  const desconto = Math.round((aj?.valorDesconto || 0) * 100) / 100
  if (desconto > 0) {
    if (desconto >= valorProdutos) {
      return { payload: null, bloqueantes: ['Desconto maior ou igual ao total dos produtos.'], avisos }
    }
    let restante = desconto
    itensPayload.forEach((it, i) => {
      const parte =
        i === itensPayload.length - 1
          ? restante
          : Math.round(((Number(it.valor_bruto || 0) / valorProdutos) * desconto) * 100) / 100
      restante = Math.round((restante - parte) * 100) / 100
      ;(it as Record<string, unknown>).valor_desconto = parte
    })
  }
  const valorNota = Math.round((valorProdutos - desconto) * 100) / 100
  const modalidadeFrete = aj?.modalidadeFrete || (semFrete ? '9' : '0')
  const docTransportadora = soDigitos(aj?.transportadoraDoc)
  const formaNormalizada = (input.formaPagamento || '').trim().toLowerCase()
  const tPag = FORMA_PAGAMENTO_NFE[formaNormalizada] || '99'
  if (tPag === '99') {
    avisos.push(
      `forma_pagamento "${input.formaPagamento || '-'}" sem mapeamento -- enviado como 99 (outros).`,
    )
  }
  avisos.push(
    'PIS/COFINS e IBS/CBS pendentes de definição do contador (SPEC-165): PIS/COFINS vão como 99; grupo IBS/CBS não enviado.',
  )
  if (ehDevolucao) {
    avisos.push('Nota de devolução: CFOP 1202/1411, entrada, finalidade 4, sem pagamento — validar com o contador (SPEC-231 F1).')
  }
  avisos.push(
    `presenca_comprador default "9" (não presencial, outros) -- venda não registra esse dado ainda.`,
    `indicador_ie_destinatario "${indicadorIe}" (IE ${ieIsento ? 'ISENTO' : ieDestinatario ? 'informada' : 'não informada'}).`,
    aj?.modalidadeFrete
      ? `modalidade_frete "${modalidadeFrete}" escolhida na emissão.`
      : `modalidade_frete default "${modalidadeFrete}" com base em orcamentos.frete_tipo.`,
    ...(semFrete
      ? []
      : [
          'valor_frete NÃO enviado: nota parcial não sabe que fração do frete da venda lhe cabe (decisão pendente, SPEC-165).',
        ]),
  )

  // Dados cadastrais do emitente (razão social, endereço, IE, regime
  // tributário) NÃO entram no corpo do POST /v2/nfe -- na Focus NFe eles
  // ficam registrados uma vez no cadastro da empresa dentro da própria
  // conta Focus (`POST /empresas`, fora do escopo desta SPEC, é passo
  // manual de configuração da conta). Só `cnpj_emitente` é enviado aqui,
  // pra identificar a empresa quando um mesmo token cobrir mais de um CNPJ.
  // `input.empresa` (endereço/IE/regime/IBGE) segue sendo usado acima só
  // pra validar que o cadastro Lucenera está completo antes de emitir
  // (bloqueantes), não pra montar o payload.
  const payload: Record<string, unknown> = {
    // SPEC-231 F1: devolução = nota de entrada, finalidade 4, referenciando a NF de venda original
    natureza_operacao: ehDevolucao ? 'Devolução de venda' : 'Venda',
    data_emissao: agoraIsoSaoPaulo(),
    tipo_documento: ehDevolucao ? 0 : 1, // 0 entrada, 1 saída
    finalidade_emissao: ehDevolucao ? '4' : '1', // 4 devolução, 1 normal
    ...(ehDevolucao ? { notas_referenciadas: [{ chave_nfe: chaveReferenciada }] } : {}),
    presenca_comprador: '9',
    modalidade_frete: modalidadeFrete,
    // SPEC-231 F3: transportadora e dados adicionais digitados na emissão
    ...(aj?.transportadoraNome ? { nome_transportador: aj.transportadoraNome } : {}),
    ...(docTransportadora.length === 14 ? { cnpj_transportador: docTransportadora } : {}),
    ...(docTransportadora.length === 11 ? { cpf_transportador: docTransportadora } : {}),
    ...(aj?.dadosAdicionais ? { informacoes_adicionais_contribuinte: aj.dadosAdicionais } : {}),
    ...(desconto > 0 ? { valor_desconto: desconto } : {}),
    cnpj_emitente: cnpjEmitente,
    // SPEC-165: campos que faltavam no JSON.
    regime_tributario_emitente: crt,
    local_destino: interestadual ? 2 : 1,
    consumidor_final: consumidorFinal,
    // devolução não tem pagamento (o crédito é do orçamento de Devolução)
    formas_pagamento: ehDevolucao
      ? [{ forma_pagamento: '90', valor_pagamento: 0 }]
      : [{ forma_pagamento: tPag, valor_pagamento: valorNota }],

    // CNPJ tem 14 dígitos, CPF tem 11 -- é assim que a própria Focus espera
    // que a gente escolha entre os dois campos mutuamente exclusivos.
    ...(input.destinatario
      ? {
          ...(destinatarioDoc.length > 11
            ? { cnpj_destinatario: destinatarioDoc }
            : { cpf_destinatario: destinatarioDoc }),
          nome_destinatario: input.destinatario.razao_social || input.destinatario.nome,
          logradouro_destinatario: input.destinatario.endereco || null,
          numero_destinatario: input.destinatario.numero || 'S/N',
          bairro_destinatario: input.destinatario.bairro || null,
          municipio_destinatario: input.destinatario.cidade || null,
          uf_destinatario: input.destinatario.estado || null,
          cep_destinatario: soDigitos(input.destinatario.cep) || null,
          telefone_destinatario: soDigitos(input.destinatario.telefone) || null,
          ...(input.destinatario.email ? { email_destinatario: input.destinatario.email } : {}),
          inscricao_estadual_destinatario: ieDestinatario,
          indicador_inscricao_estadual_destinatario: indicadorIe,
        }
      : {
          cpf_destinatario: destinatarioDoc,
          nome_destinatario: input.nomeDestinatarioLivre,
          indicador_inscricao_estadual_destinatario: '9',
        }),

    items: itensPayload,
  }

  return { payload, bloqueantes: [], avisos }
}
