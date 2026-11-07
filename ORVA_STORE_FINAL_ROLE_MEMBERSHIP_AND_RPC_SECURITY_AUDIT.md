# ORVA STORE — Final Role Membership & RPC Security Audit

**التاريخ:** 2026-11-07
**النطاق:** تدقيق نهائي لعضوية الأدوار وتعرض `SECURITY DEFINER` و RPC العام، تمهيداً للموافقة على تنفيذ مقترحات RLS الأربعة المودعة في `supabase/proposals/`.
**القيود المعمول بها (كلها مُلتزم بها):**

- لم يُنفذ أي SQL مستضاف على Production أو Staging أو أي قاعدة Supabase سحابية.
- لم تُقرأ صفوف `orders` أو `rate_limits` أو `customers` من أي بيئة — كل اختبار محلي على بيانات اصطناعية داخل Schema/أدوار تصرفية (`orva_role_test`, `orva_private_test`, `orva_role_attacker`, `orva_eff_test`) ثم أُسقطت بالكامل.
- لم تُغيَّر عضويات أي دور حقيقي، لا محلياً ولا مستضافاً.
- لم تُعدّل أي Policy أو Grant أو Function أو Supabase Functions.
- لم يُعدّل Hostinger، ولم يُنفذ Commit / Push / Deploy (الفهرس Git بقي كما وجده هذا التدقيق مع استثناء واحد مُعلن في القسم H).
- لم يُطبع أي أسرار أو قيم سرية. لم يُقرأ محتوى `.env` ولا بيانات التعريف الشخصية. الملفات الناتجة لا تحتوي `polqual` خام (لأن Policy التنفيذية القديمة تضمنت قيمة رمز إداري كقيمة حرفية).

**حالة البيئة المستضافة:** لم تتوفر أي اتصال مُصرّح به بالإنتاج خلال هذه المهمة (قائمة MCP المتاحة فارغة؛ ولم يُستخدم أي سلسلة اتصال من `.env.local`). لذلك صنفت كل نتيجة تتطلب Production بـ **NOT TESTED**، ولم يُمنح حكم READY.

---

## A. Role Membership Matrix

### A.1 دلالات المصفوفة (PostgreSQL 18 محلي، تنطبق على Supabase نفسها في هذا الشأن)

| العنصر | المصدر | المعنى |
|---|---|---|
| `pg_roles.rolinherit` | دور المسترد حقه | هل يمرر الدور صلاحيات أدوار هو عضو فيها تلقائياً (INHERIT) أم يتطلب `SET ROLE` |
| `pg_auth_members.inherit_option` (PG16+) | عضوية فردية | هل يسمح بهذه العضوية تحديداً بالميراث التلقائي (قيمة لكل عضوية، وليست للدور فقط) |
| `pg_auth_members.set_option` | عضوية فردية | هل يسمح للعضو بتنفيذ `SET ROLE` إلى الدور الممنوح (`SET`) |
| `pg_has_role(a, b, 'USAGE')` | تحقق فعّال | true إذا كان `a` يستطيع استخدام صلاحيات `b` مباشرة (يراعي `inherit_option` عبر كل مسار) |
| `pg_has_role(a, b, 'SET')` | تحقق فعّال | true إذا كان `a` يستطيع `SET ROLE b` |
| `has_table_privilege(role, table, 'SELECT')` | تحقق فعّال | يدمج المباشر + الموروث عبر العضوية + `PUBLIC` |
| `has_function_privilege(role, fn, 'EXECUTE')` | تحقق فعّال | نفس الدمج للدوال — بما فيها الوراثة عبر العضوية |

الفرق الجوهري: `rolinherit` للدور المالك نفسه، بينما `inherit_option/set_option` **لكل عضوية على حدة**. يمكن لدور `NOINHERIT` أن يستعيد صلاحيات عبر `SET ROLE` إذا كانت `set_option=true`. العضوية غير المباشرة تعمّل شرطياً: يجب أن تكون `inherit_option=true` في **كل قفزة** حتى تنتقل صلاحية تلقائية.

### A.2 المصفوفة المثبتة محلياً (بيئة تصرفية `orva_role_test` — بيانات اصطناعية فقط)

