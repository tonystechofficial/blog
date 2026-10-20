---
title: "What the AGPL does not tell you about forking a SaaS into a product"
description: "Régie is my commercial fork of Postiz: the AGPL allowed it, but the billing switch, shared OAuth credentials and a webhook path decided if it could be sold."
pubDate: 2026-08-14
track: "infrastructure"
tags: ["agpl", "stripe", "postiz", "saas"]
sources: ["dokploy/regie-fork-postiz-en-prod.md", "business/ce-qu-il-faut-verifier-avant-de-revendre-un-logiciel-libre.md", "../02-projects/produits/postiz-saas.md"]
---

On 13 August 2026 I had a Postiz instance running on one of my servers. Postiz is an open-source social media scheduler, licensed AGPL-3.0. The instance held 1 user, 1 organisation, 0 connected social accounts, registration disabled, and the four `STRIPE_*` variables empty. It looked like I was two variables away from a paid service. Half a day reading the code of v1.47.0 and the license said otherwise: legally yes, "in two variables" no. The next day, 14 August, my fork, Régie, replaced the official image in production, and the same day I found the reason no plan would ever have been activated.

## What the license says, and what it does not

The license is pure AGPL-3.0. No Commons Clause, no non-compete, no separate commercial license. Reselling as a hosted service is allowed. Two obligations come with it. Section 13: offering the service over a network obliges me to offer every user the complete source of my modified version. Prices were hard-coded in the source, so modifying was inevitable and the fork had to be published. I settled it with a `/source.tar.gz` generated at build time, `.git` excluded, embedded in the image. And no trademark: the AGPL gives neither the name nor the logo. Reselling means rebranding.

Rebranding is where the license stops helping. The name shows through in places a license file does not list: the payment page, transactional e-mails, the audience-measurement domain, a menu entry. The most unpleasant was an Affiliate link that appears only when billing is active, which would send my paying customers to the upstream affiliate programme. In the fork: 77 visible strings renamed, a monogram logo and favicon, testimonials and affiliate tracking removed, French terms, privacy and data-deletion pages, and the inherited "20 000+ entrepreneurs" figures deleted, verified at 0 occurrences in production on 18 August. The word "Postiz" vectorised as SVG paths escapes grep: the logo text and the preview wordmark had to be found by eye. A grep is not a rebranding.

Some strings must never be renamed, because they are functional. `metadata.service === 'gitroom'` filters the Stripe webhook events, and the subscription object must carry `{billing, period, uniqueId}`. `agent="postiz"` identifies the CopilotKit agent, and `postiz://` is the deep-link scheme. The `[Postiz]` subject of the digest e-mail lives in a deployed Temporal workflow, and the project rule forbids modifying a deployed workflow; it waits for a versioned one. The package is still named `gitroom` in `package.json`.

## The real billing switch

The documentation and the search results point at `IS_GENERAL`. The code points elsewhere. The permissions service contains a short-circuit: no billing key, grant every permission, return. The switch is `STRIPE_PUBLISHABLE_KEY`. Setting it does not add billing, it removes an exemption. The moment the key exists, every existing organisation falls to the FREE tier, 0 channels, 0 publications, publishing is refused without an active subscription, and there is no grandfathering, only a super-admin route to apply organisation by organisation. The rule I drew from it: billing is activated on a new instance, never on a live one. `IS_GENERAL` stays, because without it the frontend paywall disappears. And `!!process.env.X` is true for the string `"false"`: a flag is disabled by deleting the variable, not by setting it to `false`.

Two side effects ride on the same key. Upstream sends visit statistics to the publisher's Plausible domain as soon as the publishable key exists, now opt-in through `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`. A "new agency" notification was hard-wired to the upstream team's e-mail, now opt-in through `AGENCY_NOTIFICATION_EMAIL`.

Prices were five tiers in dollars, in the source. Régie sells at 19, 29, 39 and 89 euros a month, with yearly prices of 182, 278, 374 and 854 from the upstream formula `floor(monthly × 12 × 0.8)`. Stripe creates the products and prices itself at the first purchase, so there is nothing to prepare in the dashboard.

