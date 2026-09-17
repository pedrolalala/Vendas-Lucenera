import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ShieldCheck,
  Zap,
  TrendingUp,
  ShoppingCart,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function Index() {
  return (
    <div className="space-y-16 py-6 sm:py-10 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto animate-fade-in">
      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-3xl bg-linear-to-br from-indigo-900 via-indigo-800 to-indigo-950 text-white p-8 sm:p-12 lg:p-16 shadow-xl">
        <div className="absolute -right-20 -top-20 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute right-10 -bottom-20 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-2xl">
          <Badge className="mb-4 bg-indigo-500/30 text-indigo-100 hover:bg-indigo-500/40 border border-indigo-400/30 px-3 py-1">
            Plataforma Comercial Inteligente
          </Badge>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight">
            Olá, bem-vindo(a)!
          </h1>
          <p className="mt-4 text-base sm:text-lg text-indigo-100/90 leading-relaxed">
            Gerencie suas vendas, acompanhe seus clientes e acelere o crescimento do seu negócio em
            uma plataforma moderna e integrada.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              asChild
              size="lg"
              className="bg-white text-indigo-900 hover:bg-indigo-50 font-bold shadow-md hover:scale-[1.02] transition-transform"
            >
              <Link to="/vendas">
                Começar Agora
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-indigo-400/40 bg-indigo-900/40 text-white hover:bg-indigo-800/60 font-semibold"
            >
              <Link to="/dashboard">Ver Demonstração</Link>
            </Button>
          </div>
        </div>

        {/* Dashboard Mockup Illustration */}
        <div className="mt-10 lg:mt-0 lg:absolute lg:right-10 lg:top-1/2 lg:-translate-y-1/2 lg:w-[460px] rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 p-5 shadow-2xl">
          <div className="flex items-center justify-between pb-3 border-b border-white/10 text-xs text-indigo-100">
            <span className="font-semibold flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              Desempenho em Tempo Real
            </span>
            <span className="text-emerald-300 font-bold">+28.4%</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="rounded-xl bg-white/5 p-3 border border-white/10">
              <div className="text-[11px] text-indigo-200">Total Faturado</div>
              <div className="text-lg font-black text-white mt-1">R$ 142.850</div>
            </div>
            <div className="rounded-xl bg-white/5 p-3 border border-white/10">
              <div className="text-[11px] text-indigo-200">Novos Pedidos</div>
              <div className="text-lg font-black text-white mt-1">328</div>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-xs text-indigo-200">
            <span>Status do Sistema</span>
            <span className="inline-flex items-center text-emerald-300 font-medium gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Operacional
            </span>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Principais Benefícios</h2>
          <p className="text-sm text-gray-500 mt-1">
            Recursos projetados para dar total visibilidade da sua operação comercial.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border border-gray-200 hover:shadow-md transition-shadow">
            <CardHeader>
              <div className="h-10 w-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2">
                <ShoppingCart className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg font-bold text-gray-900">Gestão de Vendas</CardTitle>
              <CardDescription>
                Controle todo o ciclo de vida dos seus pedidos com atualizações rápidas e relatórios
                detalhados.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                to="/vendas"
                className="inline-flex items-center text-sm font-semibold text-indigo-600 hover:text-indigo-800"
              >
                Acessar Vendas
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </CardContent>
          </Card>

          <Card className="border border-gray-200 hover:shadow-md transition-shadow">
            <CardHeader>
              <div className="h-10 w-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2">
                <BarChart3 className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg font-bold text-gray-900">
                Métricas e Relatórios
              </CardTitle>
              <CardDescription>
                Acompanhe o faturamento, ticket médio e metas de vendas em tempo real com gráficos
                intuitivos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                to="/relatorios"
                className="inline-flex items-center text-sm font-semibold text-indigo-600 hover:text-indigo-800"
              >
                Ver Relatórios
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </CardContent>
          </Card>

          <Card className="border border-gray-200 hover:shadow-md transition-shadow">
            <CardHeader>
              <div className="h-10 w-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2">
                <Users className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg font-bold text-gray-900">Gestão de Clientes</CardTitle>
              <CardDescription>
                Mantenha histórico de compras, contatos e preferências de cada cliente em um só
                local.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                to="/clientes"
                className="inline-flex items-center text-sm font-semibold text-indigo-600 hover:text-indigo-800"
              >
                Ver Clientes
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* CTA Final */}
      <section className="rounded-3xl bg-linear-to-r from-indigo-600 to-indigo-700 text-white p-8 sm:p-10 flex flex-col md:flex-row items-center justify-between gap-6 shadow-lg">
        <div className="space-y-2 text-center md:text-left">
          <h3 className="text-2xl font-bold">Pronto para impulsionar suas vendas?</h3>
          <p className="text-indigo-100 text-sm max-w-xl">
            Acesse a página de vendas em branco e comece a estruturar sua carteira de negócios hoje
            mesmo.
          </p>
        </div>
        <Button
          asChild
          size="lg"
          className="bg-white text-indigo-900 hover:bg-indigo-50 font-bold whitespace-nowrap shadow-sm hover:scale-[1.02] transition-transform"
        >
          <Link to="/vendas">
            Ir para Vendas
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </section>
    </div>
  )
}
