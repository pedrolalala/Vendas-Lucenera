import {
  LayoutDashboard,
  TrendingUp,
  Users,
  DollarSign,
  ShoppingBag,
  ArrowUpRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function Dashboard() {
  const stats = [
    {
      title: 'Receita Total',
      value: 'R$ 124.500',
      change: '+12.5%',
      icon: DollarSign,
      positive: true,
    },
    {
      title: 'Vendas Realizadas',
      value: '1.420',
      change: '+8.2%',
      icon: ShoppingBag,
      positive: true,
    },
    { title: 'Clientes Ativos', value: '890', change: '+3.1%', icon: Users, positive: true },
    {
      title: 'Taxa de Conversão',
      value: '3.4%',
      change: '-0.4%',
      icon: TrendingUp,
      positive: false,
    },
  ]

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <LayoutDashboard className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              Dashboard
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Visão geral do desempenho e atividades</p>
          </div>
        </div>
        <Button asChild className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <Link to="/vendas">
            Acessar Módulo de Vendas
            <ArrowUpRight className="ml-1.5 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.title} className="border border-gray-200">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-medium text-gray-500">{stat.title}</CardTitle>
                <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Icon className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
                <p
                  className={`text-xs mt-1 font-medium ${stat.positive ? 'text-emerald-600' : 'text-rose-500'}`}
                >
                  {stat.change} em relação ao mês anterior
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
