import os from 'node:os';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { audit, DB, getSettings } from './db';
import { ValidationError } from './money';
import { Ctx } from './services/common';
import * as orders from './services/orders';
import * as inv from './services/inventory';
import * as purchases from './services/purchases';
import * as expenses from './services/expenses';
import * as reports from './services/reports';
import * as recipes from './services/recipes';
import * as cash from './services/cash';
import * as customers from './services/customers';
import * as menu from './services/menu';
import { Modules, modulesFromEnv } from './modules';
import { cachedDistance, fullAddress, RouteFn, routeFromEnv } from './distance';
import { originPoint, PlacesApi, placesFromEnv } from './places';
import * as kitchen from './services/kitchen';
import { verifyBalances } from './stock';
import { checkTotals, parseAccessKey, parseNfeXml, readNotePhoto } from './nfe';
import { matchDraft } from './services/notes';
import { checkStrength, consumeResetToken, createResetToken, Mailer, mailerFromEnv, MIN_PASSWORD, setPassword } from './auth';

declare global {
  namespace Express {
    interface Request { ctx?: Ctx }
  }
}

const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (e) { next(e); }
};

const wrapAsync = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((out) => { if (out !== undefined) res.json(out); }).catch(next);
};

const cents = z.number().int().min(0);
const optStr = z.string().nullish();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const orderSchema = z.object({
  idempotencyKey: optStr,
  orderDate: dateStr,
  orderTime: z.string().regex(/^\d{2}:\d{2}$/),
  source: z.enum(['presencial', 'whatsapp']),
  customerName: optStr, customerPhone: optStr,
  deliveryType: z.enum(['retirada', 'entrega']),
  address: optStr,
  neighborhood: optStr,
  customerId: z.number().int().nullish(),
  customerAddressId: z.number().int().nullish(),
  saveCustomer: z.boolean().optional(),
  saveAddress: z.object({ label: z.string().max(40), street: optStr, complement: optStr, reference: optStr }).nullish(),
  items: z.array(z.object({ size: z.string().min(1), qty: z.number().int().min(1), unitPriceCents: cents, notes: optStr, option: z.string().max(40).nullish(),
    choices: z.object({ carnes: z.array(z.string().max(60)).max(5).default([]), guarnicoes: z.array(z.string().max(60)).max(6).default([]) }).nullish() })).min(1),
  deliveryFeeCents: cents, deliveryCostCents: cents, discountCents: cents,
  paymentMethod: optStr,
  paymentStatus: z.enum(['pendente', 'parcial', 'pago']),
  paidCents: cents.optional(),
  status: z.enum(orders.ORDER_STATUSES).optional(),
  expectedAt: optStr, deliveredAt: optStr, notes: optStr,
});

const productSchema = z.object({
  name: z.string().min(1), category: optStr, unit: z.string().min(1),
  qtyMilli: z.number().int().min(0).optional(), minQtyMilli: z.number().int().min(0), unitCostCents: cents,
  supplierId: z.number().int().nullish(), notes: optStr, active: z.boolean(),
});

const purchaseSchema = z.object({
  idempotencyKey: z.string().min(8),
  purchaseDate: dateStr, supplierId: z.number().int().nullish(), invoiceNumber: optStr,
  accessKey: optStr,
  newSupplier: z.object({ name: z.string(), cnpj: optStr }).nullish(),
  items: z.array(z.object({
    productId: z.number().int().nullish(), qtyMilli: z.number().int().min(1), unitCostCents: cents.nullish(), totalCents: cents.nullish(),
    newProduct: z.object({ name: z.string(), unit: z.string(), category: optStr }).nullish(),
    source: z.object({ code: optStr, description: z.string(), unit: optStr, factorMilli: z.number().int().min(1), remember: z.boolean().optional() }).nullish(),
  })).min(1),
  discountCents: cents, freightCents: cents, paymentMethod: optStr,
  paymentStatus: z.enum(['pendente', 'parcial', 'pago']), paidCents: cents.optional(), dueDate: optStr, notes: optStr,
});

const expenseSchema = z.object({
  description: z.string().min(1), category: z.string().min(1), expenseDate: dateStr, amountCents: z.number().int().min(1),
  paymentMethod: optStr, status: z.enum(['pendente', 'pago']), paidDate: optStr, dueDate: optStr, notes: optStr,
});

