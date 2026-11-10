/**
 * HANDOVER API — Cloudflare Worker (DiSH Creative Ltd).
 *
 * Endpoints
 *   POST /create-checkout-session   -> { client_secret }         Stripe Checkout Session, ui_mode=form (embedded form)
 *   GET  /claim?session_id=cs_...   -> { licence }               after payment: issue (idempotent) and return the key
 *   POST /stripe-webhook            -> 200                       checkout.session.completed: issue the key even if the tab was closed
 *   POST /unlock  {licence}         -> fragments JSON            the licensed prompt fragments
 *   GET  /health                    -> { ok }
 *
 * Privacy: this service never receives documents, maps or packs. It handles Stripe session IDs and licence keys only.
 * KV stores licence -> { session, created, revoked }. No email, no name: Stripe holds the customer record.
 *
 * Secrets (wrangler secret put): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, LICENCE_SECRET
 * Vars (wrangler.toml):          MANAGED_PAYMENTS, REQUIRE_TERMS, STRIPE_API_VERSION, PRODUCT_ID (uses its default price) or PRICE_ID, PAYMENT_LINK_ID, SITE_ORIGIN, ALLOWED_ORIGINS, AUTOMATIC_TAX, ALLOW_PROMOTION_CODES
 * KV binding:                    LICENCES
 */
import fragments from "../../private/fragments.json";

const STRIPE = "https://api.stripe.com/v1";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

