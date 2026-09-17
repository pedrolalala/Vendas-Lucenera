import { Users, UserPlus, Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

export default function Clientes() {
  const sampleClients = [
    {
      name: 'Empresa Alpha Ltda',
      email: 'contato@alpha.com',
      totalSpent: 'R$ 34.200',
      orders: 12,
      initials: 'EA',
    },
    {
      name: 'Comércio Beta S/A',
      email: 'financeiro@beta.com',
      totalSpent: 'R$ 21.450',
      orders: 8,
      initials: 'CB',
    },
    {
      name: 'Gama Soluções Digitais',
      email: 'suporte@gama.com',
      totalSpent: 'R$ 15.800',
      orders: 5,
      initials: 'GS',
    },
  ]

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              Clientes
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Carteira de clientes e contatos comerciais
            </p>
          </div>
        </div>
        <Button className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <UserPlus className="h-4 w-4 mr-1.5" />
          Novo Cliente
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input placeholder="Buscar clientes..." className="pl-9 bg-white" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {sampleClients.map((client) => (
          <Card key={client.name} className="border border-gray-200">
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-indigo-100 text-indigo-700 font-bold text-xs">
                    {client.initials}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm leading-tight">
                    {client.name}
                  </h3>
                  <p className="text-xs text-gray-500">{client.email}</p>
                </div>
              </div>
              <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600">
                <span>{client.orders} pedidos</span>
                <span className="font-bold text-gray-900">{client.totalSpent}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