const settingsSchema = z.object({
  establishment: z.object({ name: z.string().min(1), phone: z.string(), address: z.string(), city: z.string().max(80).optional(), hours: z.string(), reportHeader: z.string() }),
  sizes: z.array(z.object({ name: z.string().min(1), priceCents: cents })).min(1),
  expenseCategories: z.array(z.string().min(1)).min(1),
  productCategories: z.array(z.string().min(1)),
  units: z.array(z.string().min(1)).min(1),
  paymentMethods: z.array(z.string().min(1)).min(1),
  defaultMinStockMilli: z.number().int().min(0),
  stockDeductOn: z.enum(['desativado', 'em_preparo', 'pronto', 'saiu_para_entrega', 'entregue']).optional(),
  minMarginPct: z.number().min(0).max(100).optional(),
  neighborhoods: z.array(z.object({ name: z.string().trim().min(1, 'Informe o nome do bairro.'), feeCents: cents, costCents: cents })).optional()
    .refine((l) => !l || new Set(l.map((n) => n.name.trim().toLowerCase())).size === l.length, 'Há bairros repetidos.'),
  deliveryTiers: z.array(z.object({ upToMeters: z.number().int().min(100, 'Faixa de distância muito pequena.').max(100_000, 'Faixa de distância acima de 100 km.'), feeCents: cents, costCents: cents })).max(20).optional()
    .refine((l) => !l || l.every((t, i) => i === 0 || t.upToMeters > l[i - 1].upToMeters), 'As faixas de distância precisam estar em ordem crescente, sem repetir.'),
  dueAlertDays: z.number().int().min(0).max(60).optional(),
  kitchenPrint: z.object({ enabled: z.boolean(), paper: z.enum(['80', '58']), copies: z.number().int().min(1).max(3), printEdits: z.boolean(), printCancels: z.boolean(), showPrices: z.boolean(), small: z.boolean().optional(), noAccents: z.boolean().optional() }).optional(),
  whatsappTemplates: z.record(z.string(), z.string().max(1000)).optional(),
  marmitaBase: z.string().trim().max(60).optional(),
  quickNotes: z.array(z.string().trim().min(1).max(40, 'Observação rápida muito longa (máx. 40 letras).')).max(20, 'No máximo 20 observações rápidas.').optional(),
  menuOptions: z.array(z.object({ name: z.string().trim().min(1, 'Toda opção do cardápio precisa de um nome.').max(40), description: z.string().max(300), sizes: z.array(z.string()),
    carnes: z.number().int().min(0).max(3).optional(), guarnicoes: z.number().int().min(0).max(4).optional() })).max(8).optional()
    .refine((l) => !l || new Set(l.map((o) => o.name.trim().toLowerCase())).size === l.length, 'Há opções do cardápio com o mesmo nome.'),
});

const num = (v: unknown) => { if (v === undefined || v === '') return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; };
/** Id numérico da URL; qualquer outra coisa vira "não encontrado" (sem erro interno). */
const id = (v: unknown) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw Object.assign(new Error('Registro não encontrado.'), { status: 404 });
  return n;
};
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);