## Shared credentials decide before price

The developer credentials for the social networks (X, LinkedIn, Meta and the rest) are unique for the whole deployment. Every customer would publish through my registration: their quotas consume mine, their terms of use bind me, and one abusive customer gets the application suspended for everyone. That is the model of the official hosted Postiz; upstream knows the limit and has not resolved it (issue #975). It is acceptable for the publisher on its own service. For a reseller it is the question to settle before any billing work: can I carry third-party customers under my developer registration, and do I want to? If not, the product is a per-customer deployment, another trade and another price.

At the start every provider key was empty (`client_id=undefined`). Keys go in the compose `environment` block, then `compose.update` and deploy, and I verify by effect: the OAuth URL must carry a real id. Configured so far: Mastodon, which registers an app with `POST /api/v1/apps` without a developer account, and Facebook and Instagram through one Meta app of type Business. X, LinkedIn, YouTube and TikTok remain.

## The webhook that never arrived

Next 16 renamed the middleware: it is `proxy.ts`, not `middleware.ts`. It redirects any path outside its whitelist to `/auth` when there is no cookie, so every new public page must be added to it.

That middleware is why no plan was ever activated. The Stripe controller is `@Controller('/stripe')`, but nginx only routes `/api/` to the backend. A webhook pointed at `/stripe` reached the frontend, where `proxy.ts` answered a 307 to `/auth`. Stripe does not follow it: `pending_webhooks` stayed at 1 and the subscription never landed in the database. The right path is `/api/stripe`. An empty POST there returns 500, which is the proof the route exists: the controller was reached and rejected the signature. Updating the endpoint's URL kept the same endpoint, so the signing key stayed valid.

Then an end-to-end test on 14 August with an isolated test account in its own FREE organisation. `/billing/subscribe` created a checkout session of EUR 1900, 19 euros, checked on the Stripe object. A hosted checkout cannot be completed without a browser, so I created the subscription by API with a test card and `metadata[service]=gitroom`, which fires the same webhook and tests the whole chain except the card entry. Result: a `Subscription` row at STANDARD with 5 channels for the test organisation, the STANDARD tier visible in the app, and the admin's lifetime ULTIMATE subscription intact. The link between subscription and organisation is the customer (`organization.paymentId`), not the `uniqueId`.

## Six checks before promising

The half-day of reading became a list I run before announcing anything.

1. Does the license allow resale? Grep the whole repository for `commons clause`, `non-compete`, `may not sell`, `resell`, `commercial license`. A contributor agreement constrains the publisher, not the user. Network reciprocity means publishing your modified source.
2. Is the trademark granted? Never. Find where it shows through anyway.
3. What is the real billing switch? Read the permissions service and find the short-circuit, not the variable name.
4. What happens to existing accounts when it flips? Usually the default tier, with no grandfathering. New instance.
5. Are third-party credentials per customer or per instance? This decides whether it is a SaaS at all.
6. What is hard-coded? Prices, currency, tier names, quotas. Hard-coded means fork, and fork means section 13.

Two prerequisites sit outside the list. The webhook is declared and verified before the first sale, because the subscription is written to the database only by it; without it the customer pays and never gets access. And an e-mail provider is mandatory, otherwise no address verification and no password reset; Resend was already running on the server. And read the code, not the search results: the line that holds the condition is the only source that settles it.

## What I keep

- The AGPL allows resale and demands a source offer; it gives no trademark, and a grep does not find a name drawn as SVG paths.
- The billing switch is the publishable key, and it removes an exemption; activate on a new instance, never on a live one.
- Shared OAuth credentials decide whether the product is a SaaS or a per-customer deployment, before any price.
- A webhook that gets a 307 activates nothing; prove the route with a request that reaches the controller.
- Functional identifiers inherited from upstream are not branding; renaming them breaks billing, the agent and the deep links.
