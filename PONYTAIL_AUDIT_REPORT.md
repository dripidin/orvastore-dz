# Ponytail audit — ORVA STORE

Date: 6 November 2026. One-shot review. No code was changed.

What this repo does: ORVA STORE is a cash-on-delivery shop for Algeria. Customers order on public pages (`/pack1`, `/pack2`, `/yamaha`). Hostinger runs the PHP APIs. A small admin dashboard manages orders, delivery, and settings. Stock and idempotency live in JSON files on the server. Orders are stored in Supabase. Load assumed: one shop, ads sending visitors, tens to a few hundred orders a day, a few staff in the dashboard. Not a multi-tenant platform.

## Must fix

1. **A second checkout with the same order id puts the first unit back on the shelf** (`api/send-order.php:L271-347`)
   - **What this is:** Checkout reserves stock, then inserts the order. `order_id` is unique in the database. The browser invents the id with a 5-digit random number (`script.js:L453`, `packs-client.js:L345`).
   - **Problem:** If that id is already reserved, this request does not take another unit. The insert then fails because the id exists. The failure path still marks that reservation released and adds the quantity back to `available`. The original order stays in the database. Two customers can also roll the same `ORVA-#####` by chance. `ORVA-21215` is already reserved in `data/inventory-state.json`.
   - **Fix:** Remember whether this request created the reservation. Roll back only that one. Reject a repeated id before touching stock.
   - **If we skip it:** A retried or colliding order frees stock that is still owed to the first customer. The shop can sell the same piece twice.

2. **Reserved stock is never finished or returned** (`api/send-order.php:L277-300`, `api/delivery.php`)
   - **What this is:** A successful order moves pieces from `available` to `reserved` and leaves them there.
   - **Problem:** Cancelling, shipping, or deleting an order in `/api/delivery` never touches `data/inventory-state.json`. The only automatic release is the Node helper `reconcileStaleReservations` in `lib/inventory-manager.js`, and the PHP checkout never calls it. Pack 1 already shows 49 reserved and 51 available out of 100 (`data/inventory-state.json`, `ORVA-P1-PRO`). Those 49 rows are still `RESERVED` from 4 November 2026.
   - **Fix:** When an order is cancelled, add the quantity back to `available`. When it is handed to the courier, subtract it from `reserved` and from `totalPhysical`. Run one cleanup for reservations whose order is gone.
   - **If we skip it:** After enough orders the product shows out of stock while the warehouse still has the goods, or the reverse if finding 1 fires.

3. **Anyone with the public Supabase key can read every order** (`supabase/schema.sql:L158-163`, `api/config.php:L19-22`)
   - **What this is:** Row Level Security is on, but `anon` may `SELECT` all rows in `public.orders` and `public.rate_limits`, and may `INSERT` an order with no price check. The publishable key is written in `api/config.php`. Checkout uses that same key.
   - **Problem:** The key is meant to be public. With these policies, a `GET` to the Supabase REST URL returns names, phones, wilayas, and totals. A direct `INSERT` writes an order that never passed the shop's price or stock checks. This was not run against the live database. The schema file is what this repo would apply.
   - **Fix:** Remove the anon read and insert policies. Insert and read orders from PHP with the server secret key only. Do not put that secret in the page or in `config.php` defaults.
   - **If we skip it:** Customer phones and addresses are readable by anyone who has the publishable key. Fake orders can be written beside the real ones.

4. **The Yamaha page cannot place an order** (`script.js:L475-490`, `yamaha-archive.html`)
   - **What this is:** `/yamaha` posts to `/api/send-order` with name, phone, and wilaya. It does not send `sku`, `packId`, or `productName`. The page price is 4,200 DZD (`script.js:L72`).
   - **Problem:** PHP rejects the request as `PRODUCT_UNAVAILABLE` because the product id is empty. The catalog also has no 4,200 DZD row. The single bag `ORVA-SAC-YAM` is archived and `allowOrders` is false. The live bundle is 4,900 DZD.
   - **Fix:** Send a real sku that is active in `data/products-catalog.json`, and set that row's `sellingPrice` to the price on the page. Keep the receipt total on the server's number.
   - **If we skip it:** Every Yamaha buyer gets an error after filling the form. Pack 1 and Pack 2 are not affected. They send `packId`.

