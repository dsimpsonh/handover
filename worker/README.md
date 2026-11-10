# HANDOVER API (Cloudflare Worker)

This Worker handles payment and licensing only. It never receives documents, maps or packs.
Routes: `POST /create-checkout-session` · `GET /claim` · `POST /stripe-webhook` · `POST /unlock` · `GET /health`.

## Fastest path
1. In Stripe (live), create a **restricted key** with the permissions listed below and copy it (`rk_live_…`).
2. In Terminal, run `cd ~/Sites/handover/worker && bash deploy.sh`. It logs you in to Cloudflare, creates the licence store, deploys, and stores the secrets through hidden prompts. It also tells you the exact webhook URL to add in Stripe.
3. Send the tech thread the `https://…workers.dev` address it prints.

**Restricted key permissions:** Checkout Sessions *Write* · Products *Read* · Prices *Read* · PaymentIntents *Write*. Leave everything else as *None*. A full secret key (`sk_live_…`) also works, but a restricted key limits the damage if it ever leaks.

## One-time setup, step by step (the same as deploy.sh)

Run every command from `~/Sites/handover/worker`.

1. **Stripe (DiSH Creative Ltd account), Test mode first**
   - ✅ Done 10 Nov: product **HANDOVER** `prod_VbNvnDNZtugBgQ`, already set in `wrangler.toml`. The service uses the product's **default price** ($99), so no price ID is needed. Check in Stripe that the $99 price is marked *Default*.
   - Developers → API keys: copy the **publishable key** (`pk_test_…`) and the **secret key** (`sk_test_…`).
2. **Cloudflare**
   ```bash
   npm i -g wrangler && wrangler login
   wrangler kv namespace create LICENCES                         # paste the id into wrangler.toml
   wrangler secret put STRIPE_SECRET_KEY                         # sk_test_…
   wrangler secret put LICENCE_SECRET                            # paste: openssl rand -hex 32
   ```
   Then run `wrangler deploy`. Note the URL it prints (`https://handover-api.<you>.workers.dev`).
3. **Webhook.** In Stripe go to Developers → Webhooks → Add endpoint and enter `https://handover-api.<you>.workers.dev/stripe-webhook`. Select the events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Copy the signing secret, then run:
   ```bash
   wrangler secret put STRIPE_WEBHOOK_SECRET                     # whsec_…
   ```
4. **Site config.** Send these two values to the tech thread. It ships a new `js/config.js`:
   `API_BASE` = the Worker URL · `STRIPE_PUBLISHABLE_KEY` = `pk_test_…`
5. **Test.** Run a payment with card `4242 4242 4242 4242`. The return page should show a key, and the app should build an unlocked pack.
6. **Go live.** Switch Stripe to live mode and create the live $99 price. Then:
   - run `wrangler secret put STRIPE_SECRET_KEY` with `sk_live_…`
   - set `PRODUCT_ID` in `wrangler.toml` to the live product's ID (test and live products have different IDs), then run `wrangler deploy`
   - add a live webhook and run `wrangler secret put STRIPE_WEBHOOK_SECRET` with its signing secret
   - send the tech thread `pk_live_…` for `js/config.js`

## Payment Link and QR code (live)
- Link: `https://buy.stripe.com/4gM4gz0rx4hT7Ce1H863K00` · ID `plink_1UaBo4Fm0kSIOXJpiq6m6Z7R`, already set as `PAYMENT_LINK_ID` in `wrangler.toml`. The QR code is in `brand/handover_payment_qr.png`.
- **Required:** in Stripe, open Payment Links → this link → Edit → *After payment* → **Don't show confirmation page; redirect to your website**. Enter:
  `https://handover.dianasimpsonhernandez.com/checkout/return/?session_id={CHECKOUT_SESSION_ID}`
  Without this redirect, link buyers get Stripe's generic page and no key. The webhook still records the key on the payment, so support can find it.
- **Don't share the link or QR until the Worker and site are live.** Payments made before then won't unlock anything without manual help.

## Discount codes
- Create them in Stripe: **Product catalogue → Coupons → New**. A coupon can be a percentage or a fixed amount, and can be limited to the HANDOVER product. Then add a **promotion code**, the word customers type (for example `LAUNCH30`), with optional expiry, redemption limit, and first-time-customers-only.
- On HANDOVER's own checkout, the "Add promotion code" field is already on (`ALLOW_PROMOTION_CODES = "true"`).
- On the Payment Link: **Payment Links → the link → Edit → Options → Allow promotion codes**.
- 100%-off codes (gifts, workshop places) still issue a licence key.

## Terms of sale and the 14-day waiver (UK)
HANDOVER delivers the key straight away, so UK law needs the buyer to tick a box agreeing that their 14-day cancellation right ends on delivery.
1. In Stripe go to **Settings → Business → Public details**. Set **Terms of service** to `https://handover.dianasimpsonhernandez.com/terms/` (and Privacy policy to `/privacy/`).
2. Set `REQUIRE_TERMS = "true"` in `wrangler.toml`, then run `npx wrangler@4 deploy`. HANDOVER's checkout now shows the required tick box with the waiver wording.
3. Payment Link: **Edit → Options → Require customers to accept your terms of service**, and put the waiver sentence in the link's custom text for terms.

## Tax
Keep `AUTOMATIC_TAX = "false"` until Andy confirms the VAT position. Once Stripe Tax is set up, change it to `"true"`.

## Support
- **Lost key:** in Stripe, open the customer's payment. The key is in its metadata as `handover_licence`.
- **Refund or revoke:** run `wrangler kv key put --binding LICENCES "<key>" '{"revoked":true}'`.

## Tests
`node --test test/worker.test.mjs` runs 11 tests: licence derivation, session parameters, idempotent claim, unpaid refused, forged or revoked keys refused, webhook signature, CORS, and the terms tick box.
`../tests/e2e_purchase.cjs` runs the real Worker code behind a browser: claim → saved key → unlocked pack, and checks that a forged key is refused.
