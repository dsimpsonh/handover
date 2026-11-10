// node --test test/  (from worker/). Exercises every route with a mocked Stripe API and in-memory KV.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "../src/index.js"), "utf8")
  .replace('import fragments from "../../private/fragments.json";',
           'const fragments = ' + readFileSync(path.join(here, "../../private/fragments.json"), "utf8") + ';');
const dir = mkdtempSync(path.join(tmpdir(), "hxw-"));
writeFileSync(path.join(dir, "w.mjs"), src);
const W = await import(path.join(dir, "w.mjs"));

const kv = () => { const m = new Map(); return { m, async get(k, t) { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; }, async put(k, v) { m.set(k, v); } }; };
const ORIGIN = "https://handover.dianasimpsonhernandez.com";
const env = () => ({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_test", LICENCE_SECRET: "s3cret",
  PRICE_ID: "price_123", SITE_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN, AUTOMATIC_TAX: "false", LICENCES: kv() });

let stripeCalls = [];
function mockStripe(session) {
  stripeCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    stripeCalls.push({ url: String(url), method: init.method, body: init.body });
    if (String(url).endsWith("/checkout/sessions") && init.method === "POST") return new Response(JSON.stringify({ id: "cs_test_A", client_secret: "cs_test_A_secret" }));
    if (String(url).includes("/checkout/sessions/")) return new Response(JSON.stringify(session));
    if (String(url).includes("/payment_intents/")) return new Response("{}");
    if (String(url).includes("/products/prod_X")) return new Response(JSON.stringify({ id: "prod_X", active: true, default_price: "price_default" }));
    return new Response("{}", { status: 404 });
  };
}
const paid = { id: "cs_test_PAID1", status: "complete", payment_status: "paid", payment_intent: "pi_1", metadata: { product: "handover" } };
const req = (p, init = {}) => new Request(ORIGIN.replace("handover.", "api.") + p, { headers: { origin: ORIGIN, ...(init.headers || {}) }, ...init });

test("licence is deterministic and well-formed", async () => {
  const a = await W.licenceFor("k", "cs_test_1"), b = await W.licenceFor("k", "cs_test_1"), c = await W.licenceFor("k", "cs_test_2");
  assert.equal(a, b); assert.notEqual(a, c); assert.match(a, W.LICENCE_RX);
});

test("create-checkout-session uses ui_mode=form, the price and the return url", async () => {
  mockStripe(paid); const e = env();
  const r = await W.default.fetch(req("/create-checkout-session", { method: "POST" }), e);
  assert.equal(r.status, 200); assert.equal((await r.json()).client_secret, "cs_test_A_secret");
  const body = new URLSearchParams(stripeCalls[0].body);
  assert.equal(body.get("ui_mode"), "form"); assert.equal(body.get("mode"), "payment");
  assert.equal(body.get("line_items[0][price]"), "price_123");
  assert.equal(body.get("return_url"), ORIGIN + "/checkout/return/?session_id={CHECKOUT_SESSION_ID}");
  assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
});

test("claim issues once, is idempotent, and unlock then returns fragments", async () => {
  mockStripe(paid); const e = env();
  const r1 = await (await W.default.fetch(req("/claim?session_id=cs_test_PAID1"), e)).json();
  const r2 = await (await W.default.fetch(req("/claim?session_id=cs_test_PAID1"), e)).json();
  assert.equal(r1.licence, r2.licence); assert.equal(e.LICENCES.m.size, 1);
  assert.equal(stripeCalls.filter((c) => c.url.includes("/payment_intents/")).length, 1); // written once, not on re-claim
  const u = await W.default.fetch(req("/unlock", { method: "POST", body: JSON.stringify({ licence: r1.licence.toLowerCase() }) }), e);
  assert.equal(u.status, 200); assert.ok((await u.json()).fragments.role);
});

test("unpaid session gets no licence", async () => {
  mockStripe({ ...paid, id: "cs_test_OPEN", status: "open", payment_status: "unpaid" }); const e = env();
  const r = await W.default.fetch(req("/claim?session_id=cs_test_OPEN"), e);
  assert.equal(r.status, 402); assert.equal(e.LICENCES.m.size, 0);
});

test("unknown, malformed and revoked licences are refused", async () => {
  const e = env();
  for (const l of ["HX-AAAA-BBBB-CCCC", "nonsense", ""]) {
    const r = await W.default.fetch(req("/unlock", { method: "POST", body: JSON.stringify({ licence: l }) }), e);
    assert.equal(r.status, 403);
  }
  const lic = await W.licenceFor("s3cret", "cs_test_REV");
  await e.LICENCES.put(lic, JSON.stringify({ session: "cs_test_REV", revoked: true }));
  assert.equal((await W.default.fetch(req("/unlock", { method: "POST", body: JSON.stringify({ licence: lic }) }), e)).status, 403);
});