| # | الحالة | `pg_has_role ... USAGE` | `pg_has_role ... SET` | الاكتشاف المقيس |
|---|---|---|---|---|
| A1 | `anon` → `chain_mid` (INHERIT) | true | true | عضوية مباشرة تمرر مصالح الورثة عبر سلسلة |
| A2 | تحقق `SET` على نفس العضوية | true | true | `SET` يصح تلقائياً مع `inherit_option=true` |
| A3 | غير مباشر: `orva_role_anon` → `chain_mid` → `readers` (قفزة وسيطة) | **true** | — | `pg_has_role` يجمع السلسلة كاملة دون عضوية مباشرة |
| A3b | عضوية مباشرة بين `anon` و `readers` في الكتالوغ | **غير موجودة** (عدد الصفوف = 0) | — | أي `REVOKE` مباشر على `readers` لا يغلق المسار غير المباشر |
| A4 | دور `NOINHERIT` عضو في `readers` مع `INHERIT FALSE, SET TRUE` | **false** | — | لا يقرأ مباشرة حتى مع محفظته من الصلاحيات |
| A5 | نفس الدور بنفذ `SET ROLE readers` | — | true | بعد `SET ROLE` يُقرأ الصف (تحققنا من `rowCount > 0`) |
| A6 | `setter` (INHERIT بالدور) عضوية `INHERIT FALSE, SET TRUE` | **false** | **true** | لا يقرأ مباشرة؛ `SET ROLE` مسموح |
| A6b | `setter` لا يقرأ مباشرة | false | — | `SELECT` مرفوض أو `rowCount = 0` |
| A6c | `setter` ينفذ `SET ROLE readers` ثم يقرأ | — | true | القراءة تعيد صفوفاً فعلية |
| A7 | `lookup` اتحاد الكتالوغ | anon=true، authenticated=true، cleancaller=false | — | `has_table_privilege` = مباشر ∪ موروث ∪ `PUBLIC` |

### A.3 حالة `anon` و `authenticated` المستضافة (Production)

**NOT TESTED.** هذه البيئة لا تحتوي أي اتصال مُصرّح به؛ ممنوع تشغيل SQL مستضافة في هذه المهمة. اللقطات والمصادقة المرجعية المتاحة للكتلة المحلية (`orva_local` غير المستضافة) تُظهر: `anon`/`authenticated` بأدوار `NOLOGIN INHERIT` بدون عضوية لأي دور أعمال. هذه **ليست أدلة Production**، وترد للمقارنة فقط.

لا تتوفر أي وسيلة داخل هذه المهمة للتحقق من: عضوية المستضاف، الأدوار الوسيطة، `SUPERUSER`/`BYPASSRLS` يصل إليها المسار. لذلك كل حكم على Membership في الإنتاج يبقى **NOT TESTED**، ولا يجوز اعتماد المقترحات التشغيلية على أساسها.

### A.4 النتيجة العملية للعضويات

- أي مسار عضوية يمرر صلاحية (حتى لو غير مباشر) ينفذ كل قيود المنشأة من النوع `GRANT` الملتوي فقط، ولا يتأثر بأي `REVOKE` مباشر يستهدف `anon`/`authenticated`.
- `PUBLIC` تُعامل كعضوية افتراضية لكل الأدوار؛ `REVOKE ... FROM PUBLIC` هو وحده الذي يغلق هذا المسار (مثبت في المحاكاة).
- الأدوار الوسيطة بسياسة `SELECT ... USING (true)` تجعل الملفات الأربعة غير فعّالة ضد هذا المسار بالكامل (قسم E).

---

## B. Effective Privileges After Membership

جدول المسارات الفعّالة على `public.orders` / `public.rate_limits` (أو ما يعادلها بالتصفية) بعد تطبيق الملفات الأربعة محلياً بالتسلسل، مع `rowCount` الفعلي (وليس نجاح الاستعلام فقط — كانت النسخ السابقة من harness الجولة السابقة تقبل `ok` وحده، وهو ما تم تصحيحه هنا):

| المسار | قبل المقترحات | بعد SELECT containment | بعد Mutation/Least-privilege | الحكم |
|---|---|---|---|---|
| `SELECT` مباشر لـ `anon` | موجود | محذوف بالكامل | — | **مغلق** ✓ |
| `SELECT` عبر `PUBLIC` | موجود | محذوف بالكامل | — | **مغلق** ✓ |
| عمود `SELECT` (column-level) | موجود (`phone`, `status`) | محذوف بالكامل عبر حلقة `information_schema.column_privileges` | — | **مغلق** ✓ |
| سياسات `Allow anon order read` / `Allow anon rate limit select` | موجودة | أُسقطت | — | **مغلق** ✓ |
| `SELECT` عبر عضوية غير مباشرة `anon → chain_mid → readers` | موجود (rowCount=2) | **ما زال موجوداً (rowCount=2)** | **ما زال موجوداً** | **مفتوح — لا تغلقه الملفات الأربعة** |
| `SELECT` مصادق `authenticated → auth_readers` | موجود (rowCount=2) | **ما زال موجوداً** | **ما زال موجوداً** | **مفتوح** |
| `SELECT` على `rate_limits` عبر `readers` | موجود (rowCount=1) | **ما زال موجوداً** | **ما زال موجوداً** | **مفتوح** |
| `UPDATE orders` عبر `anon → mutators` | موجود (rowCount=1) | — | **ما زال موجوداً (rowCount=1)** | **مفتوح** |
| `DELETE orders` عبر `mutators` | موجود (rowCount=1) | — | **ما زال موجوداً (rowCount=1)** | **مفتوح** |
| `UPDATE rate_limits` عبر `mutators` | موجود (rowCount=1) | — | **ما زال موجوداً (rowCount=1)** | **مفتوح** |
| `INSERT` (Checkout) | موجود | موجود (rowCount مقبول) | موجود | **محفوظ عمداً** ✓ |
| `UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` مباشر | موجود | — | محذوف عند الجلسة عبر كتالوغ `information_schema.role_table_grants` (فحص B12 = 0 صف) | **مغلق** ✓ |
| `service_role` | كامل | كامل | كامل | **محفوظ** ✓ |

