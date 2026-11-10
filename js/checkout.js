/* HANDOVER — embedded Stripe checkout (ui_mode=form). Creates the session through the HANDOVER API worker. */
"use strict";
(async () => {
  const C = window.HANDOVER_CONFIG || {};
  const status = (t) => { const el = document.getElementById("coStatus"); if (el) el.textContent = t; };
  if (C.PRICE_LABEL) document.getElementById("price").textContent = C.PRICE_LABEL.replace(/ one-time$/, "");
  if (!C.API_BASE || !C.STRIPE_PUBLISHABLE_KEY || typeof Stripe === "undefined") {
    status("Checkout is not open yet. Please try again soon.");
    return;
  }
  const stripe = Stripe(C.STRIPE_PUBLISHABLE_KEY);
  const clientSecret = fetch(C.API_BASE.replace(/\/$/, "") + "/create-checkout-session", { method: "POST" })
    .then((r) => { if (!r.ok) throw new Error("session " + r.status); return r.json(); })
    .then((j) => j.client_secret);
  clientSecret.catch(() => status("Checkout could not start. Please refresh the page."));

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
