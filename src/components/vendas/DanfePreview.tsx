// SPEC-153 (2026-09-17, pedido do usuário): espelho da nota fiscal com a
// estrutura visual completa de um DANFE real (Documento Auxiliar da Nota
// Fiscal Eletrônica) — cabeçalho, código de barras + chave de acesso,
// emitente, destinatário, cálculo do imposto e itens com dados fiscais.
//
// Isso continua sendo só uma pré-visualização INTERNA: não existe emissão
// fiscal real ainda (SPEC-154, Focus NFe), não há chave de acesso autorizada
// pela SEFAZ, e nenhuma chamada é feita a API fiscal nenhuma. O selo
// "ESPELHO — SEM VALOR FISCAL" abaixo replica a fala do usuário na reunião:
// "é o espelho, tipo, é a nota sem valor fiscal, ela não foi pra Cefaz ainda".
import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { cfopHeuristico, formatarChaveAcesso, montarChaveAcessoPlaceholder } from '@/lib/danfe'
import { CodigoBarras } from '@/components/vendas/CodigoBarras'
import type { OrcamentoItem, Venda } from '@/pages/Vendas'
import { formatCurrency } from '@/pages/Vendas'

interface ItemComDisponibilidade {
  item: OrcamentoItem
  faturado: number
  disponivel: number
  unitario: number
}

interface DanfePreviewProps {
  venda: Venda
  itensDisponiveis: ItemComDisponibilidade[]
  /** Número da NF (só preenchido no passo 2 — no espelho ainda pode estar vazio). */
  numeroNf: string
  /** Série da NF (idem). */
  serie: string
}

function Field({
  label,
  value,
  className,
}: {
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('px-2 py-1 flex flex-col justify-start min-h-[38px]', className)}>
      <span className="text-[8px] uppercase tracking-wide text-slate-500 leading-none">
        {label}
      </span>
      <span className="text-[11px] font-medium leading-tight break-words text-slate-900">
        {value || value === 0 ? value : '-'}
      </span>
    </div>
  )
}

function enderecoLinha(partes: Array<string | null | undefined>): string {
  return partes.filter((p) => p && p.trim() !== '').join(', ') || '-'
}

