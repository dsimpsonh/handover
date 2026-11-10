/* HANDOVER — embedded Stripe checkout (ui_mode=form). Creates the session through the HANDOVER API worker. */
"use strict";
const TERMS_VERSION = "2026-11-10";  // must match the "Last updated" date on /terms/
(async () => {
  const C = window.HANDOVER_CONFIG || {};
  const status = (t) => { const el = document.getElementById("coStatus"); if (el) el.textContent = t; };
  if (C.PRICE_LABEL) document.getElementById("price").textContent = C.PRICE_LABEL.replace(/ one-time$/, "");
  if (!C.API_BASE || !C.STRIPE_PUBLISHABLE_KEY || typeof Stripe === "undefined") {
    status("Checkout is not open yet. Please try again soon.");
    return;
  }
  // UK Consumer Contracts Regs 2013: express consent + acknowledgement of losing the 14-day right, BEFORE the key is supplied.
  // The Stripe form only loads once the box is ticked; the Worker records the consent on the payment (metadata).
  const agree = document.getElementById("agree");
  const box = document.getElementById("checkout-form");
  if (agree && !agree.checked) {
    status("Tick the box above to continue to payment.");
    await new Promise((ok) => agree.addEventListener("change", () => agree.checked && ok(), { once: false }));
  }
  if (agree) agree.disabled = true;  // consent is now part of this checkout session
  box.removeAttribute("aria-disabled");
  status("Loading secure checkout…");
  const session = fetch(C.API_BASE.replace(/\/$/, "") + "/create-checkout-session", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ terms: TERMS_VERSION, waiver: !!(agree && agree.checked) }) })
    .then((r) => { if (!r.ok) throw new Error("session " + r.status); return r.json(); });
  // Managed Payments (Stripe as merchant of record): the service returns Stripe's hosted page; go there.
  try {
    const first = await session;
    if (first.url) { status("Taking you to Stripe's secure checkout…"); location.assign(first.url); return; }
  } catch (e) { status("Checkout could not start. Please refresh the page."); return; }
  const stripe = Stripe(C.STRIPE_PUBLISHABLE_KEY);
  const clientSecret = session.then((j) => j.client_secret);

  // Diana's appearance settings from the Stripe dashboard (10 Nov 2026), font switched to the site's own (Schibsted Grotesk).
  // The font file is served from this site; Stripe's iframe loads it by absolute URL.
  const fonts = [{ family: "Schibsted Grotesk", src: `url(${location.origin}/assets/fonts/SchibstedGrotesk-var.woff2)`,
                   weight: "400 900", style: "normal", display: "swap" }];
  const appearance = {
    theme: "stripe", inputs: "spaced", labels: "auto",
    variables: { borderRadius: "4px", colorBackground: "#ffffff", colorDanger: "#e44e53", colorPrimary: "#8a7be8",
                 colorSuccess: "#40c48b", colorText: "#2a1b5e", fontSizeBase: "16px", spacingUnit: "4px",
                 fontFamily: '"Schibsted Grotesk", -apple-system, "Segoe UI", sans-serif' },
  };
  try {
    const checkout = stripe.initCheckoutFormSdk({ clientSecret, appearance, fonts });
    const form = checkout.createForm({ layout: "expanded" });
    document.getElementById("checkout-form").innerHTML = "";
    form.mount("#checkout-form");
    const res = await checkout.loadActions();
    if (res.type === "success") {
      form.on("confirm", async (event) => {
        try { await res.actions.confirm({ formConfirmEvent: event }); }
        catch (e) { console.error("Payment confirmation error:", e); }
      });
    }
  } catch (e) {
    status("Checkout could not start. Please refresh the page.");
    console.error(e);
  }
})();
