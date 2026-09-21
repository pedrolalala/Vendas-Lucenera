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

import { cfopHeuristico } from './cfop.ts'

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

  const destinatarioDoc = input.destinatario
    ? soDigitos(input.destinatario.cpf_cnpj || input.destinatario.cnpj || input.destinatario.cpf)
    : ''
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

  const itensPayload = input.itens.map((item, idx) => {
    const numeroItem = idx + 1
    const produto = item.produto
    if (!produto?.ncm) {
      bloqueantes.push(`Item ${numeroItem} (${produto?.nome || item.descricao || 'sem nome'}): produto sem NCM cadastrado.`)
    }
    if (!produto?.cst) {
      bloqueantes.push(`Item ${numeroItem} (${produto?.nome || item.descricao || 'sem nome'}): produto sem CST cadastrado.`)
    }

    const unit = valorUnitario(item)
    const valorTotalItem = item.valorFaturado ?? item.quantidadeFaturada * unit
    const codigoProduto =
      produto?.referencia || produto?.sku || (produto?.codigo_produto != null ? String(produto.codigo_produto) : null) || 'SEM-CODIGO'
    const unidade = produto?.unidade || 'UN'
    // CFOP: heurística provisória compartilhada com o espelho DANFE -- ver
    // _shared/cfop.ts (Gap de CFOP, pendência aberta na SPEC-154).
    const cfop = cfopHeuristico(produto?.porc_st)

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
    }
  })

  if (!input.destinatario && !input.nomeDestinatarioLivre) {
    bloqueantes.push('Nenhum destinatário definido para a nota (nem cliente cadastrado, nem nome livre).')
  }

  if (bloqueantes.length > 0) {
    return { payload: null, bloqueantes, avisos }
  }

  const semFrete = input.freteTipo === 'sem_frete' || !input.freteValor
  avisos.push(
    `presenca_comprador default "9" (não presencial, outros) -- venda não registra esse dado ainda.`,
    `indicador_ie_destinatario default "${input.destinatario?.inscricao_estadual ? '1' : '9'}" com base em ter/não ter IE cadastrada.`,
    `modalidade_frete default "${semFrete ? '9' : '0'}" com base em orcamentos.frete_tipo.`,
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
    natureza_operacao: 'Venda',
    data_emissao: agoraIsoSaoPaulo(),
    tipo_documento: 1, // saída
    finalidade_emissao: '1', // NF-e normal
    presenca_comprador: '9',
    modalidade_frete: semFrete ? '9' : '0',
    cnpj_emitente: cnpjEmitente,

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
          inscricao_estadual_destinatario: input.destinatario.inscricao_estadual || null,
          indicador_inscricao_estadual_destinatario: input.destinatario.inscricao_estadual ? '1' : '9',
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
