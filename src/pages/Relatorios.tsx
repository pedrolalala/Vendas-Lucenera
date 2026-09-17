import { BarChart3, Download, Calendar, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function Relatorios() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <BarChart3 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              Relatórios
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Análise detalhada de vendas e faturamento
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="bg-white border-gray-200">
            <Calendar className="h-4 w-4 mr-1.5 text-gray-500" />
            Últimos 30 dias
          </Button>
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white">
            <Download className="h-4 w-4 mr-1.5" />
            Exportar PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border border-gray-200">
          <CardHeader>
            <CardTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-600" />
              Volume de Vendas por Período
            </CardTitle>
            <CardDescription>Resumo dos últimos 6 meses de faturamento</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-48 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-sm text-gray-400">
              Gráfico de evolução consolidado
            </div>
          </CardContent>
        </Card>

        <Card className="border border-gray-200">
          <CardHeader>
            <CardTitle className="text-base font-bold text-gray-900">
              Vendas por Categoria
            </CardTitle>
            <CardDescription>Distribuição percentual por linha de produto</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-48 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-sm text-gray-400">
              Gráfico de distribuição por categoria
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
