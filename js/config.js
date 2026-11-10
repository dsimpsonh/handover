/* HANDOVER — deployment settings. Public file: never put secrets here (the publishable key is designed to be public). */
window.HANDOVER_CONFIG = {
  // Base URL of the HANDOVER API worker (worker/), e.g. "https://handover-api.<account>.workers.dev". null = not live yet.
  API_BASE: "https://handover-api.dish-creative.workers.dev",
  // Stripe publishable key, Dish Creative Ltd account: pk_test_... while testing, pk_live_... at launch.
  STRIPE_PUBLISHABLE_KEY: "pk_live_51TGfhgFm0kSIOXJp17SYEVhtVcvPc6C7pylAe3vMrDGkeoVIgNdOaCtnvKKa8kN4vveRTexyVgTeRMnxVHHMwSb900QdyDeZuR",
  CHECKOUT_PATH: "/checkout/",
  // No Stripe Payment Link: every sale goes through /checkout/ (Managed Payments, terms tick box). QR codes point there.
  PAYMENT_LINK: null,
  PRICE_LABEL: "$99 one-time",
  SUPPORT_EMAIL: "dianasimpsonhernandez@gmail.com",
};
