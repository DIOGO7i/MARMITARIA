import { Database } from './sqlite';
import { tryNormalizePhone } from './phone';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export type DB = Database;

export const DEFAULT_SETTINGS = {
  establishment: {
    name: 'Gisa Agustoni Gastronomia', phone: '(16) 99151-5757 / (16) 99390-7272',
    address: 'R. João Penteado, 2220 - Jardim América, Ribeirão Preto - SP, 14020-180',
    city: 'Ribeirão Preto - SP', // usada para completar o endereço do cliente no cálculo da distância
    hours: '', reportHeader: 'Gisa Agustoni Gastronomia — O sabor de casa, todos os dias.',
  },
  timezone: 'America/Sao_Paulo',
  // Tamanhos do cardápio da Gisa Gastronomia (por peso)
  sizes: [
    { name: '350 g', priceCents: 1200 },
    { name: '450 g', priceCents: 1400 },
    { name: '650 g', priceCents: 1600 },
    { name: '750 g', priceCents: 1800 },
  ],
  // Opções do cardápio (botões no pedido). Cada opção pode limitar os tamanhos disponíveis.
  // Cada opção diz quantas carnes e guarnições a atendente escolhe no pedido (além do que vem sempre: marmitaBase).
  menuOptions: [
    { name: 'Opção 1', description: '', sizes: ['350 g', '450 g'], carnes: 1, guarnicoes: 1 },
    { name: 'Opção 2', description: '', sizes: ['650 g', '750 g'], carnes: 1, guarnicoes: 2 },
  ] as { name: string; description: string; sizes: string[]; carnes?: number; guarnicoes?: number }[],
  marmitaBase: 'Arroz e feijão',          // vem em toda marmita, sem escolher
  // Botões de observação rápida em cada marmita do pedido, além das trocas
  // (vazio: no pedido aparecem só as trocas de cada opção do cardápio; a Gisa pode cadastrar se quiser)
  quickNotes: [] as string[],
  expenseCategories: ['Água', 'Energia elétrica', 'Gás', 'Aluguel', 'Internet', 'Manutenção', 'Taxas', 'Pagamento a entregadores', 'Outras despesas'],
  productCategories: ['Grãos', 'Carnes', 'Hortifruti', 'Embalagens', 'Bebidas', 'Temperos', 'Outros'],
  units: ['unidade', 'kg', 'g', 'litro', 'ml', 'pacote', 'caixa'],
  paymentMethods: ['Dinheiro', 'Pix', 'Cartão de débito', 'Cartão de crédito'],
  defaultMinStockMilli: 0,
  // Ficha técnica: em qual status do pedido os ingredientes saem do estoque
  stockDeductOn: 'entregue' as 'desativado' | 'em_preparo' | 'pronto' | 'saiu_para_entrega' | 'entregue',
  minMarginPct: 50,                       // alerta quando o lucro de um tamanho fica abaixo disso (% do preço)
  neighborhoods: [] as { name: string; feeCents: number; costCents: number }[], // antigo (taxa por bairro); hoje a taxa sai da distância
  // Taxa de entrega pela distância (pelas ruas) do restaurante até o cliente. Valores iniciais: ajuste em Configurações.
  deliveryTiers: [
    { upToMeters: 2000, feeCents: 500, costCents: 400 },
    { upToMeters: 4000, feeCents: 700, costCents: 600 },
    { upToMeters: 6000, feeCents: 1000, costCents: 800 },
    { upToMeters: 8000, feeCents: 1300, costCents: 1000 },
  ] as { upToMeters: number; feeCents: number; costCents: number }[],
  dueAlertDays: 3,                        // avisar contas que vencem nos próximos N dias
  // Impressora da cozinha: todo pedido sai impresso na tela "Cozinha"
  kitchenPrint: { enabled: true, paper: '80' as '80' | '58', copies: 1, printEdits: true, printCancels: true, showPrices: true },
  whatsappTemplates: {
    pendente: 'Olá, {nome}! Recebemos seu pedido #{numero} ({itens}). Total: {total}. Obrigado! — {estabelecimento}',
    em_preparo: 'Olá, {nome}! Seu pedido #{numero} já está sendo preparado. 🍳',
    pronto: 'Olá, {nome}! Seu pedido #{numero} está pronto para retirada. 😋',
    saiu_para_entrega: 'Olá, {nome}! Seu pedido #{numero} saiu para entrega. 🛵 Em breve chega aí!',
    entregue: 'Olá, {nome}! Obrigado pela preferência. Bom apetite! 😊 — {estabelecimento}',
    cancelado: 'Olá, {nome}. Seu pedido #{numero} foi cancelado. Qualquer dúvida, é só chamar.',
  } as Record<string, string>,
};
export type Settings = typeof DEFAULT_SETTINGS;

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(here, '..', 'db', 'schema.sql'), 'utf8'));
  migrate(db);
  const has = db.prepare('SELECT 1 FROM settings WHERE key = ?');
  const ins = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!has.get(k)) ins.run(k, JSON.stringify(v));
  }
  return db;
}

