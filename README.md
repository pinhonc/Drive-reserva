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
fila aberta/fechada, bloqueio de dias e horários com justificativa, reservas por dia (confirmar, chegou, sentar, finalizar, não compareceu, cancelar, destaque de atrasadas),
reserva por telefone, mapa de mesas com status (livre, ocupada, reservada, limpeza), painel de relatórios estilo B.I. (veja abaixo) e ajustes.

**Alocação automática de mesas:** cada reserva já nasce com a menor mesa que comporta o grupo e não tem conflito de
horário — isso evita overbooking.

## Relatórios (painel B.I.)

Aba **Relatórios**, com gráficos que **atualizam sozinhos** (a cada entrada/saída da fila, reserva nova ou mudança de status, e a cada 30 segundos).
Filtros no topo: **Hoje, 7 dias, 30 dias, 90 dias, 12 meses**, **Dia específico** (escolha uma data) ou período **De/Até**.

- **Tempo de espera na fila:** espera média, maior espera (com a senha e o dia), mediana, grupos atendidos, desistência e "esperando agora" (ao vivo).
  Gráficos de média e maior espera **por número de pessoas**, **por dia da semana** e **por horário de entrada**.
  Espera = da entrada na fila até a mesa ser chamada (ou sentada, se não houve chamada).
- **Como conheceram o Drive:** gráfico de **pizza** com legenda (total, %, fila/reservas), filtro Fila + reservas / Só fila / Só reservas
  e o que escreveram em "Outros".
- **Reservas:** total de pessoas (colunas) e **média de pessoas por reserva** (linha) **por dia da semana**, **por semana** e **por mês**,
  mais a distribuição por tamanho do grupo. Considera a data da reserva e não conta as canceladas.

## Turnos (almoço e jantar) e bloqueios

- **Ajustes > Horário de funcionamento:** cada dia tem dois turnos, **Almoço** e **Jantar**, cada um com abertura e fechamento.
  Desmarque o turno em que não há reservas. O cliente vê os horários separados por turno.
  Se o seu banco tinha uma faixa única por dia (ex.: 11:00–23:00), ela é lida como Almoço; ajuste os turnos em Ajustes.
- **Aba Bloqueios:** bloqueia **dia(s) inteiro(s)**, **só almoço**, **só jantar** ou um **horário específico**, por uma data ou período.
  A **justificativa é obrigatória** (mínimo de 5 caracteres, também exigida pelo banco) e fica registrada com o nome de quem bloqueou e a data.
- Os bloqueios valem para as **reservas online** (`/reservas`); não afetam a fila e **não cancelam** reservas já feitas
  (o painel avisa quantas reservas já existem no período). A equipe ainda pode criar uma reserva por telefone num horário
  bloqueado, mediante confirmação na tela, que mostra o motivo do bloqueio.
- Remover um bloqueio não apaga o registro: ele vai para o **Histórico**, com quem removeu e quando.
- O cliente não vê a justificativa; vê só que o horário/dia não está disponível.

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
