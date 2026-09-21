// SPEC-154 (2026-09-21): tela "Pendências de Nota Fiscal" -- lista
// `notas_fiscais_erros WHERE resolvido = false`, com contexto da venda
// (`notas_fiscais.orcamento_id -> orcamentos.numero_venda`). Uma pendência é
// marcada `resolvido=true` automaticamente quando uma tentativa POSTERIOR da
// mesma nota é autorizada (ver `_shared/aplicar-resultado-focus.ts`) -- nunca
// por ação manual do frontend (nunca "esconder" um erro sem ele ter sido
// realmente corrigido, regra 4/8 do briefing da SPEC-154).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase/client'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { AlertTriangle, ArrowRight } from 'lucide-react'

interface PendenciaNota {
  id: string
  ref: string
  numero_tentativa: number
  status_sefaz: string | null
  mensagem_sefaz: string | null
  erro_codigo: string | null
  erro_campo: string | null
  data_hora: string
  nota_fiscal: {
    id: string
    orcamento_id: string | null
    numero_nf: string | null
    orcamento: { id: string; numero_venda: string | null } | null
  } | null
}

export default function PendenciasNotaFiscal() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [pendencias, setPendencias] = useState<PendenciaNota[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPendencias = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('notas_fiscais_erros')
      .select(
        `
        id, ref, numero_tentativa, status_sefaz, mensagem_sefaz, erro_codigo, erro_campo, data_hora,
        nota_fiscal:notas_fiscais(id, orcamento_id, numero_nf, orcamento:orcamentos(id, numero_venda))
      `,
      )
      .eq('resolvido', false)
      .order('data_hora', { ascending: false })

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao carregar pendências de nota fiscal',
        description: error.message,
      })
    } else if (data) {
      setPendencias(
        (data as any[]).map((p) => {
          const notaFiscal = Array.isArray(p.nota_fiscal) ? p.nota_fiscal[0] || null : p.nota_fiscal
          return {
            ...p,
            nota_fiscal: notaFiscal
              ? {
                  ...notaFiscal,
                  orcamento: Array.isArray(notaFiscal.orcamento)
                    ? notaFiscal.orcamento[0] || null
                    : notaFiscal.orcamento,
                }
              : null,
          }
        }) as PendenciaNota[],
      )
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchPendencias()
  }, [])

  const verVenda = (orcamentoId: string | null | undefined) => {
    if (!orcamentoId) return
    navigate(`/vendas?venda=${orcamentoId}`)
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in pb-20 w-full max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
            Pendências de Nota Fiscal
          </h1>
          <p className="text-sm text-muted-foreground">
            Rejeições e erros de emissão via Focus NFe ainda não resolvidos (histórico completo, uma
            linha por tentativa — nunca sobrescrito). Uma pendência some daqui automaticamente
            quando uma tentativa seguinte da mesma nota é autorizada.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Venda</TableHead>
              <TableHead>Ref</TableHead>
              <TableHead className="text-center">Tentativa</TableHead>
              <TableHead>Status SEFAZ</TableHead>
              <TableHead>Mensagem</TableHead>
              <TableHead>Data/Hora</TableHead>
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
            ) : pendencias.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Nenhuma pendência de nota fiscal em aberto.
                </TableCell>
              </TableRow>
            ) : (
              pendencias.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono font-medium">
                    {p.nota_fiscal?.orcamento?.numero_venda || '-'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-600">{p.ref}</TableCell>
                  <TableCell className="text-center">{p.numero_tentativa}</TableCell>
                  <TableCell>
                    {p.status_sefaz ? (
                      <Badge variant="outline" className="bg-red-50 text-red-700">
                        {p.status_sefaz}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-amber-50 text-amber-700">
                        {p.erro_codigo || 'pré-validação'}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm max-w-md">
                    {p.erro_campo && (
                      <span className="font-mono text-xs text-slate-500 mr-1">{p.erro_campo}:</span>
                    )}
                    {p.mensagem_sefaz || '-'}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600 whitespace-nowrap">
                    {new Date(p.data_hora).toLocaleString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={!p.nota_fiscal?.orcamento_id}
                      onClick={() => verVenda(p.nota_fiscal?.orcamento_id)}
                    >
                      Ver venda <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
