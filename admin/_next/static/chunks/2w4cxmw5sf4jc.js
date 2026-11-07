(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,3805,12023,62081,e=>{"use strict";var t=e.i(29998);let a=["gallery","orderForm","title","subtitle","description","features","benefits","relatedProducts"],i=["title","subtitle","gallery","orderForm","features","description","benefits","relatedProducts"];function s(e="global_default"){return{layoutVersion:1,productId:e,desktopLayoutMode:"split",desktopSectionOrder:[...a],mobileSectionOrder:[...i],showRelatedProducts:!0,showDescription:!0,showFeatures:!0,showBenefits:!0,updatedAt:new Date().toISOString()}}e.s(["ALL_LAYOUT_SECTIONS",0,[{id:"title",labelAr:"عنوان المنتج الرئيسي",descriptionAr:"الاسم الرسمي للباقة أو المنتج وسعر البيع البارز",isEssential:!1,defaultVisible:!0},{id:"subtitle",labelAr:"الشارة والوصف الفرعي",descriptionAr:"شارة الباقة والتعريف الموجز لمحتوى العرض",isEssential:!1,defaultVisible:!0},{id:"gallery",labelAr:"معرض الصور وصورة الغلاف",descriptionAr:"الصورة الرئيسية ومعرض الصور التوضيحية للسلعة",isEssential:!1,defaultVisible:!0},{id:"orderForm",labelAr:"نموذج الطلب السريع (Checkout)",descriptionAr:"إستمارة تأكيد الطلب السريع مع اختيار الولاية والبلدية وخيارات الاستلام",isEssential:!0,defaultVisible:!0},{id:"description",labelAr:"الوصف التفصيلي للمنتج",descriptionAr:"شرح كامل لمحتويات الباقة وطريقة الاستخدام",isEssential:!1,defaultVisible:!0},{id:"features",labelAr:"قائمة المميزات والقطع المرفقة",descriptionAr:"تفصيل الأدوات أو الملحقات برؤوس نقاط وأيقونات توضيحية",isEssential:!1,defaultVisible:!0},{id:"benefits",labelAr:"بطاقات الضمان ومزايا الشراء",descriptionAr:"حق المعاينة قبل الدفع، التوصيل السريع والدفع عند الاستلام",isEssential:!1,defaultVisible:!0},{id:"relatedProducts",labelAr:"المنتجات المقترحة (Cross-sell)",descriptionAr:"عرض الباقات البديلة أو الملحقات الإضافية في نهاية الصفحة",isEssential:!1,defaultVisible:!0}],"createDefaultLayoutConfig",0,s],12023);let r="orva_product_layout_configs_v1";class o{configs=new Map;broadcastChannel=null;constructor(){this.initData(),this.setupCrossTabSync()}initData(){try{let e=window.localStorage.getItem(r);if(e){let t=JSON.parse(e);for(let[e,a]of Object.entries(t))this.configs.set(e,a)}}catch{}this.configs.has("global_default")||this.configs.set("global_default",s("global_default"))}persist(){try{let e={};for(let[t,a]of this.configs.entries())e[t]=a;window.localStorage.setItem(r,JSON.stringify(e)),this.broadcastChannel?.postMessage({type:"LAYOUT_UPDATED",timestamp:Date.now()}),window.dispatchEvent(new CustomEvent("orva:layout-updated"))}catch(e){console.warn("[MockLayoutRepository] Failed to persist layouts to localStorage",e)}}setupCrossTabSync(){try{"u">typeof BroadcastChannel&&(this.broadcastChannel=new BroadcastChannel("orva_layout_sync_v1"),this.broadcastChannel.onmessage=e=>{e.data?.type==="LAYOUT_UPDATED"&&(this.initData(),window.dispatchEvent(new CustomEvent("orva:layout-updated")))}),window.addEventListener("storage",e=>{e.key===r&&(this.initData(),window.dispatchEvent(new CustomEvent("orva:layout-updated")))})}catch(e){console.warn("[MockLayoutRepository] Cross-tab sync warning:",e)}}async getLayoutConfig(e="global_default"){let t=e||"global_default";if(this.configs.has(t))return JSON.parse(JSON.stringify(this.configs.get(t)));if(this.configs.has("global_default")){let e=JSON.parse(JSON.stringify(this.configs.get("global_default")));return e.productId=t,e}let a=s(t);return this.configs.set(t,a),this.persist(),JSON.parse(JSON.stringify(a))}async saveLayoutConfig(e){let t=e.productId||"global_default",a={...e,productId:t,updatedAt:new Date().toISOString()};return this.configs.set(t,a),this.persist(),JSON.parse(JSON.stringify(a))}async resetLayoutConfig(e="global_default"){let t=e||"global_default";return this.configs.delete(t),this.persist(),this.getLayoutConfig(t)}async restoreDefaultLayout(e="global_default"){let t=e||"global_default",a=s(t);return this.configs.set(t,a),this.persist(),JSON.parse(JSON.stringify(a))}async hasUnsavedChanges(e,t){return JSON.stringify(e)!==JSON.stringify(t)}}let l=null;function n(){return l||(l=new o),l}e.s(["getMockLayoutRepository",0,n],62081);var d=e.i(8096);function p(e){return null==e?"":String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}function c(e,t=""){if(!e||"string"!=typeof e)return t;let a=e.trim();return/^(?:https?:\/\/|\/|[a-zA-Z0-9_.\-\/ ]+\.(?:webp|jpg|jpeg|png|svg)|data:image\/(?:png|jpeg|webp|svg\+xml);base64,)/i.test(a)?a:t}function u(e){let t=Math.round(Number(e)||0);return`${t.toLocaleString("en-US")} د.ج`}function g(e){let{layoutConfig:t,storePage:a,baseAssetPath:i="/",isProduction:s=!1}=e,r=i.endsWith("/")?i:`${i}/`,o="purchaseCost"in e.product?(0,d.toPublicProductDTO)(e.product):e.product,l=p(o.title||a.title||"عرض خاص — ORVA Store"),n=p(o.subtitle||"عرض الصيانة والخدمة المتكامل مع التوصيل السريع"),g=p(o.description||""),f=p(o.sku||"ORVA-PACK"),h=Math.max(0,Number(o.sellingPrice)||4950),m=Math.round(1.85*h),y="pack 1 4950/pack1 4950.webp";f.includes("P2")&&(y="pack2 12950/pack2 12950.webp");let b=o.images?.[0],x=b&&"/placeholder.svg"!==b?c(b,y):y,v=(o.images||[]).slice(1).filter(e=>e&&"/placeholder.svg"!==e).map(e=>c(e)).filter(Boolean),w=t.desktopSectionOrder.map(e=>{switch(e){case"title":return`
    <div class="product-title-block" style="margin-bottom:16px;">
        <span class="pack-badge-simple">${n}</span>
        <h1 class="hero-main-title" style="margin-top:8px; font-size:24px; font-weight:800; color:#fff;">${l}</h1>
        <div class="price-display-banner" style="margin-top:10px; display:flex; align-items:baseline; gap:12px;">
            <span class="price-num" style="font-size:26px; font-weight:800; color:#d4a373;">${u(h)}</span>
            <span class="price-old" style="font-size:15px; color:#888; text-decoration:line-through;">${u(m)}</span>
            <span style="font-size:11px; padding:2px 6px; border-radius:4px; background:#38271d; color:#e09f67; font-weight:700;">توفير كبير</span>
        </div>
    </div>`;case"subtitle":case"features":default:return"";case"gallery":return`
    <div class="product-gallery-card" style="margin-bottom:20px;">
        <div class="main-image-container" style="border-radius:12px; overflow:hidden; background:#1c1917; text-align:center; padding:10px; border:1px solid #2e2a27;">
            <img src="${x.startsWith("/")?x:r+x}" alt="${l}" style="max-width:100%; height:auto; border-radius:8px; display:inline-block;" loading="eager">
        </div>
        ${v.length>0?`
        <div class="thumbnails-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(64px, 1fr)); gap:8px; margin-top:10px;">
            ${v.map(e=>`
                <img src="${e.startsWith("/")?e:r+e}" alt="${l}" style="width:100%; border-radius:6px; border:1px solid #332f2c;" loading="lazy">
            `).join("")}
        </div>`:""}
    </div>`;case"orderForm":return`
    <div class="order-form-container" id="order-form" style="background:#161412; border:1px solid #2e2a27; border-radius:12px; padding:20px; direction:rtl;">
        <div class="order-form-heading" style="margin-bottom:14px; border-bottom:1px solid #2e2a27; pb-3;">
            <h2 style="font-size:18px; font-weight:700; color:#fff; margin:0; display:flex; align-items:center; gap:8px;">
                <i class="fa-solid fa-cart-shopping" style="color:#d4a373;"></i>
                <span>إستمارة تأكيد الطلب السريع (الدفع عند الاستلام)</span>
            </h2>
        </div>

        <form id="orderForm">
            <!-- Anti-spam Honeypot -->
            <input type="text" id="website_url" name="website_url" style="display:none;" tabindex="-1" autocomplete="off">
            <input type="hidden" name="productId" value="${p(o.id)}">
            <input type="hidden" name="productSku" value="${f}">
            <input type="hidden" name="packPrice" value="${h}">

            <!-- Full Name Field -->
            <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label" for="fullName" style="display:block; font-size:13px; font-weight:600; margin-bottom:4px; color:#eae6e1;">الاسم واللقب الكريم <span class="req" style="color:#e63946;">*</span></label>
                <input type="text" id="fullName" class="form-input" placeholder="اكتب اسمك ولقبك هنا" required style="width:100%; padding:10px 12px; border-radius:6px; border:1px solid #332f2c; background:#1c1917; color:#fff; box-sizing:border-box;">
            </div>

            <!-- Phone Number Field -->
            <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label" for="phoneNumber" style="display:block; font-size:13px; font-weight:600; margin-bottom:4px; color:#eae6e1;">رقم الهاتف للتواصل <span class="req" style="color:#e63946;">*</span></label>
                <input type="tel" id="phoneNumber" class="form-input" placeholder="05 / 06 / 07 XX XX XX XX" dir="ltr" style="width:100%; padding:10px 12px; border-radius:6px; border:1px solid #332f2c; background:#1c1917; color:#fff; text-align:right; box-sizing:border-box;" required>
            </div>

            <!-- Wilaya Field (58 Wilayas) -->
            <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label" for="wilayaSelect" style="display:block; font-size:13px; font-weight:600; margin-bottom:4px; color:#eae6e1;">الولاية (58 ولاية) <span class="req" style="color:#e63946;">*</span></label>
                <select id="wilayaSelect" class="form-select" required style="width:100%; padding:10px 12px; border-radius:6px; border:1px solid #332f2c; background:#1c1917; color:#fff; box-sizing:border-box;">
                    <option value="" disabled selected>-- اختر ولايتك من القائمة (58 ولاية) --</option>
                </select>
            </div>

            <!-- Commune / City Field (Dynamic) -->
            <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label" for="communeSelect" style="display:block; font-size:13px; font-weight:600; margin-bottom:4px; color:#eae6e1;">البلدية أو المدينة <span class="req" style="color:#e63946;">*</span></label>
                <select id="communeSelect" class="form-select" required style="width:100%; padding:10px 12px; border-radius:6px; border:1px solid #332f2c; background:#1c1917; color:#fff; box-sizing:border-box;">
                    <option value="" disabled selected>-- اختر البلدية / الدائرة --</option>
                </select>
            </div>

            <!-- Delivery Place Options -->
            <div class="form-group" style="margin-bottom:14px;">
                <label class="form-label" style="display:block; font-size:13px; font-weight:600; margin-bottom:6px; color:#eae6e1;">أين تفضل استلام طلبيتك؟ <span class="req" style="color:#e63946;">*</span></label>
                <div class="delivery-options-row" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <label class="delivery-choice-card active" id="homeChoice" style="display:flex; align-items:flex-start; gap:8px; padding:10px; border-radius:6px; border:1px solid #d4a373; background:#221d19; cursor:pointer;">
                        <input type="radio" name="deliveryChoice" value="home" checked style="margin-top:3px;">
                        <div>
                            <div class="choice-title" style="font-size:13px; font-weight:700; color:#fff;">توصيل لباب المنزل</div>
                            <div class="choice-desc" style="font-size:11px; color:#aaa;">يسلمك الموزع السلعة في عنوانك</div>
                        </div>
                    </label>

                    <label class="delivery-choice-card" id="deskChoice" style="display:flex; align-items:flex-start; gap:8px; padding:10px; border-radius:6px; border:1px solid #332f2c; background:#191715; cursor:pointer;">
                        <input type="radio" name="deliveryChoice" value="stopdesk" style="margin-top:3px;">
                        <div>
                            <div class="choice-title" style="font-size:13px; font-weight:700; color:#fff;">استلام من المكتب</div>
                            <div class="choice-desc" style="font-size:11px; color:#aaa;">تستلم من أقرب مكتب شحن</div>
                        </div>
                    </label>
                </div>
            </div>

            <!-- Simple Price Summary -->
            <div class="simple-price-summary" style="background:#1f1c19; padding:14px; border-radius:8px; border:1px solid #383431; margin-bottom:16px;">
                <div class="summary-line" style="display:flex; justify-content:space-between; font-size:13px; color:#c7c1ba; margin-bottom:6px;">
                    <span>سعر الباقة:</span>
                    <strong style="color:#fff;">${u(h)}</strong>
                </div>
                <div class="summary-line" style="display:flex; justify-content:space-between; font-size:13px; color:#c7c1ba; margin-bottom:8px;">
                    <span>مصاريف التوصيل:</span>
                    <strong id="shippingAmount" style="color:#fff;">500 د.ج</strong>
                </div>
                <div class="summary-divider" style="height:1px; background:#443e39; margin-bottom:8px;"></div>
                <div class="summary-total-line" style="display:flex; justify-content:space-between; font-size:16px; font-weight:800; color:#d4a373;">
                    <span>المبلغ الصافي المطلوب عند الاستلام:</span>
                    <span class="total-num" id="totalAmount">${u(h+500)}</span>
                </div>
            </div>

            <!-- Primary Calming Order Button -->
            <button type="submit" class="order-submit-btn" id="confirmOrderBtn" style="width:100%; padding:14px; font-size:16px; font-weight:700; background:linear-gradient(135deg, #d4a373, #b8860b); color:#12100e; border:none; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
                <i class="fa-solid fa-circle-check"></i>
                <span>اضغط هنا لتأكيد طلبك الآن</span>
            </button>
        </form>
    </div>`;case"description":return t.showDescription?`
    <div class="product-description-card" style="background:#161412; padding:18px; border-radius:10px; border:1px solid #2e2a27; margin-top:16px;">
        <h3 style="font-size:16px; font-weight:700; margin-bottom:8px; color:#fff;">تفاصيل العرض والمحتوى</h3>
        <p style="font-size:14px; line-height:1.7; color:#d1ccc6; margin:0;">${g||n}</p>
    </div>`:"";case"benefits":return t.showBenefits?`
    <div class="guarantee-list-section" style="margin-top:20px;">
        <div class="guarantee-simple-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px;">
            <div class="guarantee-card" style="background:#191715; border:1px solid #2e2a27; border-radius:8px; padding:12px; display:flex; gap:10px; align-items:center;">
                <i class="fa-solid fa-box-open" style="font-size:22px; color:#d4a373;"></i>
                <div>
                    <h4 style="font-size:13px; font-weight:700; margin:0; color:#fff;">حق المعاينة والتجربة</h4>
                    <p style="font-size:11px; color:#aaa; margin:2px 0 0;">افتح طردك وعاين سلعتك قبل تسليم المبلغ للموزع.</p>
                </div>
            </div>
            <div class="guarantee-card" style="background:#191715; border:1px solid #2e2a27; border-radius:8px; padding:12px; display:flex; gap:10px; align-items:center;">
                <i class="fa-solid fa-truck-fast" style="font-size:22px; color:#d4a373;"></i>
                <div>
                    <h4 style="font-size:13px; font-weight:700; margin:0; color:#fff;">توصيل سريع وآمن</h4>
                    <p style="font-size:11px; color:#aaa; margin:2px 0 0;">شحن مؤمن خلال 24 - 48 ساعة لكافة الولايات.</p>
                </div>
            </div>
            <div class="guarantee-card" style="background:#191715; border:1px solid #2e2a27; border-radius:8px; padding:12px; display:flex; gap:10px; align-items:center;">
                <i class="fa-solid fa-rotate-left" style="font-size:22px; color:#d4a373;"></i>
                <div>
                    <h4 style="font-size:13px; font-weight:700; margin:0; color:#fff;">ضمان الاستبدال الفوري</h4>
                    <p style="font-size:11px; color:#aaa; margin:2px 0 0;">خدمة ما بعد البيع ومرافقة هاتفية مستمرة.</p>
                </div>
            </div>
        </div>
    </div>`:"";case"relatedProducts":return t.showRelatedProducts?`
    <div class="cross-sell-section" style="margin-top:24px; padding:16px; border-radius:10px; background:#1b1816; border:1px solid #332f2c;">
        <span style="display:inline-block; font-size:11px; font-weight:700; color:#d4a373; text-transform:uppercase;">عروض أخرى متوفرة في المتجر</span>
        <h3 style="font-size:15px; font-weight:700; margin:4px 0 10px; color:#fff;">شاهد باقة المحترفين البديلة</h3>
        <p style="font-size:12px; color:#bbb; margin-bottom:12px;">نوفر باقات صيانة إضافية تناسب الورشات والأعمال المنزلية الشاقة.</p>
        <a href="${r}pack2.html" style="display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:#d4a373; text-decoration:none;">
            <span>معاينة العرض الثاني</span>
            <i class="fa-solid fa-arrow-left"></i>
        </a>
    </div>`:""}}).filter(Boolean).join("\n"),k=a.slug.replace(/^products\//,"").replace(/\.html$/,""),S=s?a.publicUrl?a.publicUrl.replace(/\.html$/,""):`/products/${k}`:"";return`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="${s?"index, follow":"noindex, nofollow"}">
    <title>${l} — ${u(h)}</title>
    <meta name="description" content="${p(a.metaDescription||n)}">
    ${s&&S?`<link rel="canonical" href="https://orva-store.com${S}">`:""}

    <!-- Generator Metadata (Phase 8B Lifecycle Model) -->
    <!-- Template: ${p(a.templateId)} v${p(a.templateVersion)} -->
    <!-- Product SKU: ${f} | Status: ${p(s?"published":a.status)} -->
    <!-- Generated: ${p(a.lastGeneratedAt||new Date().toISOString())} -->

    <!-- Google Font: Tajawal (High Legibility) -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;600;700;800&display=swap" rel="stylesheet">

    <!-- FontAwesome 6.5.1 -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">

    <!-- Storefront Core Stylesheet -->
    <link rel="stylesheet" href="/packs-styles.css">
</head>
<body style="font-family:'Tajawal', sans-serif; background-color:#12100e; color:#eae6e1; margin:0; padding:0;">

    <!-- Top Reassurance Bar -->
    <div class="top-notice-bar" style="background:#1c1916; color:#d4a373; text-align:center; padding:8px 12px; font-size:12px; font-weight:600; border-bottom:1px solid #2e2a27;">
        <i class="fa-solid fa-truck-fast" style="margin-left:6px;"></i>
        <span>التوصيل متوفر لجميع الولايات مع حق المعاينة قبل الدفع.</span>
    </div>

    <!-- Minimal Header -->
    <header class="site-header" style="background:#161412; border-bottom:1px solid #2e2a27; padding:14px 20px;">
        <div class="container" style="max-width:1100px; margin:0 auto; display:flex; justify-content:space-between; align-items:center;">
            <a href="/" style="font-weight:900; font-size:18px; color:#fff; text-decoration:none; display:flex; align-items:center; gap:6px;">
                <span style="color:#d4a373;">ORVA</span> STORE
            </a>
            ${s?`
            <div class="header-phone-badge" style="font-size:12px; color:#d4a373; display:flex; align-items:center; gap:6px;">
                <i class="fa-solid fa-phone"></i>
                <span style="color:#eae6e1;">خدمة الزبائن: 0798282495</span>
            </div>`:`
            <span style="font-size:11px; padding:3px 8px; border-radius:4px; background:#292522; color:#b8b0a8;">
                معاينة خاصة بالمنتج (Preview)
            </span>`}
        </div>
    </header>

    <!-- Main Content Container -->
    <main class="main-content" style="max-width:1100px; margin:20px auto; padding:0 16px;">
        <div class="main-layout-${"split"===t.desktopLayoutMode?"split":"stacked"}" style="display:grid; grid-template-columns:${"split"===t.desktopLayoutMode?"repeat(auto-fit, minmax(320px, 1fr))":"1fr"}; gap:24px;">
            ${w}
        </div>
    </main>

    <!-- Site Footer -->
    <footer class="site-footer" style="background:#161412; border-top:1px solid #2e2a27; padding:24px 16px; margin-top:40px; text-align:center;">
        <div style="max-width:800px; margin:0 auto;">
            <div style="font-size:18px; font-weight:700; color:#fff; margin-bottom:6px;">ORVA Store DZ</div>
            <p style="font-size:12px; color:#888; margin:0;">نوفر لكم أفضل العروض الأصلية مع الضمان التام وحق المعاينة عند الاستلام.</p>
            <p style="font-size:11px; color:#555; margin-top:8px;">جميع الحقوق محفوظة \xa9 2026 ORVA Store DZ</p>
        </div>
    </footer>

    <!-- Storefront Client Scripts -->
    <script src="/algeria-communes.js"></script>
    <script src="/packs-client.js"></script>
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            if (typeof initPackForm === 'function') {
                initPackForm({
                    packId: '${f}',
                    packPrice: ${h},
                    productName: '${l}'
                });
            }
        });
    </script>
</body>
</html>`}let f=[{pageId:"page_pack_1_pro",productId:"prod_pack_1_pro",productSku:"ORVA-P1-PRO",slug:"pack1",title:"عرض 4 في 1 (منفاخ TOYOTA وطقم مفاتيح) — PACK 4EN1",templateId:"orva-calm-night-light",templateVersion:"1.0.0",status:"published",publicUrl:"/pack1.html",previewPath:"/data/preview/products/page_pack_1_pro.html",metaDescription:"باك الخدمة والصيانة 4 في 1 للسيارة والمنزل: منفاخ عجلات TOYOTA، طقم مفاتيح 46 قطعة، مفك مرن 11 قطعة، وطقم 6 مفكات مع التوصيل والدفع عند الاستلام.",lastGeneratedAt:"2026-10-31T06:00:00Z",createdAt:"2026-10-25T10:00:00Z",updatedAt:"2026-10-31T06:00:00Z"},{pageId:"page_pack_2_elite",productId:"prod_pack_2_elite",productSku:"ORVA-P2-ELITE",slug:"pack2",title:"عرض 5 في 1 الفاخر (ماكينة CROWN 20V والملحقات) — PACK 5EN1",templateId:"orva-calm-night-light",templateVersion:"1.0.0",status:"published",publicUrl:"/pack2.html",previewPath:"/data/preview/products/page_pack_2_elite.html",metaDescription:"عرض 5 في 1 الفاخر: ماكينة ثقب CROWN 20V ببطاريتين، طقم مفكات 6 قطع، علبة مفاتيح 46 قطعة، مفك مرن وقفازات مع التوصيل السريع.",lastGeneratedAt:"2026-10-31T06:00:00Z",createdAt:"2026-10-26T12:00:00Z",updatedAt:"2026-10-31T06:00:00Z"},{pageId:"page_sac_yamaha",productId:"prod_sac_yamaha",productSku:"ORVA-SAC-YAM",slug:"yamaha",title:"حقيبة موطو ياماها الفاخرة — Yamaha Archive Edition",templateId:"orva-calm-night-light",templateVersion:"1.0.0",status:"published",publicUrl:"/yamaha-archive.html",previewPath:"/data/preview/products/page_sac_yamaha.html",metaDescription:"حقيبة موطو ياماha الأصلية المقاومة للماء والصدمات لسائقي الدراجات النارية والرحلات اليومية.",lastGeneratedAt:"2026-10-31T06:00:00Z",createdAt:"2026-10-20T08:00:00Z",updatedAt:"2026-10-31T06:00:00Z"},{pageId:"page_pack_3_ultra",productId:"prod_pack_3_ultra",productSku:"ORVA-P3-ULTRA",slug:"products/pack-3-ultra",title:"عرض 6 في 1 المتميز للورشات — PACK 6EN1 ULTRA",templateId:"orva-calm-night-light",templateVersion:"1.0.0",status:"preview_ready",publicUrl:null,previewPath:"/data/preview/products/page_pack_3_ultra.html",metaDescription:"عرض 6 في 1 المتميز للورشات الكبرى مع معدات صيانة كهربائية وميكانيكية عالية الجودة.",lastGeneratedAt:"2026-10-31T06:00:00Z",createdAt:"2026-10-29T14:00:00Z",updatedAt:"2026-10-31T06:00:00Z"},{pageId:"page_sac_bundle",productId:"prod_sac_bundle",productSku:"ORVA-SAC-BUNDLE",slug:"products/sac-bundle",title:"حقيبة موطو ياماها + هدايا مجانية ترويجية",templateId:"orva-calm-night-light",templateVersion:"1.0.0",status:"preview_ready",publicUrl:null,previewPath:"/data/preview/products/page_sac_bundle.html",metaDescription:"باقة حقيبة ياماها الخاصة مع هدايا استثنائية وقفازات إضافية لفترة محدودة.",lastGeneratedAt:"2026-10-31T06:00:00Z",createdAt:"2026-10-29T14:30:00Z",updatedAt:"2026-10-31T06:00:00Z"}],h="orva_store_pages_v8a";async function m(e){try{let t=await fetch("/api/publish-page",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(e)});if(t.ok)return await t.json()}catch(e){}return null}class y{pages=[];constructor(){this.loadState()}loadState(){try{let e=localStorage.getItem(h);if(e){let t=JSON.parse(e);if(Array.isArray(t)&&t.length>0){this.pages=t;return}}}catch(e){}this.pages=JSON.parse(JSON.stringify(f))}persistState(){try{localStorage.setItem(h,JSON.stringify(this.pages))}catch(e){}}async getPages(){return JSON.parse(JSON.stringify(this.pages))}async getPageById(e){let t=this.pages.find(t=>t.pageId===e);return t?JSON.parse(JSON.stringify(t)):null}async getPageByProductId(e){let t=this.pages.find(t=>t.productId===e);return t?JSON.parse(JSON.stringify(t)):null}async createPage(e){let t=new Date().toISOString(),a={...e,status:"published"!==e.status||e.publicUrl?e.status:"preview_ready",publicUrl:"published"===e.status?e.publicUrl:null,createdAt:t,updatedAt:t};return this.pages.push(a),this.persistState(),JSON.parse(JSON.stringify(a))}async updatePage(e,t){let a=this.pages.findIndex(t=>t.pageId===e);if(-1===a)throw Error(`صفحة المتجر غير موجودة: ${e}`);let i=this.pages[a],s=t.status||i.status,r=new Date().toISOString(),o={...i,...t,status:s,publicUrl:"published"===s?t.publicUrl??i.publicUrl:null,updatedAt:r};return this.pages[a]=o,this.persistState(),JSON.parse(JSON.stringify(o))}async generatePreviewHtml(e){let a=await this.getPageById(e);if(!a)throw Error(`صفحة غير موجودة: ${e}`);let i=(0,t.getMockProductsRepository)(),s=await i.getProductById(a.productId);if(!s)throw Error(`المنتج المرتبط بالصفحة غير موجود: ${a.productId}`);let r=n(),o=await r.getLayoutConfig(s.id),l=g({product:s,layoutConfig:o,storePage:a,baseAssetPath:"/",isProduction:!1});return await m({action:"preview",pageId:a.pageId,slug:a.slug,html:l}),await this.updatePage(e,{lastGeneratedAt:new Date().toISOString()}),l}async publishPage(e){let a=await this.getPageById(e);if(!a)throw Error(`صفحة غير موجودة: ${e}`);let i=(0,t.getMockProductsRepository)(),s=await i.getProductById(a.productId);if(!s)throw Error(`المنتج المرتبط بالصفحة غير موجود: ${a.productId}`);let r=n(),o=await r.getLayoutConfig(s.id),l=a.slug.replace(/^products\//,"").replace(/\.html$/,""),d=a.publicUrl||`/products/${l}.html`,p=g({product:s,layoutConfig:o,storePage:{...a,status:"published",publicUrl:d},baseAssetPath:"/",isProduction:!0});await m({action:"publish",pageId:a.pageId,slug:l,html:p});let c=new Date().toISOString();return this.updatePage(e,{status:"published",publicUrl:d,lastGeneratedAt:c,updatedAt:c})}async unpublishPage(e){let t=await this.getPageById(e);if(!t)throw Error(`صفحة غير موجودة: ${e}`);let a=t.slug.replace(/^products\//,"").replace(/\.html$/,"");return await m({action:"unpublish",pageId:t.pageId,slug:a}),this.updatePage(e,{status:"preview_ready",publicUrl:null,updatedAt:new Date().toISOString()})}async archivePage(e){let t=await this.getPageById(e);if(t){let e=t.slug.replace(/^products\//,"").replace(/\.html$/,"");await m({action:"archive",pageId:t.pageId,slug:e})}return this.updatePage(e,{status:"archived",publicUrl:null,updatedAt:new Date().toISOString()})}async syncWithProduct(e){let a=(0,t.getMockProductsRepository)(),i=await a.getProductById(e);if(!i)return{page:null,actionTaken:"no_change",message:`المنتج غير موجود: ${e}`};let s=this.pages.find(t=>t.productId===e);return s?"archived"===i.status&&"archived"!==s.status?{page:await this.archivePage(s.pageId),actionTaken:"archived",message:`تم أرشفة صفحة المتجر تلقائياً تماشياً مع أرشفة المنتج (${i.sku}).`}:{page:await this.updatePage(s.pageId,{title:i.title,metaDescription:i.description.slice(0,160),productSku:i.sku}),actionTaken:"updated",message:`تمت مزامنة بيانات الصفحة مع المنتج (${i.sku}) بنجاح.`}:{page:await this.createPage({pageId:`page_${i.sku.toLowerCase().replace(/[^a-z0-9]/g,"_")}`,productId:i.id,productSku:i.sku,slug:`products/${i.sku.toLowerCase()}`,title:i.title,templateId:"orva-calm-night-light",templateVersion:"1.0.0",status:"archived"===i.status?"archived":"preview_ready",publicUrl:null,previewPath:`/data/preview/products/page_${i.id}.html`,metaDescription:i.description.slice(0,160),lastGeneratedAt:new Date().toISOString()}),actionTaken:"created",message:`تم إنشاء صفحة معاينة جديدة للمنتج (${i.sku}).`}}async getSitemapEntries(){return this.pages.map(e=>{let t="published"===e.status&&!!e.publicUrl;return{url:t?e.publicUrl:e.previewPath,status:e.status,productId:e.productId,productSku:e.productSku,title:e.title,lastModified:e.updatedAt,changeFrequency:t?"daily":"monthly",priority:t?1:.3,isPublicIndexable:t}})}}let b=null;e.s(["getMockStorePagesRepository",0,function(){return b||(b=new y),b}],3805)}]);