5. **The wilaya is chosen by a text search, and the commune is not checked** (`api/send-order.php:L191-245`)
   - **What this is:** The browser sends `wilaya` as `"name — commune"`. PHP walks the tariff list and takes the first wilaya whose name appears anywhere in that string. It does not check that the commune belongs to that wilaya. The Node checker does (`lib/order-validator.js`, `validateCommune`). Hostinger does not run that file.
   - **Problem:** Béchar's commune list includes أدرار (`algeria-communes.js`, wilaya `"8"`). أدرار is wilaya 1, earlier in `data/wilayas-tariffs.json`. A Béchar customer who picks commune أدرار is saved as wilaya 01 أدرار. A direct call can send wilaya text `بسكرة` and commune `جانت` and pay Biskra's 550 DZD instead of Djanet's 1,600 DZD. The form does not offer that pair. The public API does.
   - **Fix:** Accept the wilaya id. Compare the commune to that wilaya's list with an exact match. Reject the order if it does not match.
   - **If we skip it:** Parcels are addressed to the wrong wilaya, and a crafted request underpays shipping.

6. **The admin password is a permanent API key** (`api/admin-settings.php:L496-506`)
   - **What this is:** Settings (Telegram bot, Meta token, courier token) accept either the admin token or the raw admin password, as `Authorization: Bearer` or as the `orva_admin_session` cookie.
   - **Problem:** `api/auth.php` stores the long-lived admin token in the cookie for 8 hours and compares the password in plain text. Logout clears the cookie and does not change the password. Sending the password as a bearer token still opens settings. There is no attempt limit on `POST /api/auth`.
   - **Fix:** Accept only the session token. Stop comparing the password to the bearer header and the cookie. Add a short lockout after repeated failed logins.
   - **If we skip it:** Anyone who learns the password can change courier and bot tokens until the password is changed. They can guess it as fast as the server answers.

7. **Test products are for sale in the live catalog** (`data/products-catalog.json:L96-133`)
   - **What this is:** `ORVA-LAST-ITEM-TEST`, `ORVA-RACE-TEST-SKU`, and `ORVA-DRILL-DYNAMO` are `active` with `allowOrders: true`.
   - **Problem:** PHP sells whatever is active in that file. A checkout with `packId` `orva-last-item-test` reserves stock and creates a real order for "Last Item Test SKU" at 5,000 DZD.
   - **Fix:** Remove those rows from the catalog the server reads, or set `allowOrders` to false and status to `archived`. Do the same for their inventory rows.
   - **If we skip it:** Customers, or a bot, can order products the shop does not sell.

## Should fix

8. **Two checkouts, and they disagree** (`api/send-order.php`, `api/send-order.js`)
   - **What this is:** Hostinger routes `/api/send-order` to the PHP file (`.htaccess`). Local `dev-server.js` runs the Node file. Node checks the commune, the risk engine, and releases stock through `releaseStock`. PHP has its own copy of the rules.
   - **Problem:** A test that passes on Node does not prove the live shop. Findings 1, 2, and 5 exist because the PHP copy drifted.
   - **Fix:** Make the PHP file call the same decisions as Node for product, commune, price, and stock release. Keep one of those three functions, not a second handwritten copy.
   - **If we skip it:** The next fix lands in the file the shop does not run.

9. **A product name that contains an earlier alias is the wrong product** (`api/send-order.php:L170-175`, `data/products-catalog.json:L168`)
   - **What this is:** After exact key and exact alias, PHP accepts the product if the request text merely contains an alias.
   - **Problem:** The alias `yamaha` points at the archived bag and is listed before the bundle. `productName` `sac yamaha bundle 4900` contains `yamaha`, so the order is rejected as inactive instead of selling `ORVA-SAC-BUNDLE`. The alias `inactive` does the same to any name that includes that word. Pack pages send `packId` first, so Pack 1 and Pack 2 still resolve.
   - **Fix:** Delete the "contains" loop. Match the sku, the id, or the whole alias only.
   - **If we skip it:** Any future page that sends the product title instead of the sku will hit the wrong row.