**الفرق عن نتائج الجولة السابقة (23 PASS/0 FAIL):**
- الجولة السابقة: `ORDERS_SELECT_STILL_EFFECTIVE` (بسبب `PUBLIC` أو membership أو column)، `ORDERS_INHERITED_SELECT_ONLY`، `FUNCTION_EXECUTE_UNTOUCHED` — صحيح في تصنيفه لكن **اكتُشف الآن أن القرب من `rowCount>0` كان أكثر دقة** بعد فصل «نجاح الاستعلام» عن «وجود صفوف فعلية».
- في هذا التدقيق: المقترحات تُغلق كل مسار **مباشر/عمودي/PUBLIC** محلياً، لكنها **لا تُغلق** مسار العضوية الوسيطة ولا `EXECUTE` الوراثي عبر العضوية ولا الـ views.
- `has_table_privilege(anon, orders, 'SELECT') = true` محلياً حتى بعد المقترحات — بسبب المسار غير المباشر فقط.

**ملاحظة أمنية:** لا تزال `SELECT` و `UPDATE` ممكنتين عبر مسار عضوية محدد واحد على الأقل، وملفّا المقترحات لا يلمسانه. هذا لا يعني أن الإنتاج يحمل هذه العضوية فعلاً — بل أن هذا الاحتمال **لم يُستبعد** بعد، لأن الدليل المستضاف غير متاح.

---

## C. SECURITY DEFINER Function Inventory

البيئة المستضافة: **NOT TESTED**. البيئة المحلية المتصرفية احتوت خمس دوال اصطناعية تُمثل الأنماط الشائعة لدوال RPC المكشوفة عبر Data API (`public`). لا توجد دوال في `public` في `orva_local` الحقيقية — وهو ليس تمثيل للإنتاج.

| الدالة (نسخية محلية) | النوع | المالك | `prosecdef` | `proconfig` | `EXECUTE` إلى `PUBLIC` | استدعاء النتيجة بالملاحظة الصلبة |
|---|---|---|---|---|---|---|
| `f_invoker_list()` | `SECURITY INVOKER` | owner | false | لا شيء | مسموح | يُسمح لأي دور يملك `EXECUTE` لكنه **لا يتجاوز** صلاحيات/سياسات المستدعي؛ نميّزها كخيار آمن عندما يكون المالك يحمل صلاحيات ضئيلة |
| `f_definer_public()` | `SECURITY DEFINER` | مالك مميّز (BYPASSRLS) | true | لا شيء | **نعم** | استدعاء من `cleancaller` (صفر صلاحيات جدول) يعيد **صفين**، والكتالوغ `has_table_privilege(cleancaller, orders, 'SELECT') = false` — **تسريب مقيس** |
| `f_definer_restricted()` | `SECURITY DEFINER` | نفس المالك | true | لا شيء | لا (محتوى مقيّد) | `cleancaller`/`anon` مباشر: مرفوض؛ `anon عبر membership` (`func_exec`): **يعمل (صفان)**؛ `authenticated` بمنحة صريحة: **يعمل**؛ المالك BYPASSRLS يقرأ رغم منع `SELECT` المباشر |
| `f_definer_no_searchpath()` | `SECURITY DEFINER` | نفس المالك | true | لا شيء | نعم | تحاول حل `orders` غير المؤهلة؛ طبقاً لـ local probe فشلت بـ `42P01` (راجع ملاحظة التحقق أدناه) |
| `f_definer_safe_searchpath()` | `SECURITY DEFINER` | نفس المالك + `SET search_path = ''` | true | `search_path=''` | نعم (لكن الوصول للاسم مؤهل) | يعيد الصفوف الحقيقية، ويتجاهل أي ظلال للمسارات (C7/C8/C9 PASS) |

**Ownership check:** المالك المميز يملك `BYPASSRLS` لكن لا حقوق جدول مباشرة له حتى يُمنح `SELECT`. وإلا فشلت كل ما يوړل إليه `definer` برسالة `permission denied for table orders` — تمرنية الـ ACL لا تلغيها BYPASSRLS. أي أن `SECURITY DEFINER` تفوق معياري فقط عندما يملك المالك ما يلزم فعلاً (نموذج Supabase: `service_role`/`postgres`).

