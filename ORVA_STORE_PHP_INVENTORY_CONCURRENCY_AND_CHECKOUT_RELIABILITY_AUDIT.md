# ORVA STORE — Independent PHP Inventory Concurrency & Checkout Reliability Audit

**التاريخ:** 2026-11-07
**النطاق:** تدقيق مستقل لمسار المخزون والمزامنة في PHP ومسار الدفع (Checkout) عبر `api/send-order.php`.
**المنهجية:** قراءة مباشرة للكود؛ ملاحظة الاختلافات بين مسار JS وPHP؛ اختبارات تفرّد محلية على قاعدة معزولة `orva_local` (PostgreSQL 18.6) ببيانات اصطناعية بالكامل؛ بدون لمس Production؛ بدون قراءة صفوف العملاء؛ بدون طباعة أي أسرار.

**أدلة مُتحققة شخصياً في هذه الجولة (local – synthetic – disposable):**

- سباق 25 عملية حجز متوازية على آخر وحدة من SKU واحد: الفائز **1 فقط** — في مسار PostgreSQL **و** في مسار JSON. الأداة: `scripts/audit-inventory-concurrency.php` و`scripts/audit-inventory-json.php`.
- `reserve` مكرر لنفس `orderId` → `alreadyReserved` (Idempotency مؤكدة).
- `release` مرتين → الثانية تعيد `alreadyReleased` (Idempotency مؤكدة).
- أُعيدت `orva_local` إلى حالتها الأساسية بعد التجارب (لا صفوف `AUDIT-CONCUR-1`)، وملفات JSON الموقتة أُسقطت.
- ملف `data/inventory-state.json` **لم يُقرأ ولم يُعدّل** في هذه المهمة (فحص `git diff` = 0).
- لم يُنفذ أي SQL مستضاف؛ لم تُقرأ صفوف `public.orders`/`customers` المستضافة.

---

## A. وضع الإنتاج — توصيف دقيق للأدلة

| المصدر (مرتب من القوة إلى الضعيف) | الحكم |
|---|---|
| `docs/HOSTINGER_INVENTORY_RECOVERY_CRON_PROPOSAL.md` (read-only على Staging): «Extension pdo_pgsql is currently disabled on Staging» | مؤكد **لـ Staging فقط**. Production غير موثق ولم يُفحص (هذا يحكمه قيد المهمة) |
| `lib/rate-limit-pg.php` → `orva_rate_limit_check_and_record()` تنادي `orva_pg_pdo()`؛ أي استثناء → `RATE_LIMIT_STORAGE_UNAVAILABLE` → HTTP 503 | مؤكد من الكود (مسار الإنتاج Hostinger: `api/send-order.php`) |
| `lib/orva-pg.php` — `orva_pg_pdo()` يرفض أي DSN غير loopback إلا `ORVA_PG_ALLOW_HOSTED=true` | مؤكد من الكود |
| `api/send-order.php` لا يملك أي مسار احتياطي (REST fallback) للحد من التكرار — بدون PDO فالتعليق نهائي | مؤكد من الكود |
| غياب `ORVA_PG_ALLOW_HOSTED` من `.env.example` | مؤكد بفحص الملف |

**الأثر الفعلي:** على Staging، الدفع **معطل** لكل طلب. على Production: **غير مُختبر ولا يمكن التأكيد**؛ كل السيناريوهات المذكورة (لا `pdo_pgsql`، أو `pdo_pgsql` بدون `ORVA_PG_ALLOW_HOSTED=true`، أو لا `DATABASE_URL`) تؤدي إلى نفس الرسالة 503 — وهي نفس الرسالة التي وصلت إلينا. **لا يمكن إدارة هذه المشكلة من الكود وحده — تتطلب تدخلاً من مالك الاستضافة.**

```
فحص سريع على خادم Hostinger (المشغّل يقوم به بنفسه؛ ممنوع على أي أداة خارجية):
  php -m | grep -i pgsql
  grep ORVA_PG_ALLOW_HOSTED  /path/to/secure-config.php   (أو المتغيرات البيئية)
  grep DATABASE_URL          /path/to/secure-config.php
```

---

## B. تصنيف المخاطر

