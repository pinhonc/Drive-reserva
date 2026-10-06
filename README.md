# Drive In Burger — Fila de espera & Reservas

Três páginas independentes, um banco só (Supabase):

| Página | Link | Quem usa | O que mostra |
|---|---|---|---|
| `fila.html` | `/fila` | Cliente que lê o **QR Code** na entrada | Só a fila de espera |
| `reservas.html` | `/reservas` | Cliente que recebe o **link** (Instagram, Google, WhatsApp) | Só reservas |
| `equipe.html` | `/equipe` | **Equipe** (login) | Fila + Reservas + Mesas + Relatórios + Ajustes |

Nenhuma página pública tem link para a outra. O banco também separa: o cliente só consegue usar as funções
da própria página, e as tabelas só são lidas por usuários cadastrados na equipe.

## Colocando no ar

1. **Banco** — no Supabase (projeto *Drive-reservas*) abra **SQL Editor**, cole todo o `supabase/schema.sql` e execute.
2. **Equipe** — em **Authentication > Users > Add user**, crie o e-mail/senha de cada pessoa. Depois rode no SQL Editor:
   ```sql
   insert into public.staff (user_id, nome)
   select id, 'Nome da pessoa' from auth.users where email = 'email@dominio.com'
   on conflict do nothing;
   ```
   Em **Authentication > Sign In / Providers**, desative **Allow new users to sign up** (cadastro só pela gerência).
3. **Chaves** — em **Project Settings > API** copie a *Project URL* e a chave *anon public* para o `config.js`.
   Nunca use a chave `service_role` aqui.
4. **GitHub** — envie estes arquivos para o repositório *Drive-reserva*.
5. **Netlify** — *Add new site > Import from Git*, escolha o repositório. Build command: vazio. Publish directory: `.`
6. Abra `/equipe`, entre, e em **Ajustes** configure horários, regras e gere os **QR Codes**.
   Em **Mesas > Editar layout** monte o mapa do salão (as mesas cadastradas são só um exemplo).

## O que o sistema faz

**Fila (cliente):** senha numerada por dia, posição e espera estimada atualizadas a cada 4 segundos, aviso na tela e
vibração quando a mesa está pronta, sair da fila. A prioridade (idoso, gestante, PCD) **não** é escolhida pelo cliente:
só a recepção marca.

**Reservas (cliente):** só mostra horários com mesa realmente livre para o tamanho do grupo e a área escolhida,
confirmação automática (ou manual, se preferir), consulta/cancelamento por código + telefone, arquivo de calendário (.ics).

**Equipe:** fila em tempo real com som de novo cliente, campo para o **nº do pager** de cada cliente, **QR Code por cliente**
(o cliente lê e volta a acompanhar a posição no celular), marcar/tirar prioridade, chamar / sentar em mesa / não veio,
WhatsApp com mensagem pronta,
fila aberta/fechada, reservas por dia (confirmar, chegou, sentar, finalizar, não compareceu, cancelar, destaque de atrasadas),
reserva por telefone, mapa de mesas com status (livre, ocupada, reservada, limpeza), relatórios por período (hoje, 7, 30 ou 90 dias)
com espera média, desistência, no-show, fila e reservas por dia/semana e **como os clientes conheceram o Drive**
(ranking dos canais, fila e reservas juntas, e o que escreveram em "Outros"), e ajustes.

**Alocação automática de mesas:** cada reserva já nasce com a menor mesa que comporta o grupo e não tem conflito de
horário — isso evita overbooking.

## Salões

Salão Principal, Mezanino e Kids. Rodar o `schema.sql` de novo é seguro: mesas, filas e reservas antigas de "Salão Interno"
ou "Área Externa" passam para "Salão Principal" e o restante dos dados é mantido. As mesas de exemplo só são criadas em
banco sem mesas; num banco já usado, ajuste em **Mesas**.

## Como conheceu o Drive

No lugar de "Ocasião", fila e reservas perguntam **"Como conheceu o Drive?"**, com as opções: Indicação de amigos/familiares,
Passando em frente ao Drive, Google, Redes Sociais, Prêmio Bom Gourmet e Outros (abre um campo para digitar). O campo é opcional;
sem resposta, fica "Não informado". A recepção também preenche ao adicionar cliente ou reserva, e a resposta aparece na lista.
Ao atualizar o banco, os valores antigos de "ocasião" viram "Não informado".

## Limites desta versão

- O aviso por WhatsApp abre o app com a mensagem pronta; o envio automático exige a API oficial do WhatsApp Business.
- Reserva paga (pagamento antecipado), avaliações e cardápio digital não estão incluídos.
- Cada dia aceita uma faixa de horário e o fechamento deve ser até 23:59 (sem virar a madrugada).
- O fuso padrão é `America/Sao_Paulo` (coluna `fuso` da tabela `settings`).