export function createApp(db: DB, jwtSecret: string, opts: { staticDir?: string; corsOrigin?: string; mailer?: Mailer | null; modules?: Modules; route?: RouteFn | null; places?: PlacesApi | null } = {}) {
  const modules = opts.modules ?? modulesFromEnv();
  const route = opts.route !== undefined ? opts.route : routeFromEnv();
  const places = opts.places !== undefined ? opts.places : placesFromEnv();
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    // CSP: só carrega código, estilos e conexões do próprio sistema (reduz o estrago de qualquer XSS)
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains'); // só com HTTPS (TRUST_PROXY atrás da hospedagem)
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // só o próprio sistema pode se mostrar dentro dele (modo celular)
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    next();
  });
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1); // atrás de proxy/HTTPS da hospedagem
  app.use('/api/purchases/parse-photo', express.json({ limit: '12mb' }));
  app.use('/api/purchases/parse-xml', express.json({ limit: '6mb' }));
  app.use(express.json({ limit: '1mb' }));
  if (opts.corsOrigin) app.use(cors({ origin: opts.corsOrigin }));

  // --- limitador simples de tentativas de login ---
  const attempts = new Map<string, { n: number; until: number }>();
  const tooMany = (key: string) => {
    const a = attempts.get(key);
    return !!a && a.n >= 8 && a.until > Date.now();
  };
  const fail = (key: string) => {
    if (attempts.size > 5000) for (const [k, v] of attempts) if (v.until <= Date.now()) attempts.delete(k); // não cresce sem limite
    const a = attempts.get(key);
    attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 15 * 60_000 });
  };

  const sign = (u: { id: number; role: string; token_version?: number }) =>
    jwt.sign({ sub: u.id, role: u.role, tv: u.token_version ?? 0 }, jwtSecret, { expiresIn: '30d' }); // fica conectado por 30 dias no aparelho; trocar a senha desconecta os outros
  const userCount = () => (db.prepare('SELECT COUNT(*) c FROM users').get() as any).c as number;
  const publicUser = (u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
  const err = (status: number, message: string) => Object.assign(new Error(message), { status });
  const limited = (key: string) => { if (tooMany(key)) throw err(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'); };
  const limitedEmail = (key: string) => { const a = attempts.get(key); if (a && a.n >= 20 && a.until > Date.now()) throw err(429, 'Muitas tentativas erradas nesta conta. Aguarde 15 minutos e tente novamente.'); };
  const mailer = opts.mailer !== undefined ? opts.mailer : mailerFromEnv();
  const appUrl = (req: Request) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const pwd = z.string().min(MIN_PASSWORD, `A senha deve ter ao menos ${MIN_PASSWORD} caracteres.`);

  app.get('/api/health', (_q, r) => r.json({ ok: true }));

  app.get('/api/auth/status', wrap(() => ({ needsSetup: userCount() === 0, emailReset: !!mailer })));

  const credSchema = z.object({ email: z.string().email('E-mail inválido.'), password: pwd });
  const DUMMY_HASH = bcrypt.hashSync('nao-existe-' + Math.random(), 12); // mesmo tempo de resposta para e-mail inexistente

  // Primeiro usuário (só funciona enquanto não existe nenhum usuário).
  app.post('/api/auth/setup', wrap((req) => {
    if (userCount() > 0) throw err(403, 'O sistema já foi configurado.');
    const b = credSchema.extend({ name: z.string().min(1, 'Informe seu nome.') }).parse(req.body);
    checkStrength(b.password, b.email, b.name);
    const id = db.transaction(() => {
      const r = db.prepare("INSERT INTO users(email, name, password_hash, role) VALUES (?,?,?, 'owner')").run(b.email.trim(), b.name.trim(), bcrypt.hashSync(b.password, 12));
      return Number(r.lastInsertRowid);
    })();
    audit(db, 'usuario', id, 'criado_primeiro_usuario', null, id);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return { token: sign(u as any), user: publicUser(u) };
  }));

  app.post('/api/auth/login', wrap((req) => {
    const key = `login|${req.ip}|${String(req.body?.email ?? '').toLowerCase()}`;
    const keyEmail = `login-email|${String(req.body?.email ?? '').toLowerCase()}`; // limite também por e-mail, vindo de qualquer IP
    limited(key); limitedEmail(keyEmail);
    const b = z.object({ email: z.string(), password: z.string() }).parse(req.body);
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(b.email.trim()) as any;
    if (!bcrypt.compareSync(b.password, u?.password_hash ?? DUMMY_HASH) || !u) {
      fail(key); fail(keyEmail);
      throw err(401, 'E-mail ou senha incorretos.');
    }
    attempts.delete(key); attempts.delete(keyEmail);
    if (!u.active) throw err(403, 'Este acesso foi desativado. Fale com a responsável.');
    return { token: sign(u), user: publicUser(u) };
  }));

  // Esqueci a senha — link por e-mail (só quando SMTP está configurado). Resposta sempre igual, para não revelar e-mails cadastrados.
  app.post('/api/auth/forgot', wrapAsync(async (req) => {
    if (!mailer) throw err(501, 'A recuperação por e-mail não está configurada. Peça a quem instalou o sistema para criar uma senha nova.');
    const b = z.object({ email: z.string().email('E-mail inválido.') }).parse(req.body);
    const key = `forgot|${req.ip}`;
    limited(key); fail(key);
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(b.email.trim()) as any;
    if (u) {
      const token = createResetToken(db, u.id);
      const link = `${appUrl(req)}/redefinir-senha?token=${token}`;
      const name = getSettings(db).establishment.name;
      try {
        await mailer.send(u.email, `Redefinir senha — ${name}`,
          `Olá, ${u.name}.\n\nPara criar uma nova senha, abra o link abaixo (vale por 1 hora e só pode ser usado uma vez):\n${link}\n\nSe você não pediu isso, ignore este e-mail.`,
          `<p>Olá, ${u.name.replace(/[<>&]/g, '')}.</p><p>Para criar uma nova senha, clique no link abaixo. Ele vale por <b>1 hora</b> e só pode ser usado uma vez.</p><p><a href="${link}">Criar nova senha</a></p><p>Se você não pediu isso, ignore este e-mail.</p>`);
        audit(db, 'usuario', u.id, 'link_redefinicao_enviado', null, null);
      } catch (e) {
        console.error('Falha ao enviar e-mail de redefinição:', e);
        throw err(502, 'Não foi possível enviar o e-mail agora. Tente novamente mais tarde.');
      }
    }
    return { ok: true, message: 'Se este e-mail estiver cadastrado, enviamos um link para criar uma nova senha. Confira também a caixa de spam.' };
  }));

  app.post('/api/auth/reset', wrap((req) => {
    const b = z.object({ token: z.string().min(10), newPassword: pwd }).parse(req.body);
    const key = `reset|${req.ip}`;
    limited(key);
    checkStrength(b.newPassword);
    let userId: number;
    try { userId = consumeResetToken(db, b.token); } catch (e) { fail(key); throw e; }
    setPassword(db, userId, b.newPassword);
    audit(db, 'usuario', userId, 'senha_redefinida_por_email', null, userId);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
    return { token: sign(u), user: publicUser(u) };
  }));

  // --- tudo abaixo exige autenticação ---
  const auth = (req: Request, _res: Response, next: NextFunction) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return next(err(401, 'Sessão expirada. Entre novamente.'));
    try {
      const p = jwt.verify(h.slice(7), jwtSecret) as any;
      const u = db.prepare('SELECT id, role, token_version, active FROM users WHERE id = ?').get(p.sub) as any;
      if (!u || !u.active || (p.tv ?? 0) !== u.token_version) throw new Error('x'); // senha trocada ou acesso desativado => sessões caem
      req.ctx = { db, userId: u.id, role: u.role, modules };
      next();
    } catch {
      next(err(401, 'Sessão expirada. Entre novamente.'));
    }
  };
  const api = express.Router();
  api.use(auth);
  const C = (req: Request) => req.ctx!;
  const owner = (req: Request) => {
    if (C(req).role !== 'owner') throw err(403, 'Ação permitida somente ao responsável.');
  };
  const isStaff = (req: Request) => C(req).role !== 'owner';
  // Parte de GESTÃO (financeiro): só a responsável. O funcionário nem recebe esses dados do servidor.
  const OWNER_ONLY = ['/cash', '/purchases', '/expenses', '/suppliers', '/recipes', '/users', '/stock/verify', '/stock/adjust',
    '/reports/payables', '/reports/summary', '/reports/monthly', '/reports/stock', '/backup'];
  api.use(OWNER_ONLY, (req, _res, next) => next(isStaff(req) ? err(403, 'Esta parte é só da responsável.') : undefined));
  // Custos e valores de estoque/cliente não vão para o funcionário (ele vê quantidades, não quanto custou)
  const HIDDEN = new Set(['unitCostCents', 'valueCents', 'totalSpentCents', 'prevUnitCostCents', 'unit_cost_cents', 'prev_unit_cost_cents', 'totalValueCents']);
  const strip = (v: any): any => Array.isArray(v) ? v.map(strip)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !HIDDEN.has(k)).map(([k, x]) => [k, strip(x)])) : v;
  const safe = (req: Request, v: any) => (isStaff(req) ? strip(v) : v);

  api.get('/me', wrap((req) => {
    const u = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(C(req).userId) as any;
    return publicUser(u);
  }));

  api.post('/me/password', wrap((req) => {
    const b = z.object({ currentPassword: z.string(), newPassword: pwd }).parse(req.body);
    const key = `chpwd|${C(req).userId}`;
    limited(key);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(C(req).userId) as any;
    if (!bcrypt.compareSync(b.currentPassword, u.password_hash)) { fail(key); throw err(400, 'A senha atual está incorreta.'); }
    if (b.currentPassword === b.newPassword) throw err(400, 'A nova senha precisa ser diferente da atual.');
    checkStrength(b.newPassword, u.email, u.name);
    attempts.delete(key);
    setPassword(db, u.id, b.newPassword);
    audit(db, 'usuario', u.id, 'senha_trocada', null, u.id);
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id) as any;
    return { token: sign(fresh), user: publicUser(fresh) }; // esta sessão continua; as outras caem
  }));

  // Sair de todos os aparelhos (celular perdido, funcionário saiu): todas as sessões caem, inclusive esta
  api.post('/me/logout-all', wrap((req) => {
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(C(req).userId);
    audit(db, 'usuario', C(req).userId, 'saiu_de_todos_os_aparelhos', null, C(req).userId);
    return { ok: true };
  }));

  // Equipe (só a responsável): cadastrar funcionário, trocar a senha dele, desativar o acesso
  const userRow = (u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: !!u.active, createdAt: u.created_at });
  api.get('/users', wrap(() => (db.prepare('SELECT * FROM users ORDER BY active DESC, role, name').all() as any[]).map(userRow)));
  api.post('/users', wrap((req, res) => {
    const b = z.object({ name: z.string().trim().min(2, 'Informe o nome.').max(60), email: z.string().trim().email('E-mail inválido.'), password: pwd, role: z.enum(['owner', 'staff']).default('staff') }).parse(req.body);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(b.email)) throw err(400, 'Já existe um acesso com este e-mail.');
    checkStrength(b.password, b.email, b.name);
    const r = db.prepare('INSERT INTO users(email, name, password_hash, role) VALUES (?,?,?,?)').run(b.email, b.name, bcrypt.hashSync(b.password, 12), b.role);
    audit(db, 'usuario', Number(r.lastInsertRowid), 'criado', { nome: b.name, papel: b.role }, C(req).userId);
    res.status(201);
    return userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid));
  }));
  api.put('/users/:id', wrap((req) => {
    const uid = id(req.params.id);
    const b = z.object({ name: z.string().trim().min(2).max(60).optional(), active: z.boolean().optional(), role: z.enum(['owner', 'staff']).optional(), password: pwd.optional() }).parse(req.body);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid) as any;
    if (!u) throw err(404, 'Acesso não encontrado.');
    const me = uid === C(req).userId;
    if (me && (b.active === false || b.role === 'staff')) throw err(400, 'Você não pode desativar nem tirar a sua própria permissão de responsável.');
    const owners = (db.prepare("SELECT COUNT(*) c FROM users WHERE role='owner' AND active=1").get() as any).c;
    if (u.role === 'owner' && u.active && (b.active === false || b.role === 'staff') && owners <= 1) throw err(400, 'Precisa ficar pelo menos uma responsável com acesso.');
    db.transaction(() => {
      if (b.name) db.prepare('UPDATE users SET name=? WHERE id=?').run(b.name, uid);
      if (b.role && b.role !== u.role) db.prepare('UPDATE users SET role=?, token_version=token_version+1 WHERE id=?').run(b.role, uid);
      if (b.active !== undefined && b.active !== !!u.active) db.prepare('UPDATE users SET active=?, token_version=token_version+1 WHERE id=?').run(b.active ? 1 : 0, uid);
      if (b.password) { checkStrength(b.password, u.email, u.name); setPassword(db, uid, b.password); }
    })();
    audit(db, 'usuario', uid, 'alterado', { nome: b.name, ativo: b.active, papel: b.role, senhaNova: !!b.password }, C(req).userId);
    return userRow(db.prepare('SELECT * FROM users WHERE id = ?').get(uid));
  }));

  // Configurações
  api.get('/settings', wrap(() => ({ ...getSettings(db), modules })));
  // Cópia de segurança completa do banco (só a responsável). Feita com VACUUM INTO: cópia consistente mesmo com o sistema em uso.
  api.get('/backup', (req, res, next) => {
    try {
      const tmp = path.join(os.tmpdir(), `marmitaria-backup-${process.pid}-${Date.now()}.db`);
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      res.download(tmp, `marmitaria-copia-${day}.db`, () => fs.rm(tmp, { force: true }, () => {}));
    } catch (e) { next(e); }
  });
  api.put('/settings', wrap((req) => {
    owner(req);
    const b = settingsSchema.parse(req.body);
    const up = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    db.transaction(() => { for (const [k, v] of Object.entries(b)) up.run(k, JSON.stringify(v)); })();
    audit(db, 'configuracoes', null, 'atualizadas', null, C(req).userId);
    return { ...getSettings(db), modules };
  }));

  // Pedidos
  api.get('/orders', wrap((req) => orders.listOrders(C(req), {
    date: str(req.query.date), from: str(req.query.from), to: str(req.query.to), source: str(req.query.source), status: str(req.query.status),
    size: str(req.query.size), customer: str(req.query.customer), payment: str(req.query.payment), paymentStatus: str(req.query.paymentStatus),
    q: str(req.query.q), late: req.query.late === '1', page: num(req.query.page), pageSize: num(req.query.pageSize),
  })));
  api.post('/orders', wrap((req, res) => { res.status(201); return orders.createOrder(C(req), orderSchema.parse(req.body) as any); }));
  api.get('/orders/:id', wrap((req) => orders.getOrder(C(req), id(req.params.id))));
  api.put('/orders/:id', wrap((req) => orders.updateOrder(C(req), id(req.params.id), orderSchema.parse(req.body) as any)));
  api.post('/orders/:id/status', wrap((req) => {
    const b = z.object({ status: z.enum(orders.ORDER_STATUSES), reason: optStr, deliveredAt: optStr }).parse(req.body);
    return orders.setOrderStatus(C(req), id(req.params.id), b.status, { reason: b.reason ?? undefined, deliveredAt: b.deliveredAt });
  }));
  api.post('/orders/:id/payments', wrap((req) => {
    const b = z.object({ amountCents: z.number().int().min(1), method: optStr, paidDate: dateStr.optional() }).parse(req.body);
    return orders.addOrderPayment(C(req), id(req.params.id), b);
  }));
  api.post('/orders/:id/payments/:pid/reverse', wrap((req) => { owner(req); return orders.reverseOrderPayment(C(req), id(req.params.id), id(req.params.pid)); }));

  // Produtos / fornecedores / estoque
  api.get('/products', wrap((req) => safe(req, inv.listProducts(C(req), { q: str(req.query.q), status: str(req.query.status), active: str(req.query.active), category: str(req.query.category) }))));
  api.post('/products', wrap((req, res) => { res.status(201); const b = productSchema.parse(req.body) as any; if (isStaff(req)) b.unitCostCents = 0; return safe(req, inv.createProduct(C(req), b)); }));
  api.get('/products/:id', wrap((req) => safe(req, inv.getProduct(C(req), id(req.params.id)))));
  api.put('/products/:id', wrap((req) => {
    const b = productSchema.parse(req.body) as any;
    if (isStaff(req)) { // funcionário não vê o custo: mantém o custo e o fornecedor que já estavam
      const cur = db.prepare('SELECT unit_cost_cents, supplier_id FROM products WHERE id = ?').get(id(req.params.id)) as any;
      if (cur) { b.unitCostCents = cur.unit_cost_cents; b.supplierId = cur.supplier_id; }
    }
    return safe(req, inv.updateProduct(C(req), id(req.params.id), b));
  }));
  api.get('/suppliers', wrap((req) => inv.listSuppliers(C(req))));
  api.post('/suppliers', wrap((req, res) => { res.status(201); return inv.saveSupplier(C(req), null, z.object({ name: z.string(), cnpj: optStr, phone: optStr, notes: optStr }).parse(req.body)); }));
  api.put('/suppliers/:id', wrap((req) => inv.saveSupplier(C(req), id(req.params.id), z.object({ name: z.string(), cnpj: optStr, phone: optStr, notes: optStr, active: z.boolean().optional() }).parse(req.body))));

  api.get('/stock/movements', wrap((req) => safe(req, inv.listMovements(C(req), {
    productId: num(req.query.productId), type: str(req.query.type), reason: str(req.query.reason), from: str(req.query.from), to: str(req.query.to), limit: num(req.query.limit),
  }))));
  api.post('/stock/out', wrap((req, res) => {
    const b = z.object({
      productId: z.number().int(), qtyMilli: z.number().int().min(1), occurredAt: optStr,
      reason: z.enum(['consumo', 'perda', 'descarte', 'uso_interno', 'ajuste_inventario', 'outro']), notes: optStr,
    }).parse(req.body);
    res.status(201);
    return safe(req, inv.registerStockOut(C(req), b as any));
  }));
  api.post('/stock/adjust', wrap((req, res) => {
    owner(req);
    res.status(201);
    return inv.inventoryAdjust(C(req), z.object({ productId: z.number().int(), countedMilli: z.number().int().min(0), notes: optStr }).parse(req.body));
  }));
  api.get('/stock/verify', wrap(() => ({ divergences: verifyBalances(db) })));

  // Compras
  api.get('/purchases', wrap((req) => purchases.listPurchases(C(req), { from: str(req.query.from), to: str(req.query.to), supplierId: num(req.query.supplierId), status: str(req.query.status), paymentStatus: str(req.query.paymentStatus), q: str(req.query.q) })));
  api.post('/purchases', wrap((req, res) => { const r = purchases.createPurchase(C(req), purchaseSchema.parse(req.body) as any); res.status(r.duplicate ? 200 : 201); return r; }));
  // Nota fiscal: chave bipada, XML e foto
  api.get('/purchases/check-key', wrap((req) => {
    const k = parseAccessKey(String(req.query.key ?? ''));
    const supplier = db.prepare('SELECT id, name FROM suppliers WHERE cnpj = ?').get(k.cnpj) ?? null;
    const duplicate = db.prepare("SELECT id, number FROM purchases WHERE access_key = ? AND status = 'confirmada'").get(k.key) ?? null;
    return { ...k, supplier, duplicate };
  }));
  api.post('/purchases/parse-xml', wrap((req) => {
    const b = z.object({ xml: z.string().min(10) }).parse(req.body);
    return matchDraft(C(req), checkTotals(parseNfeXml(b.xml)));
  }));
  api.get('/purchases/photo-status', wrap(() => ({ enabled: !!process.env.ANTHROPIC_API_KEY })));
  api.post('/purchases/parse-photo', wrapAsync(async (req) => {
    const b = z.object({ image: z.string().min(100), mediaType: z.string() }).parse(req.body);
    return matchDraft(C(req), await readNotePhoto(b.image, b.mediaType));
  }));
  api.get('/purchases/:id', wrap((req) => purchases.getPurchase(C(req), id(req.params.id))));
  api.put('/purchases/:id', wrap((req) => purchases.updatePurchaseInfo(C(req), id(req.params.id), z.object({ supplierId: z.number().int().nullish(), invoiceNumber: optStr, paymentMethod: optStr, dueDate: optStr, notes: optStr }).parse(req.body))));
  api.post('/purchases/:id/payments', wrap((req) => purchases.addPurchasePayment(C(req), id(req.params.id), z.object({ amountCents: z.number().int().min(1), method: optStr, paidDate: dateStr.optional() }).parse(req.body))));
  api.post('/purchases/:id/cancel', wrap((req) => purchases.cancelPurchase(C(req), id(req.params.id), z.object({ reason: z.string() }).parse(req.body).reason)));

  // Despesas
  api.get('/expenses', wrap((req) => expenses.listExpenses(C(req), { from: str(req.query.from), to: str(req.query.to), category: str(req.query.category), status: str(req.query.status), q: str(req.query.q), includeVoided: req.query.voided === '1' })));
  api.post('/expenses', wrap((req, res) => { res.status(201); return expenses.createExpense(C(req), expenseSchema.parse(req.body) as any); }));
  api.put('/expenses/:id', wrap((req) => expenses.updateExpense(C(req), id(req.params.id), expenseSchema.parse(req.body) as any)));
  api.post('/expenses/:id/pay', wrap((req) => expenses.payExpense(C(req), id(req.params.id), z.object({ method: optStr, paidDate: dateStr.optional() }).parse(req.body))));
  api.post('/expenses/:id/void', wrap((req) => expenses.voidExpense(C(req), id(req.params.id), z.object({ reason: z.string() }).parse(req.body).reason)));

  // Clientes e endereços
  const addressSchema = z.object({ label: z.string(), street: z.string(), complement: optStr, neighborhood: optStr, reference: optStr });
  api.get('/customers', wrap((req) => safe(req, customers.listCustomers(C(req), { q: str(req.query.q), page: num(req.query.page), pageSize: num(req.query.pageSize) }))));
  api.get('/customers/by-phone/:phone', wrap((req) => safe(req, customers.findByPhone(C(req), String(req.params.phone)))));
  api.get('/customers/:id', wrap((req) => safe(req, customers.getCustomer(C(req), id(req.params.id)))));
  api.post('/customers', wrap((req, res) => {
    const b = z.object({ name: z.string(), phone: z.string(), notes: optStr, addresses: z.array(addressSchema).max(20).optional() }).parse(req.body);
    res.status(201);
    return customers.createCustomer(C(req), b);
  }));
  api.put('/customers/:id', wrap((req) => customers.updateCustomer(C(req), id(req.params.id), z.object({ name: z.string(), phone: z.string(), notes: optStr }).parse(req.body))));
  api.delete('/customers/:id', wrap((req) => { owner(req); return customers.deleteCustomer(C(req), id(req.params.id)); }));
  api.post('/customers/:id/addresses', wrap((req, res) => { res.status(201); return customers.addAddress(C(req), id(req.params.id), addressSchema.parse(req.body)); }));
  api.put('/customers/:id/addresses/:aid', wrap((req) => customers.updateAddress(C(req), id(req.params.id), id(req.params.aid), addressSchema.parse(req.body))));
  api.delete('/customers/:id/addresses/:aid', wrap((req) => customers.deleteAddress(C(req), id(req.params.id), id(req.params.aid))));

  // Impressora da cozinha (qualquer pessoa da equipe: a tela fica no computador da cozinha)
  api.get('/kitchen/queue', wrap((req) => kitchen.pendingPrints(C(req))));
  api.get('/kitchen/recent', wrap((req) => kitchen.recentPrints(C(req))));
  api.post('/kitchen/jobs/:id/claim', wrap((req) => kitchen.claimPrint(C(req), id(req.params.id))));
  api.post('/orders/:id/print', wrap((req) => kitchen.reprint(C(req), id(req.params.id))));

  // Cardápio do dia (qualquer pessoa da equipe pode montar e marcar "esgotou")
  const menuOption = z.object({ name: z.string(), description: z.string().max(300).optional().default(''), sizes: z.array(z.string()).optional().default([]), soldOut: z.boolean().optional().default(false),
    parts: z.array(z.object({ label: z.string().optional().default(''), value: z.string().optional().default(''), swaps: z.array(z.string()).optional().default([]) })).optional(),
    carnes: z.number().int().optional(), guarnicoes: z.number().int().optional() });
  const dayItem = z.union([z.string(), z.object({ name: z.string(), soldOut: z.boolean().optional() })]);
  api.get('/menu/:date', wrap((req) => menu.getMenu(C(req), String(req.params.date))));
  api.put('/menu/:date', wrap((req) => {
    const b = z.object({ options: z.array(menuOption), swaps: z.array(z.object({ title: z.string(), items: z.array(z.string()) })).optional(),
      items: z.object({ carnes: z.array(dayItem).optional(), guarnicoes: z.array(dayItem).optional() }).optional() }).parse(req.body);
    return menu.saveMenu(C(req), String(req.params.date), b.options, b.swaps, b.items);
  }));
  api.post('/menu/:date/sold-out', wrap((req) => {
    const b = z.object({ name: z.string().min(1), soldOut: z.boolean() }).parse(req.body);
    return menu.setSoldOut(C(req), String(req.params.date), b.name, b.soldOut);
  }));

  // Distância do restaurante até o endereço do cliente (pelas ruas). A chave do mapa fica só no servidor.
  const distanceUse = new Map<number, { n: number; until: number }>();
  api.get('/distance', wrapAsync(async (req) => {
    if (!route) return { enabled: false };
    const q = z.object({ street: z.string().trim().min(3, 'Informe a rua e o número.').max(200), neighborhood: z.string().trim().max(80).optional() }).parse(req.query);
    const est = getSettings(db).establishment as any;
    if (!est.address?.trim()) return { enabled: true, found: false, reason: 'Cadastre o endereço do restaurante em Configurações para calcular a distância.' };
    const city = est.city?.trim() || '';
    // limite de consultas novas por pessoa (protege a cota/custo do mapa); endereços já consultados não contam
    const u = C(req).userId!; const now = Date.now();
    const use = distanceUse.get(u); const cur = use && use.until > now ? use : { n: 0, until: now + 3_600_000 };
    try {
      const out = await cachedDistance(db, async (o, d) => {
        if (cur.n >= 150) throw err(429, 'Muitas consultas de distância nesta hora. Tente de novo mais tarde.');
        cur.n++; distanceUse.set(u, cur);
        return route(o, d);
      }, est.address, fullAddress(q.street, q.neighborhood, city));
      if (!out.result) return { enabled: true, found: false, reason: 'O mapa não achou esse endereço. Confira a rua, o número e o bairro.' };
      return { enabled: true, found: true, ...out.result };
    } catch (e: any) {
      if (e?.status === 429) throw e;
      console.error('Falha ao calcular distância:', e?.message ?? e);
      throw err(502, 'Não foi possível calcular a distância agora. O pedido pode ser feito normalmente.');
    }
  }));

  // Sugestões de endereço enquanto digita (sem precisar cadastrar bairros: o bairro vem junto do endereço escolhido)
  const placesUse = new Map<number, { n: number; until: number }>();
  const session = z.string().trim().min(8).max(64).regex(/^[\w-]+$/);
  const countPlaces = (req: any) => {
    const u = C(req).userId!; const t = Date.now();
    const use = placesUse.get(u); const cur = use && use.until > t ? use : { n: 0, until: t + 3_600_000 };
    if (cur.n >= 600) throw err(429, 'Muitas buscas de endereço nesta hora. Digite o endereço normalmente.');
    cur.n++; placesUse.set(u, cur);
  };
  api.get('/places/suggest', wrapAsync(async (req) => {
    if (!places) return { enabled: false, suggestions: [] };
    const q = z.object({ q: z.string().trim().min(3).max(120), session }).parse(req.query);
    countPlaces(req);
    const est = getSettings(db).establishment as any;
    try {
      const near = est.address?.trim() ? await originPoint(db, places, est.address) : null;
      return { enabled: true, suggestions: await places.suggest(q.q, q.session, near) };
    } catch (e: any) {
      console.error('Falha nas sugestões de endereço:', e?.message ?? e);
      throw err(502, 'Sugestões de endereço indisponíveis agora. Digite o endereço normalmente.');
    }
  }));
  api.get('/places/details', wrapAsync(async (req) => {
    if (!places) return { enabled: false };
    const q = z.object({ id: z.string().trim().min(5).max(300).regex(/^[\w-]+$/), session }).parse(req.query);
    countPlaces(req);
    try {
      const a = await places.details(q.id, q.session);
      if (!a) return { enabled: true, found: false };
      return { enabled: true, found: true, ...a };
    } catch (e: any) {
      console.error('Falha ao ler o endereço escolhido:', e?.message ?? e);
      throw err(502, 'Não foi possível ler esse endereço agora. Digite o endereço normalmente.');
    }
  }));

  // Ficha técnica (módulo extra)
  const needFichas = () => { if (!modules.fichas) throw err(403, 'As fichas técnicas não estão ativadas neste sistema.'); };
  api.get('/recipes', wrap((req) => { needFichas(); return recipes.listRecipes(C(req)); }));
  api.put('/recipes/:size', wrap((req) => {
    needFichas();
    owner(req);
    const b = z.object({ items: z.array(z.object({ productId: z.number().int(), qtyMilli: z.number().int().min(1) })) }).parse(req.body);
    return recipes.saveRecipe(C(req), String(req.params.size), b.items);
  }));

  // Caixa do dia
  api.get('/cash/:day', wrap((req) => cash.cashDay(C(req), String(req.params.day))));
  api.post('/cash/:day/open', wrap((req) => cash.openCash(C(req), String(req.params.day), z.object({ openingCents: cents }).parse(req.body).openingCents)));
  api.post('/cash/:day/movements', wrap((req) => {
    const b = z.object({ kind: z.enum(['sangria', 'suprimento']), amountCents: z.number().int().min(1), reason: z.string() }).parse(req.body);
    return cash.addCashMovement(C(req), String(req.params.day), b.kind, b.amountCents, b.reason);
  }));
  api.post('/cash/:day/close', wrap((req) => {
    const b = z.object({ countedCashCents: cents, leftInDrawerCents: cents, checks: z.record(z.string(), cents).optional(), notes: optStr }).parse(req.body);
    return cash.closeCash(C(req), String(req.params.day), b);
  }));
  api.post('/cash/:day/reopen', wrap((req) => { owner(req); return cash.reopenCash(C(req), String(req.params.day)); }));

  // Contas a pagar
  api.get('/reports/payables', wrap((req) => {
    const days = req.query.days === undefined ? getSettings(db).dueAlertDays : z.coerce.number({ invalid_type_error: 'Dias inválidos.' }).int('Dias inválidos.').min(0).max(365).parse(req.query.days);
    return reports.payables(C(req), days);
  }));

  // Relatórios
  const range = (req: Request) => {
    const q = z.object({ from: dateStr, to: dateStr }).parse(req.query);
    if (q.from > q.to) throw new ValidationError('A data inicial não pode ser posterior à data final.');
    return q;
  };
  api.get('/reports/dashboard', wrap((req) => {
    const r = range(req);
    const d = reports.dashboard(C(req), r.from, r.to);
    if (!isStaff(req)) return d;
    // tela Hoje do funcionário: pedidos, marmitas e estoque acabando. Nada de dinheiro.
    const s = d.summary;
    return { staff: true, summary: { from: s.from, to: s.to, orders: s.orders, marmitasByOption: s.marmitasByOption, marmitasTotal: s.marmitasTotal }, stock: d.stock, today: d.today };
  }));
  api.get('/reports/summary', wrap((req) => { const r = range(req); return { summary: reports.summary(C(req), r.from, r.to), series: reports.dailySeries(C(req), r.from, r.to) }; }));
  api.get('/reports/monthly', wrap((req) => { const q = z.object({ year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12) }).parse(req.query); return reports.monthly(C(req), q.year, q.month); }));
  api.get('/reports/stock', wrap((req) => { const r = range(req); return reports.stockReport(C(req), r.from, r.to); }));

  app.use('/api', api);
  app.use('/api', (_q, r) => r.status(404).json({ error: 'Rota não encontrada.' }));

  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
    app.get('*', (_q, r) => r.sendFile(path.join(opts.staticDir!, 'index.html')));
  }

  // --- tratamento central de erros ---
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Os dados enviados estão incompletos ou corrompidos. Nada foi salvo; tente novamente.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Os dados enviados são grandes demais. Para fotos, use uma imagem menor.' });
    if (err instanceof z.ZodError) {
      const msg = err.issues.map((i) => i.message === 'Required' ? `Campo obrigatório: ${i.path.join('.')}` : i.message).join(' ');
      return res.status(400).json({ error: `Dados inválidos. ${msg}` });
    }
    if (/constraint failed/i.test(String(err?.message ?? '')) || /constraint/i.test(String(err?.errstr ?? ''))) {
      return res.status(409).json({ error: 'Operação recusada pelo banco de dados (registro duplicado ou valor inválido).' });
    }
    if (err?.status && err.status !== 500) return res.status(err.status).json({ error: err.message, ...(err.existingId ? { existingId: err.existingId } : {}) }); // erros previstos (4xx, 501, 502) com mensagem clara
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Nada foi salvo; tente novamente.' });
  });

  return app;
}
