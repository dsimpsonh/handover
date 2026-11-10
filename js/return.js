/* HANDOVER — post-payment: claim the licence for this Checkout Session and save it in this browser. */
"use strict";
(async () => {
  const C = window.HANDOVER_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  let sid = new URLSearchParams(location.search).get("session_id") || "";
  try { if (sid) sessionStorage.setItem("hx_sid", sid); else sid = sessionStorage.getItem("hx_sid") || ""; } catch (e) { /* ignore */ }
  const fail = (t) => { $("#title").textContent = "Something needs attention"; $("#wait").hidden = false; $("#waitMsg").textContent = t; };
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid) || !C.API_BASE) return fail("This link is missing its payment reference. If you paid, contact support with your Stripe receipt.");
  history.replaceState(null, "", location.pathname);  // keep the session id out of history and screenshots
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const r = await fetch(C.API_BASE.replace(/\/$/, "") + "/claim?session_id=" + encodeURIComponent(sid), { cache: "no-store" });
      if (r.ok) {
        const { licence } = await r.json();
        try { localStorage.setItem("hx_licence", licence); } catch (e) { /* private mode: the key is still shown */ }
        $("#title").innerHTML = "Done. Your next AI is about to get <em>a very good briefing.</em>";
        $("#key").textContent = licence;
        $("#ok").hidden = false; $("#wait").hidden = true;
        $("#copy").onclick = async () => { await navigator.clipboard.writeText(licence); $("#copy").textContent = "Copied"; };
        return;
      }
      if (r.status !== 402) return fail("We could not confirm the payment. If you paid, contact support with your Stripe receipt.");
      $("#title").textContent = "Confirming your payment…"; $("#wait").hidden = false;
    } catch (e) { /* network blip: retry */ }
    await new Promise((res) => setTimeout(res, 3000));
  }
  fail("Your payment is still processing. Your key will be recorded when it completes; refresh this page in a few minutes.");
})();