/** Migrações aditivas para bancos criados por versões anteriores (nunca apagam dados). */
function migrate(db: DB) {
  const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  if (!cols('users').includes('recovery_hash')) db.exec('ALTER TABLE users ADD COLUMN recovery_hash TEXT');
  if (!cols('users').includes('token_version')) db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  // v21: trocas do cardápio do dia (substituir a carne / a guarnição)
  if (!cols('daily_menus').includes('extras')) db.exec('ALTER TABLE daily_menus ADD COLUMN extras TEXT');
  // v20: acesso de funcionário pode ser desativado (sem apagar o histórico do que ele lançou)
  if (!cols('users').includes('active')) db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  if (!cols('orders').includes('neighborhood')) db.exec('ALTER TABLE orders ADD COLUMN neighborhood TEXT');
  if (!cols('orders').includes('stock_consumed')) db.exec('ALTER TABLE orders ADD COLUMN stock_consumed INTEGER NOT NULL DEFAULT 0');
  if (!cols('orders').includes('customer_id')) db.exec('ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id)');
  if (!cols('orders').includes('customer_address_id')) db.exec('ALTER TABLE orders ADD COLUMN customer_address_id INTEGER'); // só referência; o pedido guarda a cópia do endereço
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)');
  if (!cols('order_items').includes('menu_description')) db.exec('ALTER TABLE order_items ADD COLUMN menu_description TEXT'); // o que tinha na opção naquele dia (cópia)
  if (!cols('order_items').includes('menu_option')) db.exec('ALTER TABLE order_items ADD COLUMN menu_option TEXT'); // Opção 1 / Opção 2 do cardápio
  // v31: carnes e guarnições do dia (botões) e o que foi escolhido em cada marmita
  if (!cols('daily_menus').includes('items')) db.exec('ALTER TABLE daily_menus ADD COLUMN items TEXT');
  if (!cols('order_items').includes('choices')) db.exec('ALTER TABLE order_items ADD COLUMN choices TEXT');
  if (!cols('purchase_items').includes('prev_unit_cost_cents')) db.exec('ALTER TABLE purchase_items ADD COLUMN prev_unit_cost_cents INTEGER'); // custo do produto antes desta compra
  if (!cols('suppliers').includes('cnpj')) db.exec('ALTER TABLE suppliers ADD COLUMN cnpj TEXT');
  if (!cols('purchases').includes('access_key')) db.exec('ALTER TABLE purchases ADD COLUMN access_key TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_cnpj ON suppliers(cnpj) WHERE cnpj IS NOT NULL');
  // Uma nota (chave de acesso) só pode estar em UMA compra confirmada.
  // v5: remove a forma de pagamento "Fiado" das configurações já salvas (uma única vez; pedidos antigos mantêm o que foi registrado)
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_sem_fiado'").get()) {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'paymentMethods'").get() as { value: string } | undefined;
    if (row) {
      const list = (JSON.parse(row.value) as string[]).filter((m) => m.trim().toLowerCase() !== 'fiado');
      db.prepare("UPDATE settings SET value = ? WHERE key = 'paymentMethods'").run(JSON.stringify(list.length ? list : ['Dinheiro']));
    }
    db.prepare("INSERT INTO settings(key, value) VALUES ('migr_sem_fiado', 'true')").run();
  }
  // v10: cria clientes a partir dos pedidos já existentes que têm telefone válido (uma única vez), e vincula esses pedidos.
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_clientes'").get()) {
    backfillCustomers(db);
    db.prepare("INSERT INTO settings(key, value) VALUES ('migr_clientes', 'true')").run();
  }
  // v12: troca os tamanhos e o nome de EXEMPLO pelos do cardápio da Gisa (só se ainda forem os de exemplo; uma única vez)
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_cardapio_gisa'").get()) {
    const OLD_SIZES = JSON.stringify([{ name: 'Pequena', priceCents: 1800 }, { name: 'Média', priceCents: 2200 }, { name: 'Grande', priceCents: 2600 }]);
    const sizes = db.prepare("SELECT value FROM settings WHERE key = 'sizes'").get() as { value: string } | undefined;
    if (sizes && JSON.stringify(JSON.parse(sizes.value)) === OLD_SIZES) {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'sizes'").run(JSON.stringify(DEFAULT_SETTINGS.sizes));
    }
    const est = db.prepare("SELECT value FROM settings WHERE key = 'establishment'").get() as { value: string } | undefined;
    if (est) {
      const e = JSON.parse(est.value);
      if (e.name === 'Minha Marmitaria') {
        db.prepare("UPDATE settings SET value = ? WHERE key = 'establishment'").run(JSON.stringify({
          ...e, name: DEFAULT_SETTINGS.establishment.name, phone: e.phone || DEFAULT_SETTINGS.establishment.phone,
          reportHeader: e.reportHeader || DEFAULT_SETTINGS.establishment.reportHeader,
        }));
      }
    }
    db.prepare("INSERT INTO settings(key, value) VALUES ('migr_cardapio_gisa', 'true')").run();
  }
  // v15: nome completo e endereço do restaurante (só se ainda estiverem os valores anteriores de fábrica; uma única vez)
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'migr_endereco_gisa'").get()) {
    const est = db.prepare("SELECT value FROM settings WHERE key = 'establishment'").get() as { value: string } | undefined;
    if (est) {
      const e = JSON.parse(est.value);
      const d = DEFAULT_SETTINGS.establishment;
      db.prepare("UPDATE settings SET value = ? WHERE key = 'establishment'").run(JSON.stringify({
        ...e,
        name: e.name === 'Gisa Gastronomia' ? d.name : e.name,
        address: e.address?.trim() ? e.address : d.address,
        city: e.city?.trim() ? e.city : d.city,
        reportHeader: e.reportHeader === 'Gisa Gastronomia — O sabor de casa, todos os dias' ? d.reportHeader : e.reportHeader,
      }));
    }
    db.prepare("INSERT INTO settings(key, value) VALUES ('migr_endereco_gisa', 'true')").run();
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_access_key ON purchases(access_key) WHERE access_key IS NOT NULL AND status = 'confirmada'");
  // v31: opções do modelo sem quantidade de carnes/guarnições ganham a regra da Gisa (Opção 2 = 2 guarnições)
  const mo = db.prepare("SELECT value FROM settings WHERE key = 'menuOptions'").get() as { value: string } | undefined;
  if (mo) {
    const l = JSON.parse(mo.value) as any[];
    if (Array.isArray(l) && l.some((o) => o.carnes === undefined || o.guarnicoes === undefined)) {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'menuOptions'").run(JSON.stringify(l.map((o) => ({
        ...o, carnes: o.carnes ?? 1, guarnicoes: o.guarnicoes ?? (/2/.test(String(o.name)) ? 2 : 1),
      }))));
    }
  }
  // v30: a lista padrão de observações rápidas da v29 (mais arroz, sem feijão…) sai; ficam só as trocas.
  // Só limpa se ninguém mexeu na lista.
  const qn = db.prepare("SELECT value FROM settings WHERE key = 'quickNotes'").get() as { value: string } | undefined;
  if (qn?.value === JSON.stringify(['Sem salada', 'Sem cebola', 'Sem feijão', 'Pouco arroz', 'Mais arroz', 'Molho à parte'])) {
    db.prepare("UPDATE settings SET value = '[]' WHERE key = 'quickNotes'").run();
  }
}

