-- Esquema SQLite (desenvolvimento / uso em servidor único).
-- Valores monetários: INTEGER em centavos. Quantidades: INTEGER em milésimos (1,500 kg = 1500).
-- Datas locais do estabelecimento: TEXT 'YYYY-MM-DD'; horários locais: 'HH:MM'.
-- Instantes exatos (auditoria): TEXT ISO-8601 em UTC.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','staff')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL            -- JSON
);

CREATE TABLE IF NOT EXISTS product_categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS suppliers (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone  TEXT,
  notes  TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category        TEXT,
  unit            TEXT NOT NULL,
  qty_milli       INTEGER NOT NULL DEFAULT 0,        -- saldo atual (derivado do histórico)
  min_qty_milli   INTEGER NOT NULL DEFAULT 0,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  supplier_id     INTEGER REFERENCES suppliers(id),
  notes           TEXT,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  number          INTEGER NOT NULL UNIQUE,
  purchase_date   TEXT NOT NULL,
  supplier_id     INTEGER REFERENCES suppliers(id),
  invoice_number  TEXT,
  items_total_cents INTEGER NOT NULL,
  discount_cents  INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  freight_cents   INTEGER NOT NULL DEFAULT 0 CHECK (freight_cents >= 0),
  total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),
  paid_cents      INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  payment_method  TEXT,
  payment_status  TEXT NOT NULL DEFAULT 'pendente' CHECK (payment_status IN ('pendente','parcial','pago')),
  due_date        TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'confirmada' CHECK (status IN ('confirmada','cancelada')),
  cancel_reason   TEXT,
  cancelled_at    TEXT,
  idempotency_key TEXT UNIQUE,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date);

CREATE TABLE IF NOT EXISTS purchase_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id     INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id      INTEGER NOT NULL REFERENCES products(id),
  qty_milli       INTEGER NOT NULL CHECK (qty_milli > 0),
  unit            TEXT NOT NULL,
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  total_cents     INTEGER NOT NULL CHECK (total_cents >= 0)
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);

CREATE TABLE IF NOT EXISTS orders (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  number              INTEGER NOT NULL UNIQUE,
  order_date          TEXT NOT NULL,
  order_time          TEXT NOT NULL,
  source              TEXT NOT NULL CHECK (source IN ('presencial','whatsapp')),
  customer_name       TEXT,
  customer_phone      TEXT,
  delivery_type       TEXT NOT NULL CHECK (delivery_type IN ('retirada','entrega')),
  address             TEXT,
  subtotal_cents      INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  delivery_fee_cents  INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),   -- frete cobrado do cliente
  delivery_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (delivery_cost_cents >= 0),  -- custo pago ao entregador
  discount_cents      INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents         INTEGER NOT NULL CHECK (total_cents >= 0),
  payment_method      TEXT,
  paid_cents          INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  payment_status      TEXT NOT NULL DEFAULT 'pendente' CHECK (payment_status IN ('pendente','parcial','pago')),
  status              TEXT NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente','em_preparo','pronto','saiu_para_entrega','entregue','cancelado')),
  expected_at         TEXT,        -- 'YYYY-MM-DDTHH:MM' local
  delivered_at        TEXT,        -- 'YYYY-MM-DDTHH:MM' local
  notes               TEXT,
  cancel_reason       TEXT,
  cancelled_at        TEXT,
  idempotency_key     TEXT UNIQUE,
  created_by          INTEGER REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  size             TEXT NOT NULL,
  qty              INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),  -- preço preservado por pedido
  total_cents      INTEGER NOT NULL CHECK (total_cents >= 0),
  notes            TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS expenses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  description     TEXT NOT NULL,
  category        TEXT NOT NULL,
  expense_date    TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_cents      INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  payment_method  TEXT,
  status          TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','parcial','pago')),
  due_date        TEXT,
  notes           TEXT,
  voided          INTEGER NOT NULL DEFAULT 0 CHECK (voided IN (0,1)),
  void_reason     TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

-- Livro de recebimentos (clientes) e pagamentos (compras/despesas). Fonte da verdade do "dinheiro que se moveu".
CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('recebimento','pagamento')),
  ref_type     TEXT NOT NULL CHECK (ref_type IN ('pedido','compra','despesa')),
  ref_id       INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,   -- positivo; estornos entram como valor negativo
  method       TEXT,
  paid_date    TEXT NOT NULL,      -- data local
  notes        TEXT,
  user_id      INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(paid_date);
CREATE INDEX IF NOT EXISTS idx_payments_ref ON payments(ref_type, ref_id);