| # | العنصر | الفئة | الأثر |
|---|---|---|---|
| B-1 | `pdo_pgsql` معطل على Staging (موثق)؛ Production غير معروف؛ `ORVA_PG_ALLOW_HOSTED` غير موثّقة في `.env.example` | **CRITICAL** | تعليق كامل للدفع على أي خادم لا يستوفي الشروط |
| B-2 | لا يوجد مسار احتياطي (REST) للحد من التكرار في PHP | **HIGH (نفس السبب الجذري)** | نفس الانهيار على Staging وProduction |
| B-3 | `reserve → save → bind` غير ذرّي؛ فشل `bind_order()` يُبتلع بصمت (`error_log` فقط في `send-order.php`) | **HIGH** | حجوزات عالقة `CHECKOUT_PENDING` ضد أوامر حقيقية موجودة → حجب مخزون لا يُكتشف |
| B-4 | لا يوجد تنبيه (Telegram/Email) على فشل مسار الحجز أو التخزين — فقط تطبيع 503 واحدة | **MEDIUM** | الانهيار غير مرئي — حتى يلاحظه العميل |
| B-5 | Risk Engine (Node/JS) بدون `SUPABASE_SERVICE_ROLE_KEY`: لا يُقيّم أي شيء — score دائم ≈ 35 LOW/ALLOW | **HIGH (مسار Vercel)** | لا توجد حماية احتيال أصلاً إن غاب المفتاح |
| B-6 | Risk Engine (PHP/Hostinger) — file-based (`risk-events.json`)، يعمل بدون DB | **LOW-MEDIUM** | حماية ضعيفة لكن موجودة؛ لا تُكسر بسبب غياب مفتاح |
| B-7 | `ruleRateLimit`/`ruleRepeatedPhone` (Node) تقرأ **كل جدول الطلبات** لكل checkout | **MEDIUM** | O(n) على كل طلب؛ ينمو خطياً مع حجم الجدول |
| B-8 | `pg_advisory_xact_lock(hashtext('orva-inv:'.$orderId))` — hashtext ترجع 32-بت | **MEDIUM** | تصادم locks — throughput على أعداد كبيرة؛ غير ضارة وظيفياً |
| B-9 | JSON backend على Hostinger (افتراضي): الملف كاملًا يُعاد كتابته لكل عملية | **LOW-MEDIUM** | آمن عبر `flock` على خادم واحد فقط؛ Vercel لا يصلح لهذا |
| B-10 | `orva_inventory_append_audit`: قراءة-تعديل-كتابة بلا قفل على القراءة؛ عند 5000 entries → حذف صامت للأقدم 1000 | **LOW** | فقد إدخالات audit بين العمليات المتزامنة |
| B-11 | `recover-abandoned-reservations.php` يعتمد على `$config['supabase']['service_role_key']` غير الفارغ للـ reconcile؛ غيابه ⇒ لا يُطلق أي حجز أبداً | **HIGH** | الـ cron يبدو أخضرًا بينما صفر عملية حقيقية؛ لا يمكن الاعتماد عليه كما هو |
| B-12 | لا توجد إشارة إلى الفرق بين «عطل دائم» و«عطل عابر» — لا كود خطأ مخصص | **MEDIUM** | تشخيص مضلل للمالك وللعميل |

---

## C. الحالات الحدية التحليل

### C-1. ترتيب الخطوات في `api/send-order.php`

```
validation (catalog + wilaya + commune) → risk evaluate (PHP) → rate limit (PDO)
→ reserve (backend) → persist Supabase REST → bind_order → respond
```

| المرحلة | الوضع | ملاحظات |
|---|---|---|
| التحقق من SKU / wilaya / commune | سليم | تحقق خادمي صارم (أرقام، قائمة 58 ولاية، communes by id) |
| Risk evaluate (PHP) | **file-based ويعمل** | honeypot + `MIN_FORM_SECONDS=8` + phone regex — بسيط لكن يعمل دون مفاتيح |
| Rate limit (`orva_rate_limit_check_and_record`) | **معطّل على Staging (موثق)** | انظر B-1/B-2 |
| Reserve (JSON الافتراضي على Hostinger) | **سليم محلياً** | `flock` على `inventory.lock` — اختبار 25 سباقاً نجح |
| Reserve (PG opt-in) | **سليم** | predicate `available >= :q` + `CHECK (total_physical = available + reserved)` |
| Persist Supabase REST | يعتمد على مفتاح | الفشل بعد الحجز ⇒ B-3 |
| Bind (`orva_inventory_bind_order`) | **`error_log` فقط** | recovery هو الشبكة الوحيدة |
| Telegram dispatch | Decoupled — فشل صامت | لا يفسد checkout |
| `data/locks/idemp_*.lock` | لا تنظيف | تراكم غير محدود (52 ملفًا في يوم واحد)؛ لا أثر وظيفي حالي |

