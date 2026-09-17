import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { redirectWithCode } from '@/lib/cross-system-auth'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { FileText, ExternalLink, ShoppingCart } from 'lucide-react'
import { DanfePreview } from '@/components/vendas/DanfePreview'

// SPEC-153: Financeiro/Admin Bancária continua sendo o dono real de
// boletos — Vendas só navega até lá (os boletos já nasceram na aprovação do
// orçamento, `aprovar_orcamento_financeiro`, com status='pendente_registro').
const FINANCEIRO_URL = 'https://retorno-bancario-bradesco-5392a.goskip.app'

// SPEC-153 (2026-09-17): dados fiscais do produto usados só no espelho
// (DANFE visual) -- NCM/CST confirmados em `produtos` (SPEC-132),
// `porc_st` usado na heurística provisória de CFOP (ver DanfePreview.tsx).
export interface ProdutoFiscal {
  id: string
  nome: string | null
  sku: string | null
  codigo_produto: number | null
  referencia: string | null
  ncm: string | null
  cst: string | null
  unidade: string | null
  porc_st: number | null
}

export interface OrcamentoItem {
  id: string
  quantidade: number
  preco_unitario: number | null
  desconto: number | null
  descricao: string | null
  produto: ProdutoFiscal | null
}

// SPEC-153 (2026-09-17): emitente real da nota (empresa do orçamento),
// colunas confirmadas em `supabase/db/current/01_schema_full.sql`.
export interface EmpresaEmitente {
  id: string
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
}

// SPEC-153 (2026-09-17): campos extras de `contatos` usados no espelho
// (destinatário/pagador padrão), colunas confirmadas.
export interface ClienteFiscal {
  id: string
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

interface NotaFiscalItem {
  id: string
  orcamento_item_id: string
  quantidade_faturada: number
  valor_faturado: number | null
}

interface NotaFiscal {
  id: string
  numero_nf: string
  valor: number | null
  data_emissao: string | null
  cliente_id: string | null
  nome_destinatario: string | null
  notas_fiscais_itens: NotaFiscalItem[]
}

export interface Venda {
  id: string
  numero: string | null
  numero_venda: string | null
  valor_total: number | null
  frete_valor: number | null
  desconto_global: number | null
  empresa: EmpresaEmitente | null
  cliente: ClienteFiscal | null
  projeto: { nome: string; codigo: string | null } | null
  orcamento_itens: OrcamentoItem[]
  notas_fiscais: NotaFiscal[]
}

interface Contato {
  id: string
  nome: string
}

export const formatCurrency = (value: number | string | null | undefined) =>
  value || value === 0
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value))
    : '-'

export function valorUnitario(item: OrcamentoItem): number {
  const preco = item.preco_unitario || 0
  const desconto = item.desconto || 0
  return preco * (1 - desconto / 100)
}

// Soma quanto de um orcamento_item já foi coberto por notas anteriores.
export function jaFaturado(item: OrcamentoItem, notas: NotaFiscal[]): number {
  let total = 0
  for (const nf of notas) {
    for (const nfi of nf.notas_fiscais_itens || []) {
      if (nfi.orcamento_item_id === item.id) total += Number(nfi.quantidade_faturada) || 0
    }
  }
  return total
}

function statusNota(venda: Venda): { label: string; className: string } {
  if (!venda.orcamento_itens || venda.orcamento_itens.length === 0) {
    return { label: 'Sem itens', className: 'bg-slate-50 text-slate-500' }
  }
  if (!venda.notas_fiscais || venda.notas_fiscais.length === 0) {
    return { label: 'Nota pendente', className: 'bg-amber-50 text-amber-700' }
  }
  const completa = venda.orcamento_itens.every(
    (item) => jaFaturado(item, venda.notas_fiscais) >= Number(item.quantidade) - 1e-6,
  )
  return completa
    ? { label: 'Nota completa', className: 'bg-emerald-50 text-emerald-700' }
    : { label: 'Nota parcial', className: 'bg-sky-50 text-sky-700' }
}

