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

## One way to buy: /checkout/ (decided 10 Nov 2026)
- Every sale goes through `https://handover.dianasimpsonhernandez.com/checkout/`: terms + 14-day waiver tick box, then Stripe's hosted page with Managed Payments (Stripe/Onelink is merchant of record and handles VAT/sales tax).
- QR code for print, slides and social: `brand/handover_checkout_qr.png` (and `.svg`), pointing at `/checkout/`.
- The old Payment Link `plink_1UaBo4Fm0kSIOXJpiq6m6Z7R` (`buy.stripe.com/4gM4gz…`) predates Managed Payments and can't be converted. Keep it **deactivated**; `brand/handover_payment_qr.png` points at it and is retired. `PAYMENT_LINK_ID` stays in `wrangler.toml` only so any sale already made through it still earns a key.
- Stripe settings in place: price includes tax (account default "Include tax in prices: Yes"), product category SaaS – business use, statement descriptor `DISH HANDOVER` (card statements show `LINK.COM* DISH HANDOVER`), support email set, refund requests "Email me for approval" (48 h to decide).

## Discount codes
- Create them in Stripe: **Product catalogue → Coupons → New**. A coupon can be a percentage or a fixed amount, and can be limited to the HANDOVER product. Then add a **promotion code**, the word customers type (for example `LAUNCH30`), with optional expiry, redemption limit, and first-time-customers-only.
- On HANDOVER's own checkout, the "Add promotion code" field is already on (`ALLOW_PROMOTION_CODES = "true"`).
- 100%-off codes (gifts, workshop places) still issue a licence key.

## Terms of sale and the 14-day waiver (UK)
HANDOVER delivers the key straight away, so UK law needs the buyer's express consent and acknowledgement that the 14-day cancellation right ends on delivery.
- **HANDOVER checkout (`/checkout/`)**: a required tick box above the payment form; the Stripe form only loads once it is ticked. The Worker stamps `consent = accepted <time> terms <version>` on the session and the payment (visible in Stripe → the payment → Metadata).
- `REQUIRE_TERMS = "true"` in `wrangler.toml` makes the Worker refuse any checkout without the tick (then `npx wrangler@4 deploy`).
- **Payment Link / QR (Stripe-hosted page)**: Stripe shows its own terms tick box once a Terms of service URL is saved on the account (dashboard.stripe.com/settings/public). Then: Payment Links → the link → Edit → Options → Require customers to accept your terms of service.
- When the Terms change, update the date on `/terms/` and `TERMS_VERSION` in `js/checkout.js` together.

## Gift licences (free keys: family, friends, workshop places)
100%-off promotion codes can't be used: Stripe Managed Payments won't complete a $0 order. Give a key directly instead:
- `bash gift.sh "Maria Lopez, Houston workshop"` creates a valid key in the live licence store and prints it with what to send.
- `bash gift.sh --list` shows every gift key; `bash gift.sh --revoke HX-…` switches one off.
- Records are kept in `private/gifts.csv` (git-ignored, never published). Gift keys don't appear in Stripe.
- If it says the Cloudflare login has expired: `npx wrangler@4 logout && npx wrangler@4 login`.

## Tax
Keep `AUTOMATIC_TAX = "false"` until Andy confirms the VAT position. Once Stripe Tax is set up, change it to `"true"`.

## Support
- **Lost key:** in Stripe, open the customer's payment. The key is in its metadata as `handover_licence`.
- **Refund or revoke:** run `wrangler kv key put --binding LICENCES "<key>" '{"revoked":true}'`.

## Tests
`node --test test/worker.test.mjs` runs 11 tests: licence derivation, session parameters, idempotent claim, unpaid refused, forged or revoked keys refused, webhook signature, CORS, and the terms tick box.
`../tests/e2e_purchase.cjs` runs the real Worker code behind a browser: claim → saved key → unlocked pack, and checks that a forged key is refused.