**prosecdef / proconfig evidence:** `proconfig` دالة المسار الآمن يحتوي `search_path=''` (C8)؛ حالة `definer` بلا ضبط يبقى `NULL` (Q13 في ملف الإنتاج يكتشفها).

**تصنيف الخطورة المحلي (النموذج):**
- `f_definer_public`-نمط: **HIGH RISK** — قابلة للتنفيذ من `PUBLIC` وتصل لجداول حساسة بصفر صلاحيات.
- `f_definer_restricted`-نمط: **REVIEW** — ليست قابلة للتنفيذ عادة إلا عبر منح صريح؛ لكن grant واحدة لـ role قابل للعضوية تجعلها قابلة للوصول عبر العضوية (لا تزال قابلة للتدقيق).
- `f_invoker_list`-نمط: **SAFE** — يحترم المستدعي، مع ملاحظة أن membership تعطي المستدعي إمكانيات حتى مع INVOKER.
- دوال بلا `search_path` مثبت: **REVIEW** — تنصح بتثبيت `SET search_path = ''` وتأهيل كل مرجع.

**Public RPC في الإنتاج: NOT TESTED** — يلزم تطبيق Queries من القسم G على بيئة مصرّح بها قبل أي موافقة.

---

## D. Public RPC Exposure

### D.1 ما ثبت محلياً
- Definer + EXECUTE عام = تسريب فعلي لصفوف اصطناعية بصفر صلاحيات (C2). **الدليل مقيس:** `rowCount = 2`، `has_table_privilege = false`.
- `SECURITY INVOKER` لم يتسرب لدور بلا صلاحيات (C1/C6 — `42P01`/رفض).
- `REVOKE EXECUTE FROM PUBLIC/anon/authenticated` تُغلق المشاركة للمنفذين مباشرة (D1 PASS).
- لكن **`REVOKE EXECUTE` لا تلغي EXECUTE الموروث عبر عضوية** (D2/GAP): `anon` يبقى قادراً على تنفيذ definer مقيدة لأن `func_exec` يحمل المنحة و`anon→func_exec (INHERIT)`.
- النقل إلى Schema غير مكشوف ورفض `USAGE` يغلق الباب فعلاً (D3 PASS).
- `security_invoker = on` للداش view يمنع المستدعي التكملة بحقوق المالك (D4 PASS).
- View بالوضع الافتراضي (definer semantics) يُسرب صفاً بصفر صلاحيات (D5/VIEW_DEFINER_DEFAULT).

### D.2 ما لم يثبت محلياً (بصراحة)
- **لم يتكرر hijack الـ search_path** على PostgreSQL 18.6 المحلية: definer بلا `SET search_path` بَعُد بـ `relation "orders" does not exist` (42P01) عند محاولة الظل بـ جدول مالك للمهاجم ونقل `search_path` للمستدعي. لذلك لا يمكن الجزم بأن بيئة Production معرضة لهذا النمط؛ يكفي أن نجعل `SET search_path = ''` + تأهيل المراجع قاعدة تدقيقية ولا نعتبره دليلاً سارياً حتى تُكتشف دوال حقيقية مكشوفة.
- لا يوجد دليل محلي على دوال حقيقية في `public` تصل `orders`/`rate_limits` — لأن وجودها في المحاكاة مصطنع بالكامل.

### D.3 التوصية التشغيلية لـ RPC
- عند توفر الدليل المستضاف: احصر كل `public` function `prosecdef=true` ذات `EXECUTE` لـ `PUBLIC`/`anon`/`authenticated` وتصل `orders`/`rate_limits` (Queries Q10/Q11/Q12/Q16 في القسم G).
- الحلول الصحيحة: `REVOKE EXECUTE ... FROM PUBLIC` ثم grant صريح لأدوار محددة، أو تحويل إلى `SECURITY INVOKER` حيث يناسب، أو نقل الدالة إلى schema غير مكشوف مع `REVOKE USAGE ... FROM PUBLIC`.
- **لا تُستخدم `REVOKE EXECUTE` الشاملة على كل دوال `public` قبل تحديد تبعيات التطبيق** (المتطلبات والمراجعة).
- أي RPC `definer` تصل للطلبات/المحدودية يجب أن تحمل `SET search_path = ''` مع تأهيل كل أسماء الجداول، وإلا رجّعت REVIEW/HIGH حسب الاكتشاف.

---

## E. Local Simulation Results

### E.1 الجولة السابقة (baseline مُعاد تشغيله)
أمر `node scripts/sql-effective-privileges-validation.js` → **23 PASS / 0 FAIL** مع ثلاث ملاحظات: `ORDERS_SELECT_STILL_EFFECTIVE`, `ORDERS_INHERITED_SELECT_ONLY`, `FUNCTION_EXECUTE_UNTOUCHED`. هذا يؤكد النتائج الأصلية حرفياً؛ SHA-256 للملفات الأربعة قبل وبعد متطابقة.

