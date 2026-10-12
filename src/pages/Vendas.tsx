import { useEffect, useMemo, useState } from 'react'
import { semPrefixo } from '@/lib/numeros'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import { redirectWithCode } from '@/lib/cross-system-auth'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'
import { emitirNotaFiscal, type EmitirNotaFiscalErroPreValidacao } from '@/lib/focus-nfe'
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
import {
  FileText,
  ExternalLink,
  ShoppingCart,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Search,
} from 'lucide-react'
import { DanfePreview } from '@/components/vendas/DanfePreview'

// SPEC-153: Financeiro/Admin Bancária continua sendo o dono real de
// boletos — Vendas só navega até lá (os boletos já nasceram na aprovação do
// orçamento, `aprovar_orcamento_financeiro`, com status='pendente_registro').
const FINANCEIRO_URL = 'https://retorno-bancario-bradesco-5392a.goskip.app'

// SPEC-153 (2026-09-17): dados fiscais do produto usados só no espelho
// (DANFE visual) -- NCM/CST confirmados em `produtos` (SPEC-132),
// `tem_st` usado na heurística provisória de CFOP (ver DanfePreview.tsx). SPEC-193 C2: o % de ST
// é só da Administração; o espelho só precisa saber se a peça tem ST.
export interface ProdutoFiscal {
  id: string
  nome: string | null
  sku: string | null
  codigo_produto: number | null
  referencia: string | null
  ncm: string | null
  cst: string | null
  unidade: string | null
  tem_st: boolean | null
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

// SPEC-154 (2026-09-21): campos de controle de emissão real via Focus NFe,
// adicionados a `notas_fiscais` pela migration
// `20260921_154_focus_nfe_integracao/001`. `status_emissao` é o CHECK
// constraint real: 'nao_emitida'|'processando_autorizacao'|'autorizado'|
// 'erro_autorizacao'|'cancelado'.
interface NotaFiscal {
  id: string
  numero_nf: string
  valor: number | null
  data_emissao: string | null
  cliente_id: string | null
  nome_destinatario: string | null
  notas_fiscais_itens: NotaFiscalItem[]
  status_emissao: string | null
  status_sefaz: string | null
  mensagem_sefaz: string | null
  chave_nfe: string | null
  arquivo_url: string | null
  ref: string | null
  created_at: string | null
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

// SPEC-154: nota mais recente de uma venda, por `created_at` -- usada só
// pra decidir se o status de emissão em andamento/erro precisa aparecer na
// listagem principal (não muda a lógica de cobertura de itens abaixo).
function notaMaisRecente(notas: NotaFiscal[]): NotaFiscal | null {
  if (!notas || notas.length === 0) return null
  return [...notas].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0
    return tb - ta
  })[0]
}

function statusNota(venda: Venda): { label: string; className: string } {
  if (!venda.orcamento_itens || venda.orcamento_itens.length === 0) {
    return { label: 'Sem itens', className: 'bg-slate-50 text-slate-500' }
  }
  if (!venda.notas_fiscais || venda.notas_fiscais.length === 0) {
    // Reunião de 05/10 [00:00]: sem repetir "Nota" — a coluna já diz o que é.
    return { label: 'Pendente', className: 'bg-amber-50 text-amber-700' }
  }

  // SPEC-154 (2026-09-21): estende o status pra refletir `status_emissao`
  // real da nota mais recente quando ela está num estado que precisa de
  // atenção -- aditivo, não substitui a lógica original de
  // completa/parcial/pendente abaixo quando a nota mais recente já está
  // resolvida (autorizada, ou ainda nem tentou emitir de verdade).
  const recente = notaMaisRecente(venda.notas_fiscais)
  if (recente?.status_emissao === 'processando_autorizacao') {
    return { label: 'Processando emissão', className: 'bg-blue-50 text-blue-700' }
  }
  if (recente?.status_emissao === 'erro_autorizacao') {
    return { label: 'Erro na emissão', className: 'bg-red-50 text-red-700' }
  }

  const completa = venda.orcamento_itens.every(
    (item) => jaFaturado(item, venda.notas_fiscais) >= Number(item.quantidade) - 1e-6,
  )
  return completa
    ? { label: 'Emitida', className: 'bg-emerald-50 text-emerald-700' }
    : { label: 'Parcial', className: 'bg-sky-50 text-sky-700' }
}