-- Histórico imutável de estoque: cada linha guarda saldo anterior/posterior.
CREATE TABLE IF NOT EXISTS stock_movements (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id         INTEGER NOT NULL REFERENCES products(id),
  type               TEXT NOT NULL CHECK (type IN ('entrada','saida','estorno')),
  reason             TEXT NOT NULL,   -- compra, consumo, perda, descarte, uso_interno, ajuste_inventario, outro, cancelamento_compra, saldo_inicial
  qty_milli          INTEGER NOT NULL, -- delta com sinal (+ entrada / - saída)
  balance_before_milli INTEGER NOT NULL,
  balance_after_milli  INTEGER NOT NULL,
  unit_cost_cents    INTEGER,
  occurred_at        TEXT NOT NULL,    -- 'YYYY-MM-DDTHH:MM' local
  occurred_date      TEXT NOT NULL,    -- 'YYYY-MM-DD' local (para filtros)
  purchase_id        INTEGER REFERENCES purchases(id),
  order_id           INTEGER REFERENCES orders(id),
  reverses_id        INTEGER REFERENCES stock_movements(id),
  notes              TEXT,
  user_id            INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id, id);
CREATE INDEX IF NOT EXISTS idx_movements_date ON stock_movements(occurred_date);
-- Uma movimentação só pode ser estornada uma vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_movements_reverses ON stock_movements(reverses_id) WHERE reverses_id IS NOT NULL;

-- Preparação futura: fichas técnicas (NÃO usadas para baixa automática por enquanto).
CREATE TABLE IF NOT EXISTS recipes (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  size   TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS recipe_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_milli  INTEGER NOT NULL CHECK (qty_milli > 0)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  entity    TEXT NOT NULL,
  entity_id INTEGER,
  action    TEXT NOT NULL,
  detail    TEXT,
  user_id   INTEGER,
  at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

-- Vínculo "produto como vem na nota do fornecedor" -> produto do estoque, com fator de conversão.
-- Ex.: "ARROZ T1 FD 6X5KG" (unidade FD) -> Arroz, 1 FD = 30 kg (factor_milli = 30000).
CREATE TABLE IF NOT EXISTS supplier_product_map (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_cnpj TEXT NOT NULL,
  match_key     TEXT NOT NULL,      -- 'cod:<cProd>' ou 'desc:<descrição normalizada>'
  description   TEXT NOT NULL,
  note_unit     TEXT,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  factor_milli  INTEGER NOT NULL CHECK (factor_milli > 0),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (supplier_cnpj, match_key)
);

-- Redefinição de senha por e-mail: guarda só o hash do token; uso único e com validade.
CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,          -- ISO UTC
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Caixa do dia: abertura (troco), sangrias/suprimentos e fechamento com conferência
CREATE TABLE IF NOT EXISTS cash_sessions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  day                  TEXT NOT NULL UNIQUE,      -- 'YYYY-MM-DD'
  opening_cents        INTEGER NOT NULL CHECK (opening_cents >= 0),
  status               TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','fechado')),
  expected_cash_cents  INTEGER,
  counted_cash_cents   INTEGER,
  left_in_drawer_cents INTEGER,
  checks               TEXT,                     -- JSON: valores conferidos de Pix/cartões { forma: centavos }
  notes                TEXT,
  opened_by            INTEGER REFERENCES users(id),
  opened_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_by            INTEGER REFERENCES users(id),
  closed_at            TEXT
);
CREATE TABLE IF NOT EXISTS cash_movements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  day          TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('sangria','suprimento')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason       TEXT NOT NULL,
  user_id      INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_day ON cash_movements(day);

-- Clientes: telefone normalizado (só dígitos, DDD + número) e ÚNICO para evitar duplicidade.
CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL UNIQUE,
  notes      TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- Endereços do cliente (casa, trabalho...). Cada endereço pertence a um único cliente.
-- O pedido guarda uma cópia do endereço usado (orders.address / orders.neighborhood),
-- então editar ou excluir um endereço não altera pedidos antigos.
CREATE TABLE IF NOT EXISTS customer_addresses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,          -- Casa, Trabalho, Outro...
  street       TEXT NOT NULL,          -- rua e número
  complement   TEXT,
  neighborhood TEXT,
  reference    TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id);

-- Cardápio do dia (montado pela manhã). options = JSON [{name, description, sizes[], soldOut}]
CREATE TABLE IF NOT EXISTS daily_menus (
  menu_date  TEXT PRIMARY KEY,
  options    TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Cache de distâncias (do restaurante até o endereço do cliente), para não consultar o mapa de novo
CREATE TABLE IF NOT EXISTS distance_cache (
  cache_key  TEXT PRIMARY KEY,
  meters     INTEGER,
  seconds    INTEGER,
  approximate INTEGER NOT NULL DEFAULT 0,
  found      INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- Coordenadas já consultadas no mapa (ex.: ponto do restaurante para priorizar sugestões perto dele)
CREATE TABLE IF NOT EXISTS geo_cache (
  cache_key  TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Fila de impressão da cozinha: cada pedido novo/alterado/cancelado vira uma comanda.
-- A tela "Cozinha" (computador com a impressora) pega da fila e imprime UMA vez (claimed_at evita duplicar com duas telas).
CREATE TABLE IF NOT EXISTS print_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  kind        TEXT NOT NULL CHECK (kind IN ('novo','alterado','cancelado','reaberto','reimpressao')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  claimed_at  TEXT,
  claimed_by  INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_print_jobs_pending ON print_jobs(claimed_at, created_at);
