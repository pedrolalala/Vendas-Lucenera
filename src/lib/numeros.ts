// SPEC-182 (N1): números de venda e de orçamento aparecem sem o prefixo
// ("VENDA-0001" → "0001", "ORC-0032" → "0032"; "ORC-0032-P3" → "0032-P3").
// Só exibição — o número gravado no banco não muda.
export const semPrefixo = (numero: string | null | undefined) =>
  (numero || '').replace(/^(VENDA|ORC)-/i, '')