// SPEC-154 (2026-09-21): resultado normalizado do passo "Confirmar e Emitir
// via Focus NFe", derivado da resposta de `emitir-nota-fiscal` (ver
// `src/lib/focus-nfe.ts`) + releitura de `notas_fiscais` para os campos que
// a Edge Function não repete na resposta (chave_nfe/arquivo_url/numero_nf,
// gravados por `aplicarStatusFocusNaNota`).
type EmissaoResultado =
  | { tipo: 'sucesso'; chaveNfe: string | null; arquivoUrl: string | null; numeroNf: string | null }
  | { tipo: 'processando'; ref: string | null }
  | { tipo: 'pre_validacao_interna'; bloqueantes: string[] }
  | { tipo: 'pre_validacao_focus'; erros: EmitirNotaFiscalErroPreValidacao[] }
  | { tipo: 'configuracao'; mensagem: string }
  | { tipo: 'retry_esgotado'; mensagem: string }
  | { tipo: 'erro_generico'; mensagem: string }

export default function Vendas() {
  const { toast } = useToast()
  const { session } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [vendas, setVendas] = useState<Venda[]>([])
  const [loading, setLoading] = useState(true)
  // SPEC-176: busca (venda, cliente, projeto, empresa) + filtro por empresa
  // faturada, aplicados juntos.
  const [busca, setBusca] = useState('')
  const [empresaFiltro, setEmpresaFiltro] = useState('todas')

  const [showNfModal, setShowNfModal] = useState(false)
  // SPEC-153 (pedido do usuário, 2026-09-17): "Emitir Nota Fiscal" abre
  // primeiro um espelho/pré-visualização da nota cheia (igual ao processo
  // manual descrito na reunião: "tirar um espelho da nota fiscal cheia" e
  // ir marcando o que já saiu) -- só depois de revisar isso é que o
  // formulário de preenchimento (número, pagador, quantidade por item)
  // aparece.
  // SPEC-154: novo passo 'emissao' depois que o rascunho já foi criado por
  // `registrar_nota_fiscal_parcial` -- mostra o resultado de
  // "Confirmar e Emitir via Focus NFe".
  const [nfStep, setNfStep] = useState<'preview' | 'form' | 'emissao'>('preview')
  const [vendaAtual, setVendaAtual] = useState<Venda | null>(null)
  const [quantidades, setQuantidades] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  // SPEC-154: id da nota fiscal (rascunho) já criada nesta sessão do modal,
  // usado pra chamar `emitir-nota-fiscal`.
  const [notaFiscalIdAtual, setNotaFiscalIdAtual] = useState<string | null>(null)
  const [emitindo, setEmitindo] = useState(false)
  const [resultadoEmissao, setResultadoEmissao] = useState<EmissaoResultado | null>(null)

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
        orcamento_itens(id, quantidade, preco_unitario, desconto, descricao, produto:produtos(id, nome, sku, codigo_produto, referencia, ncm, cst, unidade, tem_st)),
        notas_fiscais(id, numero_nf, valor, data_emissao, cliente_id, nome_destinatario, status_emissao, status_sefaz, mensagem_sefaz, chave_nfe, arquivo_url, ref, created_at, notas_fiscais_itens(id, orcamento_item_id, quantidade_faturada, valor_faturado))
      `,
      )
      .eq('status', 'Orçamento Aprovado')
      .eq('natureza_operacao', 'venda')
      // SPEC-195: venda vinculada da Connect já tem nota emitida lá — não entra aqui.
      .eq('vinculo_connect', false)
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

  // SPEC-154: mantém `vendaAtual` (usado pelo modal já aberto) em sincronia
  // sempre que a listagem é atualizada -- necessário porque o modal agora
  // permanece aberto depois de registrar/emitir uma nota (passo 'emissao'),
  // então o `venda` capturado em `abrirModalNf` ficaria desatualizado sem
  // isso (ex.: "disponível" de cada item, status_emissao da nota recém-criada).
  useEffect(() => {
    setVendaAtual((atual) => {
      if (!atual) return atual
      const atualizada = vendas.find((v) => v.id === atual.id)
      return atualizada || atual
    })
  }, [vendas])

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
    setNotaFiscalIdAtual(null)
    setResultadoEmissao(null)
    setShowNfModal(true)
  }

  // SPEC-154: navegação vinda da tela "Pendências de Nota Fiscal"
  // (`?venda=<orcamento_id>`) -- abre direto o espelho daquela venda.
  useEffect(() => {
    const vendaId = searchParams.get('venda')
    if (!vendaId || loading || vendas.length === 0) return
    const alvo = vendas.find((v) => v.id === vendaId)
    if (alvo) {
      abrirModalNf(alvo)
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('venda')
        return next
      },
      { replace: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, vendas, loading])

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
      const { data, error } = await (supabase as any).rpc('registrar_nota_fiscal_parcial', {
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

      toast({ title: 'Nota fiscal registrada como rascunho' })
      // SPEC-154: não fecha mais o modal aqui -- a nota nasce como rascunho
      // (`status_emissao='nao_emitida'`), o próximo passo é o usuário
      // confirmar a emissão real via Focus NFe.
      setNotaFiscalIdAtual(data?.nota_fiscal_id ?? null)
      setResultadoEmissao(null)
      setNfStep('emissao')
      fetchVendas()
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro ao registrar nota', description: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  // SPEC-154 (2026-09-21, achado do revisor): `registrar_nota_fiscal_parcial`
  // sempre INSERE uma nota+itens nova -- nunca atualiza um rascunho
  // existente. Sem isto, um rascunho rejeitado (pré-validação, config,
  // retry esgotado) ou abandonado (fechado sem confirmar) continuava
  // contando pra sempre em `jaFaturado()` (soma por TODAS as notas,
  // independente de status), prendendo a quantidade "disponível" da venda
  // mesmo sem nenhuma nota de fato autorizada pela SEFAZ. Cancela (deleta)
  // o rascunho -- `notas_fiscais_itens` cai junto via ON DELETE CASCADE
  // (migration 20260917_153.../001) -- sempre que o usuário sai do passo de
  // emissão sem uma nota autorizada/em processamento de verdade.
  const cancelarRascunhoSeNecessario = async () => {
    if (!notaFiscalIdAtual) return
    const tipo = resultadoEmissao?.tipo
    // Nunca cancela uma nota que já foi de fato enviada à Focus (autorizada
    // ou em processamento) -- só rascunhos que nunca saíram do nosso banco
    // ou que voltaram rejeitados antes/depois do envio.
    if (tipo === 'sucesso' || tipo === 'processando') return

    const idParaCancelar = notaFiscalIdAtual
    const { error } = await supabase.from('notas_fiscais').delete().eq('id', idParaCancelar)
    if (error) {
      console.error('[Vendas] falha ao cancelar rascunho de nota fiscal:', error)
      toast({
        variant: 'destructive',
        title: 'Não foi possível liberar o rascunho anterior',
        description: 'A quantidade dessa nota pode continuar indisponível até isso ser resolvido.',
      })
      return
    }
    await fetchVendas()
  }

  // SPEC-154 (2026-09-21): chama a Edge Function `emitir-nota-fiscal` para a
  // nota (rascunho) criada acima. Trata os 6 formatos de resposta
  // documentados em `emitir-nota-fiscal/index.ts` -- ver `EmissaoResultado`.
  const handleConfirmarEmissao = async () => {
    if (!notaFiscalIdAtual) return
    if (!session?.access_token) {
      toast({
        variant: 'destructive',
        title: 'Sessão expirada',
        description: 'Faça login novamente para emitir a nota fiscal.',
      })
      return
    }

    setEmitindo(true)
    setResultadoEmissao(null)
    try {
      const { ok, status, body } = await emitirNotaFiscal(notaFiscalIdAtual, session.access_token)

      if (!ok) {
        if (status === 409 && body?.status_emissao === 'autorizado') {
          // Nota já autorizada (ex. clique duplo) -- não é bem um "erro".
          setResultadoEmissao({ tipo: 'sucesso', chaveNfe: null, arquivoUrl: null, numeroNf: null })
        } else if (status === 409 && body?.status_emissao === 'processando_autorizacao') {
          setResultadoEmissao({ tipo: 'processando', ref: null })
        } else if (status === 409) {
          // Cancelada, ou outro 409 inesperado -- mostra a mensagem literal
          // da Edge Function em vez de forçar num dos estados conhecidos.
          setResultadoEmissao({
            tipo: 'erro_generico',
            mensagem: body?.error || 'Esta nota não pode ser (re)emitida no estado atual.',
          })
        } else if (body?.tipo === 'configuracao') {
          setResultadoEmissao({
            tipo: 'configuracao',
            mensagem: body.error || 'Erro de configuração na Focus NFe (token/CNPJ).',
          })
        } else {
          setResultadoEmissao({
            tipo: 'erro_generico',
            mensagem: body?.error || 'Erro inesperado ao emitir a nota fiscal.',
          })
        }
        return
      }

      if (body?.tipo === 'pre_validacao_interna') {
        setResultadoEmissao({ tipo: 'pre_validacao_interna', bloqueantes: body.bloqueantes || [] })
        return
      }
      if (body?.tipo === 'pre_validacao_focus') {
        setResultadoEmissao({ tipo: 'pre_validacao_focus', erros: body.erros || [] })
        return
      }
      if (body?.tipo === 'configuracao') {
        setResultadoEmissao({
          tipo: 'configuracao',
          mensagem: body.mensagem || 'Erro de configuração na Focus NFe (token/CNPJ).',
        })
        return
      }
      if (body?.tipo === 'retry_esgotado') {
        setResultadoEmissao({
          tipo: 'retry_esgotado',
          mensagem: body.mensagem || 'Focus NFe indisponível. Tente novamente em alguns minutos.',
        })
        return
      }

      // Caminho de sucesso (201/202 da Focus) -- a resposta da Edge Function
      // só traz `status_emissao`/`ref`, não repete chave_nfe/arquivo_url
      // (gravados direto em `notas_fiscais` por `aplicarStatusFocusNaNota`).
      // Relê a nota pra pegar esses campos e mostrar de fato o que foi
      // gravado.
      const { data: notaAtualizada, error: erroRefetch } = await supabase
        .from('notas_fiscais')
        .select('status_emissao, mensagem_sefaz, chave_nfe, arquivo_url, numero_nf')
        .eq('id', notaFiscalIdAtual)
        .maybeSingle()

      if (erroRefetch) {
        // Achado do revisor (2026-09-21): não deixa a UI mostrar um card de
        // sucesso silenciosamente incompleto (sem chave/arquivo) sem
        // explicar por quê -- loga e avisa, mas não trata como falha de
        // emissão (a nota já foi processada pela Focus, só não conseguimos
        // reler os detalhes agora).
        console.error('[Vendas] falha ao reler notas_fiscais após emissão:', erroRefetch)
        toast({
          title: 'Nota processada, mas os detalhes não carregaram',
          description: 'Confira o status atualizado na listagem principal em instantes.',
        })
      }

      const statusFinal = (notaAtualizada as any)?.status_emissao || body?.status_emissao

      if (statusFinal === 'autorizado') {
        setResultadoEmissao({
          tipo: 'sucesso',
          chaveNfe: (notaAtualizada as any)?.chave_nfe ?? null,
          arquivoUrl: (notaAtualizada as any)?.arquivo_url ?? null,
          numeroNf: (notaAtualizada as any)?.numero_nf ?? null,
        })
      } else if (statusFinal === 'processando_autorizacao') {
        setResultadoEmissao({ tipo: 'processando', ref: body?.ref ?? null })
      } else {
        // status_emissao voltou 'erro_autorizacao' mesmo no caminho HTTP de
        // sucesso (ex. Focus respondeu 201 já com status rejeitado/denegado)
        // -- mostra o que temos, histórico completo fica em
        // "Pendências de Nota Fiscal".
        setResultadoEmissao({
          tipo: 'erro_generico',
          mensagem:
            (notaAtualizada as any)?.mensagem_sefaz ||
            'A Focus NFe rejeitou a emissão. Veja "Pendências de Nota Fiscal" para detalhes.',
        })
      }

      fetchVendas()
    } catch (err: any) {
      setResultadoEmissao({
        tipo: 'erro_generico',
        mensagem: err?.message || 'Erro de rede ao emitir a nota fiscal.',
      })
    } finally {
      setEmitindo(false)
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

  const empresasFaturadas = useMemo(() => {
    const porId = new Map<string, string>()
    vendas.forEach((v) => {
      if (v.empresa?.id) porId.set(v.empresa.id, v.empresa.nome || 'Sem nome')
    })
    return [...porId.entries()]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome))
  }, [vendas])

  const vendasFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return vendas.filter((v) => {
      if (empresaFiltro !== 'todas' && v.empresa?.id !== empresaFiltro) return false
      if (!termo) return true
      return [
        v.numero_venda,
        v.numero,
        v.cliente?.nome,
        v.projeto?.codigo,
        v.projeto?.nome,
        v.empresa?.nome,
      ].some((campo) => (campo || '').toLowerCase().includes(termo))
    })
  }, [vendas, busca, empresaFiltro])

  return (
    // Reunião de 05/10 [00:47]: a lista ocupa a tela de ponta a ponta.
    <div className="flex flex-col gap-6 animate-fade-in pb-20 w-full">
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

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por número da venda, cliente, projeto ou empresa..."
            className="pl-9 bg-white"
          />
        </div>
        <Select value={empresaFiltro} onValueChange={setEmpresaFiltro}>
          <SelectTrigger className="w-full sm:w-64 bg-white">
            <SelectValue placeholder="Empresa faturada" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as empresas</SelectItem>
            {empresasFaturadas.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Reunião de 05/10 [00:28]–[01:10]: uma linha por venda (texto longo
          cortado com "…", completo ao passar o mouse), letra um pouco menor e sem
          a coluna do orçamento — fica só o número da venda. */}
      <div className="bg-white rounded-xl border shadow-sm overflow-x-auto">
        <Table className="text-[13px] [&_td]:whitespace-nowrap [&_td]:py-2 [&_th]:whitespace-nowrap">
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Venda</TableHead>
              <TableHead>Empresa Faturada</TableHead>
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
            ) : vendasFiltradas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  {vendas.length === 0
                    ? 'Nenhuma venda (orçamento aprovado) encontrada.'
                    : 'Nenhuma venda encontrada com essa busca/empresa.'}
                </TableCell>
              </TableRow>
            ) : (
              vendasFiltradas.map((venda) => {
                const status = statusNota(venda)
                return (
                  <TableRow key={venda.id}>
                    <TableCell className="font-mono font-medium">
                      {semPrefixo(venda.numero_venda) || '-'}
                    </TableCell>
                    <TableCell>{venda.empresa?.nome || '-'}</TableCell>
                    <TableCell
                      className="max-w-[320px] truncate"
                      title={venda.cliente?.nome || undefined}
                    >
                      {venda.cliente?.nome || '-'}
                    </TableCell>
                    <TableCell
                      className="max-w-[300px] truncate text-slate-600"
                      title={
                        venda.projeto?.codigo
                          ? `${venda.projeto.codigo} — ${venda.projeto.nome}`
                          : venda.projeto?.nome || undefined
                      }
                    >
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
                        disabled={
                          status.label === 'Emitida' ||
                          status.label === 'Sem itens' ||
                          status.label === 'Processando emissão'
                        }
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

      <Dialog
        open={showNfModal}
        onOpenChange={(open) => {
          // Fechar clicando fora/Esc precisa do mesmo cuidado do botão
          // "Fechar" -- senão um clique acidental fora do modal também
          // deixaria um rascunho órfão preso.
          if (!open) {
            void cancelarRascunhoSeNecessario()
          }
          setShowNfModal(open)
        }}
      >
        <DialogContent
          className={cn(
            'max-h-[90vh] overflow-y-auto',
            nfStep === 'preview' ? 'max-w-4xl' : nfStep === 'form' ? 'max-w-3xl' : 'max-w-lg',
          )}
        >
          {nfStep === 'preview' ? (
            <>
              <DialogHeader>
                <DialogTitle>Espelho da Nota Fiscal</DialogTitle>
                <DialogDescription>
                  Venda {semPrefixo(vendaAtual?.numero_venda)} ·{' '}
                  {vendaAtual?.cliente?.nome || 'Sem cliente'} — revise o que já foi faturado em
                  notas anteriores antes de emitir uma nova.
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
                          <span className="flex items-center gap-2">
                            NF {nf.numero_nf}
                            {nf.data_emissao
                              ? ` · ${new Date(nf.data_emissao).toLocaleDateString('pt-BR')}`
                              : ''}
                            {/* SPEC-154: status_emissao real (Focus NFe) por nota */}
                            {nf.status_emissao && nf.status_emissao !== 'nao_emitida' && (
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-[10px]',
                                  nf.status_emissao === 'autorizado' &&
                                    'bg-emerald-50 text-emerald-700',
                                  nf.status_emissao === 'processando_autorizacao' &&
                                    'bg-blue-50 text-blue-700',
                                  nf.status_emissao === 'erro_autorizacao' &&
                                    'bg-red-50 text-red-700',
                                  nf.status_emissao === 'cancelado' &&
                                    'bg-slate-100 text-slate-600',
                                )}
                              >
                                {nf.status_emissao === 'autorizado' && 'Autorizado'}
                                {nf.status_emissao === 'processando_autorizacao' && 'Processando'}
                                {nf.status_emissao === 'erro_autorizacao' && 'Erro na emissão'}
                                {nf.status_emissao === 'cancelado' && 'Cancelado'}
                              </Badge>
                            )}
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
          ) : nfStep === 'form' ? (
            <>
              <DialogHeader>
                <DialogTitle>Emitir Nota Fiscal</DialogTitle>
                <DialogDescription>
                  Venda {semPrefixo(vendaAtual?.numero_venda)} ·{' '}
                  {vendaAtual?.cliente?.nome || 'Sem cliente'} · Preencha os dados do rascunho — a
                  emissão real via Focus NFe (SPEC-154) é confirmada no próximo passo.
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
                  {submitting ? 'Registrando...' : 'Registrar Nota Fiscal (rascunho)'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              {/* SPEC-154 (2026-09-21): passo "emissão" — depois do rascunho já
                  criado (registrar_nota_fiscal_parcial), confirma a emissão
                  real via Focus NFe e mostra o resultado de cada um dos
                  formatos de resposta documentados em
                  emitir-nota-fiscal/index.ts. */}
              <DialogHeader>
                <DialogTitle>Emissão via Focus NFe</DialogTitle>
                <DialogDescription>
                  Venda {semPrefixo(vendaAtual?.numero_venda)} ·{' '}
                  {vendaAtual?.cliente?.nome || 'Sem cliente'} — nota registrada como rascunho,
                  ainda não transmitida à SEFAZ.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                {!resultadoEmissao && !emitindo && (
                  <div className="rounded-lg border p-4 bg-slate-50 text-sm text-slate-700 space-y-2">
                    <p>
                      A nota fiscal foi registrada como rascunho (ambiente de homologação até a
                      validação de CFOP com o contador). Confirme para transmitir de fato à Focus
                      NFe.
                    </p>
                  </div>
                )}

                {emitindo && (
                  <div className="rounded-lg border p-6 flex flex-col items-center gap-2 text-sm text-slate-600">
                    <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
                    Enviando para a Focus NFe...
                  </div>
                )}

                {!emitindo && resultadoEmissao?.tipo === 'processando' && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 flex gap-3 text-sm text-blue-800">
                    <Clock className="h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-semibold">Processando autorização...</p>
                      <p>
                        A Focus NFe está processando a nota
                        {resultadoEmissao.ref ? ` (ref ${resultadoEmissao.ref})` : ''}. O status
                        final chega automaticamente por webhook (ou pelo job de verificação, em até
                        10 minutos) — pode fechar esta janela e acompanhar pela listagem principal.
                      </p>
                    </div>
                  </div>
                )}

                {!emitindo && resultadoEmissao?.tipo === 'sucesso' && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 flex gap-3 text-sm text-emerald-800">
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                    <div className="space-y-1">
                      <p className="font-semibold">Nota fiscal autorizada.</p>
                      {resultadoEmissao.numeroNf && <p>Número: {resultadoEmissao.numeroNf}</p>}
                      {resultadoEmissao.chaveNfe && (
                        <p className="font-mono text-xs break-all">
                          Chave: {resultadoEmissao.chaveNfe}
                        </p>
                      )}
                      {resultadoEmissao.arquivoUrl && (
                        <a
                          href={resultadoEmissao.arquivoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 underline font-medium"
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> Ver XML/DANFE
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {!emitindo && resultadoEmissao?.tipo === 'pre_validacao_interna' && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-2">
                    <div className="flex gap-2 items-center font-semibold">
                      <AlertTriangle className="h-5 w-5 shrink-0" />
                      Cadastro incompleto — não chegou a ser enviado à Focus NFe
                    </div>
                    <ul className="list-disc pl-6 space-y-1">
                      {resultadoEmissao.bloqueantes.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {!emitindo && resultadoEmissao?.tipo === 'pre_validacao_focus' && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-2">
                    <div className="flex gap-2 items-center font-semibold">
                      <AlertTriangle className="h-5 w-5 shrink-0" />
                      Focus NFe rejeitou os dados enviados (pré-validação)
                    </div>
                    <ul className="list-disc pl-6 space-y-1">
                      {resultadoEmissao.erros.length === 0 ? (
                        <li>
                          Erro de validação sem detalhamento — ver "Pendências de Nota Fiscal".
                        </li>
                      ) : (
                        resultadoEmissao.erros.map((e, i) => (
                          <li key={i}>
                            {e.campo && <span className="font-mono">{e.campo}</span>}
                            {e.campo ? ': ' : ''}
                            {e.mensagem}
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                )}

                {!emitindo && resultadoEmissao?.tipo === 'configuracao' && (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 flex gap-3 text-sm text-orange-800">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-semibold">Problema de configuração — não é a venda</p>
                      <p>{resultadoEmissao.mensagem}</p>
                    </div>
                  </div>
                )}

                {!emitindo && resultadoEmissao?.tipo === 'retry_esgotado' && (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 flex gap-3 text-sm text-orange-800">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-semibold">Focus NFe indisponível</p>
                      <p>{resultadoEmissao.mensagem}</p>
                    </div>
                  </div>
                )}

                {!emitindo && resultadoEmissao?.tipo === 'erro_generico' && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex gap-3 text-sm text-red-800">
                    <XCircle className="h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-semibold">Erro ao emitir</p>
                      <p>{resultadoEmissao.mensagem}</p>
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2">
                {(!resultadoEmissao ||
                  resultadoEmissao.tipo === 'retry_esgotado' ||
                  resultadoEmissao.tipo === 'configuracao') && (
                  <Button onClick={handleConfirmarEmissao} disabled={emitindo}>
                    {emitindo
                      ? 'Enviando...'
                      : resultadoEmissao
                        ? 'Tentar novamente'
                        : 'Confirmar e Emitir via Focus NFe'}
                  </Button>
                )}
                {(resultadoEmissao?.tipo === 'pre_validacao_interna' ||
                  resultadoEmissao?.tipo === 'pre_validacao_focus') && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      // Cancela o rascunho rejeitado ANTES de voltar pro
                      // formulário -- senão o próximo "Registrar Nota
                      // Fiscal" cria um segundo rascunho e o primeiro fica
                      // pra sempre contando como "já faturado" (achado do
                      // revisor, ver cancelarRascunhoSeNecessario acima).
                      await cancelarRascunhoSeNecessario()
                      setNotaFiscalIdAtual(null)
                      setResultadoEmissao(null)
                      setNfStep('form')
                    }}
                  >
                    Corrigir e tentar novamente
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={async () => {
                    await cancelarRascunhoSeNecessario()
                    setShowNfModal(false)
                  }}
                >
                  Fechar
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
