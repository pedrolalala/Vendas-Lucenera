import { ShoppingCart, Plus, Filter, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function Vendas() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <ShoppingCart className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              Vendas
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Acompanhe e gerencie suas vendas</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-gray-600 border-gray-200 hover:bg-gray-50"
            disabled
          >
            <Filter className="h-4 w-4 mr-1.5" />
            Filtrar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-gray-600 border-gray-200 hover:bg-gray-50"
            disabled
          >
            <Download className="h-4 w-4 mr-1.5" />
            Exportar
          </Button>
          <Button
            size="sm"
            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs font-semibold"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Adicionar Venda
          </Button>
        </div>
      </div>

      {/* Main Blank Content Area / Clean Empty State ready to be filled */}
      <div className="min-h-[500px] rounded-2xl border-2 border-dashed border-gray-200 bg-white/60 p-8 flex flex-col items-center justify-center text-center">
        <div className="h-16 w-16 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4 ring-8 ring-indigo-50/50">
          <ShoppingCart className="h-8 w-8 text-indigo-500 stroke-[1.5]" />
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-1">Nenhuma venda cadastrada ainda</h2>
        <p className="text-sm text-gray-500 max-w-md mb-6 leading-relaxed">
          Esta área está pronta para receber suas informações de vendas, pedidos e relatórios de
          faturamento.
        </p>
        <Button className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium">
          <Plus className="h-4 w-4 mr-2" />
          Adicionar Venda
        </Button>
      </div>
    </div>
  )
}
