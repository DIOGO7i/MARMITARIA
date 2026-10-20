# Sistema de Gestão para Marmitaria

Aplicação web para controlar **pedidos de marmitas** (presenciais e pelo WhatsApp), **estoque**, **compras**, **saídas**, **despesas** e **relatórios diários e mensais**. Os dados ficam num banco de dados real, os cálculos são automáticos e o acesso exige login.

---

## 1. Arquitetura

| Camada | Tecnologia |
|---|---|
| Front-end | React 18 + TypeScript + Vite, Tailwind CSS, ícones Lucide, gráficos Recharts |
| Back-end | Node.js 22 + Express + TypeScript (executado com `tsx`) |
| Banco de dados | SQLite embutido no Node.js (`node:sqlite`, sem nada para compilar) — arquivo `marmitaria.db` com WAL, chaves estrangeiras, `CHECK` e índices |
| Autenticação | E-mail e senha (hash bcrypt, custo 12) + sessão JWT de 12 h, limite de tentativas de login |
| Validação | Zod no servidor + validação nos formulários |
| Testes | Vitest (103 testes automáticos) + teste de ponta a ponta no navegador (31 etapas de um dia de operação) |

```
marmitaria/
├── server/
│   ├── db/schema.sql          ← script de criação das tabelas
│   └── src/
│       ├── index.ts           ← inicialização do servidor
│       ├── app.ts             ← rotas da API, autenticação, tratamento de erros
│       ├── db.ts              ← conexão, configurações padrão, auditoria
│       ├── money.ts           ← cálculos financeiros puros (testados)
│       ├── stock.ts           ← único ponto que altera saldo de estoque
│       ├── services/          ← regras de negócio: pedidos, estoque, compras, despesas, relatórios
│       ├── create-user.ts     ← criar usuário pela linha de comando
│       └── *.test.ts          ← testes automatizados
├── web/
│   └── src/
│       ├── pages/             ← uma tela por seção do menu
│       ├── components/        ← componentes de interface, layout responsivo
│       └── lib/               ← chamadas à API, formatação BR, datas
├── Dockerfile
└── .env.example
```

### Por que SQLite e não Supabase?

O pedido preferia Supabase/PostgreSQL. Neste ambiente não havia como criar e configurar um projeto Supabase, e o próprio pedido autorizava uma alternativa **que realmente persiste os dados**. A escolha foi SQLite no servidor:

- **Os dados são salvos em disco de verdade**: continuam lá depois de atualizar a página, reiniciar o servidor ou entrar de novo.
- O banco **nunca é exposto ao navegador**. Todo acesso passa pela API, que exige login e valida tudo. Por isso não são necessárias políticas RLS: nenhum cliente fala direto com o banco.
- Toda operação que mexe em várias tabelas (confirmar compra, cancelar, receber, dar baixa) roda numa **transação atômica**: ou tudo é gravado, ou nada é.
- Para uma marmitaria (um estabelecimento, poucos usuários ao mesmo tempo), SQLite é rápido e confiável, e o backup é copiar um arquivo.

Se no futuro for preciso migrar para PostgreSQL/Supabase, as regras de negócio já estão isoladas em `server/src/services`. Seria preciso trocar a camada de acesso (`db.ts`) e traduzir `schema.sql`. Isso **não** está feito (ver Pendências).

---

## 2. Instalar e executar localmente

**Jeito mais fácil (Windows):** instale o Node.js (nodejs.org), extraia o zip e dê **dois cliques em `INICIAR.bat`**. Na primeira vez ele instala tudo (alguns minutos) e depois abre o sistema no navegador. Deixe a janela preta aberta enquanto usa.

**Pelo terminal:**

Pré-requisito: **Node.js 22.13 ou superior** (recomendado: a versão LTS mais recente).

```bash
npm install          # instala dependências do servidor e do front-end
npm run build        # gera o front-end (web/dist)
npm start            # inicia em http://localhost:3001
```

Abra **http://localhost:3001** no navegador.

### Modo desenvolvimento (recarrega ao editar)

Em dois terminais:

```bash
npm run dev:server   # API em http://localhost:3001
npm run dev:web      # interface em http://localhost:5173 (encaminha /api para a 3001)
```

### Testes

```bash
npm test             # 103 testes automatizados
npm run typecheck    # verificação de tipos do servidor e do front-end
```

---

## 3. Banco de dados

- O banco é criado **automaticamente** na primeira execução, em `server/data/marmitaria.db` (ou na pasta indicada em `DATA_DIR`).
- O script das tabelas está em `server/db/schema.sql` e é aplicado a cada inicialização (`CREATE TABLE IF NOT EXISTS`, sem perder dados).
- **Valores em dinheiro** são guardados como **inteiros em centavos** e **quantidades** como inteiros em **milésimos** (1,5 kg = 1500). Isso evita os erros de arredondamento de números decimais.
- Datas do estabelecimento ficam em `AAAA-MM-DD` e horários em `HH:MM`, no fuso **America/Sao_Paulo**. Os registros de auditoria guardam o instante exato em UTC.
- **Backup**: copie o arquivo `marmitaria.db` com o servidor parado, ou use `sqlite3 marmitaria.db ".backup copia.db"` com ele rodando.

Tabelas: `users`, `settings`, `product_categories`, `suppliers`, `products`, `purchases`, `purchase_items`, `stock_movements`, `orders`, `order_items`, `expenses`, `payments` (recebimentos e pagamentos), `recipes` / `recipe_items` (fichas técnicas, preparadas para o futuro) e `audit_log`.

---

## 4. Criar o primeiro usuário

**Pela tela (recomendado):** na primeira vez que abrir o sistema, aparece “Primeiro acesso”. Informe nome, e-mail e senha (mínimo 6 caracteres). Esse usuário vira o **responsável**. Depois disso, essa tela de cadastro é bloqueada.

**Pela linha de comando** (inclusive para usuários adicionais):

```bash
npm run create-user -- "Maria" maria@exemplo.com "senha-segura-123"          # responsável
npm run create-user -- "Ana" ana@exemplo.com "outra-senha-123" staff         # funcionário
npm run nova-senha -- maria@exemplo.com "senha-nova"                         # esqueceu a senha
```

O **funcionário** registra pedidos, compras, saídas e despesas. Somente o **responsável** pode: alterar configurações, fazer ajuste de inventário, corrigir manualmente o horário de entrega e estornar recebimentos.

---

## 5. Publicar na internet

O sistema é um único serviço Node que entrega a API e as telas. Precisa de **um disco persistente** para o arquivo do banco.

### Opção A — Docker (Railway, Render, Fly.io, VPS)

```bash
docker build -t marmitaria .
docker run -d -p 3001:3001 -v marmitaria-dados:/data \
  -e JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
  marmitaria
```

Na hospedagem, configure um **volume persistente montado em `/data`** e a variável `JWT_SECRET`.

### Opção B — VPS sem Docker

