# AI DB Context — Vendas

Este sistema é um módulo do ecossistema Lucenera e usa um Supabase compartilhado (mesmo projeto de todos os outros sistemas-satélite).

Este arquivo resume o recorte de banco necessário para trabalhar em Vendas sem depender de documentação externa.

Se uma demanda exigir estrutura de banco que não aparece neste contexto, documente a necessidade em `DB_CHANGE_REQUEST_TEMPLATE.md` antes de alterar código que dependa dela.

## Papel do sistema

Sistema novo (SPEC-153, 2026-09-17): único lugar onde nota fiscal e boleto são orquestrados a partir de um orçamento aprovado (venda). Não edita item/parcela de orçamento — isso continua sendo feito dentro do sistema Orçamentos (`gestao-financeira-clone-544cb`). Não gera boleto novo — os boletos da venda já nascem em `aprovar_orcamento_financeiro` (sistema Orçamentos), com `status='pendente_registro'`; Vendas só navega até a tela de Boletos de Administração Bancária (`retorno-bancario-bradesco-5392a`, slug `financeiro`).

Emissão real via API fiscal (Focus NFe) é a SPEC-154 (2026-09-21, banco + Edge Functions implementadas, migration não aplicada, funções não deployadas -- ver seção própria abaixo). O registro manual (`registrar_nota_fiscal_parcial`, sem chamar API externa) continua existindo e é o único jeito de criar o rascunho da nota antes de chamar `emitir-nota-fiscal`.

## Objetos reais relevantes no Supabase

Principais tabelas:

- `orcamentos` — fonte da lista de vendas: `WHERE status = 'Orçamento Aprovado' AND natureza_operacao = 'venda'`
- `orcamento_itens` — granularidade da nota fiscal parcial
- `notas_fiscais` — dono do CRUD é este sistema (schema compartilhado com Admin Bancária, que não usa mais)
- `notas_fiscais_itens` (nova, SPEC-153) — dono do CRUD é este sistema
- `contatos` — cliente da venda e/ou pagador alternativo de uma nota parcial
- `projetos` — exibição (código/nome) na lista de vendas
- `boletos` — só leitura/navegação (o CRUD real continua em Admin Bancária)

## Colunas-chave reais

`orcamentos` (relevantes aqui):

- `id`, `numero`, `numero_venda` (texto `VENDA-0001`, gerado por `aprovar_orcamento_financeiro`, SPEC-136)
- `status` (`'Orçamento Aprovado'` é o único status que aparece em Vendas)
- `natureza_operacao` (`'venda'`/`'devolucao'`/`'outros'`/`'sac'` — só `'venda'` aparece aqui; devolução não gera venda nova)
- `cliente_id` (FK `contatos.id`, FK name `orcamentos_cliente_id_fkey`)
- `projeto_id` (FK `projetos.id`)
- `valor_total`

`orcamento_itens` possui:

- `id`, `orcamento_id`, `produto_id`, `quantidade`, `preco_unitario`, `desconto` (percentual), `descricao`
- Valor do item = `quantidade * preco_unitario * (1 - desconto / 100)` (mesma fórmula usada em Orçamentos, `FiscalSummaryDialog.tsx`/`GerenciamentoDialog.tsx`)

`notas_fiscais` possui:

- `id`, `numero_nf`, `serie`, `data_emissao`, `valor`, `arquivo_url`, `fornecedor`, `arquiteto`, `boleto_id`, `orcamento_id`
- `tipo_operacao` (`'CR'`/`'CP'`), `perfil` (`'ribeirao'`/`'sao_paulo'`/null)
- `cliente_id` (uuid, `REFERENCES contatos(id)`, nullable — SPEC-153: pagador real da nota parcial quando cadastrado, pode divergir de `orcamentos.cliente_id`)
- `nome_destinatario` (text, nullable — SPEC-153: pagador real sem cadastro em `contatos`)

`notas_fiscais_itens` (nova, SPEC-153) possui:

- `id`, `nota_fiscal_id` (FK `notas_fiscais.id`), `orcamento_item_id` (FK `orcamento_itens.id`)
- `quantidade_faturada`, `valor_faturado`, `created_at`
- `SUM(quantidade_faturada)` por `orcamento_item_id`, em todas as notas de todas as vendas, nunca pode ultrapassar `orcamento_itens.quantidade` — garantido pela RPC abaixo (transacional), não por trigger.

## RPC principal

`public.registrar_nota_fiscal_parcial(p_orcamento_id, p_numero_nf, p_itens jsonb, p_serie, p_data_emissao, p_cliente_id, p_nome_destinatario, p_tipo_operacao, p_perfil, p_fornecedor, p_arquivo_url)`

- `p_itens`: array jsonb de `{orcamento_item_id, quantidade_faturada, valor_faturado}`.
- Valida que o orçamento está com `status='Orçamento Aprovado'` e `natureza_operacao='venda'`.
- Trava (`FOR UPDATE`) as linhas de `orcamento_itens` envolvidas antes de somar a cobertura já existente — evita corrida entre duas notas parciais simultâneas da mesma venda.
- Insere `notas_fiscais` + `notas_fiscais_itens` numa única transação.
- Requer `hub_pode_executar(usuario, 'vendas', NULL, 'emitir_nota_fiscal')` (ou `service_role`) — sem RBAC fino ainda (só admin/admin_geral tem acesso, via `papel_permissoes` em branco, migration `003_permissao_admin_sistema_vendas.sql`).

