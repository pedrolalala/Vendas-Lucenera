import { Outlet, NavLink } from 'react-router-dom'
import { Building2, LogOut, AlertTriangle, FileText } from 'lucide-react'
import logoUrl from '@/assets/logotipo-verticalv1preto-b4de9.png'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SystemSwitcher } from '@/components/SystemSwitcher'

// SPEC-153: layout mínimo, mesmo padrão dos demais sistemas-satélite (header
// fixo com logo/voltar-pra-Central/sair + SystemSwitcher). O sistema Vendas
// nasce com uma única tela real ("Vendas") -- SPEC-154 (2026-09-21) adiciona
// a segunda tela ("Pendências de Nota Fiscal"), então o header ganha um nav
// simples de links em vez de sidebar cheia. SPEC-204 (2026-10-15): terceira tela,
// "Notas Fiscais Connect" (consulta das notas importadas dos XMLs da Connect).
export default function Layout() {
  const { signOut } = useAuth()

  return (
    <div className="flex min-h-screen w-full bg-slate-50 flex-col">
      <header className="h-16 border-b bg-white flex items-center justify-between px-6 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="Lucenera Logo" className="h-10 object-contain" />
            <span className="font-semibold text-lg text-slate-800">Vendas</span>
          </div>
          <nav className="hidden sm:flex items-center gap-1">
            <NavLink
              to="/vendas"
              className={({ isActive }) =>
                cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100',
                )
              }
            >
              Vendas
            </NavLink>
            <NavLink
              to="/pendencias-nota-fiscal"
              className={({ isActive }) =>
                cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5',
                  isActive ? 'bg-red-50 text-red-700' : 'text-slate-600 hover:bg-slate-100',
                )
              }
            >
              <AlertTriangle className="h-3.5 w-3.5" /> Pendências de Nota Fiscal
            </NavLink>
            <NavLink
              to="/notas-fiscais-connect"
              className={({ isActive }) =>
                cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5',
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100',
                )
              }
            >
              <FileText className="h-3.5 w-3.5" /> Notas Fiscais Connect
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild title="Voltar para a Central Lucenera">
            <a href="https://central-lucenera.pages.dev/dashboard">
              <Building2 className="h-4 w-4" />
            </a>
          </Button>
          <Button variant="ghost" size="icon" onClick={() => signOut()} title="Sair">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* pr-16/sm:pr-20 (SPEC-153, mesmo ajuste de Separação Parcial/CRM):
          reserva espaço pro SystemSwitcher (SPEC-120), fixo na borda
          direita — sem isso a tabela de vendas fica sobreposta pelo menu. */}
      <main className="flex-1 p-4 sm:p-6 pr-16 sm:pr-20 flex flex-col gap-4 w-full">
        <Outlet />
      </main>

      <footer className="h-14 border-t bg-white flex items-center justify-between px-6 text-xs text-muted-foreground mt-auto shrink-0">
        <p>© {new Date().getFullYear()} Lucenera. Todos os direitos reservados.</p>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
          <span>Sistema Operacional</span>
        </div>
      </footer>
      <SystemSwitcher currentSlug="vendas" />
    </div>
  )
}