10. **A missing stock row becomes 20 pieces, and a missing catalog becomes baked-in prices** (`api/send-order.php:L109-119` and `L260-266`)
    - **What this is:** If the sku is not in the inventory file, PHP creates it with `available: 20` and saves that. If `data/products-catalog.json` is missing, PHP uses five prices written in the PHP file, including the Yamaha bag as orderable.
    - **Problem:** A new product with no inventory row can be sold 20 times that were never counted. A missing catalog file ignores archived flags and the real prices.
    - **Fix:** If the sku has no inventory row, return out of stock. If the catalog file is missing, return 503. Delete the fallback list.
    - **If we skip it:** A new product, or a lost file, sells stock the shop did not enter.

11. **Login can be guessed with no pause** (`api/auth.php:L132-148`)
    - **What this is:** `POST /api/auth` with `action: login` checks the password and returns.
    - **Problem:** There is no counter, delay, or lock. A script can try passwords as fast as the server answers. Settings then treat a correct password as a bearer token (finding 6).
    - **Fix:** After 5 failures from the same address, wait or refuse for 15 minutes. Do this in `api/auth.php` only.
    - **If we skip it:** The single shared password is open to guessing.

12. **Public analytics grows a session for every new id** (`api/analytics.php:L155-185`)
    - **What this is:** Anyone can `POST /api/analytics`. Each `sessionId` is stored in `sessions` on `data/private/analytics-ledger.json`. Recent events are capped at 100. Sessions are not.
    - **Problem:** A client that sends a new `sessionId` on every call makes the file larger forever. Every later page view rewrites the whole file under a lock. `event: purchase` also increments conversions with no check.
    - **Fix:** Cap `sessions` (drop entries older than a day). Ignore `purchase` on this public route. Orders already count conversions elsewhere.
    - **If we skip it:** A bot fills the disk and slows every real page view that writes the same file.

13. **The default Telegram text trusts the customer's name as HTML** (`api/send-order.php:L468-489`)
    - **What this is:** Custom templates escape values with `htmlspecialchars`. The built-in message pastes `$fullName`, `$phone`, `$commune`, and `$orderId` straight into a message sent with `parse_mode: HTML`.
    - **Problem:** A name like `<a href="https://evil.example">اضغط هنا</a>` is a clickable link in the shop's Telegram chat. The custom-template path already escapes this.
    - **Fix:** Escape those four fields the same way as the template path, before building `$tgMsg`.
    - **If we skip it:** A customer can put a fake link in the order alert the staff click.

14. **Checkout rewrites whole JSON files that only grow** (`api/send-order.php:L300`, `L507-516`, `L536-545`)
    - **What this is:** Every order rewrites the inventory file, the Telegram ledger, and the idempotency file. Old reservations and old keys stay.
    - **Problem:** `data/inventory-state.json` is already about 2,000 lines, mostly test skus (`ORVA-RACE-SKU-…`, `ORVA-ORPHAN-…`). At a few hundred orders a day the lock is held while the whole file is written. That is the same lock that guards the last unit of stock.
    - **Fix:** Delete test skus and released reservations from the inventory file. Keep idempotency keys for one day, then drop them. Do not load the test history in production.
    - **If we skip it:** Checkout gets slower, and a lock timeout starts failing real orders.

## Nice to have

15. **The Codflow limiter allows the call when it cannot count** (`api/codflow.php:L120-122`)
    - **What this is:** If the rate-limit folder cannot be created, the bridge returns allowed.
    - **Problem:** A full temp disk turns the limit off. The route still needs the admin token, so this is not public checkout.
    - **Fix:** If the counter cannot be saved, return 503 for that request.
    - **If we skip it:** A disk problem removes the only throttle on the Codflow proxy.

16. **`resend` is installed and never called** (`package.json`)
    - **What this is:** The dependency is declared. No shop script imports it. Mail is not sent through it.
    - **Problem:** It is one more package to install and patch.
    - **Fix:** Remove it from `package.json` and the lockfile.
    - **If we skip it:** Nothing user-facing breaks. Updates stay noisier than they need to be.

Verdict: Fix 1, 2, and 3 first. Stock is given back or stuck, and customer phones are readable with the public database key.

Lean: -1 dependency (`resend`), about 70 lines (the baked-in catalog in `api/send-order.php` and the test products in the live catalog).

Not checked: the live Supabase project was not queried, so the policies on the hosted database may differ from `supabase/schema.sql`. Hostinger's copy of the PHP files was not compared to this tree. `codflow-main` was not read line by line. The Next.js dashboard source was not clicked through. Card payment does not exist here. Courier create-shipment inside `api/delivery.php` was only checked for stock updates, which are absent.