function backfillCustomers(db: DB) {
  const rows = db.prepare(`SELECT id, customer_name, customer_phone, delivery_type, address, neighborhood, created_at
    FROM orders WHERE customer_phone IS NOT NULL AND TRIM(customer_phone) != '' ORDER BY id`).all() as any[];
  const byPhone = new Map<string, any[]>();
  for (const r of rows) { const p = tryNormalizePhone(r.customer_phone); if (p) byPhone.set(p, [...(byPhone.get(p) ?? []), r]); }
  db.transaction(() => {
    for (const [phone, list] of byPhone) {
      const named = [...list].reverse().find((r) => r.customer_name?.trim());
      let c = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone) as any;
      if (!c) c = { id: Number(db.prepare('INSERT INTO customers(name, phone) VALUES (?, ?)').run(named?.customer_name?.trim() || 'Cliente sem nome', phone).lastInsertRowid) };
      const seen = new Map<string, number>();
      for (const r of list) {
        let addrId: number | null = null;
        if (r.delivery_type === 'entrega' && r.address?.trim()) {
          const k = (r.address.trim() + '|' + (r.neighborhood ?? '')).toLowerCase();
          if (!seen.has(k)) seen.set(k, Number(db.prepare('INSERT INTO customer_addresses(customer_id, label, street, neighborhood) VALUES (?,?,?,?)').run(c.id, seen.size === 0 ? 'Casa' : `Endereço ${seen.size + 1}`, r.address.trim(), r.neighborhood || null).lastInsertRowid));
          addrId = seen.get(k)!;
        }
        db.prepare('UPDATE orders SET customer_id = ?, customer_address_id = ? WHERE id = ?').run(c.id, addrId, r.id);
      }
    }
  })();
}

export function getSettings(db: DB): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const out: any = {};
  for (const r of rows) if (!r.key.startsWith('migr_')) out[r.key] = JSON.parse(r.value);
  return { ...DEFAULT_SETTINGS, ...out };
}

export function audit(db: DB, entity: string, entityId: number | null, action: string, detail: unknown, userId: number | null) {
  db.prepare('INSERT INTO audit_log(entity, entity_id, action, detail, user_id) VALUES (?,?,?,?,?)')
    .run(entity, entityId, action, detail == null ? null : JSON.stringify(detail), userId);
}