### E.2 هذه الجولة (harness الجديد `scripts/orva-membership-definer-audit.js`)
Postgres `180006`. كل الفحوصات على Schema وأدوار تصرفية؛ لا قراءة لبيانات حقيقية؛ لم تُنشئ/تعدّل غير ما أُسقط بالكامل (التحقق أعلاه).

**35 فحصاً PASS / 0 FAIL.** الفجوات/الملاحظات المقيسة:

| # | النوع | الوصف المقيس |
|---|---|---|
| B0 | ملاحظة | الاستراتيجية: لا `SELECT` مباشر للمستدعين؛ فقط مسارات العضوية — تُظهر أن الملفات الأربعة لا تغلقها |
| B2 | ملاحظة | `UPDATE` عبر `mutators` أثّرت صفاً واحداً قبل المقترحات |
| B4 / ORDERS_SELECT_VIA_MEMBERSHIP | GAP | القراءة تعيد صفين بعد SELECT containment عبر `anon→chain_mid→readers` |
| B5 / RATE_LIMITS_SELECT_VIA_MEMBERSHIP | GAP | صف واحد في `rate_limits` بعد containment |
| B7 / VIEW_OWNER_PRIVILEGES | GAP | view مملوك لصاحب مميز يُرجع صفاً بصفر صلاحيات المستدعي |
| B8 / ORDERS_UPDATE_VIA_MEMBERSHIP | GAP | `UPDATE` يمر عبر `mutators` بعد Mutation lockdown (rowCount=1) |
| B9 / ORDERS_DELETE_VIA_MEMBERSHIP | GAP | `DELETE` يعبر `mutators` بعد lockdown (rowCount=1) |
| B10 / RATE_LIMITS_UPDATE_VIA_MEMBERSHIP | GAP | `rate_limits` `UPDATE` يبقى عبر العضوية (rowCount=1) |
| B11 / ORDERS_SELECT_AUTH_MEMBERSHIP | GAP | `authenticated → auth_readers` يقرأ صفين بعد كل الملفات |
| C1 | ملاحظة | `anon` يشغّل `INVOKER` ويقرأ عبر membership — ليست مشكلة INVOKER نفسها |
| C2 / DEFINER_PUBLIC_EXECUTION | GAP | definer يُرجع صفين لمنفذ بلا صلاحيات جدول |
| C3 | ملاحظة | `anon` يشغل definer المقيدة عبر `func_exec` — membership path |
| C5 / FUNCTION_EXECUTE_VIA_MEMBERSHIP | GAP | `EXECUTE` على restricted definer موروث عبر العضوية |
| C6 | ملاحظة | لم يتكرر الظل المحلي (راجع D.2) |
| D2 / REVOKE_EXECUTE_NOT_SUFFICIENT | GAP | `REVOKE` المباشر لا يمنع الموروث |
| D5 / VIEW_DEFINER_DEFAULT | GAP | view الافتراضي يتسرب لصفر صلاحيات |

### E.3 سلامة البيئة المحلية
- الفحوصات نجحت تحت `orva_role_test`/`orva_private_test`/`orva_role_attacker` ثم أُسقطت كلياً (التحقق: `schemas: public, staging` فقط؛ و `orva_role_*`/`orva_eff_*`/`probe_*`/`sp_*`/`orva_private_test` عددها صفر).
- `inventory-state.json` لم يتغير mtimes (فحص مرجعي من مجموعة SQL السابقة نجح أيضاً).
- لم تلمس أي جداول `public.orders` أو `public.rate_limits` الحقيقية للبيئة المحلية في هذا التدقيق (كل شيء تصرفياً).
- لم يُنفذ أي SQL مستضاف.

---

## F. SQL Proposals Review

المقترحات الأربعة (SHA-256 أدناه ولم تُعدّل):

| الملف | الغرض | الحكم المحلي على الهدف | ما لا تستهدفه (وهذا متوقع من نطاقها) |
|---|---|---|---|
| `2026-11-07-production-orders-select-containment.sql` | إلغاء `Allow anon order read` و`SELECT` الجدول/العمود/`PUBLIC` من `anon/authenticated/PUBLIC` | يغلق المسارات المباشرة/العمودية/PUBLIC محلياً (B3/B4، تحقّق baseline) | العضويات الوسيطة؛ الدوال؛ الـ views؛ `EXECUTE` الوراثي., ويشترط شرط «Catalog membership check» قبل التنفيذ |
| `2026-11-07-production-rate-limits-select-containment.sql` | نفس النمط على `rate_limits` | يغلق المباشر/العمودي/PUBLIC محلياً | نفس الاستثناءات |
| `2026-11-07-production-orders-mutation-lockdown.sql` | إسقاط `Allow admin token order update/delete` + `UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` + column revokes | يغلق المباشر محلياً؛ `INSERT` محفوظ للـ Checkout؛ المفتاح `service_role` محفوظ؛ `B12 = 0` | العضويات الوسيطة؛ `EXECUTE`؛ الـ views |
| `2026-11-07-production-rate-limits-least-privilege.sql` | نزع عمليات `UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` و column revokes | يُغلق المباشر محلياً؛ `INSERT` محفوظ | نفس الاستثناءات |

