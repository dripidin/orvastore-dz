(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,174210,e=>{"use strict";var t=e.i(438232),s=e.i(917870),a=e.i(144918);e.s(["useAriaLabelledBy",0,function(e,i,r,o=!0,d){let[n,l]=t.useState(),c=(0,a.useBaseUiId)(d?`${d}-label`:void 0),p=e??i??n;return(0,s.useIsoLayoutEffect)(()=>{let t=e||i||!o?void 0:function(e,t){let s=function(e){if(!e)return;let t=e.parentElement;if(t&&"LABEL"===t.tagName)return t;let s=e.id;if(s){let t=e.nextElementSibling;if(t&&t.htmlFor===s)return t}let a=e.labels;return a&&a[0]}(e);if(s)return!s.id&&t&&(s.id=t),s.id||void 0}(r.current,c);n!==t&&l(t)}),p}])},813483,e=>{"use strict";let t=(0,e.i(927201).default)("arrow-left",[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]);e.s(["ArrowLeft",0,t],813483)},979577,e=>{"use strict";let t=(0,e.i(927201).default)("eye",[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]);e.s(["Eye",0,t],979577)},79032,e=>{"use strict";let t=(0,e.i(927201).default)("phone",[["path",{d:"M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384",key:"9njp5v"}]]);e.s(["Phone",0,t],79032)},602476,e=>{"use strict";let t=(0,e.i(927201).default)("save",[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]]);e.s(["Save",0,t],602476)},595449,e=>{"use strict";let t="orva_visitor_analytics_v1";class s{events=[];sessions=new Map;eventIdsSet=new Set;broadcastChannel=null;nowProvider;constructor(e){this.nowProvider=e||(()=>Date.now()),this.initData(),this.setupCrossTabSync()}setNowProvider(e){this.nowProvider=e}getCurrentTime(){return this.nowProvider()}initData(){try{let e=window.localStorage.getItem(t);if(e){let t=JSON.parse(e);Array.isArray(t.events)&&(this.events=t.events,this.eventIdsSet=new Set(this.events.map(e=>e.id))),Array.isArray(t.sessions)&&(this.sessions=new Map(t.sessions.map(e=>[e.sessionId,e])))}}catch{}}loadSeedEvents(e){for(let t of e){if(this.eventIdsSet.has(t.id))continue;this.eventIdsSet.add(t.id),this.events.push(t);let e=t.pseudonymousSessionId,s=t.productId||"unknown",a=this.sessions.get(e);a||(a={sessionId:e,startedAt:t.timestamp,lastActivityAt:t.timestamp,currentProductId:s,sessionDurationSeconds:0,hasPurchased:!1,orderIds:[],purchasedProductIds:[],referrerCategory:"direct",viewedProductIds:[],startedCheckout:!1,isSynthetic:!0},this.sessions.set(e,a)),a.orderIds||(a.orderIds=[]),a.purchasedProductIds||(a.purchasedProductIds=[]),a.viewedProductIds||(a.viewedProductIds=[]),"number"==typeof t.sessionDurationSeconds&&t.sessionDurationSeconds>=0&&(a.sessionDurationSeconds=Math.max(a.sessionDurationSeconds,t.sessionDurationSeconds)),a.lastActivityAt=t.timestamp,"product_view"!==t.eventType||a.viewedProductIds.includes(s)||a.viewedProductIds.push(s),"checkout_started"===t.eventType&&(a.startedCheckout=!0),"order_created"===t.eventType&&(a.hasPurchased=!0,t.orderId&&!a.orderIds.includes(t.orderId)&&(a.orderIds.push(t.orderId),a.orderId=t.orderId),a.purchasedProductIds.includes(s)||a.purchasedProductIds.push(s),t.selectedWilaya&&(a.selectedWilaya=t.selectedWilaya))}}persist(){try{let e={events:this.events,sessions:Array.from(this.sessions.values()),updatedAt:new Date(this.getCurrentTime()).toISOString()};window.localStorage.setItem(t,JSON.stringify(e)),this.broadcastChannel?.postMessage({type:"ANALYTICS_UPDATED",timestamp:this.getCurrentTime()}),window.dispatchEvent(new CustomEvent("orva:analytics-updated"))}catch(e){console.warn("[MockVisitorAnalyticsRepository] Failed to persist analytics",e)}}setupCrossTabSync(){try{"u">typeof BroadcastChannel&&(this.broadcastChannel=new BroadcastChannel("orva_visitor_analytics_sync_v1"),this.broadcastChannel.onmessage=e=>{e.data?.type==="ANALYTICS_UPDATED"&&(this.initData(),window.dispatchEvent(new CustomEvent("orva:analytics-updated")))}),window.addEventListener("storage",e=>{e.key===t&&(this.initData(),window.dispatchEvent(new CustomEvent("orva:analytics-updated")))})}catch(e){console.warn("[MockVisitorAnalyticsRepository] Cross-tab sync warning:",e)}}async trackEvent(e){let t=new Date(this.getCurrentTime()).toISOString(),s=e.id||`evt_${this.getCurrentTime()}_${Math.random().toString(36).substring(2,8)}`;if(this.eventIdsSet.has(s)){let e=this.events.find(e=>e.id===s);if(e)return{...e}}let a=e.pseudonymousSessionId,i=e.productId||"unknown",r=this.sessions.get(a);r||(r={sessionId:a,startedAt:e.timestamp||t,lastActivityAt:t,currentProductId:i,sessionDurationSeconds:0,hasPurchased:!1,orderIds:[],purchasedProductIds:[],referrerCategory:"direct",viewedProductIds:[],startedCheckout:!1,isSynthetic:e.isSynthetic||!1},this.sessions.set(a,r)),r.orderIds||(r.orderIds=[]),r.purchasedProductIds||(r.purchasedProductIds=[]),r.viewedProductIds||(r.viewedProductIds=[]);let o=Math.max(0,Math.floor(((e.timestamp?new Date(e.timestamp).getTime():this.getCurrentTime())-new Date(r.startedAt).getTime())/1e3));if(r.sessionDurationSeconds=Math.max(r.sessionDurationSeconds,"number"==typeof e.sessionDurationSeconds&&e.sessionDurationSeconds>=0?e.sessionDurationSeconds:o),r.lastActivityAt=e.timestamp||t,r.currentProductId=i,"product_view"===e.eventType&&(r.viewedProductIds.includes(i)||r.viewedProductIds.push(i)),"checkout_started"===e.eventType&&(r.startedCheckout=!0),"order_created"===e.eventType){for(let t of(r.hasPurchased=!0,e.orderId&&(r.orderId=e.orderId,r.orderIds.includes(e.orderId)||r.orderIds.push(e.orderId)),e.productIds&&e.productIds.length>0?e.productIds:i&&"unknown"!==i?[i]:[]))r.purchasedProductIds.includes(t)||r.purchasedProductIds.push(t);e.selectedWilaya&&(r.selectedWilaya=e.selectedWilaya)}e.selectedWilaya&&!r.selectedWilaya&&(r.selectedWilaya=e.selectedWilaya);let d={id:s,pseudonymousSessionId:a,eventType:e.eventType,productId:i,productIds:e.productIds,timestamp:e.timestamp||t,sessionDurationSeconds:r.sessionDurationSeconds,selectedWilaya:e.selectedWilaya||r.selectedWilaya,orderId:e.orderId||r.orderId,isSynthetic:e.isSynthetic||!1,metadata:e.metadata};return this.events.push(d),this.eventIdsSet.add(s),this.persist(),{...d}}async getEvents(e){let t=[...this.events];return e?.productId&&(t=t.filter(t=>t.productId===e.productId||t.productIds&&t.productIds.includes(e.productId))),e?.eventType&&(t=t.filter(t=>t.eventType===e.eventType)),t}async getSessions(e){let t=Array.from(this.sessions.values());return e?.productId&&(t=t.filter(t=>t.viewedProductIds.includes(e.productId)||t.purchasedProductIds.includes(e.productId)||t.currentProductId===e.productId)),JSON.parse(JSON.stringify(t))}async getTimeToPurchaseMetrics(e){let t=Array.from(this.sessions.values()).filter(e=>e.hasPurchased),s=[],a={under1Min:0,from1To5Min:0,from5To15Min:0,from15To30Min:0,over30Min:0};for(let a of t)if(e){if(!(a.purchasedProductIds.includes(e)||a.currentProductId===e&&0===a.purchasedProductIds.length))continue;let t=this.events.filter(t=>t.pseudonymousSessionId===a.sessionId&&"product_view"===t.eventType&&t.productId===e);if(0===t.length)continue;let i=this.events.filter(t=>t.pseudonymousSessionId===a.sessionId&&"order_created"===t.eventType&&(t.productId===e||t.productIds&&t.productIds.includes(e))),r=i.length>0?i[0].timestamp:null;if(!r)continue;let o=new Date(t[0].timestamp).getTime(),d=Math.floor((new Date(r).getTime()-o)/1e3);Number.isFinite(d)&&d>=0&&s.push(d)}else for(let e of a.purchasedProductIds.length>0?a.purchasedProductIds:a.currentProductId?[a.currentProductId]:[]){let t=this.events.filter(t=>t.pseudonymousSessionId===a.sessionId&&"product_view"===t.eventType&&t.productId===e);if(0===t.length)continue;let i=this.events.filter(t=>t.pseudonymousSessionId===a.sessionId&&"order_created"===t.eventType&&(t.productId===e||t.productIds&&t.productIds.includes(e))),r=i.length>0?i[0].timestamp:null;if(!r)continue;let o=new Date(t[0].timestamp).getTime(),d=Math.floor((new Date(r).getTime()-o)/1e3);Number.isFinite(d)&&d>=0&&s.push(d)}for(let e of s)e<60?a.under1Min++:e<300?a.from1To5Min++:e<900?a.from5To15Min++:e<1800?a.from15To30Min++:a.over30Min++;if(0===s.length)return{totalPurchasingSessions:0,averageTimeToPurchaseSeconds:0,medianTimeToPurchaseSeconds:0,buckets:a};let i=Math.round(s.reduce((e,t)=>e+t,0)/s.length);s.sort((e,t)=>e-t);let r=Math.floor(s.length/2),o=s.length%2!=0?s[r]:Math.round((s[r-1]+s[r])/2);return{totalPurchasingSessions:s.length,averageTimeToPurchaseSeconds:i,medianTimeToPurchaseSeconds:o,buckets:a}}async getExitMetrics(e){let t=Array.from(this.sessions.values()).filter(t=>!e||t.viewedProductIds.includes(e)||t.purchasedProductIds.includes(e)||t.currentProductId===e),s=t.length,a=t.filter(e=>!e.hasPurchased&&e.sessionDurationSeconds>=60).length,i=s>0?Math.round(a/s*1e3)/10:0;return{totalSessions:s,sessionsInactive60sWithoutPurchase:a,inactivityRatePercentage:i,isEstimated:!0,exitedAfterOneMinuteCount:a,exitRatePercentage:i}}async getProductConversionMetrics(e){let t=Array.from(this.sessions.values());if(e){let s=t.filter(t=>t.viewedProductIds.includes(e)||t.purchasedProductIds.includes(e)||t.currentProductId===e),a=s.length,i=t.filter(t=>t.viewedProductIds.includes(e)).length,r=s.filter(t=>t.startedCheckout&&(t.viewedProductIds.includes(e)||t.currentProductId===e)).length,o=t.filter(t=>t.hasPurchased&&t.viewedProductIds.includes(e)&&t.purchasedProductIds.includes(e)).length,d=t.filter(t=>t.hasPurchased&&!t.viewedProductIds.includes(e)&&t.purchasedProductIds.includes(e)).length,n=new Set,l=0;for(let s of t)if(s.hasPurchased&&s.purchasedProductIds.includes(e))if(s.orderIds&&s.orderIds.length>0)for(let e of s.orderIds)n.add(e);else s.orderId?n.add(s.orderId):l++;let c=n.size+l,p=i>0?Math.round(o/i*1e3)/10:0,u=r>0?Math.round(c/r*1e3)/10:0;return{totalSessions:a,uniqueProductViews:i,uniqueProductSessions:i,checkoutStarts:r,ordersCreated:c,uniqueOrdersCount:c,purchasingSessions:o+d,attributedPurchasingSessions:o,unattributedPurchasingSessions:d,productViewConversionRate:p,checkoutCompletionRate:u}}let s=t.length,a=t.filter(e=>e.viewedProductIds.length>0).length,i=t.filter(e=>e.startedCheckout).length,r=new Set,o=0;for(let e of t)if(e.hasPurchased)if(e.orderIds&&e.orderIds.length>0)for(let t of e.orderIds)r.add(t);else e.orderId?r.add(e.orderId):o++;let d=r.size+o,n=t.filter(e=>e.hasPurchased&&e.purchasedProductIds.some(t=>e.viewedProductIds.includes(t))).length,l=t.filter(e=>e.hasPurchased).length,c=Math.max(0,l-n),p=a>0?Math.round(n/a*1e3)/10:0,u=i>0?Math.round(d/i*1e3)/10:0;return{totalSessions:s,uniqueProductViews:a,uniqueProductSessions:a,checkoutStarts:i,ordersCreated:d,uniqueOrdersCount:d,purchasingSessions:l,attributedPurchasingSessions:n,unattributedPurchasingSessions:c,productViewConversionRate:p,checkoutCompletionRate:u}}async resetDemoAnalytics(){this.events=[],this.sessions.clear(),this.eventIdsSet.clear();try{window.localStorage.removeItem(t),this.broadcastChannel?.postMessage({type:"ANALYTICS_UPDATED",timestamp:this.getCurrentTime()}),window.dispatchEvent(new CustomEvent("orva:analytics-updated"))}catch(e){console.warn("[MockVisitorAnalyticsRepository] Reset error:",e)}}}let a=null;e.s(["getMockVisitorAnalyticsRepository",0,function(){return a||(a=new s),a}])},3805,312023,162081,e=>{"use strict";var t=e.i(829998);let s=["gallery","orderForm","title","subtitle","description","features","benefits","relatedProducts"],a=["title","subtitle","gallery","orderForm","features","description","benefits","relatedProducts"];function i(e="global_default"){return{layoutVersion:1,productId:e,desktopLayoutMode:"split",desktopSectionOrder:[...s],mobileSectionOrder:[...a],showRelatedProducts:!0,showDescription:!0,showFeatures:!0,showBenefits:!0,updatedAt:new Date().toISOString()}}e.s(["ALL_LAYOUT_SECTIONS",0,[{id:"title",labelAr:"عنوان المنتج الرئيسي",descriptionAr:"الاسم الرسمي للباقة أو المنتج وسعر البيع البارز",isEssential:!1,defaultVisible:!0},{id:"subtitle",labelAr:"الشارة والوصف الفرعي",descriptionAr:"شارة الباقة والتعريف الموجز لمحتوى العرض",isEssential:!1,defaultVisible:!0},{id:"gallery",labelAr:"معرض الصور وصورة الغلاف",descriptionAr:"الصورة الرئيسية ومعرض الصور التوضيحية للسلعة",isEssential:!1,defaultVisible:!0},{id:"orderForm",labelAr:"نموذج الطلب السريع (Checkout)",descriptionAr:"إستمارة تأكيد الطلب السريع مع اختيار الولاية والبلدية وخيارات الاستلام",isEssential:!0,defaultVisible:!0},{id:"description",labelAr:"الوصف التفصيلي للمنتج",descriptionAr:"شرح كامل لمحتويات الباقة وطريقة الاستخدام",isEssential:!1,defaultVisible:!0},{id:"features",labelAr:"قائمة المميزات والقطع المرفقة",descriptionAr:"تفصيل الأدوات أو الملحقات برؤوس نقاط وأيقونات توضيحية",isEssential:!1,defaultVisible:!0},{id:"benefits",labelAr:"بطاقات الضمان ومزايا الشراء",descriptionAr:"حق المعاينة قبل الدفع، التوصيل السريع والدفع عند الاستلام",isEssential:!1,defaultVisible:!0},{id:"relatedProducts",labelAr:"المنتجات المقترحة (Cross-sell)",descriptionAr:"عرض الباقات البديلة أو الملحقات الإضافية في نهاية الصفحة",isEssential:!1,defaultVisible:!0}],"createDefaultLayoutConfig",0,i],312023);let r="orva_product_layout_configs_v1";class o{configs=new Map;broadcastChannel=null;constructor(){this.initData(),this.setupCrossTabSync()}initData(){try{let e=window.localStorage.getItem(r);if(e){let t=JSON.parse(e);for(let[e,s]of Object.entries(t))this.configs.set(e,s)}}catch{}this.configs.has("global_default")||this.configs.set("global_default",i("global_default"))}persist(){try{let e={};for(let[t,s]of this.configs.entries())e[t]=s;window.localStorage.setItem(r,JSON.stringify(e)),this.broadcastChannel?.postMessage({type:"LAYOUT_UPDATED",timestamp:Date.now()}),window.dispatchEvent(new CustomEvent("orva:layout-updated"))}catch(e){console.warn("[MockLayoutRepository] Failed to persist layouts to localStorage",e)}}setupCrossTabSync(){try{"u">typeof BroadcastChannel&&(this.broadcastChannel=new BroadcastChannel("orva_layout_sync_v1"),this.broadcastChannel.onmessage=e=>{e.data?.type==="LAYOUT_UPDATED"&&(this.initData(),window.dispatchEvent(new CustomEvent("orva:layout-updated")))}),window.addEventListener("storage",e=>{e.key===r&&(this.initData(),window.dispatchEvent(new CustomEvent("orva:layout-updated")))})}catch(e){console.warn("[MockLayoutRepository] Cross-tab sync warning:",e)}}async getLayoutConfig(e="global_default"){let t=e||"global_default";if(this.configs.has(t))return JSON.parse(JSON.stringify(this.configs.get(t)));if(this.configs.has("global_default")){let e=JSON.parse(JSON.stringify(this.configs.get("global_default")));return e.productId=t,e}let s=i(t);return this.configs.set(t,s),this.persist(),JSON.parse(JSON.stringify(s))}async saveLayoutConfig(e){let t=e.productId||"global_default",s={...e,productId:t,updatedAt:new Date().toISOString()};return this.configs.set(t,s),this.persist(),JSON.parse(JSON.stringify(s))}async resetLayoutConfig(e="global_default"){let t=e||"global_default";return this.configs.delete(t),this.persist(),this.getLayoutConfig(t)}async restoreDefaultLayout(e="global_default"){let t=e||"global_default",s=i(t);return this.configs.set(t,s),this.persist(),JSON.parse(JSON.stringify(s))}async hasUnsavedChanges(e,t){return JSON.stringify(e)!==JSON.stringify(t)}}let d=null;function n(){return d||(d=new o),d}e.s(["getMockLayoutRepository",0,n],162081);var l=e.i(908096);function c(e){return null==e?"":String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}function p(e,t=""){if(!e||"string"!=typeof e)return t;let s=e.trim();return/^(?:https?:\/\/|\/|[a-zA-Z0-9_.\-\/ ]+\.(?:webp|jpg|jpeg|png|svg)|data:image\/(?:png|jpeg|webp|svg\+xml);base64,)/i.test(s)?s:t}function u(e){let t=Math.round(Number(e)||0);return`${t.toLocaleString("en-US")} د.ج`}function g(e){let{layoutConfig:t,storePage:s,baseAssetPath:a="/",isProduction:i=!1}=e,r=a.endsWith("/")?a:`${a}/`,o="purchaseCost"in e.product?(0,l.toPublicProductDTO)(e.product):e.product,d=c(o.title||s.title||"عرض خاص — ORVA Store"),n=c(o.subtitle||"عرض الصيانة والخدمة المتكامل مع التوصيل السريع"),g=c(o.description||""),h=c(o.sku||"ORVA-PACK"),f=Math.max(0,Number(o.sellingPrice)||4950),m=Math.round(1.85*f),y="pack 1 4950/pack1 4950.webp";h.includes("P2")&&(y="pack2 12950/pack2 12950.webp");let b=o.images?.[0],v=b&&"/placeholder.svg"!==b?p(b,y):y,x=(o.images||[]).slice(1).filter(e=>e&&"/placeholder.svg"!==e).map(e=>p(e)).filter(Boolean),w=t.desktopSectionOrder.map(e=>{switch(e){case"title":return`
    <div class="product-title-block" style="margin-bottom:16px;">
        <span class="pack-badge-simple">${n}</span>
        <h1 class="hero-main-title" style="margin-top:8px; font-size:24px; font-weight:800; color:#fff;">${d}</h1>
        <div class="price-display-banner" style="margin-top:10px; display:flex; align-items:baseline; gap:12px;">
            <span class="price-num" style="font-size:26px; font-weight:800; color:#d4a373;">${u(f)}</span>
            <span class="price-old" style="font-size:15px; color:#888; text-decoration:line-through;">${u(m)}</span>
            <span style="font-size:11px; padding:2px 6px; border-radius:4px; background:#38271d; color:#e09f67; font-weight:700;">توفير كبير</span>
        </div>
    </div>`;case"subtitle":case"features":default:return"";case"gallery":return`
    <div class="product-gallery-card" style="margin-bottom:20px;">
        <div class="main-image-container" style="border-radius:12px; overflow:hidden; background:#1c1917; text-align:center; padding:10px; border:1px solid #2e2a27;">
            <img src="${v.startsWith("/")?v:r+v}" alt="${d}" style="max-width:100%; height:auto; border-radius:8px; display:inline-block;" loading="eager">
        </div>
        ${x.length>0?`
        <div class="thumbnails-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(64px, 1fr)); gap:8px; margin-top:10px;">
            ${x.map(e=>`
                <img src="${e.startsWith("/")?e:r+e}" alt="${d}" style="width:100%; border-radius:6px; border:1px solid #332f2c;" loading="lazy">
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
            <input type="hidden" name="productId" value="${c(o.id)}">
            <input type="hidden" name="productSku" value="${h}">
            <input type="hidden" name="packPrice" value="${f}">

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
                    <strong style="color:#fff;">${u(f)}</strong>
                </div>
                <div class="summary-line" style="display:flex; justify-content:space-between; font-size:13px; color:#c7c1ba; margin-bottom:8px;">
                    <span>مصاريف التوصيل:</span>
                    <strong id="shippingAmount" style="color:#fff;">500 د.ج</strong>
                </div>
                <div class="summary-divider" style="height:1px; background:#443e39; margin-bottom:8px;"></div>
                <div class="summary-total-line" style="display:flex; justify-content:space-between; font-size:16px; font-weight:800; color:#d4a373;">
                    <span>المبلغ الصافي المطلوب عند الاستلام:</span>
                    <span class="total-num" id="totalAmount">${u(f+500)}</span>
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
    </div>`:""}}).filter(Boolean).join("\n"),I=s.slug.replace(/^products\//,"").replace(/\.html$/,""),S=i?s.publicUrl||`/products/${I}.html`:"";return`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="${i?"index, follow":"noindex, nofollow"}">
    <title>${d} — ${u(f)}</title>
    <meta name="description" content="${c(s.metaDescription||n)}">
    ${i&&S?`<link rel="canonical" href="https://orva-store.com${S}">`:""}

    <!-- Generator Metadata (Phase 8B Lifecycle Model) -->
    <!-- Template: ${c(s.templateId)} v${c(s.templateVersion)} -->
    <!-- Product SKU: ${h} | Status: ${c(i?"published":s.status)} -->
    <!-- Generated: ${c(s.lastGeneratedAt||new Date().toISOString())} -->

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
            ${i?`
            <span style="font-size:11px; padding:3px 8px; border-radius:4px; background:#1c2d20; color:#5eead4; border:1px solid #134e48; display:flex; align-items:center; gap:4px;">
                <i class="fa-solid fa-shield-halved"></i>
                متجر موثوق 100%
            </span>`:`
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
                    packId: '${h}',
                    packPrice: ${f},
                    productName: '${d}'
                });
            }
        });
    </script>
</body>
</html>`}let h=[{pageId:"page_pack_1_pro",productId:"prod_pack_1_pro",productSku:"ORVA-P1-PRO",slug:"pack1",title:"عرض 4 في 1 (منفاخ TOYOTA وطقم مفاتيح) — PACK 4EN1",templateId:"orva-calm-night-light",templateVersion:"1.0.0",status:"published",publicUrl:"/pack1.html",previewPath:"/data/preview/products/page_pack_1_pro.html",metaDescription:"باك الخدمة والصيانة 4 في 1 للسيارة والمنزل: منفاخ عجلات TOYOTA، طقم مفاتيح 46 قطعة، مفك مرن 11 قطعة، وطقم 6 مفكات مع التوصيل والدفع عند الاستلام.",lastGeneratedAt:"2026-10-31T06:00:00Z",createdAt:"2026-10-25T10:00:00Z",updatedAt:"2026-10-31T06:00:00Z"},{pageId:"page_pack_2_elite",productId:"prod_pack_2_elite",productSku:"ORVA-P2-ELITE",slug:"pack2",title:"عرض 5 في 1 الفاخر (ماكينة CROWN 20V والملحقات) — PACK 5EN1",templateId:"orva-calm-night-light",templateVersion:"1.0.0",status:"published",publicUrl:"/pack2.html",previewPath:"/data/preview/products/page_pack_2_elite.html",metaDescription:"عرض 5 في 1 الفاخر: ماكينة ثقب CROWN 20V ببطاريتين، طقم مفكات 6 قطع، علبة مفاتيح 46 قطعة، مفك مرن وقفازات مع التوصيل السريع.",lastGeneratedAt:"2026-10-31T06:00:00Z",createdAt:"2026-10-26T12:00:00Z",updatedAt:"2026-10-31T06:00:00Z"},{pageId:"page_sac_yamaha",productId:"prod_sac_yamaha",productSku:"ORVA-SAC-YAM",slug:"yamaha",title:"حقيبة موطو ياماها الفاخرة — Yamaha Archive Edition",templateId:"orva-calm-night-light",templateVersion:"1.0.0",status:"published",publicUrl:"/yamaha-archive.html",previewPath:"/data/preview/products/page_sac_yamaha.html",metaDescription:"حقيبة موطو ياماha الأصلية المقاومة للماء والصدمات لسائقي الدراجات النارية والرحلات اليومية.",lastGeneratedAt:"2026-10-31T06:00:00Z",createdAt:"2026-10-20T08:00:00Z",updatedAt:"2026-10-31T06:00:00Z"},{pageId:"page_pack_3_ultra",productId:"prod_pack_3_ultra",productSku:"ORVA-P3-ULTRA",slug:"products/pack-3-ultra",title:"عرض 6 في 1 المتميز للورشات — PACK 6EN1 ULTRA",templateId:"orva-calm-night-light",templateVersion:"1.0.0",status:"preview_ready",publicUrl:null,previewPath:"/data/preview/products/page_pack_3_ultra.html",metaDescription:"عرض 6 في 1 المتميز للورشات الكبرى مع معدات صيانة كهربائية وميكانيكية عالية الجودة.",lastGeneratedAt:"2026-10-31T06:00:00Z",createdAt:"2026-10-29T14:00:00Z",updatedAt:"2026-10-31T06:00:00Z"},{pageId:"page_sac_bundle",productId:"prod_sac_bundle",productSku:"ORVA-SAC-BUNDLE",slug:"products/sac-bundle",title:"حقيبة موطو ياماها + هدايا مجانية ترويجية",templateId:"orva-calm-night-light",templateVersion:"1.0.0",status:"preview_ready",publicUrl:null,previewPath:"/data/preview/products/page_sac_bundle.html",metaDescription:"باقة حقيبة ياماها الخاصة مع هدايا استثنائية وقفازات إضافية لفترة محدودة.",lastGeneratedAt:"2026-10-31T06:00:00Z",createdAt:"2026-10-29T14:30:00Z",updatedAt:"2026-10-31T06:00:00Z"}],f="orva_store_pages_v8a";async function m(e){try{let t=await fetch("/api/publish-page",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(e)});if(t.ok)return await t.json()}catch(e){}return null}class y{pages=[];constructor(){this.loadState()}loadState(){try{let e=localStorage.getItem(f);if(e){let t=JSON.parse(e);if(Array.isArray(t)&&t.length>0){this.pages=t;return}}}catch(e){}this.pages=JSON.parse(JSON.stringify(h))}persistState(){try{localStorage.setItem(f,JSON.stringify(this.pages))}catch(e){}}async getPages(){return JSON.parse(JSON.stringify(this.pages))}async getPageById(e){let t=this.pages.find(t=>t.pageId===e);return t?JSON.parse(JSON.stringify(t)):null}async getPageByProductId(e){let t=this.pages.find(t=>t.productId===e);return t?JSON.parse(JSON.stringify(t)):null}async createPage(e){let t=new Date().toISOString(),s={...e,status:"published"!==e.status||e.publicUrl?e.status:"preview_ready",publicUrl:"published"===e.status?e.publicUrl:null,createdAt:t,updatedAt:t};return this.pages.push(s),this.persistState(),JSON.parse(JSON.stringify(s))}async updatePage(e,t){let s=this.pages.findIndex(t=>t.pageId===e);if(-1===s)throw Error(`صفحة المتجر غير موجودة: ${e}`);let a=this.pages[s],i=t.status||a.status,r=new Date().toISOString(),o={...a,...t,status:i,publicUrl:"published"===i?t.publicUrl??a.publicUrl:null,updatedAt:r};return this.pages[s]=o,this.persistState(),JSON.parse(JSON.stringify(o))}async generatePreviewHtml(e){let s=await this.getPageById(e);if(!s)throw Error(`صفحة غير موجودة: ${e}`);let a=(0,t.getMockProductsRepository)(),i=await a.getProductById(s.productId);if(!i)throw Error(`المنتج المرتبط بالصفحة غير موجود: ${s.productId}`);let r=n(),o=await r.getLayoutConfig(i.id),d=g({product:i,layoutConfig:o,storePage:s,baseAssetPath:"/",isProduction:!1});return await m({action:"preview",pageId:s.pageId,slug:s.slug,html:d}),await this.updatePage(e,{lastGeneratedAt:new Date().toISOString()}),d}async publishPage(e){let s=await this.getPageById(e);if(!s)throw Error(`صفحة غير موجودة: ${e}`);let a=(0,t.getMockProductsRepository)(),i=await a.getProductById(s.productId);if(!i)throw Error(`المنتج المرتبط بالصفحة غير موجود: ${s.productId}`);let r=n(),o=await r.getLayoutConfig(i.id),d=s.slug.replace(/^products\//,"").replace(/\.html$/,""),l=s.publicUrl||`/products/${d}.html`,c=g({product:i,layoutConfig:o,storePage:{...s,status:"published",publicUrl:l},baseAssetPath:"/",isProduction:!0});await m({action:"publish",pageId:s.pageId,slug:d,html:c});let p=new Date().toISOString();return this.updatePage(e,{status:"published",publicUrl:l,lastGeneratedAt:p,updatedAt:p})}async unpublishPage(e){let t=await this.getPageById(e);if(!t)throw Error(`صفحة غير موجودة: ${e}`);let s=t.slug.replace(/^products\//,"").replace(/\.html$/,"");return await m({action:"unpublish",pageId:t.pageId,slug:s}),this.updatePage(e,{status:"preview_ready",publicUrl:null,updatedAt:new Date().toISOString()})}async archivePage(e){let t=await this.getPageById(e);if(t){let e=t.slug.replace(/^products\//,"").replace(/\.html$/,"");await m({action:"archive",pageId:t.pageId,slug:e})}return this.updatePage(e,{status:"archived",publicUrl:null,updatedAt:new Date().toISOString()})}async syncWithProduct(e){let s=(0,t.getMockProductsRepository)(),a=await s.getProductById(e);if(!a)return{page:null,actionTaken:"no_change",message:`المنتج غير موجود: ${e}`};let i=this.pages.find(t=>t.productId===e);return i?"archived"===a.status&&"archived"!==i.status?{page:await this.archivePage(i.pageId),actionTaken:"archived",message:`تم أرشفة صفحة المتجر تلقائياً تماشياً مع أرشفة المنتج (${a.sku}).`}:{page:await this.updatePage(i.pageId,{title:a.title,metaDescription:a.description.slice(0,160),productSku:a.sku}),actionTaken:"updated",message:`تمت مزامنة بيانات الصفحة مع المنتج (${a.sku}) بنجاح.`}:{page:await this.createPage({pageId:`page_${a.sku.toLowerCase().replace(/[^a-z0-9]/g,"_")}`,productId:a.id,productSku:a.sku,slug:`products/${a.sku.toLowerCase()}`,title:a.title,templateId:"orva-calm-night-light",templateVersion:"1.0.0",status:"archived"===a.status?"archived":"preview_ready",publicUrl:null,previewPath:`/data/preview/products/page_${a.id}.html`,metaDescription:a.description.slice(0,160),lastGeneratedAt:new Date().toISOString()}),actionTaken:"created",message:`تم إنشاء صفحة معاينة جديدة للمنتج (${a.sku}).`}}async getSitemapEntries(){return this.pages.map(e=>{let t="published"===e.status&&!!e.publicUrl;return{url:t?e.publicUrl:e.previewPath,status:e.status,productId:e.productId,productSku:e.productSku,title:e.title,lastModified:e.updatedAt,changeFrequency:t?"daily":"monthly",priority:t?1:.3,isPublicIndexable:t}})}}let b=null;e.s(["getMockStorePagesRepository",0,function(){return b||(b=new y),b}],3805)}]);