// ------------------------------------------------------------------------------------------------ helpers
const enc = new TextEncoder();

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function cors(req, env) {
  const origin = req.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || env.SITE_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST,OPTIONS",
           "access-control-allow-headers": "content-type", "access-control-max-age": "86400", vary: "origin" };
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Deterministic licence for a Checkout Session: the same session always yields the same key (idempotent). */
export async function licenceFor(secret, sessionId) {
  const b = await hmac(secret, "handover-licence|" + sessionId);
  let s = "";
  for (let i = 0; i < 12; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return `HX-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export const LICENCE_RX = /^HX-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

async function stripe(env, method, path, form) {
  const r = await fetch(STRIPE + path, {
    method,
    headers: { authorization: "Bearer " + env.STRIPE_SECRET_KEY, "content-type": "application/x-www-form-urlencoded",
               "stripe-version": env.STRIPE_API_VERSION || "2026-08-26.dahlia" },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const body = await r.json();
  if (!r.ok) {
    const e = new Error("stripe " + path + ": " + (body.error && body.error.message || r.status));
    e.status = r.status;
    throw e;
  }
  return body;
}

/** Stripe-Signature: t=...,v1=... ; signed payload = `${t}.${rawBody}` ; tolerance 5 min. */
export async function verifyStripeSignature(rawBody, header, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=")).filter((p) => p.length === 2)
    .map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = header.split(",").filter((p) => p.trim().startsWith("v1=")).map((p) => p.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(nowSec - t) > 300) return false;
  const expected = hex(await hmac(secret, `${t}.${rawBody}`));
  return sigs.some((s) => timingSafeEqual(s, expected));
}

async function issue(env, session) {
  // "paid", or "no_payment_required" when a 100%-off promotion code (e.g. a workshop gift) brought the total to zero.
  if (session.status !== "complete" || !["paid", "no_payment_required"].includes(session.payment_status)) return null;
  // Only HANDOVER purchases earn a key: our embedded checkout tags the session, the Payment Link is matched by ID.
  // Any other DiSH Creative Ltd sale (another product, a different link) is refused.
  const ours = (session.metadata && session.metadata.product === "handover") ||
               (!!env.PAYMENT_LINK_ID && session.payment_link === env.PAYMENT_LINK_ID);
  if (!ours) return null;
  const licence = await licenceFor(env.LICENCE_SECRET, session.id);
  const existing = await env.LICENCES.get(licence, "json");
  if (!existing) {
    await env.LICENCES.put(licence, JSON.stringify({ session: session.id, created: new Date().toISOString(), revoked: false }));
    if (session.payment_intent) {  // so the key is visible on the payment in the Stripe dashboard (support)
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
      try { await stripe(env, "POST", `/payment_intents/${pi}`, { "metadata[handover_licence]": licence }); } catch (e) { /* non-fatal */ }
    }
  }
  return licence;
}

// ------------------------------------------------------------------------------------------------ routes
let cachedPrice = null;
/** PRICE_ID wins if set; otherwise the product's default price (set in the Stripe dashboard), cached per isolate. */
export async function resolvePrice(env) {
  if (env.PRICE_ID && /^price_/.test(env.PRICE_ID)) return env.PRICE_ID;
  if (cachedPrice && cachedPrice.product === env.PRODUCT_ID) return cachedPrice.price;
  const p = await stripe(env, "GET", `/products/${env.PRODUCT_ID}`);
  const price = typeof p.default_price === "string" ? p.default_price : p.default_price && p.default_price.id;
  if (!p.active || !price) throw new Error("product has no active default price");
  cachedPrice = { product: env.PRODUCT_ID, price };
  return price;
}

async function createSession(req, env) {
  // UK Consumer Contracts Regs 2013 reg 37: the checkout page collects express consent + the 14-day waiver acknowledgement
  // (a required tick box) before the form loads; we stamp it on the session and payment as the record.
  let body = {};
  try { body = await req.json(); } catch (e) { /* no body */ }
  const waiver = body && body.waiver === true;
  const terms = String(body && body.terms || "").slice(0, 20).replace(/[^0-9A-Za-z.-]/g, "");
  if (env.REQUIRE_TERMS === "true" && !waiver) return json({ error: "terms_not_accepted" }, 400, cors(req, env));
  // MANAGED_PAYMENTS = "true": Stripe (via Link) is merchant of record and handles VAT/sales tax worldwide.
  // Managed Payments supports Checkout's hosted or embedded page, not the "form" components, so the buyer is
  // sent to Stripe's hosted page and comes back to /checkout/return/. Otherwise the embedded form is used.
  const managed = env.MANAGED_PAYMENTS === "true";
  const returnTo = `${env.SITE_ORIGIN}/checkout/return/?session_id={CHECKOUT_SESSION_ID}`;
  const form = {
    "line_items[0][price]": await resolvePrice(env), "line_items[0][quantity]": "1", mode: "payment",
    "metadata[product]": "handover", "payment_intent_data[metadata][product]": "handover",
  };
  if (managed) {
    Object.assign(form, { ui_mode: "hosted_page", success_url: returnTo, cancel_url: `${env.SITE_ORIGIN}/checkout/`,
                          "managed_payments[enabled]": "true", integration_identifier: "handover_hosted_v1" });
  } else {
    Object.assign(form, { ui_mode: "form", return_url: returnTo, integration_identifier: "handover_form_v1" });
    if (env.AUTOMATIC_TAX === "true") form["automatic_tax[enabled]"] = "true";  // not allowed with Managed Payments
  }
  if (env.ALLOW_PROMOTION_CODES !== "false") form.allow_promotion_codes = "true";  // customer-facing codes from the Stripe dashboard
  if (waiver) {
    const stamp = `accepted ${new Date().toISOString()} terms ${terms || "unknown"}`;
    form["metadata[consent]"] = stamp;
    form["payment_intent_data[metadata][consent]"] = stamp;
  }
  const s = await stripe(env, "POST", "/checkout/sessions", form);
  return json(managed ? { url: s.url } : { client_secret: s.client_secret }, 200, cors(req, env));
}

async function claim(req, env) {
  const id = new URL(req.url).searchParams.get("session_id") || "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json({ error: "bad_session" }, 400, cors(req, env));
  let s;
  try { s = await stripe(env, "GET", `/checkout/sessions/${id}`); }
  catch (e) { if (e.status === 404) return json({ error: "unknown_session" }, 404, cors(req, env)); throw e; }
  const licence = await issue(env, s);
  if (!licence) return json({ status: s.status, payment_status: s.payment_status }, 402, cors(req, env));
  return json({ licence }, 200, { ...cors(req, env), "cache-control": "no-store" });
}

async function webhook(req, env) {
  const raw = await req.text();
  if (!(await verifyStripeSignature(raw, req.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET))) {
    return new Response("bad signature", { status: 400 });
  }
  const ev = JSON.parse(raw);
  if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
    await issue(env, ev.data.object);
  }
  return new Response("ok");
}

async function unlock(req, env) {
  let body = {};
  try { body = await req.json(); } catch (e) { /* fallthrough */ }
  const licence = String(body.licence || "").trim().toUpperCase();
  if (!LICENCE_RX.test(licence)) return json({ error: "bad_licence" }, 403, cors(req, env));
  const rec = await env.LICENCES.get(licence, "json");
  if (!rec || rec.revoked) return json({ error: "unknown_licence" }, 403, cors(req, env));
  return json(fragments, 200, { ...cors(req, env), "cache-control": "no-store" });
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, env) });
    try {
      if (pathname === "/health") return json({ ok: true });
      if (pathname === "/create-checkout-session" && req.method === "POST") return await createSession(req, env);
      if (pathname === "/claim" && req.method === "GET") return await claim(req, env);
      if (pathname === "/stripe-webhook" && req.method === "POST") return await webhook(req, env);
      if (pathname === "/unlock" && req.method === "POST") return await unlock(req, env);
      return json({ error: "not_found" }, 404);
    } catch (e) {
      console.error(pathname, e && e.message);  // visible in: npx wrangler@4 tail (never includes secrets)
      return json({ error: "server_error" }, 500, cors(req, env));
    }
  },
};
