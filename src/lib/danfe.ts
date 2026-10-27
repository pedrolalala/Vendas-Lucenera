// SPEC-153 (2026-09-17, pedido do usuário): utilitários do "espelho" de nota
// fiscal (DANFE visual) mostrado no passo 1 do modal "Emitir Nota Fiscal" em
// `src/pages/Vendas.tsx` / `src/components/vendas/DanfePreview.tsx`.
//
// IMPORTANTE: não existe emissão fiscal real ainda (SPEC-154, Focus NFe, não
// implementada). A chave de acesso abaixo é só um PLACEHOLDER visual, com o
// MESMO FORMATO de 44 dígitos de uma chave real
// (cUF+AAMM+CNPJ+mod+serie+nNF+tpEmis+cNF+cDV), mas sem nenhuma garantia de
// ser válida perante a SEFAZ. Nunca é transmitida a nenhuma API fiscal.

const UF_PARA_CODIGO_IBGE: Record<string, string> = {
  AC: '12',
  AL: '17',
  AP: '16',
  AM: '13',
  BA: '29',
  CE: '23',
  DF: '53',
  ES: '32',
  GO: '52',
  MA: '21',
  MT: '51',
  MS: '50',
  MG: '31',
  PA: '15',
  PB: '25',
  PR: '41',
  PE: '26',
  PI: '22',
  RJ: '33',
  RN: '24',
  RS: '43',
  RO: '11',
  RR: '14',
  SC: '42',
  SP: '35',
  SE: '28',
  TO: '17',
}

function soNumeros(v: string | null | undefined): string {
  return (v || '').replace(/\D/g, '')
}

function pad(v: string, len: number): string {
  return v.slice(-len).padStart(len, '0')
}

// Hash simples e determinístico (NÃO criptográfico) só pra gerar o trecho
// "código numérico" (cNF) da chave placeholder a partir do id da venda —
// garante que o mesmo orçamento sempre mostra a mesma chave visual.
function hashDeterministico(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  return pad(String(h % 1e8), 8)
}

// Dígito verificador mod-11 (peso 2..9 cíclico, da direita pra esquerda) —
// mesmo algoritmo usado numa chave de acesso real, aplicado sobre os dígitos
// placeholder acima. Não substitui validação real da SEFAZ.
function digitoVerificador(base43: string): string {
  let soma = 0
  let peso = 2
  for (let i = base43.length - 1; i >= 0; i--) {
    soma += Number(base43[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  const dv = resto < 2 ? 0 : 11 - resto
  return String(dv)
}

export interface ChaveAcessoPlaceholderInput {
  vendaId: string
  uf?: string | null
  cnpjEmitente?: string | null
  dataEmissao?: string | null
  serie?: string | null
  numeroNf?: string | null
}

/**
 * Monta uma chave de acesso de 44 dígitos no mesmo formato de uma chave real
 * (cUF+AAMM+CNPJ+mod+série+nNF+tpEmis+cNF+cDV), usando os dados reais já
 * disponíveis (empresa emitente, série/número quando preenchidos) e
 * zeros/placeholder pro resto. Puramente visual — nunca é validada nem
 * enviada à SEFAZ (a emissão real via Focus NFe é a SPEC-154).
 */
export function montarChaveAcessoPlaceholder({
  vendaId,
  uf,
  cnpjEmitente,
  dataEmissao,
  serie,
  numeroNf,
}: ChaveAcessoPlaceholderInput): string {
  const cUF = UF_PARA_CODIGO_IBGE[(uf || 'SP').toUpperCase()] || '35'
  const data = dataEmissao ? new Date(dataEmissao) : new Date()
  const aamm = pad(String(data.getFullYear() % 100), 2) + pad(String(data.getMonth() + 1), 2)
  const cnpj = pad(soNumeros(cnpjEmitente) || '0', 14)
  const modelo = '55'
  const serieNum = pad(soNumeros(serie) || '0', 3)
  const nNF = pad(soNumeros(numeroNf) || '0', 9)
  const tpEmis = '1'
  const cNF = hashDeterministico(vendaId || 'venda')
  const base43 = `${cUF}${aamm}${cnpj}${modelo}${serieNum}${nNF}${tpEmis}${cNF}`
  return `${base43}${digitoVerificador(base43)}`
}

/** Agrupa a chave de 44 dígitos em blocos de 4, igual ao DANFE real. */
export function formatarChaveAcesso(chave: string): string {
  return chave.replace(/(\d{4})(?=\d)/g, '$1 ')
}

/**
 * Heurística PROVISÓRIA de CFOP — mesma lógica já usada em
 * `gestao-financeira-clone-544cb/src/components/budgets/FiscalSummaryDialog.tsx`:
 * só distingue operação dentro do estado com/sem substituição tributária, não
 * trata operação interestadual (limite já documentado na SPEC-154, escopo da
 * emissão fiscal real).
 */
export function cfopHeuristico(porcSt: number | null | undefined): string {
  return (porcSt || 0) > 0 ? '5405' : '5102'
}

// SPEC-231 F1: devolução de venda (entrada, dentro do estado) — mesma regra de _shared/cfop.ts cfopDevolucao.
export function cfopDevolucao(porcSt: number | null | undefined): string {
  return (porcSt || 0) > 0 ? '1411' : '1202'
}