test("webhook: valid signature issues the licence; bad or stale signature is rejected", async () => {
  mockStripe(paid); const e = env();
  const body = JSON.stringify({ type: "checkout.session.completed", data: { object: paid } });
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_test"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`))).toString("hex");
  const ok = await W.default.fetch(req("/stripe-webhook", { method: "POST", body, headers: { "stripe-signature": `t=${t},v1=${sig}` } }), e);
  assert.equal(ok.status, 200); assert.equal(e.LICENCES.m.size, 1);
  const bad = await W.default.fetch(req("/stripe-webhook", { method: "POST", body, headers: { "stripe-signature": `t=${t},v1=deadbeef` } }), e);
  assert.equal(bad.status, 400);
  assert.equal(await W.verifyStripeSignature(body, `t=${t - 900},v1=${sig}`, "whsec_test"), false);
});

test("CORS: unknown origins get no allow header; bad session ids rejected", async () => {
  const e = env();
  const r = await W.default.fetch(new Request("https://api.x/claim?session_id=nope", { headers: { origin: "https://evil.example" } }), e);
  assert.equal(r.status, 400); assert.equal(r.headers.get("access-control-allow-origin"), null);
});

test("without PRICE_ID the product's default price is used", async () => {
  mockStripe(paid); const e = { ...env(), PRICE_ID: "", PRODUCT_ID: "prod_X" };
  const r = await W.default.fetch(req("/create-checkout-session", { method: "POST" }), e);
  assert.equal(r.status, 200);
  const create = stripeCalls.find((c) => c.url.endsWith("/checkout/sessions"));
  assert.equal(new URLSearchParams(create.body).get("line_items[0][price]"), "price_default");
});

test("payment-link sessions earn a key; other DiSH sales do not", async () => {
  const e = { ...env(), PAYMENT_LINK_ID: "plink_HX" };
  mockStripe({ id: "cs_live_LINK1", status: "complete", payment_status: "paid", payment_intent: "pi_2", payment_link: "plink_HX", metadata: {} });
  const ok = await W.default.fetch(req("/claim?session_id=cs_live_LINK1"), e);
  assert.equal(ok.status, 200); assert.match((await ok.json()).licence, W.LICENCE_RX);
  mockStripe({ id: "cs_live_OTHER", status: "complete", payment_status: "paid", payment_intent: "pi_3", payment_link: "plink_SOMETHING_ELSE", metadata: {} });
  const no = await W.default.fetch(req("/claim?session_id=cs_live_OTHER"), e);
  assert.equal(no.status, 402); assert.equal(e.LICENCES.m.size, 1);
});

test("promotion codes are allowed and a 100%-off order still earns a key", async () => {
  mockStripe(paid); const e = env();
  await W.default.fetch(req("/create-checkout-session", { method: "POST" }), e);
  assert.equal(new URLSearchParams(stripeCalls[0].body).get("allow_promotion_codes"), "true");
  mockStripe({ ...paid, id: "cs_live_FREE1", payment_status: "no_payment_required", amount_total: 0 });
  const r = await W.default.fetch(req("/claim?session_id=cs_live_FREE1"), e);
  assert.equal(r.status, 200);
  mockStripe({ ...paid, id: "cs_live_OPEN2", status: "open", payment_status: "no_payment_required" });
  assert.equal((await W.default.fetch(req("/claim?session_id=cs_live_OPEN2"), e)).status, 402);
});

test("REQUIRE_TERMS adds the consent tick box and the cancellation waiver text", async () => {
  assert.match(W.TERMS_CONSENT, /14-day right to cancel/);
  assert.ok(W.TERMS_CONSENT.length < 1200);
  mockStripe({});
  const off = await W.default.fetch(new Request("https://api/create-checkout-session", { method: "POST", headers: { origin: ORIGIN } }), env());
  assert.equal(off.status, 200);
  assert.equal(new URLSearchParams(stripeCalls.at(-1).body).get("consent_collection[terms_of_service]"), null);
  mockStripe({});
  const r = await W.default.fetch(new Request("https://api/create-checkout-session", { method: "POST", headers: { origin: ORIGIN } }), { ...env(), REQUIRE_TERMS: "true" });
  assert.equal(r.status, 200);
  const body = new URLSearchParams(stripeCalls.at(-1).body);
  assert.equal(body.get("consent_collection[terms_of_service]"), "required");
  assert.equal(body.get("custom_text[terms_of_service_acceptance][message]"), W.TERMS_CONSENT);
});