```bash
git clone <seu-repositório> && cd marmitaria
npm ci && npm run build
cp .env.example .env    # edite JWT_SECRET
npm start               # use pm2 ou systemd para manter rodando
```

Coloque um proxy com **HTTPS** na frente (Caddy ou Nginx + Let's Encrypt). **Não publique sem HTTPS**, porque a senha trafega no login.

### Opção C — Oracle Cloud grátis (recomendado para começar, versão 27)

Script pronto em `publicar/instalar.sh` para um servidor **Ubuntu** (Oracle Cloud "Always Free" ou qualquer VPS):

```bash
sudo apt-get install -y unzip && unzip marmitaria.zip
sudo bash marmitaria/publicar/instalar.sh SEU-NOME.duckdns.org
```

Ele instala Node 22, Caddy (HTTPS automático), o serviço `marmitaria` (reinicia sozinho), libera as portas 80/443,
e agenda **cópia de segurança diária às 3h30** (guarda 30 dias em `/var/lib/marmitaria/copias`).
Para **atualizar**, mande o zip novo, descompacte por cima e rode `sudo bash marmitaria/publicar/instalar.sh` de novo — os dados não são tocados.
Para **voltar uma cópia**: `sudo bash /opt/marmitaria/publicar/restaurar.sh ARQUIVO.db`.
A responsável também pode baixar uma cópia em **Configurações → Cópia de segurança**.

### Opção D — Render + Neon, grátis (versão 28)

Para hospedagens cujo disco é apagado ao reiniciar (como o **Render grátis**), o banco é guardado num **Postgres**
(ex.: **Neon**, grátis) pela variável `DATABASE_URL`. O sistema continua usando SQLite por dentro:
- **na partida**, busca a última cópia no Postgres antes de abrir. Se existe cópia e ela não pode ser lida, **não abre**
  (nunca começa vazio por cima da cópia boa);
- **depois de cada gravação**, uns 7 segundos depois manda a cópia completa compactada (tabela `marmitaria_copias`);
- **ao desligar** (SIGTERM), manda a última cópia;
- guarda **uma cópia por dia, por 30 dias** (`dia-AAAA-MM-DD`).

O arquivo `render.yaml` já configura tudo: no Render, **New → Blueprint**, escolha o repositório e cole o `DATABASE_URL` do Neon.
Banco e serviço na **mesma região** (Ohio). Para não "dormir" após 15 min, um monitor grátis (UptimeRobot)
pode abrir `/api/health` a cada 5 min. Um serviço ligado o mês todo cabe nas 750 h grátis.
Teste com Postgres: `TEST_PG_URL=postgres://... npm test`.

### Variáveis de ambiente (`.env.example`)

| Variável | Uso |
|---|---|
| `JWT_SECRET` | **Obrigatória em produção.** Segredo das sessões. Sem ela, o servidor se recusa a iniciar com `NODE_ENV=production`. |
| `PORT` | Porta HTTP (padrão 3001) |
| `DATA_DIR` | Pasta do banco (padrão `server/data`) |
| `NODE_ENV` | `production` em produção |
| `CORS_ORIGIN` | Só se o front-end estiver em outro domínio |
| `DATABASE_URL` | Opcional. Postgres onde o banco é guardado (hospedagem sem disco permanente, ex.: Render + Neon) |
| `MODULOS_EXTRAS` | Liga módulos extras: `fichas`, `estoque_completo` ou `todos` (veja “Versão simples e módulos extras”) |

Em desenvolvimento, sem `JWT_SECRET`, o servidor gera um segredo aleatório e o guarda em `DATA_DIR/.jwt_secret`.

---

## 6. Regras de negócio implementadas

### Pedidos
- Número automático e sequencial; origem **Presencial** ou **WhatsApp**; cliente e telefone opcionais.
- Vários tamanhos no mesmo pedido, cada um com quantidade, preço e observações (“sem cebola”).
- **Total = subtotal + frete cobrado − desconto.** São recusados quantidade zero ou fracionada, valores negativos e desconto que deixe o total negativo (validação na tela **e** no servidor).
- **Retirada ou entrega:** dois botões grandes no pedido. Na **retirada** somem o endereço, o frete e o custo do entregador. Na **entrega** aparecem os endereços do cliente (ou o campo para digitar um) e os valores de frete.
- **Frete cobrado do cliente** e **custo pago ao entregador** são campos separados. Na entrega, os dois vêm da distância (veja “Taxa de entrega pela distância”) e continuam editáveis.
- O preço padrão vem das Configurações, mas **cada pedido guarda o próprio preço**. Mudar o preço depois não altera pedidos antigos.
- Status da **entrega:** Pendente → Em preparo → Pronto (esperando entregador) → Saiu para entrega → Entregue.
- Status da **retirada:** Pendente → Em preparo → Pronto para retirar → Retirado. Não existe “Saiu para entrega” na retirada (o servidor também recusa). Se uma entrega que já saiu for trocada para retirada, ela volta para “Pronto para retirar”.
- Qualquer pedido pode ser **Cancelado**. Há um botão “→ próximo status” direto na lista, que segue o caminho certo de cada tipo. As mensagens de WhatsApp também: a retirada não oferece “saiu para entrega” e a entrega não oferece “pronto para retirar”.
- Ao marcar **Entregue** ou **Retirado**, a data e o horário reais são gravados na hora. O responsável pode corrigir.
- **Atrasado** = passou do horário previsto e não está entregue nem cancelado. Há um filtro rápido com contador.
- **Cancelar** exige confirmação e motivo. O pedido fica no histórico com os valores preservados, sai das vendas, e os recebimentos são **estornados** (lançamento negativo, nada é apagado). Um pedido cancelado pode ser reaberto.
- Recebimentos parciais, com status “A receber / Parcial / Pago”.
- Impressão de comanda (formato de cupom, com as observações de preparo em destaque).
- Proteção contra duplicidade: cada formulário envia uma chave única. Clique duplo ou reenvio após queda de conexão **não cria um segundo pedido**.

### Estoque
- O saldo **só muda por movimentação** (saldo inicial, compra, saída, ajuste, estorno). Editar o produto não altera a quantidade nem o histórico.
- Cada movimentação guarda **saldo anterior, entrada, saída, saldo posterior, data/hora, motivo e usuário**. Existe uma verificação automática de que saldo = soma do histórico (`GET /api/stock/verify`, coberta pelos testes).
- Saída maior que o saldo é **bloqueada**. A correção de contagem física é feita por **Ajuste de inventário** (só o responsável), que registra a diferença.
- Alertas de **estoque baixo** (saldo ≤ mínimo) e **sem estoque**, com ícone e texto além da cor.

### Compras
- Vários produtos por compra, informando **valor unitário ou valor total** por item (o outro é calculado: 10 kg por R$ 60,00 → R$ 6,00/kg).
- Desconto e frete da compra são **rateados** entre os itens para formar o custo real.
- O custo do produto é atualizado pelo **custo médio ponderado**.
- A confirmação grava compra, itens, entradas de estoque e pagamento numa **única transação**, com chave de idempotência: **a compra nunca entra duas vezes no estoque**.
- Valor total × valor pago, com pagamentos parciais e “a pagar”.
- Edição só de dados que não afetam estoque ou valores (fornecedor, nota fiscal, vencimento, observações). Para corrigir quantidades, a compra é **cancelada de forma auditável** (estorna o estoque e os pagamentos) e lançada de novo. O cancelamento é recusado se o estoque já foi consumido.


### Nota fiscal: bipar, importar XML ou foto
Na tela **Nova compra**, o quadro **“Preencher pela nota fiscal”** oferece três caminhos:

| Caminho | O que preenche | Precisa de |
|---|---|---|
| **Bipar a chave** (leitor de código de barras USB, que funciona como teclado, ou digitar os 44 dígitos) | Nº da nota, fornecedor (se o CNPJ já estiver cadastrado) e **bloqueio de nota repetida** | Nada |
| **Importar XML** (arquivo que o fornecedor envia por e-mail) | **Tudo**: fornecedor, data, nº, itens, quantidades, valores, frete e desconto | Nada |
| **Foto da nota** (celular ou arquivo) | Tudo o que a IA conseguir ler. **Sempre confira** | Internet + `ANTHROPIC_API_KEY` no `.env` |

- A chave é validada pelo dígito verificador. Uma nota já lançada numa compra confirmada **não pode entrar de novo** (verificado na tela e no banco). Se a compra for cancelada, a nota pode ser lançada de novo.
- Cada item da nota é ligado a um produto do estoque: **✔ reconhecido** (vínculo salvo), **? sugerido pelo nome** (confira) ou **＋ produto novo**. Todo item que o sistema ainda não conhece **é cadastrado automaticamente** ao confirmar a compra, com nome limpo (“ARROZ TIPO 1 FD 6X5KG” → “Arroz Tipo 1”) e unidade sugeridos, ambos editáveis. Os produtos são criados na mesma transação da compra: se algo falhar, nada fica pela metade. Isso permite começar com o estoque vazio e montá-lo a partir das primeiras notas.
- **Conversão de unidade**: “1 FD = 30 kg”, “1 CX = 100 unidades”. O produto escolhido e a conversão ficam guardados por fornecedor (pelo código do item e pela descrição), e as próximas notas desse fornecedor vêm preenchidas.
- O total da compra é comparado com o total da nota (“✔ bate com a nota” ou um aviso em vermelho).
- Seguro, IPI, ST e outras despesas da nota entram em “Frete e outras despesas”, para que o custo dos produtos fique correto.
- O fornecedor é cadastrado automaticamente (nome + CNPJ) se ainda não existir.
- **Ativar a foto:** crie uma chave em console.anthropic.com, coloque `ANTHROPIC_API_KEY=...` no arquivo `.env` na pasta do sistema (copie de `.env.example`) e reinicie. A chave fica **só no servidor**, nunca no navegador. É cobrado por uso, em geral poucos centavos por nota.
- **Não implementado:** baixar o XML automaticamente da Sefaz a partir da chave. Isso exige o certificado digital A1 (e-CNPJ) da empresa e a manifestação do destinatário.


### Login e “Esqueci a senha”
- **Login simples:** e-mail e senha (mínimo **6** caracteres), com botão de **mostrar senha**. A pessoa fica **conectada por 30 dias** naquele aparelho; “Sair” no menu desconecta.
- **Esqueci a senha:** sem e-mail configurado, a tela orienta a falar com quem instalou, que cria uma senha nova no servidor com `npm run nova-senha -- email senha-nova` (nenhum dado é perdido). O código de recuperação de 16 letras foi **removido** para simplificar.
- **Link por e-mail (opcional):** configure `SMTP_*` e `APP_URL` no `.env` e “Esqueci a senha” passa a mandar um link. O link vale **1 hora**, é de **uso único**, e só o mais recente vale. A resposta é a mesma para e-mails cadastrados ou não, para não revelar quem tem conta.
- **Trocar senha:** em Configurações → Segurança. Trocar ou redefinir a senha (inclusive pelo comando) **desconecta todos os outros aparelhos**.
- Login e redefinição têm limite de tentativas e ficam no histórico de auditoria.


### Tema claro e escuro
- Botão **Tema claro/escuro** no menu lateral (no celular, ícone ☀️/🌙 no topo) e na tela de login.
- Em **Configurações → Aparência**: Claro, Escuro ou **Automático** (segue o tema do Windows ou do celular). A escolha fica salva **no aparelho/navegador**, então cada pessoa pode usar o seu.
- A impressão (comanda e relatórios) sai **sempre clara**, mesmo no tema escuro.
- Como funciona: as cores do Tailwind usam variáveis CSS (`web/src/theme-vars.css`, ligadas ao Tailwind 4 no `@theme` de `web/src/index.css`). No escuro, a escala de cinzas é invertida, e as cores de status invertem os tons claros e escuros, mantendo botões e destaques.


### Ficha técnica (custo, lucro e baixa automática) — módulo extra `fichas`
- Menu **Fichas técnicas**: para cada tamanho de marmita, informe os ingredientes e a quantidade por marmita, na unidade do produto (ex.: 0,150 kg de arroz, que aparece como "= 150 g", e 1 marmitex).
- O sistema mostra **custo**, **lucro** e **margem** de cada tamanho, usando o custo médio dos ingredientes, que é atualizado a cada compra. Abaixo da **margem mínima** configurada aparece um alerta na ficha e na tela Hoje.
- **Baixa automática:** escolha em que momento os ingredientes saem do estoque (ao entregar, que é o padrão; ao sair para entrega; ao ficar pronto; ao começar o preparo; ou desativado). Cada pedido baixa **uma única vez**. Cancelar, voltar de status ou editar o pedido **devolve/ajusta** o estoque com movimentações de estorno no histórico. Tamanho sem ficha não baixa nada.
- A baixa **não trava o pedido** se faltar estoque, porque a cozinha já usou os ingredientes: o saldo pode ficar negativo e aparece no alerta “sem estoque”.
- O custo dos ingredientes baixados entra no **resultado operacional estimado** dos relatórios.

### Taxa de entrega pela distância
- **Não precisa cadastrar bairros.** Em **Configurações → Taxa de entrega pela distância** ficam faixas por quilômetro: “até X km”, frete cobrado do cliente e valor pago ao entregador.
- Valores iniciais (só um ponto de partida, **ajuste para a sua realidade**): até 2 km R$ 5 (entregador R$ 4); até 4 km R$ 7 (R$ 6); até 6 km R$ 10 (R$ 8); até 8 km R$ 13 (R$ 10).
- No pedido, ao escolher o endereço, o sistema mede a distância pelas ruas e preenche o frete e o custo do entregador pela faixa. Os valores continuam editáveis; depois de mexer à mão, eles não são trocados sozinhos até escolher outro endereço.
- Acima da maior faixa, ou se o mapa não achar o endereço, aparece um aviso para informar o frete na hora.
- Editando um pedido antigo, o frete gravado é mantido até trocar o endereço.

### Caixa do dia
- Menu **Caixa do dia**: **abrir** com o troco inicial (sugere o que ficou na gaveta no último fechamento), registrar **sangrias** (retiradas) e **suprimentos** (dinheiro colocado).
- **Dinheiro esperado** = troco + recebido em dinheiro − contas pagas em dinheiro + suprimentos − sangrias.
- **O que é dinheiro:** a forma de pagamento “Dinheiro” (também vale “dinheiro”, “Dinheiro (espécie)” ou “Espécie”). Pix e cartões aparecem por forma, para conferir com a maquininha ou o banco, mas não entram na gaveta.
- **Forma de pagamento obrigatória** ao registrar algo já pago (pedido, recebimento, compra, despesa e “Marcar paga”). Sem a forma, o sistema não sabe se o dinheiro entrou na gaveta. Se ainda existir algum valor “Não informada” num dia, o caixa mostra um aviso.
- **Corrigiu a forma no pedido** (ex.: marcou Pix, mas foi dinheiro): os recebimentos do pedido mudam junto e o caixa já conta certo. Só não acontece quando o pedido foi pago em duas formas diferentes.
- **Encomenda paga hoje para outro dia:** o dinheiro entra no caixa de **hoje**, que é quando ele chegou. Pedido de um dia que já passou, lançado depois, continua no dia dele.
- **Sangria** maior que o dinheiro que deveria ter na gaveta é recusada.
- **Lançamento depois de fechar:** se entrar ou sair dinheiro com a data de um caixa já fechado, o fechamento não muda, mas aparece um aviso com o valor e uma linha a mais na conta, para os números baterem. É só reabrir e fechar de novo.
- **Fechar:** informe o dinheiro contado. O sistema mostra se sobrou ou faltou, guarda quanto ficou na gaveta (o campo já vem com o troco do dia) e permite conferir Pix/cartões com os valores da maquininha. O responsável pode **reabrir** (fica no histórico). Também dá para imprimir o fechamento.

### Mensagens de WhatsApp
- Botão **“Avisar no WhatsApp”** no pedido (e ícone na lista), quando o cliente tem telefone com DDD. Abre o WhatsApp com a mensagem do status atual já preenchida, editável antes de enviar.
- Modelos editáveis em **Configurações → Mensagens de WhatsApp**, com `{nome}`, `{numero}`, `{total}`, `{itens}`, `{previsao}` e `{estabelecimento}`.

### Aviso de contas a pagar
- A tela Hoje mostra **contas vencidas**, **que vencem hoje** e **nos próximos dias** (compras e despesas em aberto). O número de dias é configurável; o padrão é 3.
- Se houver conta vencida ou vencendo hoje, aparece uma **faixa vermelha no topo** de todas as telas.


### Clientes e endereços
- **Novo pedido:** o primeiro campo é o **telefone**, já focado e formatado enquanto digita. Ao completar DDD + número, o sistema **busca o cadastro sozinho** (aceita `(11) 98888-7777`, `11988887777` ou `+55 11 98888 7777`).
  - **Cliente encontrado:** preenche o nome e repete como foi o último pedido: retirada, ou entrega com o mesmo endereço já marcado. Na entrega, os **endereços salvos** aparecem como opções (Casa, Trabalho…, Outro endereço).
  - **Telefone novo:** aparece “Cadastrar cliente” (marcado): basta informar o nome e, se for entrega, o endereço (com “Salvar este endereço no cadastro”). Cliente e endereço são gravados **na mesma operação** do pedido; se o pedido falhar, nada fica pela metade.
  - **Telefone inválido** (sem DDD, DDD inexistente, celular sem o 9) mostra o motivo e impede o registro.
- **Endereço com sugestões:** ao digitar a rua, aparecem sugestões do mapa (as mais perto do restaurante primeiro). Ao tocar numa, **rua, número e bairro são preenchidos sozinhos** e a distância com o frete aparece logo abaixo. Se a sugestão vier sem número, o sistema avisa e deixa o cursor pronto para digitar. Sem a chave do mapa, o campo funciona como texto normal.
- **Taxa de entrega:** ao escolher o endereço, o **frete cobrado** e o **custo do entregador** vêm da **distância** (veja “Taxa de entrega pela distância”). Os valores continuam editáveis.
- **Menu Clientes:** lista com busca por nome ou telefone, pedidos, último pedido e total gasto. O **perfil** mostra dados, observações, **endereços** (adicionar, editar, excluir), **histórico de pedidos** com o endereço usado em cada um, e o botão **Novo pedido** (abre o pedido já com o cliente).
- **Sem duplicidade:** o telefone é único no banco. Cadastrar ou editar com um telefone que já existe é recusado, com o nome do cliente existente e um botão para abrir o cadastro dele.
- **Endereço do pedido é uma cópia:** o pedido guarda o endereço usado na hora da compra. Editar ou excluir o endereço depois **não altera pedidos antigos**. O servidor confere que o endereço escolhido pertence ao cliente do pedido.
- **Privacidade:** dados de clientes só aparecem com login. O responsável pode **excluir o cadastro**: nome, telefone e endereços saem do cadastro, e os pedidos antigos continuam no histórico financeiro sem vínculo. Todas as alterações ficam no histórico de auditoria.
- **Pedidos antigos:** na primeira execução desta versão, os pedidos já existentes com telefone válido viram clientes (um por telefone) com os endereços usados, e os pedidos são vinculados.
- **Distância:** veja “Distância até o cliente”, logo abaixo.


### Distância até o cliente
- Ao digitar ou escolher **rua e número** de um endereço (no pedido ou no cadastro do cliente), aparece a **distância pelas ruas** a partir do restaurante, o tempo aproximado e o frete da faixa, por exemplo “3,2 km · ~9 min · frete R$ 7,00”. A distância também aparece nos **endereços salvos** (no pedido e no perfil) e no **detalhe do pedido**.
- Ponto de partida: **Configurações → Endereço do restaurante** (já vem *R. João Penteado, 2220 - Jardim América, Ribeirão Preto - SP, 14020-180*). A **Cidade das entregas** completa o endereço do cliente, que só precisa ter rua, número e bairro.
- Se o mapa achar só a rua (sem o número exato), o selo fica amarelo com “aproximado: confira o número”. Se não achar, aparece um aviso em vermelho. Nada disso impede o pedido.
- O tempo é **sem trânsito**, de carro (para moto é parecido). Cada endereço é consultado **uma vez só** e fica guardado no banco por 180 dias, o que economiza a cota do mapa. Há um limite de 150 consultas novas por pessoa por hora.
- **Como ativar** (a chave fica só no servidor, nunca no navegador):
  1. Em console.cloud.google.com, crie um projeto e ative **duas APIs**: **Routes API** (distância e frete) e **Places API (New)** (sugestões de endereço enquanto digita).
  2. O Google exige uma **conta de faturamento** (cartão) para liberar a chave, mesmo no uso gratuito. Hoje a cota grátis da Routes API (Compute Routes Essentials) é de cerca de **10.000 consultas por mês**; acima disso, cerca de US$ 5 a cada 1.000. As sugestões usam “sessões”: as letras digitadas numa mesma busca e o endereço escolhido contam juntos, e só o detalhe do endereço escolhido (Place Details Essentials) é cobrado, também com cota grátis mensal. Confira os valores atuais no site do Google.
  3. Em **Credenciais**, crie uma **chave de API** e **restrinja** a chave às duas APIs acima.
  4. Coloque `GOOGLE_MAPS_API_KEY=...` no arquivo `.env` e reinicie.
- Limites por pessoa e por hora: 150 distâncias novas e 600 buscas de endereço. Isso protege a cota se alguém deixar o dedo no teclado.
- Sem a chave, o sistema funciona normalmente: o endereço é digitado à mão e a distância não aparece. Se só a Places API faltar, a distância continua funcionando e só as sugestões não aparecem.

### Identidade visual
- Cores tiradas da logo: **amarelo #FDD661** (topo, menu, tela de entrada) e **marrom #986400** (botões, destaques e letras). Os cinzas são quentes, para combinar.
- Letras: **Oranienbaum** nos títulos e no nome (a mesma família da logo) e **Josefin Sans** no slogan “O sabor de casa, todos os dias.” As letras vêm junto com o sistema e funcionam sem internet.
- A logo aparece na tela de entrada, no ícone da aba do navegador e no ícone de “Adicionar à tela inicial” do celular, que abre o sistema como um aplicativo.
- No tema escuro, o topo continua amarelo, com a marca, e o resto fica escuro.

### Cardápio do dia (Opção 1 / Opção 2)
- Menu **Cardápio do dia** (e o cartão “Montar o cardápio de hoje” na tela **Hoje**): de manhã, escreva **o que vai em cada opção** e toque nos **tamanhos** de cada uma. Botões **Hoje** / **Amanhã** permitem montar o do dia seguinte na véspera.
- **Repetir o cardápio anterior:** se o dia ainda não foi montado, aparece um botão para copiar o último cardápio salvo e só ajustar.
- **Esgotou:** na tela Hoje, cada opção tem o botão **Esgotou** / **Voltou**. Opção esgotada fica **desabilitada no pedido novo** (o servidor também recusa). Pedidos que já tinham aquela opção continuam podendo ser editados.
- **Trocas do dia:** grupos como “Para trocar a carne” e “Para trocar a guarnição”, um item por linha. Entram no texto do WhatsApp e na imagem. “Repetir o cardápio anterior” copia as trocas também.
- **Imagem do cardápio:** em Cardápio do dia, o sistema monta sozinho uma imagem em estilo limpo (fundo branco, letras da marca, linhas finas separando as opções, preços alinhados à direita e o amarelo da logo só como acento): o dia da semana, cada opção com o que vai nela, tamanhos e preços, as trocas e o WhatsApp no rodapé. Com foto, ela ocupa o topo de ponta a ponta. Dois formatos: **Status / Stories** (1080×1920) e **Feed do Instagram** (1080×1350). Se o cardápio for grande, as letras diminuem para caber; opção esgotada não aparece.
  - **Foto do prato (opcional):** escolha uma foto do celular; o sistema recorta e ajusta luz, contraste e cor sozinho (sem exagerar). A foto não é guardada no servidor.
  - **Compartilhar** (no celular abre direto WhatsApp/Instagram) ou **Baixar imagem**. Tudo é feito no próprio aparelho, sem programa de edição.
- **Mandar no WhatsApp:** o sistema monta o texto do cardápio com pratos e preços (sem as opções esgotadas) e abre o WhatsApp para escolher o contato, grupo ou status; também dá para **copiar o texto**.
- **No pedido:** cada marmita tem os botões de opção com o prato do dia escrito embaixo e só os tamanhos daquela opção (Opção 1 → 350 g e 450 g; Opção 2 → 650 g e 750 g). A opção é **obrigatória** em pedidos novos. O pedido **guarda uma cópia** do que tinha na opção naquele dia.
- Se o dia não foi montado, o pedido usa o **Modelo do cardápio** (Configurações): nomes dos botões, tamanhos e uma descrição padrão opcional, com um aviso.
- A opção aparece na **lista de pedidos**, no **detalhe**, na **comanda impressa**, na **mensagem de WhatsApp** (`{itens}`) e no **histórico do cliente**. A tela Hoje e o Resumo diário mostram **marmitas por opção e tamanho**, para a cozinha saber quanto preparar.

### Versão simples e módulos extras
O sistema vem **enxuto** para o dia a dia. Menu: Hoje, Cardápio do dia, Pedidos, Clientes, Caixa do dia, Estoque, Compras, Despesas e contas, Relatórios e Configurações.
- **Tela Hoje:** cardápio do dia, pedidos (pendentes, em preparo, prontos, saiu para entrega, entregues ou retirados), marmitas por opção, dinheiro do dia (vendido, recebido, a receber, gastos), aviso de **estoque acabando** e contas a pagar. Outros períodos ficam em Relatórios.
- **Estoque simples:** lista com quanto tem de cada item, filtro **Acabando**, e três ações: **Usei** (usei na cozinha / estragou), **Contei** (digita quanto tem de verdade; só o responsável) e **Editar**. Cadastro com nome, medida, quanto tem agora e “avisar quando ficar abaixo de”. As **compras somam sozinhas**. O histórico de cada item continua guardado.
- **Módulos extras** (para ligar depois, inclusive como plano pago): no `.env`, `MODULOS_EXTRAS=fichas,estoque_completo` (ou `todos`) e reinicie.
  - `fichas`: menu Fichas técnicas, baixa automática dos ingredientes e alerta de lucro baixo. **Desligado, nenhum pedido mexe no estoque sozinho** e a API das fichas responde que o recurso não está ativado.
  - `estoque_completo`: tela de estoque com custo, valor, categorias e fornecedores, ajuste de inventário e menu Saídas de estoque.
  - Os dados nunca são apagados: ligar ou desligar um módulo só mostra ou esconde as telas.

### Despesas
- Categorias configuráveis, status pago/pendente, vencimento (“Vencida” em destaque).
- Se a descrição parecer compra de mercadoria, o sistema pede confirmação de que **não é uma compra já lançada**, para evitar contar duas vezes.
- Despesa errada é **anulada** (com motivo e estorno do pagamento), não apagada.

### Relatórios e indicadores financeiros
O sistema separa:

| Indicador | Significado |
|---|---|
| Vendas registradas | Soma dos pedidos não cancelados (pela data do pedido). **Não é dinheiro recebido.** |
| Recebido | Pagamentos de clientes efetivamente registrados (pela data do recebimento) |
| A receber | Pedidos do período ainda não pagos |
| Frete cobrado / Custo com entregas | O que o cliente pagou de frete × o que foi pago ao entregador |
| Compras | Valor das compras confirmadas |
| Despesas | Outros custos (sem as compras) |
| Pagamentos feitos | Compras e despesas efetivamente pagas |
| Contas a pagar | Compras e despesas do período ainda em aberto |

**Resultado operacional (estimativa):** vendas − custo das entregas − despesas − custo dos insumos baixados do estoque (consumo, perda, descarte, uso interno, pelo custo médio). **As compras não são subtraídas diretamente**, porque viram custo quando os insumos são usados. Despesas na categoria “Pagamento a entregadores” não são somadas de novo ao custo de entrega dos pedidos. A tela mostra o cálculo por extenso e **avisa quando faltam dados** (por exemplo, nenhuma baixa de insumos registrada no período).

- **Resumo diário** (qualquer data), **resumo mensal** (com gráfico de evolução diária, despesas por categoria e comparativo com o mês anterior quando há dados) e **relatório de estoque** (quantidades, valor estimado pelo custo médio, abaixo do mínimo, entradas e saídas do período, mais movimentados).
- Exportação **CSV** (separador `;`, UTF-8 com BOM para abrir certo no Excel, datas DD/MM/AAAA, valores em R$) e **PDF** pela impressão do navegador (“Salvar como PDF”).

### Equipe: dia a dia x gestão (financeiro só da responsável)
- O sistema tem duas partes. **Dia a dia** (todo mundo): Hoje, Pedidos, Cardápio do dia, Clientes e Estoque. **Gestão · só você** (só a responsável): Caixa do dia, Compras, Despesas e contas, Relatórios e Configurações.
- **Funcionário** vê o total do pedido, escolhe a forma de pagamento e marca como pago. **Não vê**: caixa, compras, despesas, relatórios, lucro, gastos, custo do estoque, valor do estoque, quanto cada cliente já gastou, custo do entregador e contas a pagar. A tela Hoje dele mostra só pedidos, marmitas e estoque acabando.
- O bloqueio é no **servidor**: mesmo digitando o endereço da tela ou chamando a API, o funcionário recebe “Esta parte é só da responsável”. Os custos nem chegam ao celular dele.
- **Configurações → Equipe:** a responsável adiciona funcionários (nome, e-mail e senha), troca a senha deles e **desativa** o acesso (a pessoa sai de todos os aparelhos na hora; o que ela lançou continua no histórico). Dá para ter mais de uma responsável. Ninguém consegue desativar a si mesmo nem tirar a última responsável.
- O funcionário tem **Minha conta** (tema e a própria senha).
- Se o funcionário editar um item do estoque, o custo que a responsável colocou é mantido.

### Pedido rápido
- O pedido é feito em 4 passos numerados: **1 Cliente** (telefone acha o cadastro; Balcão ou WhatsApp), **2 Retirada ou entrega** (na entrega, o frete vem sozinho pela distância e dá para mudar ali mesmo), **3 Marmitas** (toca na opção, no tamanho e usa − / + para a quantidade; observação na mesma linha) e **4 Pagamento** (botões da forma e “Já pagou” ou “Paga depois”).
- O total fica grande no rodapé. Preço diferente de uma marmita: “mudar preço” na linha.
- O que raramente muda fica em **Mais opções** (fechado): desconto, previsão de horário, data e hora do pedido, status inicial, pagou só uma parte, observação geral e, só para a responsável, o pago ao entregador.

### Impressora da cozinha (todo pedido sai impresso)
- No computador da cozinha, ligado à impressora (térmica de 80 mm ou 58 mm, ou qualquer impressora), fica aberta a tela **Cozinha (impressora)**. Todo pedido registrado, de qualquer celular, sai impresso **sozinho** em poucos segundos.
- **Pedido alterado** sai de novo com “PEDIDO ALTERADO”; **cancelado** sai com “CANCELADO — NÃO FAZER” (se ainda não tinha impresso, só sai da fila). Pedido reaberto sai com “PEDIDO REABERTO”.
- A comanda tem: número grande, horário, RETIRADA ou ENTREGA em destaque, nome do cliente, cada marmita (quantidade, tamanho, opção e o que vai nela), observações em letra grande, total de marmitas, endereço e telefone na entrega e “PAGO” ou “COBRAR R$ …” (pode desligar).
- **Tamanho da folha:** a comanda mede a si mesma e manda para a impressora uma folha do tamanho exato (ex.: 80 mm × 115 mm). Na térmica, corta no lugar certo, sem tira de papel em branco; numa impressora comum, sai pequena no topo da folha. Cada via é uma folha. Em Configurações dá para escolher letra **menor** se a comanda ficar comprida. “Imprimir aqui”, no pedido, usa a mesma comanda.
- **Nunca imprime duas vezes**, mesmo com duas telas da cozinha abertas ou clique duplo. Se a internet cair, os pedidos ficam na fila e saem quando voltar. Ao abrir a tela de manhã, não imprime pedidos de mais de 12 horas atrás.
- **Imprimir de novo:** botão “De novo” na tela da cozinha ou “Imprimir na cozinha” no detalhe do pedido (sai “2ª VIA”).
- **Configurações → Impressora da cozinha** (responsável): ligar/desligar, papel 80 ou 58 mm, 1 a 3 vias (ex.: uma para o entregador), imprimir alterações, imprimir cancelamentos e mostrar ou não o valor.
- **Preparar o computador da cozinha (uma vez):**
  1. Deixe a impressora como **impressora padrão** do Windows.
  2. Abra pelo atalho **INICIAR-COZINHA.bat** (troque o endereço dentro dele se o sistema estiver na internet). Ele abre o Chrome (ou Edge) com `--kiosk-printing`, que imprime **sem mostrar a janela de impressão**, num perfil separado.
  3. Entre com um acesso de funcionário (ex.: “Cozinha”), toque em **Ligar impressão automática** e em **Imprimir teste**. A tela fica sempre acesa e dá um bipe a cada comanda.

### Gráficos de pizza e de colunas (Relatórios)
- Nos **Resumos diário e mensal** aparecem quatro gráficos, cada um com a lista ao lado (nome, valor e porcentagem), para não depender só da cor:
  - **Para onde vai o dinheiro:** compras de mercadoria, despesas por categoria e entregadores. O custo de entregador vem dos pedidos; se não foi informado nos pedidos, usa o que foi lançado como despesa de entregador (nunca os dois, para não contar duas vezes).
  - **Como os clientes pagaram:** o que foi recebido no período por forma de pagamento (estornos descontados). Soma o mesmo que “Valores recebidos”.
  - **Marmitas vendidas:** por opção do cardápio ou por tamanho (botão para trocar), sem pedidos cancelados.
  - **Retirada x entrega:** quantidade de pedidos de cada tipo, sem cancelados.
- Botão **Pizza / Colunas** acima dos gráficos: troca os quatro de uma vez. Nas colunas, a porcentagem fica em cima de cada coluna e a lista com nome e valor fica embaixo. O sistema lembra a escolha naquele aparelho.
- **Evolução diária** (Resumo mensal): em **colunas**, mostra as vendas e os gastos (compras + despesas) de cada dia lado a lado; em **linhas**, como antes (vendas, recebido, compras e despesas).
- Mais de 8 fatias: as 7 maiores aparecem com nome e o resto vira “Outros”. Passando o dedo ou o mouse numa fatia, aparece o valor. As cores foram conferidas para daltonismo, no tema claro e no escuro.

### Integração pedidos × estoque
Criar um pedido **não** baixa ingredientes. As tabelas `recipes` e `recipe_items` (ficha técnica por tamanho) já existem, e toda baixa passa por `applyMovement` com suporte a vínculo com pedido e estorno único (`reverses_id` com índice único). Mas a baixa automática **não está ativada** (ver Pendências).

---

## 7. Critérios de aceitação: como foram verificados

| # | Critério | Verificação |
|---|---|---|
| 1 | Criar, editar e consultar pedidos | Testes + teste no navegador |
| 2 | Origem Presencial/WhatsApp identificada | Teste + navegador |
| 3 | Total do pedido correto | Testes (R$ 44,00 + R$ 5,00 − R$ 2,00 = R$ 47,00 conferido na tela) |
| 4 | Horário real da entrega registrado | Teste + navegador |
| 5 | Cadastrar produtos e fornecedores | Navegador + API |
| 6 | Compra atualiza o estoque | Teste (10 kg / R$ 60 → R$ 6/kg) + navegador |
| 7 | Compra não contabilizada duas vezes | Teste da API + clique duplo no navegador → 1 compra |
| 8 | Saída reduz o estoque | Teste + navegador (10 kg − 6 kg = 4 kg) |
| 9 | Histórico consistente | Verificação saldo × histórico sem divergências |
| 10 | Alerta de estoque baixo | Teste + navegador (Arroz 4 kg < mínimo 5 kg) |
| 11 | Despesas registradas e filtradas | Teste + navegador |
| 12 | Filtros de data dos relatórios | Teste |
| 13 | Vendas × recebimentos × compras × despesas separados | Teste + conferência manual dos totais |
| 14 | Dados persistem após atualizar e entrar de novo | Navegador (recarregar + novo login) |
| 15 | Funciona em celular e computador | Navegador em 1366 px e 390 px, sem rolagem lateral |
| 16 | Falha de conexão sem falso sucesso | Navegador com rede cortada → “Nada foi salvo”; o reenvio salvou uma única vez |
| 17 | Botões e formulários funcionam | Fluxo completo no navegador, sem erros no console |

---

## Auditoria (versão 11)

Revisão completa de código, segurança e teste de ponta a ponta. Defeitos encontrados **e corrigidos**:

| Área | Defeito | Correção |
|---|---|---|
| Segurança | Bibliotecas com falhas conhecidas: leitor de XML (crítica), envio de e-mail (alta), rotas da tela (moderada) | Atualizadas: `fast-xml-parser` 5.11.1, `nodemailer` 10.0.12, `react-router-dom` 7.18.3. `npm audit --omit=dev`: 0 vulnerabilidades |
| Segurança | XML com DOCTYPE/ENTITY podia travar o servidor | Recusado na importação (NF-e nunca usa) |
| Permissão | Funcionário conseguia estornar recebimento chamando o servidor direto | Agora só o responsável (bloqueado no servidor) |
| Permissão | Funcionário podia informar horário de entrega manual ao **criar** o pedido | Só o responsável |
| Segurança | Sem cabeçalhos básicos de proteção | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` |
| Segurança | CSV exportado podia virar fórmula no Excel (nome começando com `=`) | Texto perigoso é neutralizado; valores em R$ continuam normais |
| Validação | Datas inexistentes aceitas (30/02, 31/04) | Recusadas no servidor |
| Validação | Parâmetros inválidos na URL davam "erro interno" | Respondem 404/400 com mensagem clara |
| Validação | Dados corrompidos ou grandes demais respondiam em inglês | Mensagens em português |
| Estoque | Cancelar uma compra digitada errado deixava o **custo médio inflado** | O custo volta exatamente ao anterior (ou é recalculado sem a compra) |
| Caixa | Estornos (pedido cancelado, despesa anulada, compra cancelada) ficavam “sem forma de pagamento” | Estorno na mesma forma do pagamento original: devolução em dinheiro sai da gaveta |
| Relatórios | Custo dos insumos contava duas vezes ao editar ou cancelar pedido já baixado | Custo líquido (baixas − estornos) |
| Pedidos | Editar pedido antigo podia trocar sozinho o endereço e o frete | Mantém o que foi gravado até a pessoa mudar |
| Pedidos | Trocar o telefone deixava o nome do cliente anterior | Nome limpo ao trocar de cliente |
| Pedidos | Endereço em bairro sem taxa herdava o frete do endereço anterior | Zera e avisa para informar o frete |
| Tela | Eixo dos gráficos quebrava em duas linhas; avisos se acumulavam | Valores curtos (R$ 6 mil); no máximo 3 avisos |

**Pendências conhecidas (não são defeitos):** leitura de nota por **foto** depende da chave `ANTHROPIC_API_KEY` e não foi testada com foto real; **taxa por distância** depende de um serviço de mapas; não há tela de **usuários** (funcionários são criados pelo comando `create-user`); as ferramentas de desenvolvimento (`vite`/`vitest`) têm avisos de segurança que **só afetam o modo desenvolvimento**, não o sistema em uso.

## Segurança (versão 14)
- **Dependências:** `npm audit` mostra **0 vulnerabilidades** (inclusive as ferramentas de teste e build). Atualizados: Vitest 5, Vite 8, plugin React 6 e Tailwind CSS 4 (visual conferido no tema claro e escuro).
- **Senha curta, mas não óbvia:** mínimo de 6 caracteres. Senhas comuns (123456, senha123, marmita…), tudo igual, sequências e senhas iguais ao e-mail ou ao nome são recusadas.
- **Contra adivinhação de senha:** 8 erros seguidos do mesmo IP bloqueiam por 15 minutos, e **20 erros na mesma conta, de qualquer IP**, também bloqueiam. A resposta para e-mail inexistente é igual (mesma mensagem e mesmo tempo), para não revelar quem tem conta.
- **Sessão de 30 dias com controle:** em Configurações → Segurança, **“Sair de todos os aparelhos”** derruba todas as sessões (celular perdido, funcionário que saiu). Trocar a senha também derruba os outros aparelhos.
- **Cabeçalhos:** `Content-Security-Policy` (só código e conexões do próprio sistema; nenhum script inline), `X-Frame-Options: SAMEORIGIN` (para a moldura de celular), `nosniff`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, e `Strict-Transport-Security` quando atrás de HTTPS (`TRUST_PROXY=1`).
- **Continua valendo:** senhas com bcrypt; segredos (JWT, chave da Anthropic, SMTP) só no servidor via `.env`; consultas ao banco sempre com parâmetros; validação de todos os dados no servidor; permissões de responsável conferidas no servidor; XML com DOCTYPE recusado; CSV protegido contra fórmulas.
- **Depende da hospedagem:** usar **HTTPS**, `JWT_SECRET` longo e aleatório, e **backup** do arquivo `marmitaria.db`.

## Celular ou computador (versão 25)

- **No celular** o sistema mostra uma barra embaixo com **Hoje, Pedidos, + Novo pedido (botão do meio), Cardápio e Mais**. O "Mais" abre um menu com as outras telas.
- Botões com pelo menos 40 px de altura, campos com letra de 16 px (o iPhone não dá zoom sozinho), janelas que respeitam o entalhe e a barra do iPhone.
- **Configurações** (ou **Minha conta**, para funcionário) → **Aparência → Tela**:
  - **Automático (recomendado)**: escolhe sozinho pelo tamanho da tela.
  - **Celular**: força o jeito de celular. No computador, mostra o sistema dentro de uma moldura de celular.
  - **Computador**: força o jeito de computador (menu lateral), mesmo no celular, com a página inteira cabendo na tela.
- A escolha fica guardada em cada aparelho.
- Testado em iPhone SE, iPhone 14 e Pixel 7, com todas as telas da responsável e da funcionária: nada sai da tela e nenhum botão ficou pequeno.

## Impressora Bluetooth no celular (versão 26)

Para usar só com um celular Android e uma impressora térmica Bluetooth (ex.: **5808 Printer**, 58 mm), sem computador:

1. Pareie a impressora no Bluetooth do celular (senha costuma ser 0000 ou 1234).
2. Instale o app **RawBT** (Play Store, grátis). Nele: Conexão → Bluetooth → a impressora; papel 58 mm; codificação CP860 (Português), se tiver.
3. No sistema, em **Configurações → Impressora da cozinha**, escolha papel **58 mm**.
4. No celular, abra **Cozinha (impressora)** → **Celular com impressora Bluetooth** → **Imprimir teste**. Na primeira vez, o Android pergunta se pode abrir o RawBT: marque **Sempre**.

A partir daí, ao **registrar, alterar, cancelar ou reabrir** um pedido nesse celular, a comanda sai na hora (texto com comandos ESC/POS: número e tipo em letra grande, observações em negrito). Comandas que ficaram na fila (por exemplo, sem internet na hora) saem no próximo pedido ou pelo botão **Imprimir o que estiver esperando**. Se os acentos saírem errados, marque **"tirar os acentos"** nas Configurações. A escolha "Bluetooth" vale só para o aparelho onde foi ligada. Só funciona em Android (o iPhone não permite).

## Cardápio por botões: carnes e guarnições do dia (versão 31)

**De manhã**, no **Cardápio do dia**, a Gisa digita as **carnes do dia** e as **guarnições do dia** (pode várias de uma vez,
separadas por vírgula) e marca "Esgotou" no meio do movimento. **Arroz e feijão** vem em toda marmita (Configurações → "Vem em toda marmita").

Cada **opção** diz quanto leva (Configurações → Modelo do cardápio, ou no próprio Cardápio do dia):
**Opção 1** (350/450 g) = 1 carne + 1 guarnição; **Opção 2** (650/750 g) = 1 carne + 2 guarnições.

**No pedido**, a atendente toca: opção → tamanho → carne → guarnição(ões). Contador "1 de 2 · falta 1".
Guarnição pode repetir (2x Purê); cheio, tocar numa nova troca a última; tocar numa escolhida tira. Pode salvar com menos (cliente sem guarnição);
mais que o limite, o servidor recusa. Item esgotado ou fora do cardápio é recusado em pedido novo; na edição, o que o pedido já tinha continua valendo.
Escolhas ficam em `order_items.choices`; a descrição gravada é "Arroz e feijão, Bisteca, 2x Purê".
**Comanda**: "CARNE: BISTECA" / "GUARNIÇÕES: 2x PURÊ" em letra alta. WhatsApp e imagem listam as carnes e guarnições do dia.

## Impressão Bluetooth: formato do RawBT corrigido (versão 32)

O RawBT só entende a comanda em **base64** (`intent:base64,<bytes>#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`).
Até a v31 o texto ia direto e o RawBT imprimia só o aviso da versão grátis. Agora os bytes ESC/POS vão em base64,
com os acentos na tabela **PC860** (português, `ESC t 3`). Se a impressora mostrar acentos trocados, ligue
"tirar os acentos" em Configurações → Impressora da cozinha. Código em `web/src/lib/escpos.ts`.

## Comanda Bluetooth legível na 5808 (versão 34)

A 5808 (e parecidas) vem no **modo chinês**: letra acentuada vira ideograma ("Op妝o"). Por isso a comanda Bluetooth
sai **sempre sem acento** ("OPCAO", "GUARNICAO", "PURE") e **sempre com 32 letras por linha** (58 mm) — o "papel"
das Configurações vale só para a impressora do computador. Na tela Cozinha ficam os testes A–D e o número da versão.

## 8. Suposições adotadas

- Um único estabelecimento, fuso **America/Sao_Paulo**, moeda real (R$).
- Tamanhos do cardápio da **Gisa Gastronomia**, por peso: **350 g R$ 12,00 · 450 g R$ 14,00 · 650 g R$ 16,00 · 750 g R$ 18,00** (editáveis em Configurações). Instalações antigas que ainda tinham os tamanhos de exemplo são atualizadas sozinhas; tamanhos já alterados à mão não são tocados.
- “Vendas do dia” usam a data do pedido; “Recebido do dia” usa a data do recebimento.
- Pedido marcado como “Pago” no cadastro gera recebimento com a data do pedido.
- Custo de estoque pelo **custo médio ponderado**.
- Pedidos cancelados contam em “registrados” e “cancelados”, mas nunca nas vendas.

## 9. Pendências e possíveis evoluções

- **Supabase/PostgreSQL**: não configurado (ver seção 1). A migração exigiria trocar `db.ts` e traduzir `schema.sql`.
- **PDF nativo**: a exportação em PDF usa “Imprimir → Salvar como PDF” do navegador.
- **Fuso horário configurável pela tela**: fixo em America/Sao_Paulo (alterável em `settings` no banco).
- Backup automático do arquivo do banco fica a cargo da hospedagem.
