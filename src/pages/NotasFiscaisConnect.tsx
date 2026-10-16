// SPEC-204 (2026-10-15): tela "Notas Fiscais Connect" -- consulta das NF-e emitidas pela Connect,
// importadas dos XMLs por `scripts/importar_nfe_connect.py` (repo central) para
// `notas_fiscais_connect` (+ itens, duplicatas, eventos). Só leitura: nada aqui grava no banco.
// Separada de `notas_fiscais`, que são as notas que este sistema emite pela Focus NFe.
import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { formatarChaveAcesso } from '@/lib/danfe'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { FileText, Search } from 'lucide-react'

interface NotaConnect {
  id: string
  chave_nfe: string
  numero: number
  serie: number | null
  data_emissao: string
  natureza_operacao: string | null
  cfop_principal: string | null
  destinatario_tipo: string | null
  destinatario_documento: string | null
  destinatario_nome: string | null
  destinatario_municipio: string | null
  destinatario_uf: string | null
  valor_produtos: number | null
  valor_desconto: number | null
  valor_frete: number | null
  valor_outros: number | null
  valor_icms: number | null
  valor_st: number | null
  valor_ipi: number | null
  valor_total: number
  forma_pagamento: string | null
  informacoes_complementares: string | null
  protocolo: string | null
  data_autorizacao: string | null
  situacao: 'autorizada' | 'cancelada'
  cancelada_em: string | null
  empresa: { nome: string } | null
  cliente: { nome: string } | null
  itens: { count: number }[]
  eventos: { tipo_evento: string }[]
}

interface ItemNota {
  numero_item: number
  codigo_produto: string | null
  descricao: string | null
  ncm: string | null
  cfop: string | null
  unidade: string | null
  quantidade: number | null
  valor_unitario: number | null
  valor_total: number | null
}

interface Duplicata {
  numero: string
  vencimento: string | null
  valor: number | null
}

interface Evento {
  tipo_evento: string
  descricao: string | null
  sequencia: number
  data_evento: string | null
  correcao: string | null
  justificativa: string | null
  protocolo: string | null
}

const CARTA_CORRECAO = '110110'

// As tabelas da SPEC-204 ainda não estão nos tipos gerados do client (src/lib/supabase/types.ts).
const db = supabase as unknown as SupabaseClient

const FORMAS_PAGAMENTO: Record<string, string> = {
  '01': 'Dinheiro',
  '02': 'Cheque',
  '03': 'Cartão de crédito',
  '04': 'Cartão de débito',
  '05': 'Crédito loja',
  '14': 'Duplicata',
  '15': 'Boleto',
  '16': 'Depósito',
  '17': 'PIX',
  '18': 'Transferência',
  '90': 'Sem pagamento',
  '99': 'Outros',
}

const moeda = (v: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0)

const data = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-'

const documento = (tipo: string | null, doc: string | null) => {
  if (!doc) return ''
  if (tipo === 'CPF' && doc.length === 11)
    return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (tipo === 'CNPJ' && doc.length === 14)
    return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return doc
}

const mesDe = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7)