### C-2. Crash recovery — لم تصل بعد إلى قابلية تشغيل واقعية

بناء `lifecycle` (`CHECKOUT_PENDING` / `ORDER_BOUND`) نفسه صحيح ولا يسمح بمسح الصفوف التاريخية (الـ 51 RESERVED القديمة بلا `lifecycle` → `skippedHistorical` — محررة لا تُمس):

- `recover-abandoned-reservations.php` على Hostinger يحتاج `SUPABASE_SERVICE_ROLE_KEY` للـ reconcile؛ غيابه ⇒ يعيد `[exists=true]` دائماً ⇒ **صفر إطلاق ومسار مظلم صامت**.
- حتى لو توفر المفتاح: يفتح معاملة واحدة كاملة لكل الصفوف — مرور بأعداد كبيرة قد يطيل كل معاملة التوجيه.
- أي خطأ curl (شبكة/timeout) ⇒ يُلتقط كـ `Throwable` ⇒ `[exists=true, processing=true]` — **آمن** (لا يُطلق أصلاً عند الشك).

### C-3. مسار Node على Vercel — مرجع محلي

- `lib/db.js → checkAndRecordRateLimit`: PG pool؛ failClosed عند أي خطأ؛ نفس النتيجة 503.
- `getPgPool()` يسمح لـ loopback فقط في local/dev؛ في `production` يسمح للـ pooler — لكن `"self signed certificate in certificate chain"` (مرصودة عند الاتصال بـ aws-0-eu-west-1.pooler.supabase.com مع الإعداد الافتراضي) لم تُختبر على Vercel بعد.
- إصلاح محلي طبقناه اليوم (خارج هذا المسح): `lib/db.js` — في local/dev/test مع فشل `getSupabase()` ⇒ `tryGetSupabase()` يُرجع `null` بدل رمي الاستثناء — يفتح مسار failover PG.

### C-4. الفرق البنيوي PHP ↔ JS

| الميزة | PHP (Hostinger) | JS (Vercel) | التفاوت |
|---|---|---|---|
| backend الافتراضي | JSON (`inventory-state.json`) | PG (pool) | مختلف — لا يمكن نسخ/لصق |
| checkout idempotency | ملف JSON + `flock` | جدول PG `idempotency_records` | مختلف تماماً |
| recovery | `recover-abandoned-reservations.php` | `lib/inventory-pg.js` / `scripts/recover-…js` | كليهما يحتاج مفتاح |
| rate limit | PDO مباشر | PG pool | كلاهما fail-closed |
| مكافحة الاحتيال | file-based | DB-based | مختلف |

---

## D. حالات حدية تفصيلية

1. **لا يوجد path ترابطي بين reserve و `has_active_reservation`** — مراجعة السباق غير ممكنة بين الخطوتين لأن الثاني يُنفذ قبل الأول في نفس المسار.
2. **قيم `available/reserved/total` مرتبطة بـ `CHECK (total_physical = available + reserved)`** في مقترح PG — يضمن عدم كسر الثبات على مستوى القاعدة؛ وفي JSON يوجد تحقق `(int)$item['totalPhysical'] !== (int)$available + (int)$reserved` قبل الكتابة، لكن لا يُعاد بعد `rename()` — لا ضير عملياً.
3. `release` بدل أن يفشل: إن كانت `expectedQty < qty` المتاحة فعليًا، يأخذ `min` — لا يأخذ أكثر من الكمية الموجودة، صحيح.
4. `orderId` يُفرض عليه `^[A-Za-z0-9._:-]{6,64}$` في كل مسار — لا حقن ولا symlink عبر الملف.
5. كل `rollback` txn يتم الاستدارة فيه عند أي فشل — صحيح.
6. لا توجد أي معاملة واحدة تضم reservation + persist، لذا الخطر (B-3) غير قابل للحل دون helper XML مشترك أو RPC — يتطلب قراراً هندسياً.
7. تلف ملف `inventory-state.json` (انقطاع كهربائي في لحظة `rename`): لا يُفقد uncommitted dayًا غير 0 — لكن يُفقد آخر وحدة حالية وقد تُظهر الـ instance محجوزًا — يعمل fail-closed (يرفض INVENTORY_UNAVAILABLE), آمن.
8. توقيت `updated_at` في PG reserve يعاد ضبطه عند إعادة الحجز (RELEASED → RESERVED) — متسق مع إعادة تجربة الـ checkout من نقطة الصفر.