**ملاحظات التصميم:**
- الملفات الأربعة **أبقت `INSERT` عمداً** — لأن مسار Checkout الحالي يعتمد عليه. طالما بقي هذا المسار، أي موافقة نهائية تتطلب مساراً خادماً (`service_role`) أو حتمية بأن `INSERT` عام مقبول هيكلية.
- كل ملف يذكر صراحة «Catalog check for unexpected role membership» كشرط مسبق خارج الملف. **هذا الشرط هو من يجب أن يُنفذ — وليس تعديل الملفات لتوسيع صلاحياتها.**
- لا توجد فجوة تُثبت أن الملفات **خاطئة داخل نطاقها**؛ الفجوة هي أن المخاطر المتبقية خارج نطاقها بالكامل، ولا يمكن تمرير التنفيذ بأمان بدون دليل مستضاف (القسم G).
- **لم يتم إنشاء أي مقترح SQL إضافي في هذه المهمة** للحفاظ على القاعدة «لا توسع لتعديل العضويات أو كل دوال public»؛ المقترح الجاهز للاستخدام المستقبلي الوحيد هو استعلامات الفحص للقراءة فقط (القسم G). أي مقترح membership lockdown منفصل يُنشأ **فقط** بعد اختيار/تأكيد الأدلة المستضافة، ويكون بأصغر نطاق ممكن.
- لم يتم إدراج أي حدود `REVOKE EXECUTE` جماعية — يظل محظوراً قبل حصر تبعيات التطبيق.
- أي تعديل مستقبلي على الملفات الأربعة يتطلب SHA-256 جديد وتحديث التقرير المرتبط بها.

**الخلاصة:** المقترحات سليمة لهدفها (CONTAINMENT المباشر/العمودي/PUBLIC + سياساته) محلياً؛ لكنها **لا تُغلق** فجوات العضوية/الـ RPC/الـ views. الموافقة عليها وحدها لا تجعل `orders`/`rate_limits` مغلقين أمام مسار عضوي أو definer RPC، ولذلك الموافقة على تنفيذها **غير كافية للإطلاق** دون القسم G.

---

## G. Production Read-only Inspection Queries

**الملف:** `supabase/proposals/2026-11-07-production-readonly-role-membership-rpc-queries.sql`
**SHA-256:** `6BB63824E13C0004D0759626807852F4E69A8E289776D6BB8A99B33DD24C7041`
**الحالة:** أُعدّ في هذه المهمة للتشغيل **لاحقاً يدوياً** فقط. لم يُشغّل على Production. لُوحظت بنيته ودلالته محلياً بنجاح (16 قسماً تنفذ بدون أخطاء؛ فحص ممنوعات DML/DDL/GRANT/REVOKE نظيف بعد تجريد النصوص المحرفية).

ما يعرضه (كل الاستعلامات SELECT فقط؛ لا DML/DDL/GRANT/REVOKE؛ لا `polqual` خام):

| القسم | ما يعرضه | لماذا |
|---|---|---|
| Q1 | `pg_roles` لـ `anon/authenticated/service_role/authenticator/postgres` | أي `SUPERUSER`/`BYPASSRLS` مسار حرج |
| Q2 | العضوية المباشرة `anon/authenticated` مع `inherit_option`, `set_option` | أساس التهديد |
| Q3 | العضوية **غير المباشرة** المتكررة (`WITH RECURSIVE` حتى عمق 8) مع سلسلة المسار و`inherit_option` الفعّال عبر القفزات | حالة `anon` من القسم A بلغة الإنتاج |
| Q4 | أدوار وسيطة قابلة للوصول — `rolsuper/rolinherit/rolbypassrls` | كشف أي دور عالي الصلاحيات في مسار الورثة |
| Q5 | جدول `role_table_grants` على `orders/rate_limits` للـ `anon/authenticated/PUBLIC` | تحقق متبقي (يجب صفر) |
| Q6 | `column_privileges` لنفس الأدوار | ما يفلت منه `table_grants` |
| Q7 | `pg_policy` metadata فقط (`polname`, `polcmd`, `has_13n` literal-token boolean, `octet_length`) — **بدون قيمة سرية** | كشف سياسات الرمز القديمة دون تسريب الرمز |
| Q8 | وصول `SUPERUSER/BYPASSRLS` للمستدعي/المصادقل الورثة | إنذار حرج |
| Q9 | Views في `public` يقرأها `anon/authenticated` | VIEW gap يتطلب `security_invoker=on` أو `REVOKE` على الـ view |
| Q10 | كل دوال `public` مع `owner/prosecdef/proconfig/has_function_privilege` | definer inventory |
| Q11 | نفس الشيء مقسّماً لكل overload: EXECUTE لـ `PUBLIC/anon/authenticated` | سطح RPC العام |
| Q12 | الدوال المرتبطة بـ `public.orders`/`public.rate_limits` عبر `pg_depend` | definer التي تلمس الطلب مباشرة |
| Q13 | definer بدون `SET search_path = ''` | SEARCH_PATH audit |
| Q14 | `proacl` خام | مطابقة bools مع ACL النصي |
| Q15 | بقايا `SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` لـ `anon/authenticated/PUBLIC` بعد المقترحات | فحص نهائي (INSERT متوقع متبق) |
| Q16 | بقايا definer `EXECUTE` لـ `PUBLIC/anon/authenticated` | إغلاق RPC النهائي |