const nomeMes = (mes: string) => {
  const [ano, m] = mes.split('-').map(Number)
  const nome = new Date(ano, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' })
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${ano}`
}

// Só soma no valor a nota de VENDA autorizada (decisão do usuário, 15/10/2026). Venda = CFOP de venda
// (5101–5123, 5401–5405 e os 6xxx equivalentes). Remessa, devolução, retorno, industrialização,
// bonificação... aparecem na lista, mas não somam. 5411 (devolução de compra) fica de fora.
const ehVenda = (n: { cfop_principal: string | null }) =>
  /^[56](10[1-9]|11\d|12[0-3]|40[1-5])$/.test(n.cfop_principal || '')

const somaNoTotal = (n: NotaConnect) => n.situacao === 'autorizada' && ehVenda(n)

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export default function NotasFiscaisConnect() {
  const { toast } = useToast()
  const [notas, setNotas] = useState<NotaConnect[]>([])
  const [loading, setLoading] = useState(true)
  const [empresa, setEmpresa] = useState('todas')
  const [mes, setMes] = useState('todos')
  const [situacao, setSituacao] = useState('todas')
  const [busca, setBusca] = useState('')
  const [aberta, setAberta] = useState<NotaConnect | null>(null)

  useEffect(() => {
    const carregar = async () => {
      setLoading(true)
      // PostgREST devolve no máximo 1000 linhas por chamada: busca em páginas.
      const todas: NotaConnect[] = []
      for (let inicio = 0; ; inicio += 1000) {
        const { data: pagina, error } = await db
          .from('notas_fiscais_connect')
          .select(
            `id, chave_nfe, numero, serie, data_emissao, natureza_operacao, cfop_principal,
             destinatario_tipo, destinatario_documento, destinatario_nome, destinatario_municipio,
             destinatario_uf, valor_produtos, valor_desconto, valor_frete, valor_outros, valor_icms,
             valor_st, valor_ipi, valor_total, forma_pagamento, informacoes_complementares,
             protocolo, data_autorizacao, situacao, cancelada_em,
             empresa:empresas(nome), cliente:contatos(nome),
             itens:notas_fiscais_connect_itens(count),
             eventos:notas_fiscais_connect_eventos(tipo_evento)`,
          )
          .order('data_emissao', { ascending: false })
          .order('numero', { ascending: false })
          .range(inicio, inicio + 999)
        if (error) {
          toast({
            variant: 'destructive',
            title: 'Erro ao carregar as notas fiscais da Connect',
            description: error.message,
          })
          break
        }
        todas.push(...((pagina as unknown as NotaConnect[]) || []))
        if (!pagina || pagina.length < 1000) break
      }
      setNotas(todas)
      setLoading(false)
    }
    carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const empresas = useMemo(
    () => Array.from(new Set(notas.map((n) => n.empresa?.nome).filter(Boolean) as string[])).sort(),
    [notas],
  )
  const meses = useMemo(
    () =>
      Array.from(new Set(notas.map((n) => mesDe(n.data_emissao))))
        .sort()
        .reverse(),
    [notas],
  )

  const filtradas = useMemo(() => {
    const termo = semAcento(busca.trim())
    const termoDigitos = busca.replace(/\D/g, '')
    return notas.filter((n) => {
      if (empresa !== 'todas' && n.empresa?.nome !== empresa) return false
      if (mes !== 'todos' && mesDe(n.data_emissao) !== mes) return false
      if (situacao !== 'todas' && n.situacao !== situacao) return false
      if (!termo) return true
      return (
        String(n.numero).includes(termo) ||
        semAcento(n.destinatario_nome || '').includes(termo) ||
        semAcento(n.natureza_operacao || '').includes(termo) ||
        (termoDigitos.length >= 3 && (n.destinatario_documento || '').includes(termoDigitos))
      )
    })
  }, [notas, empresa, mes, situacao, busca])

  const vendas = filtradas.filter(somaNoTotal)
  const valorVendas = vendas.reduce((s, n) => s + (Number(n.valor_total) || 0), 0)
  const outras = filtradas.filter((n) => n.situacao === 'autorizada' && !ehVenda(n)).length
  const canceladas = filtradas.filter((n) => n.situacao === 'cancelada').length

  return (
    <div className="flex flex-col gap-6 animate-fade-in pb-20 w-full max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
          <FileText className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
            Notas Fiscais Connect
          </h1>
          <p className="text-sm text-muted-foreground">
            Notas fiscais emitidas pela Connect, importadas dos arquivos XML. Somente consulta.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <div className="text-sm text-muted-foreground">Notas de venda</div>
          <div className="text-2xl font-bold">{loading ? '—' : vendas.length}</div>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <div className="text-sm text-muted-foreground">Valor das vendas</div>
          <div className="text-2xl font-bold">{loading ? '—' : moeda(valorVendas)}</div>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <div className="text-sm text-muted-foreground">Outras operações</div>
          <div className="text-2xl font-bold">{loading ? '—' : outras}</div>
          <div className="text-xs text-muted-foreground">
            remessa, devolução, retorno... não somam
          </div>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <div className="text-sm text-muted-foreground">Canceladas</div>
          <div className="text-2xl font-bold">{loading ? '—' : canceladas}</div>
          <div className="text-xs text-muted-foreground">não somam no valor</div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9 bg-white"
            placeholder="Buscar por número, destinatário, CPF/CNPJ ou natureza"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Select value={empresa} onValueChange={setEmpresa}>
          <SelectTrigger className="md:w-56 bg-white">
            <SelectValue placeholder="Empresa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as empresas</SelectItem>
            {empresas.map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={mes} onValueChange={setMes}>
          <SelectTrigger className="md:w-52 bg-white">
            <SelectValue placeholder="Mês" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os meses</SelectItem>
            {meses.map((m) => (
              <SelectItem key={m} value={m}>
                {nomeMes(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={situacao} onValueChange={setSituacao}>
          <SelectTrigger className="md:w-44 bg-white">
            <SelectValue placeholder="Situação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            <SelectItem value="autorizada">Autorizadas</SelectItem>
            <SelectItem value="cancelada">Canceladas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-x-auto">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Número</TableHead>
              <TableHead>Emissão</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Destinatário</TableHead>
              <TableHead>Natureza</TableHead>
              <TableHead className="text-center">Itens</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : filtradas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {notas.length === 0
                    ? 'Nenhuma nota fiscal da Connect importada ainda.'
                    : 'Nenhuma nota encontrada com esses filtros.'}
                </TableCell>
              </TableRow>
            ) : (
              filtradas.map((n) => {
                const cartas = n.eventos.filter((e) => e.tipo_evento === CARTA_CORRECAO).length
                return (
                  <TableRow
                    key={n.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setAberta(n)}
                  >
                    <TableCell className="font-mono font-medium">{n.numero}</TableCell>
                    <TableCell className="whitespace-nowrap">{data(n.data_emissao)}</TableCell>
                    <TableCell className="text-sm">{n.empresa?.nome || '-'}</TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{n.destinatario_nome || '-'}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {documento(n.destinatario_tipo, n.destinatario_documento)}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{n.natureza_operacao || '-'}</TableCell>
                    <TableCell className="text-center">{n.itens[0]?.count ?? 0}</TableCell>
                    <TableCell
                      className={
                        n.situacao === 'cancelada'
                          ? 'text-right font-medium line-through text-muted-foreground'
                          : !ehVenda(n)
                            ? 'text-right text-muted-foreground'
                            : 'text-right font-medium'
                      }
                      title={somaNoTotal(n) ? undefined : 'Não soma no valor das vendas'}
                    >
                      {moeda(n.valor_total)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {n.situacao === 'cancelada' ? (
                          <Badge variant="outline" className="bg-red-50 text-red-700">
                            Cancelada
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700">
                            Autorizada
                          </Badge>
                        )}
                        {n.situacao === 'autorizada' && !ehVenda(n) && (
                          <Badge variant="outline" className="bg-slate-100 text-slate-600">
                            Não é venda · não soma
                          </Badge>
                        )}
                        {cartas > 0 && (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700">
                            {cartas === 1 ? 'Carta de correção' : `${cartas} cartas de correção`}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <DetalheNota nota={aberta} onClose={() => setAberta(null)} />
    </div>
  )
}

function DetalheNota({ nota, onClose }: { nota: NotaConnect | null; onClose: () => void }) {
  const { toast } = useToast()
  const [itens, setItens] = useState<ItemNota[]>([])
  const [duplicatas, setDuplicatas] = useState<Duplicata[]>([])
  const [eventos, setEventos] = useState<Evento[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!nota) return
    setLoading(true)
    Promise.all([
      db
        .from('notas_fiscais_connect_itens')
        .select(
          'numero_item, codigo_produto, descricao, ncm, cfop, unidade, quantidade, valor_unitario, valor_total',
        )
        .eq('nota_id', nota.id)
        .order('numero_item'),
      db
        .from('notas_fiscais_connect_duplicatas')
        .select('numero, vencimento, valor')
        .eq('nota_id', nota.id)
        .order('vencimento'),
      db
        .from('notas_fiscais_connect_eventos')
        .select(
          'tipo_evento, descricao, sequencia, data_evento, correcao, justificativa, protocolo',
        )
        .eq('nota_id', nota.id)
        .order('data_evento'),
    ]).then(([i, d, e]) => {
      const erro = i.error || d.error || e.error
      if (erro) {
        toast({
          variant: 'destructive',
          title: 'Erro ao carregar os detalhes da nota',
          description: erro.message,
        })
      }
      setItens((i.data as ItemNota[]) || [])
      setDuplicatas((d.data as Duplicata[]) || [])
      setEventos((e.data as Evento[]) || [])
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nota?.id])

  if (!nota) return null

  const valores: [string, number | null][] = [
    ['Produtos', nota.valor_produtos],
    ['Desconto', nota.valor_desconto],
    ['Frete', nota.valor_frete],
    ['Outras despesas', nota.valor_outros],
    ['ICMS', nota.valor_icms],
    ['ICMS ST', nota.valor_st],
    ['IPI', nota.valor_ipi],
  ]

  return (
    <Dialog open={!!nota} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Nota fiscal {nota.numero}
            {nota.serie != null && (
              <span className="text-sm font-normal text-muted-foreground">série {nota.serie}</span>
            )}
            {nota.situacao === 'cancelada' ? (
              <Badge variant="outline" className="bg-red-50 text-red-700">
                Cancelada em {data(nota.cancelada_em)}
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700">
                Autorizada
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">
            {formatarChaveAcesso(nota.chave_nfe)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="rounded-lg border p-3 space-y-1">
            <div className="text-xs font-semibold uppercase text-muted-foreground">Emissão</div>
            <div>
              {nota.empresa?.nome || '-'} · {data(nota.data_emissao)}
            </div>
            <div>
              {nota.natureza_operacao || '-'}
              {nota.cfop_principal && <> · CFOP {nota.cfop_principal}</>}
            </div>
            <div className="text-muted-foreground">
              Protocolo {nota.protocolo || '-'}
              {nota.data_autorizacao && <> · autorizada em {data(nota.data_autorizacao)}</>}
            </div>
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <div className="text-xs font-semibold uppercase text-muted-foreground">
              Destinatário
            </div>
            <div className="font-medium">{nota.destinatario_nome || '-'}</div>
            <div className="font-mono text-xs">
              {documento(nota.destinatario_tipo, nota.destinatario_documento)}
            </div>
            <div className="text-muted-foreground">
              {[nota.destinatario_municipio, nota.destinatario_uf].filter(Boolean).join(' / ')}
            </div>
            <div className="text-xs text-muted-foreground">
              {nota.cliente
                ? `Cliente cadastrado: ${nota.cliente.nome}`
                : 'CPF/CNPJ não encontrado no cadastro de clientes'}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold text-sm">Itens</h3>
          <div className="rounded-lg border overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>NCM</TableHead>
                  <TableHead>CFOP</TableHead>
                  <TableHead className="text-right">Qtd</TableHead>
                  <TableHead className="text-right">Unitário</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-6">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : (
                  itens.map((i) => (
                    <TableRow key={i.numero_item}>
                      <TableCell className="text-muted-foreground">{i.numero_item}</TableCell>
                      <TableCell className="font-mono text-xs">{i.codigo_produto}</TableCell>
                      <TableCell className="text-sm">{i.descricao}</TableCell>
                      <TableCell className="font-mono text-xs">{i.ncm}</TableCell>
                      <TableCell className="font-mono text-xs">{i.cfop}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {Number(i.quantidade).toLocaleString('pt-BR')} {i.unidade}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {moeda(i.valor_unitario)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap font-medium">
                        {moeda(i.valor_total)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="rounded-lg border p-3 space-y-1">
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">
              Valores
            </div>
            {valores
              .filter(([, v]) => Number(v) > 0)
              .map(([rotulo, v]) => (
                <div key={rotulo} className="flex justify-between">
                  <span className="text-muted-foreground">{rotulo}</span>
                  <span>{moeda(v)}</span>
                </div>
              ))}
            <div className="flex justify-between font-semibold border-t pt-1 mt-1">
              <span>Total da nota</span>
              <span>{moeda(nota.valor_total)}</span>
            </div>
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">
              Pagamento
              {nota.forma_pagamento &&
                ` · ${FORMAS_PAGAMENTO[nota.forma_pagamento] || nota.forma_pagamento}`}
            </div>
            {duplicatas.length === 0 ? (
              <div className="text-muted-foreground">Sem duplicatas na nota.</div>
            ) : (
              duplicatas.map((d) => (
                <div key={d.numero} className="flex justify-between">
                  <span className="text-muted-foreground">
                    Parcela {d.numero} · vence{' '}
                    {data(d.vencimento ? `${d.vencimento}T12:00:00` : null)}
                  </span>
                  <span>{moeda(d.valor)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {eventos.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold text-sm">Eventos</h3>
            {eventos.map((e) => (
              <div
                key={`${e.tipo_evento}-${e.sequencia}`}
                className="rounded-lg border p-3 text-sm space-y-1"
              >
                <div className="font-medium">
                  {e.descricao || e.tipo_evento}
                  {e.tipo_evento === CARTA_CORRECAO && ` nº ${e.sequencia}`} ·{' '}
                  <span className="font-normal text-muted-foreground">
                    {data(e.data_evento)}
                    {e.protocolo && <> · protocolo {e.protocolo}</>}
                  </span>
                </div>
                {(e.correcao || e.justificativa) && (
                  <div className="text-muted-foreground">{e.correcao || e.justificativa}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {nota.informacoes_complementares && (
          <div className="space-y-1 text-sm">
            <h3 className="font-semibold">Informações complementares</h3>
            <p className="text-muted-foreground whitespace-pre-wrap">
              {nota.informacoes_complementares}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
