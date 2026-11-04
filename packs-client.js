/**
 * ORVA STORE — Multi-Pack Client Engine (packs-client.js)
 * Supports Pack 1 (4,950 DA) & Pack 2 (13,390 DA)
 * Handles 58 Wilayas, Communes, Shipping Tariffs, Anti-Fraud, and /api/send-order Dispatch
 */

(function () {
    'use strict';

    // 58 Algerian Wilayas with exact tariffs from Tarif_Biskra.txt
    const ALGERIA_WILAYAS = [
        { id: 1, name: "01 - أدرار", stopdesk: 800, domicile: 1300, time: "48 - 96 H" },
        { id: 2, name: "02 - الشلف", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 3, name: "03 - الأغواط", stopdesk: 550, domicile: 950, time: "24 - 48 H" },
        { id: 4, name: "04 - أم البواقي", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 5, name: "05 - باتنة", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 6, name: "06 - بجاية", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 7, name: "07 - بسكرة", stopdesk: 400, domicile: 550, time: "24 - 48 H" },
        { id: 8, name: "08 - بشار", stopdesk: 800, domicile: 1300, time: "48 - 96 H" },
        { id: 9, name: "09 - البليدة", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 10, name: "10 - البويرة", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 11, name: "11 - تمنراست", stopdesk: 800, domicile: 1400, time: "48 - 96 H" },
        { id: 12, name: "12 - تبسة", stopdesk: 500, domicile: 800, time: "24 - 48 H" },
        { id: 13, name: "13 - تلمسان", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 14, name: "14 - تيارت", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 15, name: "15 - تيزي وزو", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 16, name: "16 - الجزائر (العاصمة)", stopdesk: 450, domicile: 700, time: "24 - 48 H" },
        { id: 17, name: "17 - الجلفة", stopdesk: 500, domicile: 800, time: "24 - 48 H" },
        { id: 18, name: "18 - جيجل", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 19, name: "19 - سطيف", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 20, name: "20 - سعيدة", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 21, name: "21 - سكيكدة", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 22, name: "22 - سيدي بلعباس", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 23, name: "23 - عنابة", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 24, name: "24 - قالمة", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 25, name: "25 - قسنطينة", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 26, name: "26 - المدية", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 27, name: "27 - مستغانم", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 28, name: "28 - المسيلة", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 29, name: "29 - معسكر", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 30, name: "30 - ورقلة", stopdesk: 550, domicile: 950, time: "24 - 72 H" },
        { id: 31, name: "31 - وهران", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 32, name: "32 - البيض", stopdesk: 550, domicile: 950, time: "24 - 72 H" },
        { id: 33, name: "33 - إليزي", stopdesk: 800, domicile: 1700, time: "48 - 96 H" },
        { id: 34, name: "34 - برج بوعريريج", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 35, name: "35 - بومرداس", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 36, name: "36 - الطارف", stopdesk: 500, domicile: 800, time: "24 - 48 H" },
        { id: 37, name: "37 - تندوف", stopdesk: 800, domicile: 1500, time: "48 - 96 H" },
        { id: 38, name: "38 - تسمسيلت", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 39, name: "39 - الوادي", stopdesk: 550, domicile: 950, time: "24 - 72 H" },
        { id: 40, name: "40 - خنشلة", stopdesk: 500, domicile: 800, time: "24 - 48 H" },
        { id: 41, name: "41 - سوق أهراس", stopdesk: 500, domicile: 800, time: "24 - 48 H" },
        { id: 42, name: "42 - تيبازة", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 43, name: "43 - ميلة", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 44, name: "44 - عين الدفلى", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 45, name: "45 - النعامة", stopdesk: 550, domicile: 950, time: "24 - 72 H" },
        { id: 46, name: "46 - عين تموشنت", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 47, name: "47 - غرداية", stopdesk: 550, domicile: 950, time: "24 - 72 H" },
        { id: 48, name: "48 - غليزان", stopdesk: 450, domicile: 750, time: "24 - 48 H" },
        { id: 49, name: "49 - تيميمون", stopdesk: null, domicile: 1300, time: "48 - 96 H" },
        { id: 50, name: "50 - برج باجي مختار", stopdesk: null, domicile: 1700, time: "48 - 96 H" },
        { id: 51, name: "51 - أولاد جلال", stopdesk: null, domicile: 550, time: "24 - 72 H" },
        { id: 52, name: "52 - بني عباس", stopdesk: null, domicile: 1300, time: "48 - 96 H" },
        { id: 53, name: "53 - عين صالح", stopdesk: null, domicile: 1300, time: "48 - 96 H" },
        { id: 54, name: "54 - عين قزام", stopdesk: null, domicile: 1700, time: "48 - 96 H" },
        { id: 55, name: "55 - تقرت", stopdesk: null, domicile: 950, time: "24 - 72 H" },
        { id: 56, name: "56 - جانت", stopdesk: null, domicile: 1600, time: "48 - 96 H" },
        { id: 57, name: "57 - المغير", stopdesk: null, domicile: 950, time: "24 - 72 H" },
        { id: 58, name: "58 - المنيعة", stopdesk: null, domicile: 1100, time: "24 - 72 H" }
    ];

    function initPackForm(config) {
        const { packPrice, productName, packId } = config;
        const pageLoadTime = Date.now();

        const form = document.getElementById('orderForm');
        const wilayaSelect = document.getElementById('wilayaSelect');
        const communeSelect = document.getElementById('communeSelect');
        const homeChoice = document.getElementById('homeChoice');
        const deskChoice = document.getElementById('deskChoice');
        const shippingAmountEl = document.getElementById('shippingAmount');
        const totalAmountEl = document.getElementById('totalAmount');
        const submitBtn = document.getElementById('confirmOrderBtn') || (form ? form.querySelector('button[type="submit"]') : null);

        let selectedDeliveryMode = 'home';
        let currentShipping = 500;
        let selectedWilayaObj = null;

        // 1. Populate 58 Wilayas
        if (wilayaSelect) {
            wilayaSelect.innerHTML = '<option value="" disabled selected>-- اختر ولايتك من القائمة (58 ولاية) --</option>';
            ALGERIA_WILAYAS.forEach(w => {
                const opt = document.createElement('option');
                opt.value = w.id;
                opt.textContent = w.name;
                wilayaSelect.appendChild(opt);
            });

            wilayaSelect.addEventListener('change', () => {
                const wId = parseInt(wilayaSelect.value, 10);
                selectedWilayaObj = ALGERIA_WILAYAS.find(w => w.id === wId) || null;
                updateCommunes(wId);
                updateShippingCalculation();
            });
        }

        // 2. Populate Communes
        function updateCommunes(wilayaId) {
            if (!communeSelect) return;
            communeSelect.innerHTML = '';
            
            const defOpt = document.createElement('option');
            defOpt.value = '';
            defOpt.disabled = true;
            defOpt.selected = true;

            const communesData = (typeof window !== 'undefined' && window.algeriaCommunes) 
                ? window.algeriaCommunes 
                : (typeof algeriaCommunes !== 'undefined' ? algeriaCommunes : {});

            const list = communesData[wilayaId] || communesData[String(wilayaId)] || [];

            if (!wilayaId || !list || !Array.isArray(list) || list.length === 0) {
                defOpt.textContent = '-- اختر البلدية / الدائرة --';
                communeSelect.appendChild(defOpt);
                return;
            }

            defOpt.textContent = '-- اختر البلدية / الدائرة (متوفرة للتوصيل) --';
            communeSelect.appendChild(defOpt);

            list.forEach(cName => {
                const opt = document.createElement('option');
                opt.value = cName;
                opt.textContent = cName;
                communeSelect.appendChild(opt);
            });
        }

        // 3. Delivery choice listeners
        const radios = document.querySelectorAll('input[name="deliveryChoice"]');
        radios.forEach(r => {
            r.addEventListener('change', (e) => {
                selectedDeliveryMode = e.target.value;
                if (homeChoice && deskChoice) {
                    if (selectedDeliveryMode === 'home') {
                        homeChoice.classList.add('active');
                        deskChoice.classList.remove('active');
                    } else {
                        deskChoice.classList.add('active');
                        homeChoice.classList.remove('active');
                    }
                }
                updateShippingCalculation();
            });
        });

        // Clickable card wrapper handlers
        if (homeChoice) {
            homeChoice.addEventListener('click', () => {
                const radio = homeChoice.querySelector('input[type="radio"]');
                if (radio) {
                    radio.checked = true;
                    radio.dispatchEvent(new Event('change'));
                }
            });
        }

        if (deskChoice) {
            deskChoice.addEventListener('click', () => {
                const radio = deskChoice.querySelector('input[type="radio"]');
                if (radio) {
                    radio.checked = true;
                    radio.dispatchEvent(new Event('change'));
                }
            });
        }

        // 4. Update Shipping & Total
        function updateShippingCalculation() {
            if (selectedWilayaObj) {
                if (selectedDeliveryMode === 'stopdesk') {
                    if (selectedWilayaObj.stopdesk !== null) {
                        currentShipping = selectedWilayaObj.stopdesk;
                    } else {
                        // Wilaya has no stopdesk, fallback to domicile
                        currentShipping = selectedWilayaObj.domicile;
                    }
                } else {
                    currentShipping = selectedWilayaObj.domicile;
                }
            } else {
                currentShipping = 500;
            }

            const grandTotal = packPrice + currentShipping;
            if (shippingAmountEl) shippingAmountEl.textContent = `${currentShipping.toLocaleString()} د.ج`;
            if (totalAmountEl) totalAmountEl.textContent = `${grandTotal.toLocaleString()} د.ج`;
        }

        // 5. Phone validation (Algerian numbers: 05, 06, 07 + 8 digits)
        function validatePhone(phone) {
            const cleaned = phone.replace(/[\s-]/g, '');
            return /^(05|06|07)[0-9]{8}$/.test(cleaned);
        }

        // 6. Device Fingerprint & Helpers
        function getDeviceId() {
            try {
                let devId = localStorage.getItem('metachagour_device_id');
                if (!devId) {
                    devId = 'DEV-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now().toString(36);
                    localStorage.setItem('metachagour_device_id', devId);
                }
                return devId;
            } catch (e) {
                return 'DEV-ANON-' + Date.now();
            }
        }

        function getCookie(name) {
            try {
                const value = `; ${document.cookie}`;
                const parts = value.split(`; ${name}=`);
                if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift());
            } catch (e) {}
            return null;
        }

        function getUrlParam(name) {
            try {
                const params = new URLSearchParams(window.location.search);
                return params.get(name);
            } catch (e) {
                return null;
            }
        }

        // 7. Tracking Guards & Checkout Flow
        const isPack2 = (String(packId || '').toLowerCase().includes('2') || Number(packPrice) >= 10000);
        const packKey = isPack2 ? 'pack2' : 'pack1';
        const cleanProductName = isPack2 ? 'PACK 5EN1 13390' : 'PACK 4EN1 4950';

        let initiateCheckoutFired = false;
        let isSubmitting = false;
        let purchaseFired = false;

        function triggerInitiateCheckoutOnce() {
            if (initiateCheckoutFired) return;
            initiateCheckoutFired = true;

            const currentTotal = packPrice + currentShipping;
            if (typeof window.fbq === 'function') {
                try {
                    window.fbq('track', 'InitiateCheckout', {
                        content_name: packKey,
                        value: currentTotal,
                        currency: 'DZD'
                    });
                    console.log('[Meta Pixel] InitiateCheckout tracked once:', {
                        content_name: packKey,
                        value: currentTotal,
                        currency: 'DZD'
                    });
                } catch (icErr) {
                    console.warn('[Meta Pixel InitiateCheckout Error]:', icErr);
                }
            }
        }

        // Trigger InitiateCheckout on first click of the confirmation button
        if (submitBtn) {
            submitBtn.addEventListener('click', () => {
                triggerInitiateCheckoutOnce();
            });
        }

        // 8. Form submission
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (isSubmitting) return;

                // Guarantee InitiateCheckout fired if user pressed Enter
                triggerInitiateCheckoutOnce();

                const nameInput = document.getElementById('fullName');
                const phoneInput = document.getElementById('phoneNumber');
                const communeVal = communeSelect ? communeSelect.value : '';
                const honeypotVal = document.getElementById('website_url') ? document.getElementById('website_url').value : '';

                const nameVal = nameInput ? nameInput.value.trim() : '';
                const phoneVal = phoneInput ? phoneInput.value.trim() : '';

                if (nameVal.length < 3) {
                    alert('يرجى كتابة الاسم الكامل بشكل صحيح.');
                    if (nameInput) nameInput.focus();
                    return;
                }

                if (!validatePhone(phoneVal)) {
                    alert('يرجى إدخال رقم هاتف صحيح يبدأ بـ 05 أو 06 أو 07 ويتكون من 10 أرقام.');
                    if (phoneInput) phoneInput.focus();
                    return;
                }

                if (!selectedWilayaObj) {
                    alert('يرجى اختيار ولايتك من القائمة.');
                    if (wilayaSelect) wilayaSelect.focus();
                    return;
                }

                if (!communeVal) {
                    alert('يرجى اختيار بلديتك من القائمة.');
                    if (communeSelect) communeSelect.focus();
                    return;
                }

                // Check 2-attempt limit
                const cleanPhone = phoneVal.replace(/\D/g, '');
                const attemptsKey = 'pack_sub_attempts_' + cleanPhone;
                let currentAttempts = 0;
                try {
                    const stored = localStorage.getItem(attemptsKey);
                    if (stored) {
                        const parsed = JSON.parse(stored);
                        if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
                            currentAttempts = parsed.count || 0;
                        }
                    }
                } catch (err) {}

                if (currentAttempts >= 2) {
                    alert('عذراً، لقد تم تسجيل طلبك مسبقاً (الحد الأقصى محاولتان). سيتصل بك فريقنا هاتفياً لتأكيد طلبك وتجهيز الشحن.');
                    return;
                }

                isSubmitting = true;
                const originalBtnContent = submitBtn ? submitBtn.innerHTML : '';
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = '<span>جارٍ إرسال طلبك...</span> <i class="fa-solid fa-spinner fa-spin"></i>';
                }

                const orderId = `${packKey.toUpperCase()}-${Math.floor(10000 + Math.random() * 90000)}`;
                const timestamp = Date.now();
                const eventId = `order_${orderId}_${timestamp}`;
                const grandTotalNum = packPrice + currentShipping;
                const fullLocation = `${selectedWilayaObj.name} — ${communeVal}`;
                const deliveryTypeLabel = selectedDeliveryMode === 'stopdesk' ? 'توصيل للمكتب (Stop Desk)' : 'توصيل للمنزل';

                // Advanced Matching & Test code retrieval
                const userFbp = getCookie('_fbp') || undefined;
                let userFbc = getCookie('_fbc') || undefined;
                if (!userFbc) {
                    const fbclid = getUrlParam('fbclid');
                    if (fbclid) {
                        userFbc = `fb.1.${timestamp}.${fbclid}`;
                    }
                }
                let testEventCode = getUrlParam('test_event_code') || undefined;
                if (testEventCode) {
                    try { sessionStorage.setItem('meta_test_event_code', testEventCode); } catch (e) {}
                } else {
                    try { testEventCode = sessionStorage.getItem('meta_test_event_code') || undefined; } catch (e) {}
                }

                const payload = {
                    orderId,
                    eventId,
                    packId: packKey,
                    fullName: nameVal,
                    phone: phoneVal,
                    wilaya: fullLocation,
                    commune: communeVal,
                    deliveryType: deliveryTypeLabel,
                    deliveryTime: selectedWilayaObj.time || '24 - 48 H',
                    quantity: 1,
                    productName: cleanProductName,
                    productTotal: `${packPrice} د.ج`,
                    shippingFee: `${currentShipping} د.ج`,
                    priceNum: grandTotalNum,
                    grandTotal: `${grandTotalNum} د.ج`,
                    deviceId: getDeviceId(),
                    honeypot: honeypotVal,
                    formDurationMs: Date.now() - pageLoadTime,
                    fbp: userFbp,
                    fbc: userFbc,
                    testEventCode: testEventCode
                };

                try {
                    const res = await fetch('/api/send-order', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const data = await res.json();

                    if (!res.ok || data.success === false) {
                        alert(data.message || 'حدث خطأ أثناء إرسال الطلب. يرجى المحاولة مرة أخرى.');
                        isSubmitting = false;
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = originalBtnContent;
                        }
                        return;
                    }

                    // Save attempt in localStorage
                    try {
                        localStorage.setItem(attemptsKey, JSON.stringify({
                            count: currentAttempts + 1,
                            timestamp: Date.now()
                        }));
                    } catch (e) {}

                    const finalOrderId = data.orderId || orderId;
                    const sharedEventId = data.eventId || eventId;

                    // Track Meta Pixel Purchase Event (Unified Pixel 9988776655443322 segmented by content_name)
                    if (!purchaseFired && typeof window.fbq === 'function') {
                        purchaseFired = true;
                        try {
                            window.fbq('track', 'Purchase', {
                                content_name: packKey,
                                value: grandTotalNum,
                                currency: 'DZD',
                                num_items: 1
                            }, { eventID: sharedEventId });

                            console.log('[Tracking Deduplication] SUCCESS:', {
                                event: 'Purchase',
                                browser_eventID: sharedEventId,
                                server_event_id: data.eventId || sharedEventId,
                                value: grandTotalNum,
                                currency: 'DZD',
                                test_event_code: testEventCode || 'NONE'
                            });
                        } catch (fbErr) {
                            console.warn('[Meta Pixel Purchase Tracking Error]:', fbErr);
                        }
                    }

                    // Show success receipt modal
                    showReceiptModal({
                        orderId: finalOrderId,
                        fullName: nameVal,
                        phone: phoneVal,
                        location: fullLocation,
                        deliveryType: deliveryTypeLabel,
                        productName: productName,
                        productTotal: `${packPrice.toLocaleString()} د.ج`,
                        shippingFee: `${currentShipping.toLocaleString()} د.ج`,
                        grandTotal: `${grandTotalNum.toLocaleString()} د.ج`
                    });

                    // Keep button in success state to avoid duplicate re-orders
                    if (submitBtn) {
                        submitBtn.innerHTML = '<span>تم تأكيد طلبك بنجاح ✅</span>';
                        submitBtn.disabled = true;
                    }

                } catch (err) {
                    console.error('Submit error:', err);
                    alert('حدث خطأ في الاتصال بالخادم. يرجى التحقق من اتصالك بالإنترنت والمحاولة مجدداً.');
                    isSubmitting = false;
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = originalBtnContent;
                    }
                }
            });
        }

        // 8. Modal Receipt Creator
        function showReceiptModal(receipt) {
            let modal = document.getElementById('packSuccessModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'packSuccessModal';
                modal.className = 'pack-modal-overlay';
                document.body.appendChild(modal);
            }

            modal.innerHTML = `
                <div class="pack-modal-card">
                    <div class="pack-modal-icon">✅</div>
                    <h3 class="pack-modal-title">تم تسجيل طلبك بنجاح!</h3>
                    <p class="pack-modal-desc">شكراً لثقتكم. سيتصل بك فريقنا هاتفياً في أقرب وقت لتأكيد طلبك وتفاصيل التوصيل قبل الشحن.</p>
                    
                    <div class="pack-receipt-box">
                        <div class="receipt-row"><span>رقم الطلب:</span><strong>${receipt.orderId}</strong></div>
                        <div class="receipt-row"><span>المنتج المطلوب:</span><strong>${receipt.productName}</strong></div>
                        <div class="receipt-row"><span>الاسم واللقب:</span><strong>${receipt.fullName}</strong></div>
                        <div class="receipt-row"><span>رقم الهاتف:</span><strong dir="ltr">${receipt.phone}</strong></div>
                        <div class="receipt-row"><span>مكان الاستلام:</span><strong>${receipt.location}</strong></div>
                        <div class="receipt-row"><span>طريقة الاستلام:</span><strong>${receipt.deliveryType}</strong></div>
                        <div class="receipt-divider"></div>
                        <div class="receipt-row total"><span>المبلغ الصافي عند الاستلام:</span><strong class="receipt-highlight">${receipt.grandTotal}</strong></div>
                    </div>

                    <button class="pack-modal-close-btn" type="button" id="closeReceiptBtn">
                        حسناً، شكراً لكم
                    </button>
                </div>
            `;

            modal.classList.add('active');

            const closeBtn = document.getElementById('closeReceiptBtn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    modal.classList.remove('active');
                });
            }
        }
    }

    window.initPackForm = initPackForm;
})();