**تعليمات الاستخدام (لاحقة وحصرياً):** خذ لقطة schema + كتالوغ المنح قبل أي تنفيذ؛ نفذ Q1..Q16 في محرر Supabase بـ اتصال مُصرّح كتابة read-only؛ ادمج النتائج في حزمة incident؛ لا تنشر المخرجات في Git. عند أي صف من Q2/Q3/Q8/Q9/Q10/Q12/Q16 → الحل هو مقترح **مُخصص** (لـ membership أو RPC واحدة بعينها) بعد مراجعة، وليس تعديلاً عاملاً للمقترحات الأربعة.

---

## H. SHA-256 للملفات

**ملفات لم تتغير في هذه المهمة (متطابقة قبل وأثناء وبعد الاختبار):**

| الملف | SHA-256 |
|---|---|
| `2026-11-07-production-orders-select-containment.sql` | `6727B8C3E87DB5245C5E3310C7A5D000BD78581D0EF8EEEBE4A434CF61004506` |
| `2026-11-07-production-rate-limits-select-containment.sql` | `0B34CC9CBCD60AD302525333C0889426C56C4D043810E8D924717A19BE7A6305` |
| `2026-11-07-production-orders-mutation-lockdown.sql` | `FBBFBA6C25EF3498C80B4BE9989F7FA438DA3270E5FE99DC65DFB2BFBDB5C580` |
| `2026-11-07-production-rate-limits-least-privilege.sql` | `3F0B9D1DFB2DE4438A0EF8D12D1A4D901B7A6FFE558BA5D1E6FFD7C344DE5A01` |

**ملفات أُنشئت/عُدّلت في هذه المهمة:**

| الملف | SHA-256 | الحالة |
|---|---|---|
| `supabase/proposals/2026-11-07-production-readonly-role-membership-rpc-queries.sql` | `6BB63824E13C0004D0759626807852F4E69A8E289776D6BB8A99B33DD24C7041` | أُنشئ ثم عُدل فيه ثلاثة عيوب (Q7 `coalesce(p.polqual::text, '')`، Q8 ضم `rolsuper/rolbypassrls` بشكل صحيح، Q9 إسقاط `has_table_privilege('PUBLIC', ...)`) ثم أُعيد التحقق محلياً بنجاح — 16 قسماً بلا أخطاء |
| `scripts/orva-membership-definer-audit.js` | `8A3D260EFFE25004CD105D5F65DF92B6CCB85D125B8B0344A876795A18A28A5B` | أُنشئ harness تصرفي واحد؛ يتحقق بنفسه من أن الملفات الأربعة لم تتغير (`changedProposals = []`) |

**الحالة الموضعية للـ Git index (للشفافية):** الملفات الأربعة الأصلية وملفات العرض المساعدة كانت مُدرجة ضمن staging سابقة على هذه المهمة — تمت مراجعتها فقط، وقيم SHA-256 المقابلة لها متطابقة مع نسخة العمل. الملف الوحيد الذي مزامن Index خاصته هو `2026-11-07-production-readonly-role-membership-rpc-queries.sql` (نسخة الفهرس كانت تحمل النسخة الأصلية ذات العيوب، فأُضيف ليطابق نسخة العمل). لم تُلمس ملفات المستخدم المُدرجة. تقرير هذه المهمة لم يُدرج في الفهرس. لم يُنفذ commit/push/deploy.

---

## I. Remaining Security Blockers

