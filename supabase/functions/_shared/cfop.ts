// SPEC-154 (2026-09-21): mesma heurística PROVISÓRIA de CFOP já usada no
// espelho DANFE do frontend -- `cfopHeuristico` em
// `04-Sistemas/vendas-lucenera/src/lib/danfe.ts` (SPEC-153). Duplicada aqui
// porque esta Edge Function roda isolada em Deno, sem acesso ao bundle do
// frontend (mesmo padrão já usado em
// gestao-financeira-clone-544cb/supabase/functions/generate-report/index.ts
// para `calcularParcelasPdf`).
//
// NÃO reimplementar com lógica diferente -- se a heurística mudar, mudar os
// dois lugares juntos (regra R1 do briefing da SPEC-154: o espelho e o
// payload real nunca podem divergir).
//
// Limite já documentado na SPEC-154 ("Gap de CFOP"): só distingue operação
// dentro do estado com/sem substituição tributária, não trata operação
// interestadual. Pendência aberta -- validar com contador/Vinícius antes de
// qualquer emissão real (produção).
export function cfopHeuristico(porcSt: number | null | undefined): string {
  return (porcSt || 0) > 0 ? '5405' : '5102'
}

// SPEC-231 F1: nota de devolução de venda (entrada, dentro do estado). 1202 = devolução de venda de mercadoria
// adquirida de terceiros; 1411 = idem com substituição tributária. Provisório como o de venda — validar com o contador.
export function cfopDevolucao(porcSt: number | null | undefined): string {
  return (porcSt || 0) > 0 ? '1411' : '1202'
}