export default function Vendas() {
  const { toast } = useToast()
  const [vendas, setVendas] = useState<Venda[]>([])
  const [loading, setLoading] = useState(true)

  const [showNfModal, setShowNfModal] = useState(false)
  // SPEC-153 (pedido do usuário, 2026-09-17): "Emitir Nota Fiscal" abre
  // primeiro um espelho/pré-visualização da nota cheia (igual ao processo
  // manual descrito na reunião: "tirar um espelho da nota fiscal cheia" e
  // ir marcando o que já saiu) -- só depois de revisar isso é que o
  // formulário de preenchimento (número, pagador, quantidade por item)
  // aparece.
  const [nfStep, setNfStep] = useState<'preview' | 'form'>('preview')
  const [vendaAtual, setVendaAtual] = useState<Venda | null>(null)
  const [quantidades, setQuantidades] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const [numeroNf, setNumeroNf] = useState('')
  const [serie, setSerie] = useState('')
  const [dataEmissao, setDataEmissao] = useState('')
  const [tipoOperacao, setTipoOperacao] = useState('CR')
  const [perfil, setPerfil] = useState('')
  const [fornecedor, setFornecedor] = useState('')

  const [pagadorModo, setPagadorModo] = useState<'venda' | 'cadastrado' | 'livre'>('venda')
  const [buscaContato, setBuscaContato] = useState('')
  const [contatosEncontrados, setContatosEncontrados] = useState<Contato[]>([])
  const [contatoSelecionado, setContatoSelecionado] = useState<Contato | null>(null)
  const [nomeDestinatario, setNomeDestinatario] = useState('')

  const fetchVendas = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('orcamentos')
      .select(
        `
        id, numero, numero_venda, valor_total, frete_valor, desconto_global,
        empresa:empresas(id, nome, razao_social, cnpj, inscricao_estadual, logradouro, numero, complemento, bairro, cidade, estado, cep, regime_tributario),
        cliente:contatos!orcamentos_cliente_id_fkey(id, nome, razao_social, cpf_cnpj, cnpj, cpf, inscricao_estadual, endereco, numero, bairro, cidade, estado, cep, telefone),
        projeto:projetos(nome, codigo),
        orcamento_itens(id, quantidade, preco_unitario, desconto, descricao, produto:produtos(id, nome, sku, codigo_produto, referencia, ncm, cst, unidade, porc_st)),
        notas_fiscais(id, numero_nf, valor, data_emissao, cliente_id, nome_destinatario, notas_fiscais_itens(id, orcamento_item_id, quantidade_faturada, valor_faturado))
      `,
      )
      .eq('status', 'Orçamento Aprovado')
      .eq('natureza_operacao', 'venda')
      .order('numero_venda', { ascending: false })

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao carregar vendas',
        description: error.message,
      })
    } else if (data) {
      setVendas(
        (data as any[]).map((v) => ({
          ...v,
          empresa: Array.isArray(v.empresa) ? v.empresa[0] || null : v.empresa,
          cliente: Array.isArray(v.cliente) ? v.cliente[0] || null : v.cliente,
          projeto: Array.isArray(v.projeto) ? v.projeto[0] || null : v.projeto,
          orcamento_itens: (v.orcamento_itens || []).map((item: any) => ({
            ...item,
            produto: Array.isArray(item.produto) ? item.produto[0] || null : item.produto,
          })),
        })) as Venda[],
      )
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchVendas()
  }, [])

  useEffect(() => {
    if (pagadorModo !== 'cadastrado' || buscaContato.trim().length < 2) {
      setContatosEncontrados([])
      return
    }
    let cancelado = false
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('contatos')
        .select('id, nome')
        .ilike('nome', `%${buscaContato.trim()}%`)
        .order('nome')
        .limit(20)
      if (!cancelado) setContatosEncontrados((data as Contato[]) || [])
    }, 300)
    return () => {
      cancelado = true
      clearTimeout(timer)
    }
  }, [buscaContato, pagadorModo])

  const abrirModalNf = (venda: Venda) => {
    setVendaAtual(venda)
    const iniciais: Record<string, string> = {}
    for (const item of venda.orcamento_itens || []) {
      const disponivel = Number(item.quantidade) - jaFaturado(item, venda.notas_fiscais)
      iniciais[item.id] = disponivel > 0 ? String(disponivel) : '0'
    }
    setQuantidades(iniciais)
    setNumeroNf('')
    setSerie('')
    setDataEmissao('')
    setTipoOperacao('CR')
    setPerfil('')
    setFornecedor('')
    setPagadorModo('venda')
    setBuscaContato('')
    setContatosEncontrados([])
    setContatoSelecionado(null)
    setNomeDestinatario('')
    setNfStep('preview')
    setShowNfModal(true)
  }

  const itensDisponiveis = useMemo(() => {
    if (!vendaAtual) return []
    return (vendaAtual.orcamento_itens || []).map((item) => {
      const faturado = jaFaturado(item, vendaAtual.notas_fiscais)
      const disponivel = Math.max(0, Number(item.quantidade) - faturado)
      return { item, faturado, disponivel, unitario: valorUnitario(item) }
    })
  }, [vendaAtual])

  const valorTotalSelecionado = useMemo(() => {
    return itensDisponiveis.reduce((acc, { item, unitario }) => {
      const q = Number(quantidades[item.id] || 0)
      return acc + q * unitario
    }, 0)
  }, [itensDisponiveis, quantidades])

  const handleQuantidadeChange = (itemId: string, disponivel: number, valor: string) => {
    const num = Number(valor)
    if (valor === '') {
      setQuantidades((c) => ({ ...c, [itemId]: '' }))
      return
    }
    if (Number.isNaN(num) || num < 0) return
    const clamped = Math.min(num, disponivel)
    setQuantidades((c) => ({ ...c, [itemId]: String(clamped) }))
  }

  const handleRegistrar = async () => {
    if (!vendaAtual) return
    if (!numeroNf.trim()) {
      toast({ variant: 'destructive', title: 'Número da NF é obrigatório' })
      return
    }
    const itensPayload = itensDisponiveis
      .map(({ item, unitario }) => {
        const quantidade = Number(quantidades[item.id] || 0)
        if (quantidade <= 0) return null
        return {
          orcamento_item_id: item.id,
          quantidade_faturada: quantidade,
          valor_faturado: Number((quantidade * unitario).toFixed(2)),
        }
      })
      .filter(Boolean)

    if (itensPayload.length === 0) {
      toast({ variant: 'destructive', title: 'Selecione ao menos um item para a nota' })
      return
    }

    if (pagadorModo === 'cadastrado' && !contatoSelecionado) {
      toast({ variant: 'destructive', title: 'Selecione o contato pagador' })
      return
    }
    if (pagadorModo === 'livre' && !nomeDestinatario.trim()) {
      toast({ variant: 'destructive', title: 'Informe o nome do pagador' })
      return
    }

    setSubmitting(true)
    try {
      const { error } = await (supabase as any).rpc('registrar_nota_fiscal_parcial', {
        p_orcamento_id: vendaAtual.id,
        p_numero_nf: numeroNf.trim(),
        p_itens: itensPayload,
        p_serie: serie || null,
        p_data_emissao: dataEmissao || null,
        p_cliente_id: pagadorModo === 'cadastrado' ? contatoSelecionado?.id : null,
        p_nome_destinatario: pagadorModo === 'livre' ? nomeDestinatario.trim() : null,
        p_tipo_operacao: tipoOperacao,
        p_perfil: perfil || null,
        p_fornecedor: fornecedor || null,
      })
      if (error) throw error

      toast({ title: 'Nota fiscal registrada' })
      setShowNfModal(false)
      fetchVendas()
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro ao registrar nota', description: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const verBoletos = async (venda: Venda) => {
    const route = `/boletos?orcamento_id=${venda.id}`
    try {
      await redirectWithCode(FINANCEIRO_URL, route, 'financeiro', { newTab: true })
    } catch {
      window.open(`${FINANCEIRO_URL}${route}`, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in pb-20 w-full max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <ShoppingCart className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">Vendas</h1>
            <p className="text-sm text-muted-foreground">
              Orçamentos aprovados que viraram venda — emita nota fiscal (parcial, multi-pagador) e
              acompanhe os boletos já criados na aprovação.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Venda</TableHead>
              <TableHead>Orçamento</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Projeto</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-center">Nota Fiscal</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : vendas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Nenhuma venda (orçamento aprovado) encontrada.
                </TableCell>
              </TableRow>
            ) : (
              vendas.map((venda) => {
                const status = statusNota(venda)
                return (
                  <TableRow key={venda.id}>
                    <TableCell className="font-mono font-medium">
                      {venda.numero_venda || '-'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {venda.numero || '-'}
                    </TableCell>
                    <TableCell>{venda.cliente?.nome || '-'}</TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {venda.projeto?.codigo
                        ? `${venda.projeto.codigo} — ${venda.projeto.nome}`
                        : venda.projeto?.nome || '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(venda.valor_total)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={status.className}>
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1 whitespace-nowrap">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => abrirModalNf(venda)}
                        disabled={status.label === 'Nota completa' || status.label === 'Sem itens'}
                      >
                        <FileText className="h-3.5 w-3.5" /> Emitir Nota Fiscal
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => verBoletos(venda)}
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Ver Boletos
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showNfModal} onOpenChange={setShowNfModal}>
        <DialogContent
          className={cn(
            'max-h-[90vh] overflow-y-auto',
            nfStep === 'preview' ? 'max-w-4xl' : 'max-w-3xl',
          )}
        >
          {nfStep === 'preview' ? (
            <>
              <DialogHeader>
                <DialogTitle>Espelho da Nota Fiscal</DialogTitle>
                <DialogDescription>
                  Venda {vendaAtual?.numero_venda} · {vendaAtual?.cliente?.nome || 'Sem cliente'} —
                  revise o que já foi faturado em notas anteriores antes de emitir uma nova.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                {(vendaAtual?.notas_fiscais?.length ?? 0) > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Notas já emitidas</Label>
                    <div className="border rounded-lg divide-y">
                      {vendaAtual!.notas_fiscais.map((nf) => (
                        <div
                          key={nf.id}
                          className="flex items-center justify-between px-3 py-2 text-sm"
                        >
                          <span>
                            NF {nf.numero_nf}
                            {nf.data_emissao
                              ? ` · ${new Date(nf.data_emissao).toLocaleDateString('pt-BR')}`
                              : ''}
                          </span>
                          <span className="text-muted-foreground">
                            {nf.nome_destinatario || 'Cliente da venda'} ·{' '}
                            {formatCurrency(nf.valor)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {vendaAtual && (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">
                      Espelho — estrutura de DANFE (documento interno, sem valor fiscal)
                    </Label>
                    <DanfePreview
                      venda={vendaAtual}
                      itensDisponiveis={itensDisponiveis}
                      numeroNf={numeroNf}
                      serie={serie}
                    />
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowNfModal(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => setNfStep('form')}
                  disabled={itensDisponiveis.every(({ disponivel }) => disponivel <= 0)}
                >
                  Continuar para emissão
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Emitir Nota Fiscal</DialogTitle>
                <DialogDescription>
                  Venda {vendaAtual?.numero_venda} · {vendaAtual?.cliente?.nome || 'Sem cliente'} ·
                  Registro manual — a emissão real via Focus NFe é a SPEC-154.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 py-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>
                      Número da NF <span className="text-red-500">*</span>
                    </Label>
                    <Input value={numeroNf} onChange={(e) => setNumeroNf(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Série</Label>
                    <Input value={serie} onChange={(e) => setSerie(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Data de Emissão</Label>
                    <Input
                      type="date"
                      value={dataEmissao}
                      onChange={(e) => setDataEmissao(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Tipo</Label>
                    <Select value={tipoOperacao} onValueChange={setTipoOperacao}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CR">Contas a Receber</SelectItem>
                        <SelectItem value="CP">Contas a Pagar</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Perfil</Label>
                    <Select value={perfil} onValueChange={setPerfil}>
                      <SelectTrigger>
                        <SelectValue placeholder="Não informado" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ribeirao">Ribeirão</SelectItem>
                        <SelectItem value="sao_paulo">São Paulo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Fornecedor</Label>
                    <Input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} />
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border p-4">
                  <Label className="text-sm font-semibold">Pagador desta nota</Label>
                  <p className="text-xs text-muted-foreground">
                    Nota fiscal parcial pode ser emitida em nome de uma pessoa diferente do titular
                    da venda (ex. cônjuge sem cadastro), sem alterar o titular da venda em si.
                  </p>
                  <RadioGroup
                    value={pagadorModo}
                    onValueChange={(v) => setPagadorModo(v as typeof pagadorModo)}
                    className="gap-3"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="venda" id="pagador-venda" />
                      <Label htmlFor="pagador-venda" className="font-normal cursor-pointer">
                        Cliente da venda ({vendaAtual?.cliente?.nome || 'sem cliente cadastrado'})
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="cadastrado" id="pagador-cadastrado" />
                      <Label htmlFor="pagador-cadastrado" className="font-normal cursor-pointer">
                        Outro contato cadastrado
                      </Label>
                    </div>
                    {pagadorModo === 'cadastrado' && (
                      <div className="ml-6 space-y-2">
                        <Input
                          placeholder="Buscar por nome..."
                          value={buscaContato}
                          onChange={(e) => {
                            setBuscaContato(e.target.value)
                            setContatoSelecionado(null)
                          }}
                        />
                        {contatoSelecionado ? (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700">
                            Selecionado: {contatoSelecionado.nome}
                          </Badge>
                        ) : (
                          contatosEncontrados.length > 0 && (
                            <div className="max-h-40 overflow-y-auto border rounded-md divide-y">
                              {contatosEncontrados.map((c) => (
                                <button
                                  type="button"
                                  key={c.id}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                                  onClick={() => {
                                    setContatoSelecionado(c)
                                    setBuscaContato(c.nome)
                                    setContatosEncontrados([])
                                  }}
                                >
                                  {c.nome}
                                </button>
                              ))}
                            </div>
                          )
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="livre" id="pagador-livre" />
                      <Label htmlFor="pagador-livre" className="font-normal cursor-pointer">
                        Nome livre (sem cadastro)
                      </Label>
                    </div>
                    {pagadorModo === 'livre' && (
                      <div className="ml-6">
                        <Input
                          placeholder="Nome do pagador"
                          value={nomeDestinatario}
                          onChange={(e) => setNomeDestinatario(e.target.value)}
                        />
                      </div>
                    )}
                  </RadioGroup>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Itens</Label>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50">
                          <TableHead>Descrição</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Já faturado</TableHead>
                          <TableHead className="text-right">Disponível</TableHead>
                          <TableHead className="text-right w-32">Faturar nesta nota</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {itensDisponiveis.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={6}
                              className="text-center py-6 text-muted-foreground"
                            >
                              Nenhum item nesta venda.
                            </TableCell>
                          </TableRow>
                        ) : (
                          itensDisponiveis.map(({ item, faturado, disponivel, unitario }) => (
                            <TableRow key={item.id}>
                              <TableCell className="text-sm">{item.descricao || '-'}</TableCell>
                              <TableCell className="text-right">{item.quantidade}</TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {faturado}
                              </TableCell>
                              <TableCell className="text-right">{disponivel}</TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  min={0}
                                  max={disponivel}
                                  step="0.001"
                                  disabled={disponivel <= 0}
                                  value={quantidades[item.id] ?? ''}
                                  onChange={(e) =>
                                    handleQuantidadeChange(item.id, disponivel, e.target.value)
                                  }
                                  className="text-right"
                                />
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs">
                                {formatCurrency(Number(quantidades[item.id] || 0) * unitario)}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="text-right text-sm font-semibold">
                    Total desta nota: {formatCurrency(valorTotalSelecionado)}
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setNfStep('preview')}>
                  Voltar ao espelho
                </Button>
                <Button onClick={handleRegistrar} disabled={submitting}>
                  {submitting ? 'Registrando...' : 'Registrar Nota Fiscal'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