---

## E. تحليل تهديدات الطلبات الفعلية

| التهديد | الأثر | الحالة |
|---|---|---|
| `INSERT INTO public.orders` يفشل بعد أن نجح reserve | الحجز يبقى `CHECKOUT_PENDING` — recovery فقط إن عملت | جزئياً تحت التحكم |
| insert نجح ثم انقطع الاتصال قبل bind | نفس ما سبق | نفس |
| bind نجح ثم العميل ضغط رجوع وresubmit | `Idempotency-Key` من الـ client — idempotent | سليم |
| insert نجح ثم crash، ثم العميل أعاد المحاولة بنفس `orderId` | 409 CONFLICT (`DUPLICATE_ORDER_ID`) — الجاني لا يراجع SQL | يحجز العميل ولا يسترد؛ يتطلب مسار مساندة |
| خطأ متوقَّع في client time bucketing (`dedup_…`) | timeout 5min ⇒ قد يمر الطلب مرتين | نادر عملياً |
| عطل كامل في PDO على خادم حقيقي | 429/503 دائماً | **الوضع الحالي على Staging** |

---

## F. ما لم يُختبر (NOT TESTED)

- **Production الفعلي على Hostinger**: لم يُلمَس؛ لا SQL، لا تنفيذ `pdo`، لا دور أُنشئ.
- **استعادة الـ 51 Stale RESERVED**: لم تُلمَس (data حيّة أو قديمة — غير آمنة التعديل بدون موافقة مؤكدة).
- **`ORVA_INVENTORY_BACKEND=postgres` على خادم Hostinger الحقيقي**: لم يُفعّل؛ لا توجد قرارات نشر بهذا الشأن.
- **recovery script على Hostinger مع/بدون مفتاح خدمة**: untested end-to-end؛ يحتاج تجربة على staging معتمدة.
- **Vercel PG pool SSL مع pooler**: مرصود محلياً «self signed certificate»؛ لم تُختبر بعد (محظور التلامس مع المستضاف).
- **POST سباق بحق `orderId` واحد في وقت واحد** (مكرر): غير مُختبر كـ harness منفصل عن الاختبارات الحالية.

---

## G. دلائل مُتحققة (محلي)

```
PHP version                          : PHP 8.3.36 ZTS (Windows)
pdo_pgsql                            : ENABLED locally
Race 25 processes × 1 unit (PG)      : 1 winner / 24 INSUFFICIENT_STOCK ✓
Race 25 processes × 1 unit (JSON)    : 1 winner / 24 INSUFFICIENT_STOCK ✓
Reserve same orderId twice           : first created, second alreadyReserved ✓
Release same orderId twice           : first ok, second alreadyReleased ✓
JSON invariant (available+reserved)  : VALID ✓
PG CHECK inventory_items_invariant   : موجود في 2026-11-07-public-inventory-idempotency.sql
orders stock JSON tracked file       : untouched ✓
data/inventory-state.json            : لم يُقرأ/لم يُعدّل
data/inventory-audit.json            : لم يُقرأ/لم يُعدّل
```

---

## H. SHA-256 للملفات المُنشأة

| الملف | SHA-256 |
|---|---|
| `scripts/audit-inventory-concurrency.php` | `172669C0C2254811FF2068EB57164988C8EE25CD7DE03CBA1E93A64B49F58CB0` |
| `scripts/audit-inventory-json.php` | `FB11F3B93DDBC3BD58128E818890CBE3B826782E756EDF209D4F2F694E0FED15` |