Ver `supabase/db/migrations/20260917_153_notas_fiscais_parcial_multipagador/` no repositório central para o SQL completo.

## Decisões de negócio

- Vendas não edita item/parcela — qualquer correção volta pro sistema Orçamentos.
- Boleto sem nota fiscal é permitido (exceção real, não bloquear).
- Nota fiscal parcial pode ser emitida em nome de pessoa diferente do titular da venda, sem alterar o titular da venda em si.
- "Nota completa" é derivado comparando `notas_fiscais_itens` com `orcamento_itens` — não existe flag redundante gravada em `orcamentos`/`notas_fiscais`.

## Como agir ao codar

- Nunca usar `venda_id` — vínculo é sempre `orcamento_id`/`orcamento_item_id`.
- Nunca gerar boleto novo aqui — só navegar (`redirectWithCode`, sistema `financeiro`) pra `retorno-bancario-bradesco-5392a` (`/boletos?orcamento_id=...`).
- Nota fiscal real (Focus NFe) já existe como Edge Functions (SPEC-154, ver seção própria acima) — nunca duplique lógica de montagem de payload fora de `_shared/montar-payload-nfe.ts`/`_shared/cfop.ts`, e nunca chame a Focus a partir do frontend (token só existe nas Edge Functions).
- Se precisar de nova coluna/tabela, preencha `DB_CHANGE_REQUEST_TEMPLATE.md`.

## SPEC-154 — Integração Focus NFe (2026-09-21)

Banco + Edge Functions implementados nesta data (rascunho -- migration em `supabase/db/migrations/20260921_154_focus_nfe_integracao/` NÃO aplicada, Edge Functions NÃO deployadas; frontend fora do escopo desta etapa). Ver `03-Projeto/Planos de Ação/SPECs/SPEC-154_Integracao_Focus_NFe.md` para o texto completo e as pendências de negócio ainda não decididas.

`notas_fiscais` ganha (além das colunas já listadas acima):

- `ambiente` (`homologacao`/`producao`, sempre `homologacao` até validar CFOP/IBGE)
- `ref` (único, formato `VENDA-{numero_venda}-N{tentativa}`, imutável por tentativa)
- `status_emissao` (`nao_emitida`/`processando_autorizacao`/`autorizado`/`erro_autorizacao`/`cancelado`)
- `status_sefaz`, `mensagem_sefaz` (cStat/mensagem crus da SEFAZ, nunca inventados)
- `chave_nfe`, `payload_enviado` (jsonb, snapshot do que foi enviado), `tentativa_atual`, `ultima_consulta_em`
- `arquivo_url` passa a também guardar o link do DANFE/XML autorizado (decisão: não existe coluna `caminho_xml` separada, ver comentário na migration 001)

Nova tabela `notas_fiscais_erros` (histórico completo, nunca sobrescrito, uma linha por tentativa/evento com problema) e `empresas.codigo_municipio_ibge` (nullable, preenchimento manual por empresa).

3 Edge Functions novas em `supabase/functions/`:

- `emitir-nota-fiscal` — chamada autenticada do frontend; monta o payload NF-e 4.00 (CFOP replicado de `src/lib/danfe.ts` via `_shared/cfop.ts`) e faz `POST {ambiente}/v2/nfe?ref=...` na Focus.
- `focus-nfe-webhook` — endpoint público (verify_jwt=false), idempotente por `ref`, autenticado por secret próprio (`FOCUS_NFE_WEBHOOK_SECRET`).
- `verificar-notas-pendentes` — job de fallback, chamado por `pg_cron`/`pg_net` (migration 004, com placeholder de URL/secret -- nunca commitar token real), autenticado por `FOCUS_NFE_CRON_SECRET`.

Secrets esperados nas Edge Functions (configurar via `supabase functions secrets set`, nunca em código/`.env` versionado): `FOCUS_NFE_TOKEN`, `FOCUS_NFE_AMBIENTE` (`homologacao`/`producao`), `FOCUS_NFE_WEBHOOK_SECRET`, `FOCUS_NFE_CRON_SECRET`.

Decisão simplificada registrada: token único (`FOCUS_NFE_TOKEN`) para todas as empresas emissoras, em vez de um secret por empresa -- `_shared/focus-client.ts` (`resolverConfigFocus`) já recebe o `empresa_id` como parâmetro pra não precisar mudar a assinatura quando a estrutura multi-empresa for implementada (pendência registrada na SPEC-154, depende de quantas contas reais o usuário criar na Focus).

Pendências que bloqueiam qualquer emissão REAL (a Edge Function já valida e bloqueia antes de chamar a Focus, ver `_shared/montar-payload-nfe.ts`): `empresas.codigo_municipio_ibge` vazio, destinatário sem CPF/CNPJ, item sem NCM/CST. Gap de CFOP (heurística provisória, só intra-estado) não é revalidado aqui -- é a mesma limitação já documentada em `danfe.ts`.

## SPEC-007 — SSO entre sistemas

- `AuthProvider` (`src/hooks/use-auth.tsx`) chama `consumeCodeFromUrl('vendas')`.
- `redirectWithCode` (`src/lib/cross-system-auth.ts`) usa `sistema_origem: 'vendas'`.
- Não aceitar `access_token`/`refresh_token` em query string; somente `sso_code`.