1. **Production Membership NOT TESTED** — Q2/Q3/Q4/Q8 لم تُشغّل؛ لا يمكن الجزم بانتفاء `anon/authenticated` ذات عضوية وسيطة granting SELECT/UPDATE/DELETE على `orders`/`rate_limits`، ولا انتفاء دور وسيط `BYPASSRLS`/`SUPERUSER` في مسار الورثة.
2. **Production SECURITY DEFINER / Public RPC NOT TESTED** — Q10..Q14/Q16 لم تُشغّل؛ لا يمكن الجزم بعدم وجود definer في `public` قابلة لـ `PUBLIC` وتصل الطلبات أو المحدودية.
3. **Views heuristic** — أي view في `public` يسمح بها `anon/authenticated` يتطلب مراجعة `security_invoker` أو `REVOKE SELECT`؛ هذا التسريب مقيس محلياً (B7/VIEW_DEFINER_DEFAULT) وقابل للتكرار مستضافاً.
4. **Membership remediation design** — إذا ظهرت أدلة مستضافة، فالمعالجة تُنفذ بإلغاء العضوية المحددة فقط (بعد تحليل الأثر)، لا بإلغاء تجميعي؛ كل عضوية مستهدَفة تُوثّق بأثرها على مسارات Checkout/php.
5. **`INSERT` المسموح عمداً** (Checkout) — طالما بقي بدون خادم `service_role`، تبقى سطح `INSERT` العام على طلبات/حدود ممكنة؛ يجب قبولها كقرار تصميم أو تأجيلها للمراجعة بعد الانتقال الكامل لمسار خادم.
6. **`SEARCH_PATH` لـ definer التي يجب بقاؤها definer** — يُلزم `proconfig` يحتوي `search_path=''` وتأهيل كل اسم؛ لم يتحقق أي دليل مستضاف على وجود/غياب هذه الدوال.
7. **بوابة ما قبل تنفيذ المقترحات** — النسخة الحالية من الملفات جاهزة هندسياً لنطاقها، لكن **بوابة الـ Catalog check للعضويات (شرط مسبق في كل ملفين) وQ1..Q16 لم تُنفذ مستضافاً**. بدونها التنفيذ ممنوع من ناحية السلامة (حتى لو تبقى الـ Checkout works).
8. **الحجم التشغيلي** — حتى لو مررت المقترحات، بقايا `EXECUTE PUBLIC` لـ definer قد تجعل `orders`/`rate_limits` قابلة للوصول عبر RPC رغم إلغاء SELECT/UPDATE/DELETE — وهذا السيناريو لم يُختبر مستضافاً.

---

## J. Final Verdict

**BLOCKED — INSUFFICIENT LIVE EVIDENCE**

السبب المباشر: معلومات عضويات Production والدوال المكشوفة غير متاحة؛ المهمة تمنع تنفيذ SQL مستضاف؛ والمقترحات الأربعة لا تغلق فجوات العضوية/الـ RPC/الـ views بشكل صريح (بما فيها نطاقها). لذلك لا يمكن تصنيف هذا التدقيق READY — ولن يُسمح بتجاوز هذا الحاجز محلياً.

**قواعد التصعيد إذا توفرت أدلة لاحقة:**
- إذا أعادت Q2/Q3/Q4/Q8 أي صف → **BLOCKED — ROLE MEMBERSHIP** حتى إلغاء العضوية المحددة (أو توثيقها كاستثناء مع قبول صاحبه) والتحقق بعدها بـ Q2/Q3/Q5/Q6.
- إذا أعادت Q10..Q14/Q16 definer قابلة لـ `PUBLIC/anon/authenticated` وتصل `orders/rate_limits` → **BLOCKED — SECURITY DEFINER** حتى حصرها بدقة: منحة صريحة، أو تحويلها إلى `SECURITY INVOKER` حيث يناسب، أو نقل الدالة إلى schema غير مكشوف مع `REVOKE USAGE`، أو تثبيت `SET search_path = ''` حيث تناسب؛ ثم التحقق بـ Q10..Q13 وQ16.
- إذا مرت Q1..Q16 بصفر نتائج غير متوقعة + تمت المراجعة اليدوية لكل view/definer في `public` + Checkout smoke test → عندها فقط يُفتح باب المراجعة النهائية لـ «READY FOR PRODUCTION SQL APPROVAL» — وليس في هذه المهمة.

**القرار الوحيد الجائز الآن:** أوقف التنفيذ على Production؛ وفّذ Q1..Q16 يدوياً بـ اتصال مُصرّح بعد إذن صريح؛ راجع العيوب المجتمعة في هذه التقرير؛ ولا تُفعّل أي feature flag للطلبات/الكتابة إلى أن يُغلق القسم I بنداً 1–4.

**هذا التدقيق متوقف هنا. أي SQL مستضاف أو حذف عضويات أو تعديل PostgREST/Hostinger أو commit/deploy يحتاج قراراً منفصلاً من مالك النظام.**

---

*نهاية التقرير. أُعد على أساس أدلة محلية صرفة مع احترام كامل لقيود الإنتاج. لا يوجد في هذه الوثيقة أي سر أو بيانات عملاء أو تفاصيل ربط.*