تعديلات على ملفات قائمة في هذا المسح: **لا شيء**.

---

## I. التوصيات ذات الأولوية

**P0 — إلزامي على Hostinger / Vercel قبل أي جلسة إنتاج:**

1. فعّل `pdo_pgsql` على خادم Hostinger (PHP options → PDO pgsql)؛ بدونها مستحيل تنفيذ أي مسار خرافي هنا.
2. اضبط على Hostinger (outside-webroot secure config): `ORVA_PG_ALLOW_HOSTED=true`, `DATABASE_URL=postgresql://postgres:<password>@db.olmsjkhdfghyydogcvvy.supabase.co:5432/postgres` (وفّر `SUPABASE_SERVICE_ROLE_KEY` ليتسنى الـ recovery).
3. تحقق يدوي: `php -v && php -m | grep -i pgsql` — إن كانت متاحة، اختبر HTTP POST اصطناعي صغير الحجم (بدون إرسال Telegram حقيقي؛ عطّل إرسال الإيميلات أولاً).
4. فعّل إشعار `RATE_LIMIT_STORAGE_UNAVAILABLE` يصل المالك عبر Telegram — لا تقبل أن يظل العطل مخفياً.
5. لا يُقدم على أي عملية نشر hosted قبل استقرار P0 + اختبارات end-to-end staging معتمد.

**P1 — خلال أسابيع، بموافقة إدارية:**

6. إعادة بناء `ruleRateLimit`/`ruleRepeatedPhone` بـ `COUNT(*)` على الخادم مع Index على `created_at`، بدل تحميل الجدول في الذاكرة.
7. قرار موثق: JSON أم PG لـ Hostinger — الافتراضي الحالي json صالح لخادم واحد (اختبارنا أثبت)، لكن PG أأمن stateless.
8. مراجعة مسار استدعاء recovery على Staging (obseletion state over time in `staging-secure-config.php`) — يحتاج configuration واضح على cron المستقبلا.

**P2 — لاحقة:**

9. `hashtext` → `hashtextextended(text, 0)` في PHP وJS؛
10. توقيت متوازٍ بمعالجة أفقية
11. نقل `inventory-audit.json` إلى PG streaming أو جدول مخصص؛
12. تنظيف `data/locks/idemp_*.lock` من التراكم.

---

## J. حالة المشروع — Verdict

**BLOCKED — PHP Checkout NOT FUNCTIONAL / NOT VERIFIED.**

- Staging معطل (موثق: `pdo_pgsql` غير مثبت).
- Production لم يُختبر — لا يمكن التحقق ولا يمكن أن يدعي أي طرف أن «شيئا يعمل» الآن.
- أي ادعاء بنجاح الدفع الآن هو ادعاء باطل؛ والحل والورار — ليس برمجياً، بل تشغيلياً (Hostinger).

**هذا ليس خللاً في الكود بحد ذاته؛ هو قرار تشغيلي لم يُتخذ بعد.**

---

## K. مرجعية

الإصلاحات ذات الصلة (2026-11-07):

- `api/send-order.js:51-63`: `wilayaId` يُمرر إلى `verifyAndCalculateOrder`.
- `lib/db.js:18-29`: في local/dev/test بلا `SUPABASE_SERVICE_ROLE_KEY` يُرجع `null` بدل رمي `SERVER_MISCONFIGURED` — يسمح بـ failover PG.
- RTL → LTR في لوحة التحكم (Admin Dashboard).

تستجوب: `lib/inventory-store.php`, `lib/inventory-pg.php`, `lib/inventory-recovery.js`, `lib/inventory-pg.js`, `lib/inventory-manager.js`, `lib/db.js`, `lib/db-authority.js`, `lib/supabaseServer.js`, `lib/riskEngine.js`, `lib/risk-engine.php`, `scripts/recover-abandoned-reservations.php`, `scripts/recover-abandoned-reservations.js`, `docs/HOSTINGER_INVENTORY_RECOVERY_CRON_PROPOSAL.md`, `supabase/proposals/2026-11-07-public-inventory-idempotency.sql`.

---

*أُعدّ هذا التقرير لمالك المشروع فقط؛ غير قابل للنشر حتى الآن؛ ولا يلزم أي تنفيذ دون موافقة صريحة.*
