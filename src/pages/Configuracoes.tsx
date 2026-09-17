import { Settings, Shield, Bell, CreditCard, Building } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function Configuracoes() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <Settings className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              Configurações
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Preferências do sistema e parâmetros de vendas
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border border-gray-200 md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Building className="h-4 w-4 text-indigo-600" />
              Dados da Empresa
            </CardTitle>
            <CardDescription>Informações básicas exibidas em recibos e orçamentos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="companyName">Nome da Empresa</Label>
              <Input id="companyName" defaultValue="Nexus Vendas Corporativas Ltda" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="cnpj">CNPJ</Label>
                <Input id="cnpj" defaultValue="12.345.678/0001-90" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail Comercial</Label>
                <Input id="email" defaultValue="contato@nexusvendas.com.br" />
              </div>
            </div>
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-white mt-2">
              Salvar Alterações
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border border-gray-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Shield className="h-4 w-4 text-indigo-600" />
                Segurança
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-gray-500 space-y-2">
              <p>Autenticação em dois fatores e gerenciamento de sessões ativas.</p>
              <Button variant="outline" size="sm" className="w-full">
                Gerenciar Acesso
              </Button>
            </CardContent>
          </Card>

          <Card className="border border-gray-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Bell className="h-4 w-4 text-indigo-600" />
                Notificações
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-gray-500 space-y-2">
              <p>Configure alertas por e-mail e notificações push para novas vendas.</p>
              <Button variant="outline" size="sm" className="w-full">
                Preferências de Alerta
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
