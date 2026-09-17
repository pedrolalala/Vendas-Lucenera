import { useState } from 'react'
import { Link, useLocation, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  BarChart3,
  Settings,
  Menu,
  X,
  Search,
  Bell,
  Sparkles,
  ChevronRight,
  TrendingUp,
  HelpCircle,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
}

const navItems: NavItem[] = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'Vendas', href: '/vendas', icon: ShoppingCart },
  { title: 'Clientes', href: '/clientes', icon: Users },
  { title: 'Relatórios', href: '/relatorios', icon: BarChart3 },
  { title: 'Configurações', href: '/configuracoes', icon: Settings },
]

export default function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()

  const isActive = (href: string) => {
    if (href === '/' && location.pathname === '/') return true
    if (href !== '/' && location.pathname.startsWith(href)) return true
    return false
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-[#111827] flex">
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden transition-opacity duration-300"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Desktop & Mobile */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-[#E5E7EB] flex flex-col transition-transform duration-300 ease-out lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand / Logo */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-[#E5E7EB]">
          <Link
            to="/"
            onClick={() => setMobileMenuOpen(false)}
            className="flex items-center gap-2.5 font-bold text-xl tracking-tight text-gray-900 group"
          >
            <div className="h-9 w-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm shadow-indigo-200 group-hover:bg-indigo-700 transition-colors">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="leading-tight text-base font-extrabold text-gray-900">
                Nexus<span className="text-indigo-600">Vendas</span>
              </span>
              <span className="text-[10px] text-gray-500 font-medium">Gestão Comercial</span>
            </div>
          </Link>
          <button
            type="button"
            className="lg:hidden p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          <div className="px-3 pb-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            Menu Principal
          </div>
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`group flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  active
                    ? 'bg-indigo-50 text-indigo-700 font-semibold shadow-xs'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`h-5 w-5 transition-colors ${
                      active ? 'text-indigo-600' : 'text-gray-400 group-hover:text-gray-600'
                    }`}
                  />
                  <span>{item.title}</span>
                </div>
                {item.badge && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-800 border-amber-200"
                  >
                    {item.badge}
                  </Badge>
                )}
                {active && <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 ml-auto" />}
              </Link>
            )
          })}

          <div className="pt-6 px-3 pb-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            Atalhos
          </div>
          <Link
            to="/"
            onClick={() => setMobileMenuOpen(false)}
            className={`group flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              isActive('/') && location.pathname === '/'
                ? 'bg-indigo-50 text-indigo-700 font-semibold'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-gray-400 group-hover:text-indigo-600" />
              <span>Página Inicial</span>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </Link>
        </div>

        {/* Footer info in sidebar */}
        <div className="p-4 border-t border-[#E5E7EB] bg-gray-50/50">
          <div className="flex items-center gap-3 p-2 rounded-lg bg-white border border-gray-200/70 shadow-xs">
            <Avatar className="h-9 w-9">
              <AvatarImage
                src="https://img.usecurling.com/ppl/thumbnail?gender=male&seed=42"
                alt="Avatar"
              />
              <AvatarFallback className="bg-indigo-100 text-indigo-700 font-semibold text-xs">
                GC
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-900 truncate">Gabriel Costa</p>
              <p className="text-[11px] text-gray-500 truncate">gabriel@empresa.com</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        {/* Top Header */}
        <header className="sticky top-0 z-30 h-16 bg-white border-b border-[#E5E7EB] flex items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 flex-1">
            <button
              type="button"
              className="lg:hidden p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Search Input */}
            <div className="relative w-full max-w-md hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                type="search"
                placeholder="Buscar pedidos, clientes, relatórios..."
                className="pl-9 pr-4 py-1.5 h-9 bg-gray-50/70 border-gray-200 focus:bg-white text-sm"
              />
            </div>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Quick action or help */}
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-500 hover:text-gray-700 h-9 w-9 rounded-lg"
              title="Ajuda e Suporte"
            >
              <HelpCircle className="h-4 w-4" />
            </Button>

            {/* Notifications */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative text-gray-500 hover:text-gray-700 h-9 w-9 rounded-lg"
                >
                  <Bell className="h-4 w-4" />
                  <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-indigo-600 ring-2 ring-white" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="text-xs font-semibold text-gray-500">
                  Notificações
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="flex flex-col items-start gap-1 py-2 text-xs">
                  <span className="font-semibold text-gray-900">Módulo de Vendas criado</span>
                  <span className="text-gray-500">
                    A página em branco de Vendas já está pronta para uso.
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Profile Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
                  <Avatar className="h-8 w-8">
                    <AvatarImage
                      src="https://img.usecurling.com/ppl/thumbnail?gender=male&seed=42"
                      alt="Gabriel Costa"
                    />
                    <AvatarFallback className="bg-indigo-100 text-indigo-700 text-xs">
                      GC
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>
                  <div className="font-medium text-sm text-gray-900">Gabriel Costa</div>
                  <div className="text-xs text-gray-500 font-normal">Administrador</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/vendas" className="cursor-pointer">
                    Página de Vendas
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/configuracoes" className="cursor-pointer">
                    Configurações
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page Main Content Area */}
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
