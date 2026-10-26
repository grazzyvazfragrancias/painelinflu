// Clube de Influenciadoras · Grazzy Vaz Fragrâncias
// Função do servidor (Supabase Edge Function "painel").
//
//   POST /functions/v1/painel/bagy   -> recebe os avisos de pedido da Bagy (URL de callback do webhook)
//   POST /functions/v1/painel/admin  -> ações da administradora: sincronizar pedidos, testar a Bagy, criar acesso
//
// Segredos necessários (Edge Functions > Secrets):
//   BAGY_TOKEN  = token gerado na Bagy em Configurações > APIs e Webhooks > Adicionar API
//
// Segurança do webhook: a URL leva uma chave secreta (?chave=...) gerada pelo banco e mostrada na
// tela Integração Bagy. Além disso, o conteúdo do aviso nunca é usado diretamente: a função pega só
// o número do pedido e busca o pedido na API da Bagy com o seu token.

import { createClient } from "npm:@supabase/supabase-js@2";

const BAGY_API = Deno.env.get("BAGY_API_URL") ?? "https://api.dooca.store";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS") ?? "";
  try {
    const v = JSON.parse(raw);
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return String(v[0]);
    return String(v.default ?? Object.values(v)[0]);
  } catch {
    return raw;
  }
}

const db = createClient(SUPABASE_URL, serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

// ---------------- Bagy ----------------

async function bagy(path: string): Promise<Obj | Obj[] | null> {
  const token = Deno.env.get("BAGY_TOKEN");
  if (!token) throw new Error("Falta o segredo BAGY_TOKEN na função.");
  const r = await fetch(BAGY_API + path, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (r.status === 404) return null;
  if (r.status === 401 || r.status === 403) {
    throw new Error("A Bagy recusou o token. Gere um novo em Configurações > APIs e Webhooks e atualize o BAGY_TOKEN.");
  }
  if (!r.ok) throw new Error(`A Bagy respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

function asList(x: unknown): Obj[] {
  if (Array.isArray(x)) return x;
  const o = x as Obj | null;
  if (o && Array.isArray(o.data)) return o.data;
  if (o && Array.isArray(o.items)) return o.items;
  if (o && Array.isArray(o.orders)) return o.orders;
  if (o && o.id != null) return [o];
  return [];
}

function unwrapOrder(x: unknown): Obj | null {
  const o = x as Obj | null;
  if (!o) return null;
  if (o.data && typeof o.data === "object" && !Array.isArray(o.data) && o.data.id != null) return o.data;
  return o;
}

async function knownCoupons(): Promise<Set<string>> {
  const { data, error } = await db.from("influencers").select("coupon");
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r: Obj) => String(r.coupon).toUpperCase()));
}

// Partes do pedido onde não há cupom (evita confundir nome de cliente, produto ou observação com um cupom)
const SKIP_TOP = /^(customer|address|shipping|billing|items|histories|payment|payment_method|fulfillment|note|extra|device|token|marketplace)$/i;
const COUPONISH = /coupon|cupom|voucher|promo|discount|desconto/;

// Procura o cupom no pedido, nesta ordem:
//   1. um cupom cadastrado, dentro de um campo de cupom/desconto;
//   2. outro código dentro de um campo de cupom/desconto (vira "cupom sem dona");
//   3. um cupom cadastrado em outro campo do pedido (só códigos com letras e 4+ caracteres).
export function findCoupon(order: Obj, known: Set<string>): string | null {
  let strong: string | null = null;
  let weak: string | null = null;
  let loose: string | null = null;
  const visit = (v: unknown, path: string[], depth: number) => {
    if (depth > 8 || strong) return;
    if (typeof v === "string" || typeof v === "number") {
      const s = String(v).trim().toUpperCase();
      if (!s) return;
      const p = path.join(".").toLowerCase();
      const key = (path[path.length - 1] ?? "").toLowerCase();
      const couponish = COUPONISH.test(p);
      if (known.has(s)) {
        if (couponish) strong = s;
        else if (!loose && s.length >= 4 && /[A-Z]/.test(s)) loose = s;
        return;
      }
      if (
        !weak && couponish &&
        /code|codigo|coupon|cupom|voucher|name|nome|title/.test(key) &&
        /^[A-Z0-9][A-Z0-9_-]{2,29}$/.test(s) && /[A-Z]/.test(s)
      ) weak = s;
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, [...path, String(i)], depth + 1));
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Obj)) {
        if (depth === 0 && SKIP_TOP.test(k)) continue;
        visit(x, [...path, k], depth + 1);
      }
    }
  };
  visit(order, [], 0);
  return strong ?? weak ?? loose;
}

function num(v: unknown): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function statusOf(o: Obj): "aprovado" | "pendente" | "cancelado" {
  const st = String(o.status ?? "").toLowerCase();
  const ps = String(o.payment_status ?? o.payment?.status ?? "").toLowerCase();
  if (st === "canceled" || st === "cancelled" || o.canceled_at) return "cancelado";
  if (["voided", "refunded", "chargeback", "denied", "expired", "canceled", "cancelled"].includes(ps)) return "cancelado";
  if (["approved", "paid", "authorized"].includes(ps)) return "aprovado";
  return "pendente";
}

export function orderToSale(o: Obj, coupon: string): Obj {
  const code = String(o.code ?? o.id);
  const customer = o.customer?.name ??
    [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") ?? null;
  const total = num(o.total);
  const base = o.subtotal != null ? Math.max(0, num(o.subtotal) - Math.abs(num(o.discount))) : total;
  const date = String(o.created_at ?? "").slice(0, 10);
  const paid = String(o.paid_at ?? o.payment?.paid_at ?? o.approved_at ?? o.payment?.approved_at ?? "").slice(0, 10);
  const row: Obj = {
    external_id: `bagy-${code}`,
    bagy_id: String(o.id),
    order_number: code,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10),
    customer: customer || null,
    coupon,
    total,
    base,
    status: statusOf(o),
    source: "bagy",
    raw: o,
  };
  // Só envia a data de pagamento se a Bagy informar; senão o banco marca o dia em que viu o pedido pago
  if (/^\d{4}-\d{2}-\d{2}$/.test(paid) && row.status === "aprovado") row.paid_at = paid;
  return row;
}

async function saveOrder(o: Obj, known: Set<string>) {
  const coupon = findCoupon(o, known);
  if (!coupon) return { saved: false as const, reason: "sem cupom" };
  const row = orderToSale(o, coupon);
  const { data: cur } = await db.from("sales").select("manual_override").eq("external_id", row.external_id).maybeSingle();
  if (cur?.manual_override) return { saved: false as const, reason: "editada à mão no painel" };
  const { error } = await db.from("sales").upsert(row, { onConflict: "external_id" });
  if (error) throw new Error(error.message);
  return { saved: true as const, coupon, matched: known.has(coupon), status: row.status as string, code: row.order_number };
}

async function log(event: string, ref: string, result: string, detail = "") {
  await db.from("bagy_log").insert({ event: event.slice(0, 60), order_ref: ref.slice(0, 60), result, detail: detail.slice(0, 500) });
  const cutoff = new Date(Date.now() - 60 * 864e5).toISOString();
  await db.from("bagy_log").delete().lt("at", cutoff);
}

// ---------------- Webhook ----------------

let cachedKey = "";
async function webhookKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const { data, error } = await db.from("integration").select("webhook_key").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  cachedKey = String(data?.webhook_key ?? "");
  return cachedKey;
}

async function handleWebhook(req: Request): Promise<Response> {
  const key = new URL(req.url).searchParams.get("chave") ?? "";
  const expected = await webhookKey();
  if (!expected || key !== expected) return json({ ok: false, error: "Chave inválida." }, 401);
  const text = await req.text();
  let body: Obj = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = Object.fromEntries(new URLSearchParams(text));
  }
  const inner: Obj = body.body && typeof body.body === "object" && (body.body.event || body.body.data) ? body.body : body;
  const event = String(inner.event ?? inner.act ?? inner.scope_name ?? "pedido");
  const id = inner.data?.id ?? inner.id ?? inner.scope_id ?? inner.order_id ?? inner.data?.order_id;
  if (id == null || id === "") {
    await log(event, "", "ignorado", "Aviso sem número de pedido");
    return json({ ok: true });
  }
  const ref = String(id);
  try {
    const order = unwrapOrder(await bagy(`/orders/${encodeURIComponent(ref)}`));
    if (!order) {
      if (/delet|cancel/i.test(event)) {
        await db.from("sales").update({ status: "cancelado" }).eq("bagy_id", ref);
      }
      await log(event, ref, "pedido não encontrado na Bagy");
      return json({ ok: true });
    }
    const r = await saveOrder(order, await knownCoupons());
    if (!r.saved) {
      await log(event, String(order.code ?? ref), "ignorado", r.reason === "sem cupom" ? "Pedido sem cupom" : "Venda editada à mão no painel; não foi alterada");
    } else {
      await log(event, r.code, r.matched ? "venda registrada" : "cupom sem dona", `${r.coupon} · ${r.status}`);
    }
    return json({ ok: true });
  } catch (e) {
    await log(event, ref, "erro", (e as Error).message);
    // 500 faz a Bagy tentar entregar de novo mais tarde
    return json({ ok: false, error: (e as Error).message }, 500);
  }
}

// ---------------- Administradora ----------------

async function requireAdmin(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await db.auth.getUser(jwt);
  const user = data?.user;
  if (error || !user?.email || !user.email_confirmed_at) return null;
  const { data: a } = await db.from("admin_emails").select("email").eq("email", user.email.toLowerCase()).maybeSingle();
  return a ? user : null;
}

function newPassword(): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = crypto.getRandomValues(new Uint8Array(8));
  const s = Array.from(b, (x) => abc[x % abc.length]).join("");
  return `gv-${s.slice(0, 4)}-${s.slice(4)}`;
}

async function actionAccess(p: Obj) {
  const { data: inf, error } = await db.from("influencers").select("id,name,email,status").eq("id", p.influencer_id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!inf) throw new Error("Influenciadora não encontrada.");
  if (!inf.email) throw new Error("Cadastre o e-mail da influenciadora antes de criar o acesso.");
  const password = newPassword();
  const { data: uid, error: e1 } = await db.rpc("auth_user_id_by_email", { p_email: inf.email });
  if (e1) throw new Error(e1.message);
  if (uid) {
    const { error: e2 } = await db.auth.admin.updateUserById(uid as string, { password, email_confirm: true });
    if (e2) throw new Error(e2.message);
  } else {
    const { error: e3 } = await db.auth.admin.createUser({ email: inf.email, password, email_confirm: true });
    if (e3) throw new Error(e3.message);
  }
  return { email: inf.email, password, created: !uid };
}

const isoDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? String(s) : null;

async function actionSync(p: Obj) {
  const today = new Date().toISOString().slice(0, 10);
  const from = isoDate(p.desde) ?? new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const to = isoDate(p.ate) ?? today;
  const known = await knownCoupons();
  const started = Date.now();
  const res = { lidos: 0, salvos: 0, de_influenciadoras: 0, cupom_sem_dona: 0, sem_cupom: 0, editadas: 0, paginas: 0, completo: true, desde: from, ate: to };
  let details = 0;
  for (let page = 1; page <= 60; page++) {
    if (Date.now() - started > 110_000) {
      res.completo = false;
      break;
    }
    const list = asList(await bagy(`/orders?created_at=${from}--${to}&limit=100&page=${page}&sort=id`));
    res.paginas = page;
    for (let o of list) {
      res.lidos++;
      if (!findCoupon(o, known) && num(o.discount) !== 0 && !(Array.isArray(o.discounts) && o.discounts.length) && details < 200) {
        details++;
        o = unwrapOrder(await bagy(`/orders/${encodeURIComponent(String(o.id))}`)) ?? o;
      }
      const r = await saveOrder(o, known);
      if (!r.saved) { if (r.reason === "sem cupom") res.sem_cupom++; else res.editadas++; }
      else {
        res.salvos++;
        if (r.matched) res.de_influenciadoras++;
        else res.cupom_sem_dona++;
      }
    }
    if (list.length < 100) break;
  }
  await log("sincronização", `${from} a ${to}`, res.completo ? "concluída" : "parcial", `${res.salvos} vendas com cupom de ${res.lidos} pedidos`);
  return res;
}

async function actionTest() {
  const known = await knownCoupons();
  const list = asList(await bagy(`/orders?limit=20&sort=-id`)).slice(0, 5);
  const pedidos = [];
  for (const item of list) {
    const o = unwrapOrder(await bagy(`/orders/${encodeURIComponent(String(item.id))}`)) ?? item;
    pedidos.push({
      numero: o.code ?? o.id,
      data: String(o.created_at ?? "").slice(0, 10),
      total: o.total,
      status: o.status,
      pagamento: o.payment_status,
      desconto: o.discount,
      cupom_encontrado: findCoupon(o, known),
      descontos: o.discounts ?? null,
      campos: Object.keys(o),
    });
  }
  return { ok: true, pedidos };
}

async function handleAdmin(req: Request): Promise<Response> {
  const user = await requireAdmin(req);
  if (!user) return json({ error: "Acesso permitido só para administradoras." }, 403);
  let p: Obj = {};
  try {
    p = await req.json();
  } catch { /* corpo vazio */ }
  try {
    if (p.action === "acesso") return json(await actionAccess(p));
    if (p.action === "sincronizar") return json(await actionSync(p));
    if (p.action === "testar") return json(await actionTest());
    return json({ error: "Ação desconhecida." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}

// ---------------- Rotas ----------------

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  if (path.endsWith("/bagy")) {
    if (req.method === "GET") return json({ ok: true, info: "Webhook da Bagy pronto para receber pedidos." });
    return await handleWebhook(req);
  }
  if (path.endsWith("/admin") && req.method === "POST") return await handleAdmin(req);
  return json({ error: "Rota não encontrada." }, 404);
}

Deno.serve(handler);
