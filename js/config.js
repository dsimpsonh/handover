/* HANDOVER — deployment settings. Public file: never put secrets here (the publishable key is designed to be public). */
window.HANDOVER_CONFIG = {
  // Base URL of the HANDOVER API worker (worker/), e.g. "https://handover-api.<account>.workers.dev". null = not live yet.
  API_BASE: "https://handover-api.dish-creative.workers.dev",
  // Stripe publishable key, Dish Creative Ltd account: pk_test_... while testing, pk_live_... at launch.
  STRIPE_PUBLISHABLE_KEY: "pk_live_51TGfhgFm0kSIOXJp17SYEVhtVcvPc6C7pylAe3vMrDGkeoVIgNdOaCtnvKKa8kN4vveRTexyVgTeRMnxVHHMwSb900QdyDeZuR",
  CHECKOUT_PATH: "/checkout/",
  // Stripe Payment Link (live) for QR codes, email and social; its "after payment" redirect must point to /checkout/return/.
  PAYMENT_LINK: "https://buy.stripe.com/4gM4gz0rx4hT7Ce1H863K00",
  PRICE_LABEL: "$99 one-time",
  SUPPORT_EMAIL: "dianasimpsonhernandez@gmail.com",
};
