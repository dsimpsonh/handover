/* HANDOVER — deployment settings. Public file: never put secrets here. */
window.HANDOVER_CONFIG = {
  // Stripe Payment Link for the $99 one-time licence (Dish Creative Ltd account). null = checkout not live yet.
  STRIPE_LINK: null,
  // Unlock service: verifies a licence key and returns the prompt fragments. Sees licence + email only, never files.
  UNLOCK_URL: null,
  PRICE_LABEL: "$99 one-time",
  SUPPORT_EMAIL: null,
};