export function DanfePreview({ venda, itensDisponiveis, numeroNf, serie }: DanfePreviewProps) {
  const empresa = venda.empresa
  const destinatario = venda.cliente

  const chave = useMemo(
    () =>
      montarChaveAcessoPlaceholder({
        vendaId: venda.id,
        uf: empresa?.estado,
        cnpjEmitente: empresa?.cnpj,
        serie,
        numeroNf,
      }),
    [venda.id, empresa?.estado, empresa?.cnpj, serie, numeroNf],
  )

  const valorTotalProdutos = useMemo(
    () =>
      itensDisponiveis.reduce(
        (acc, { item, unitario }) => acc + Number(item.quantidade || 0) * unitario,
        0,
      ),
    [itensDisponiveis],
  )

  // "Valor total da nota" no espelho = soma do que ainda está disponível pra
  // faturar (é o que comporia a próxima nota parcial se tudo fosse selecionado).
  const valorTotalDisponivel = useMemo(
    () =>
      itensDisponiveis.reduce((acc, { disponivel, unitario }) => acc + disponivel * unitario, 0),
    [itensDisponiveis],
  )

  const docDestinatario = destinatario?.cpf_cnpj || destinatario?.cnpj || destinatario?.cpf || null

  return (
    <div className="border-2 border-slate-900 bg-white text-slate-900 text-[11px] rounded-sm overflow-hidden">
      {/* Selo de espelho — sem valor fiscal */}
      <div className="bg-red-600 text-white text-center text-[11px] font-bold py-1.5 tracking-wide uppercase">
        Espelho — sem valor fiscal — documento não transmitido à SEFAZ
      </div>

      {/* Banda 1: Emitente | Identificação DANFE | Código de barras + chave */}
      <div className="grid grid-cols-12 border-b-2 border-slate-900 divide-x divide-slate-900">
        <div className="col-span-5 p-2 space-y-0.5">
          <p className="text-xs font-bold uppercase">{empresa?.nome || 'Empresa não definida'}</p>
          {empresa?.razao_social && empresa.razao_social !== empresa.nome && (
            <p className="text-[10px] text-slate-600">{empresa.razao_social}</p>
          )}
          <p className="text-[10px] text-slate-600">
            {enderecoLinha([
              empresa?.logradouro,
              empresa?.numero,
              empresa?.complemento,
              empresa?.bairro,
            ])}
          </p>
          <p className="text-[10px] text-slate-600">
            {enderecoLinha([empresa?.cidade, empresa?.estado])}
            {empresa?.cep ? ` — CEP ${empresa.cep}` : ''}
          </p>
          <p className="text-[10px] text-slate-600">
            CNPJ: {empresa?.cnpj || '-'} · IE: {empresa?.inscricao_estadual || '-'}
          </p>
          {empresa?.regime_tributario && (
            <p className="text-[10px] text-slate-600">Regime: {empresa.regime_tributario}</p>
          )}
        </div>

        <div className="col-span-3 p-2 flex flex-col items-center justify-center text-center gap-1">
          <p className="text-lg font-black tracking-tight leading-none">DANFE</p>
          <p className="text-[8px] text-slate-600 leading-tight">
            Documento Auxiliar da Nota Fiscal Eletrônica
          </p>
          <p className="text-[9px] text-slate-600">0 - Entrada / 1 - Saída</p>
          <p className="text-sm font-bold">1 - SAÍDA</p>
          <p className="text-[10px] mt-1">
            N° <span className="font-bold">{numeroNf || 'A definir'}</span> &nbsp; SÉRIE{' '}
            <span className="font-bold">{serie || '-'}</span>
          </p>
        </div>

        <div className="col-span-4 p-2 flex flex-col items-center justify-center gap-1">
          <CodigoBarras value={chave} className="w-full max-w-[220px] h-10" />
          <p className="text-[9px] font-mono text-center tracking-wide break-all">
            {formatarChaveAcesso(chave)}
          </p>
          <p className="text-[8px] text-slate-500 text-center leading-tight">
            Chave provisória — placeholder, sem autorização da SEFAZ
          </p>
        </div>
      </div>

      {/* Banda 2: Natureza da Operação | Protocolo de Autorização */}
      <div className="grid grid-cols-2 border-b-2 border-slate-900 divide-x divide-slate-900">
        <Field label="Natureza da Operação" value="Venda" />
        <Field
          label="Protocolo de Autorização de Uso"
          value={<span className="text-red-600 font-bold">Não autorizado — sem valor fiscal</span>}
        />
      </div>

      {/* Banda 3: Destinatário / Remetente */}
      <div className="border-b-2 border-slate-900">
        <p className="bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase border-b border-slate-900">
          Destinatário / Remetente
        </p>
        <div className="grid grid-cols-6 divide-x divide-slate-300">
          <Field
            label="Nome / Razão Social"
            value={destinatario?.razao_social || destinatario?.nome}
            className="col-span-3"
          />
          <Field label="CNPJ / CPF" value={docDestinatario} className="col-span-1" />
          <Field
            label="Insc. Estadual"
            value={destinatario?.inscricao_estadual}
            className="col-span-1"
          />
          <Field label="Telefone" value={destinatario?.telefone} className="col-span-1" />
        </div>
        <div className="grid grid-cols-6 divide-x divide-slate-300 border-t border-slate-300">
          <Field
            label="Endereço"
            value={enderecoLinha([destinatario?.endereco, destinatario?.numero])}
            className="col-span-3"
          />
          <Field label="Bairro" value={destinatario?.bairro} className="col-span-1" />
          <Field
            label="Município / UF"
            value={enderecoLinha([destinatario?.cidade, destinatario?.estado])}
            className="col-span-1"
          />
          <Field label="CEP" value={destinatario?.cep} className="col-span-1" />
        </div>
        <p className="px-2 py-1 text-[9px] italic text-slate-500 border-t border-slate-300">
          Pagador padrão: cliente da venda. O pagador final desta nota (cliente cadastrado ou nome
          livre) é definido no próximo passo.
        </p>
      </div>

      {/* Banda 4: Cálculo do Imposto */}
      <div className="border-b-2 border-slate-900">
        <p className="bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase border-b border-slate-900">
          Cálculo do Imposto
        </p>
        <div className="grid grid-cols-4 divide-x divide-slate-300">
          <Field label="Valor Total dos Produtos" value={formatCurrency(valorTotalProdutos)} />
          <Field label="Valor do Frete" value={formatCurrency(venda.frete_valor || 0)} />
          <Field
            label="Desconto Global"
            value={`${Number(venda.desconto_global || 0).toLocaleString('pt-BR')}%`}
          />
          <Field
            label="Valor Total da Nota (disponível)"
            value={<span className="font-bold">{formatCurrency(valorTotalDisponivel)}</span>}
          />
        </div>
      </div>

      {/* Banda 5: Dados do Produto/Serviço */}
      <div className="border-b-2 border-slate-900">
        <p className="bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase border-b border-slate-900">
          Dados do Produto / Serviço
        </p>
        <table className="w-full text-[10px]">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="border-b border-slate-300">
              <th className="p-1 text-left font-medium">Código</th>
              <th className="p-1 text-left font-medium">Descrição</th>
              <th className="p-1 text-left font-medium">NCM</th>
              <th className="p-1 text-left font-medium">CST</th>
              <th className="p-1 text-left font-medium">CFOP</th>
              <th className="p-1 text-left font-medium">Unid.</th>
              <th className="p-1 text-right font-medium">Qtde</th>
              <th className="p-1 text-right font-medium">Vl. Unit.</th>
              <th className="p-1 text-right font-medium">Vl. Total</th>
            </tr>
          </thead>
          <tbody>
            {itensDisponiveis.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-2 text-center text-slate-500">
                  Nenhum item nesta venda.
                </td>
              </tr>
            ) : (
              itensDisponiveis.map(({ item, disponivel, unitario }) => {
                const completo = disponivel <= 0
                const produto = item.produto
                const codigo = produto?.referencia || produto?.sku || produto?.codigo_produto || '-'
                // Heurística provisória (não trata operação interestadual) —
                // ver comentário em src/lib/danfe.ts.
                const cfop = cfopHeuristico(produto?.tem_st ? 1 : 0)
                return (
                  <tr
                    key={item.id}
                    className={cn('border-b border-slate-200', completo && 'opacity-50')}
                  >
                    <td className="p-1 font-mono">{codigo}</td>
                    <td className={cn('p-1', completo && 'line-through')}>
                      {item.descricao || produto?.nome || '-'}
                    </td>
                    <td className="p-1 font-mono">{produto?.ncm || '-'}</td>
                    <td className="p-1 font-mono">{produto?.cst || '-'}</td>
                    <td className="p-1 font-mono">{cfop}</td>
                    <td className="p-1">{produto?.unidade || 'UN'}</td>
                    <td className="p-1 text-right">{item.quantidade}</td>
                    <td className="p-1 text-right font-mono">{formatCurrency(unitario)}</td>
                    <td className="p-1 text-right font-mono">
                      {formatCurrency(Number(item.quantidade || 0) * unitario)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Banda 6: Dados Adicionais */}
      <div className="p-2 bg-slate-50">
        <p className="text-[9px] font-bold uppercase text-slate-600 mb-1">Dados Adicionais</p>
        <p className="text-[10px] text-slate-600 leading-snug">
          Documento interno de conferência ("espelho da nota fiscal"), sem valor fiscal — ainda não
          foi transmitido à SEFAZ. A emissão fiscal real (Focus NFe) é escopo separado (SPEC-154).
          Itens esmaecidos/riscados já estão 100% cobertos por notas anteriores desta venda.
        </p>
      </div>
    </div>
  )
}
