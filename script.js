/**
 * ORVA STORE — Yamaha Sac à Dos Single Product Landing Page
 * Features: 58 Wilayas Selector, Live Price & Tariff Calculation, Order Modal Receipt, Resend Serverless Dispatch
 */

document.addEventListener('DOMContentLoaded', () => {
    
    /* --------------------------------------------------------------------------
       1. Algerian 58 Wilayas Data & Exact Shipping Pricing System (Tarif_Biskra.txt)
       -------------------------------------------------------------------------- */
    const algerianWilayas = [
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

    const UNIT_PRICE = 4200;
    const wilayaSelect = document.getElementById('wilayaSelect');
    const communeSelect = document.getElementById('communeSelect');
    const cardHome = document.getElementById('cardHome');
    const cardStopDesk = document.getElementById('cardStopDesk');
    const homePriceSub = document.getElementById('homePriceSub');
    const stopdeskPriceSub = document.getElementById('stopdeskPriceSub');
    const deliveryNotice = document.getElementById('deliveryNotice');
    const summaryDeliveryTime = document.getElementById('summaryDeliveryTime');

    let currentShippingCost = 0;
    let selectedDeliveryMode = 'domicile';
    let selectedWilayaObj = null;

    // Populate Wilayas Dropdown
    if (wilayaSelect) {
        algerianWilayas.forEach(w => {
            const opt = document.createElement('option');
            opt.value = w.id;
            opt.textContent = `${w.name}`;
            wilayaSelect.appendChild(opt);
        });
    }

    // Populate Communes (Cities) Dropdown based on selected Wilaya
    function updateCommunesDropdown(wilayaId) {
        if (!communeSelect) return;
        communeSelect.innerHTML = '';

        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.disabled = true;
        defaultOpt.selected = true;

        if (!wilayaId || typeof algeriaCommunes === 'undefined' || !algeriaCommunes[wilayaId]) {
            defaultOpt.textContent = '-- اختر البلدية (اختر الولاية أولاً) --';
            communeSelect.appendChild(defaultOpt);
            communeSelect.disabled = true;
            return;
        }

        defaultOpt.textContent = '-- اختر البلدية / الدائرة --';
        communeSelect.appendChild(defaultOpt);

        const list = algeriaCommunes[wilayaId];
        for (var i = 0; i < list.length; i++) {
            const opt = document.createElement('option');
            opt.value = list[i];
            opt.textContent = list[i];
            communeSelect.appendChild(opt);
        }
        communeSelect.disabled = false;
    }

    function getSelectedDeliveryMode() {
        const checked = document.querySelector('input[name="deliveryType"]:checked');
        return checked ? checked.value : 'domicile';
    }

    function findWilayaById(wilayaId) {
        for (var i = 0; i < algerianWilayas.length; i++) {
            if (algerianWilayas[i].id === wilayaId) {
                return algerianWilayas[i];
            }
        }
        return null;
    }

    function updateDeliverySelectionState() {
        selectedDeliveryMode = getSelectedDeliveryMode();
        
        // Visual Card State
        if (selectedDeliveryMode === 'domicile') {
            if (cardHome) cardHome.classList.add('active');
            if (cardStopDesk) cardStopDesk.classList.remove('active');
        } else {
            if (cardStopDesk) cardStopDesk.classList.add('active');
            if (cardHome) cardHome.classList.remove('active');
        }

        if (!selectedWilayaObj) {
            currentShippingCost = 0;
            if (homePriceSub) homePriceSub.textContent = 'توصيل حتى الباب';
            if (stopdeskPriceSub) stopdeskPriceSub.textContent = 'الاستلام من المكتب';
            if (deliveryNotice) deliveryNotice.style.display = 'none';
            if (summaryDeliveryTime) summaryDeliveryTime.textContent = '24 - 48 H';
            updateOrderTotals();
            return;
        }

        const hasStopDesk = selectedWilayaObj.stopdesk !== null;

        if (homePriceSub) {
            homePriceSub.textContent = selectedWilayaObj.domicile + ' د.ج';
        }

        if (stopdeskPriceSub) {
            if (hasStopDesk) {
                stopdeskPriceSub.textContent = selectedWilayaObj.stopdesk + ' د.ج';
                if (cardStopDesk) cardStopDesk.classList.remove('disabled');
            } else {
                stopdeskPriceSub.textContent = 'غير متوفر حالياً';
                if (cardStopDesk) cardStopDesk.classList.add('disabled');
            }
        }

        if (summaryDeliveryTime) {
            summaryDeliveryTime.textContent = selectedWilayaObj.time || '24 - 48 H';
        }

        // Handle unavailable Stop Desk auto-fallback
        if (selectedDeliveryMode === 'stopdesk' && !hasStopDesk) {
            const homeRadio = document.querySelector('input[name="deliveryType"][value="domicile"]');
            if (homeRadio) homeRadio.checked = true;
            selectedDeliveryMode = 'domicile';
            if (cardHome) cardHome.classList.add('active');
            if (cardStopDesk) cardStopDesk.classList.remove('active');

            var nameParts = selectedWilayaObj.name.split('-');
            var wilayaCleanName = nameParts.length > 1 ? nameParts[1].trim() : selectedWilayaObj.name;
            if (deliveryNotice) {
                deliveryNotice.textContent = '⚠️ توصيل المكتب غير متوفر لولاية (' + wilayaCleanName + ') حالياً. تم التحديد التلقائي للتوصيل للمنزل.';
                deliveryNotice.style.display = 'block';
            }
            currentShippingCost = selectedWilayaObj.domicile;
        } else {
            if (deliveryNotice) deliveryNotice.style.display = 'none';
            currentShippingCost = selectedDeliveryMode === 'stopdesk' ? selectedWilayaObj.stopdesk : selectedWilayaObj.domicile;
        }

        updateOrderTotals();
    }

    /* --------------------------------------------------------------------------
       2. Order Pricing Calculator & Quantity Manager (Max 3)
       -------------------------------------------------------------------------- */
    const qtyInput = document.getElementById('orderQty');
    const qtyMinus = document.getElementById('qtyMinus');
    const qtyPlus = document.getElementById('qtyPlus');
    const summaryProductPrice = document.getElementById('summaryProductPrice');
    const summaryShippingPrice = document.getElementById('summaryShippingPrice');
    const summaryTotalPrice = document.getElementById('summaryTotalPrice');

    let currentQty = 1;

    function updateOrderTotals() {
        const productTotal = currentQty * UNIT_PRICE;
        const grandTotal = productTotal + currentShippingCost;

        if (summaryProductPrice) summaryProductPrice.textContent = `${productTotal} د.ج`;
        
        if (summaryShippingPrice) {
            if (currentShippingCost > 0) {
                summaryShippingPrice.textContent = `${currentShippingCost} د.ج (${selectedDeliveryMode === 'stopdesk' ? 'مكتب' : 'منزل'})`;
            } else {
                summaryShippingPrice.textContent = `اختر الولاية لتحديد السعر`;
            }
        }

        if (summaryTotalPrice) {
            summaryTotalPrice.textContent = `${grandTotal} د.ج`;
        }
    }

    if (qtyPlus && qtyMinus && qtyInput) {
        qtyPlus.addEventListener('click', () => {
            if (currentQty < 3) {
                currentQty++;
                qtyInput.value = currentQty;
                updateOrderTotals();
            }
        });

        qtyMinus.addEventListener('click', () => {
            if (currentQty > 1) {
                currentQty--;
                qtyInput.value = currentQty;
                updateOrderTotals();
            }
        });
    }

    if (wilayaSelect) {
        wilayaSelect.addEventListener('change', function() {
            const wilayaId = parseInt(wilayaSelect.value, 10);
            selectedWilayaObj = findWilayaById(wilayaId);
            updateDeliverySelectionState();
            updateCommunesDropdown(wilayaId);
        });
    }

    const deliveryRadios = document.querySelectorAll('input[name="deliveryType"]');
    deliveryRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            updateDeliverySelectionState();
        });
    });

    /* --------------------------------------------------------------------------
       Sticky Mobile CTA Bar & Scroll Listener
       -------------------------------------------------------------------------- */
    const stickyMobileBar = document.getElementById('stickyMobileBar');
    const productSec = document.getElementById('product-section');

    window.addEventListener('scroll', () => {
        if (stickyMobileBar && productSec) {
            const productSecTop = productSec.offsetTop;
            if (window.scrollY > 350 && window.scrollY < productSecTop - 250) {
                stickyMobileBar.classList.add('visible');
            } else {
                stickyMobileBar.classList.remove('visible');
            }
        }
    });

    /* --------------------------------------------------------------------------
       3. 1:1 Swipable Image Slider & Gallery System (8 Images)
       -------------------------------------------------------------------------- */
    const sliderImages = document.querySelectorAll('.hero-main-img-1to1');
    const thumbItems = document.querySelectorAll('#thumbsGrid .thumb-item');
    const sliderCounter = document.getElementById('sliderCounter');
    const prevBtn = document.getElementById('sliderPrevBtn');
    const nextBtn = document.getElementById('sliderNextBtn');
    const swipeFrame = document.getElementById('swipeSliderFrame');

    let currentSlideIndex = 0;
    const totalSlides = sliderImages.length;

    function goToSlide(index) {
        if (index < 0) index = totalSlides - 1;
        if (index >= totalSlides) index = 0;
        
        currentSlideIndex = index;

        sliderImages.forEach((img, i) => {
            if (i === currentSlideIndex) img.classList.add('active');
            else img.classList.remove('active');
        });

        thumbItems.forEach((thumb, i) => {
            if (i === currentSlideIndex) thumb.classList.add('active');
            else thumb.classList.remove('active');
        });

        if (sliderCounter) {
            sliderCounter.textContent = `${currentSlideIndex + 1} / ${totalSlides}`;
        }
    }

    if (prevBtn) prevBtn.addEventListener('click', () => goToSlide(currentSlideIndex - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => goToSlide(currentSlideIndex + 1));

    thumbItems.forEach((thumb) => {
        thumb.addEventListener('click', () => {
            const idx = parseInt(thumb.getAttribute('data-index'), 10);
            if (!isNaN(idx)) goToSlide(idx);
        });
    });

    // Touch Swipe Gesture Support
    if (swipeFrame) {
        let touchStartX = 0;
        let touchEndX = 0;

        swipeFrame.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        swipeFrame.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        }, { passive: true });

        function handleSwipe() {
            const swipeThreshold = 35;
            const diffX = touchEndX - touchStartX;

            if (Math.abs(diffX) > swipeThreshold) {
                if (diffX > 0) {
                    goToSlide(currentSlideIndex - 1);
                } else {
                    goToSlide(currentSlideIndex + 1);
                }
            }
        }
    }

    /* --------------------------------------------------------------------------
    /* --------------------------------------------------------------------------
       4. Form Validation & Resend Order Dispatch
       -------------------------------------------------------------------------- */
    const orderForm = document.getElementById('orvaOrderForm');
    const fullNameInput = document.getElementById('fullName');
    const phoneInput = document.getElementById('phoneNumber');
    const submitBtn = document.getElementById('submitBtn');

    let isSubmitting = false;

    function validatePhone(phone) {
        const cleaned = phone.replace(/[\s-]/g, '');
        return /^(05|06|07)[0-9]{8}$/.test(cleaned);
    }

    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    if (orderForm) {
        orderForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (isSubmitting) return;

            let isValid = true;

            const nameVal = fullNameInput.value.trim();
            const nameGroup = fullNameInput.closest('.form-group');
            if (nameVal.length < 3) {
                if (nameGroup) nameGroup.classList.add('invalid');
                isValid = false;
            } else {
                if (nameGroup) nameGroup.classList.remove('invalid');
            }

            const wilayaVal = wilayaSelect.value;
            const wilayaGroup = wilayaSelect.closest('.form-group');
            if (!wilayaVal) {
                if (wilayaGroup) wilayaGroup.classList.add('invalid');
                isValid = false;
            } else {
                if (wilayaGroup) wilayaGroup.classList.remove('invalid');
            }

            const communeVal = communeSelect ? communeSelect.value : '';
            const communeGroup = communeSelect ? communeSelect.closest('.form-group') : null;
            if (!communeVal) {
                if (communeGroup) communeGroup.classList.add('invalid');
                isValid = false;
            } else {
                if (communeGroup) communeGroup.classList.remove('invalid');
            }

            const phoneVal = phoneInput.value.trim();
            const phoneGroup = phoneInput.closest('.form-group');
            if (!validatePhone(phoneVal)) {
                if (phoneGroup) phoneGroup.classList.add('invalid');
                isValid = false;
            } else {
                if (phoneGroup) phoneGroup.classList.remove('invalid');
            }

            if (!isValid) return;

            // Check client-side attempt limit (Max 2 attempts per phone in 24h)
            const cleanPhone = phoneVal.replace(/\D/g, '');
            const attemptsKey = 'orva_sub_attempts_' + cleanPhone;
            let currentAttempts = 0;
            try {
                const stored = localStorage.getItem(attemptsKey);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
                        currentAttempts = parsed.count || 0;
                    }
                }
            } catch (e) {}

            if (currentAttempts >= 2) {
                alert('عذراً، لقد تم تسجيل طلبك مسبقاً (الحد الأقصى محاولتان). سيتصل بك فريقنا هاتفياً لتأكيد طلبك وتجهيز الشحن.');
                return;
            }

            isSubmitting = true;

            // Prepare Order Payload
            const selectedWilayaText = selectedWilayaObj ? selectedWilayaObj.name : (wilayaSelect.selectedIndex > 0 ? wilayaSelect.options[wilayaSelect.selectedIndex].text : '');
            const fullLocationText = selectedWilayaText + (communeVal ? ' — ' + communeVal : '');
            const deliveryTypeLabel = selectedDeliveryMode === 'stopdesk' ? 'توصيل للمكتب (Stop Desk)' : 'توصيل للمنزل';
            const deliveryTimeVal = selectedWilayaObj ? selectedWilayaObj.time : '24 - 48 H';
            const orderId = 'ORVA-' + Math.floor(10000 + Math.random() * 90000);
            const productTotal = currentQty * UNIT_PRICE;
            const shippingFee = currentShippingCost;
            const grandTotalNum = productTotal + shippingFee;

            function getOrCreateDeviceId() {
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

            const fbpCookie = getCookie('_fbp') || undefined;
            const fbcCookie = getCookie('_fbc') || undefined;
            const eventId = `order_${orderId}_${Date.now()}`;

            const payload = {
                orderId,
                eventId,
                fullName: nameVal,
                phone: phoneVal,
                wilaya: fullLocationText,
                deliveryType: deliveryTypeLabel,
                quantity: currentQty,
                productTotal: `${productTotal} د.ج`,
                shippingFee: `${shippingFee} د.ج`,
                grandTotal: `${grandTotalNum} د.ج`,
                deliveryTime: deliveryTimeVal,
                deviceId: getOrCreateDeviceId(),
                fbp: fbpCookie,
                fbc: fbcCookie
            };

            // Loading State on Submit Button
            const originalBtnContent = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = `
                <span>جارٍ إرسال طلبك...</span>
                <i class="fa-solid fa-spinner fa-spin"></i>
            `;

            let isBlocked = false;
            let orderCreatedSuccessfully = false;
            let finalOrderId = orderId;

            try {
                const response = await fetch('/api/send-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                console.log('Order result:', result);

                if (response.status === 429 || (result && result.error === 'RATE_LIMIT_EXCEEDED') || (result && result.error === 'REQUEST_BLOCKED')) {
                    isBlocked = true;
                    alert(result.message || 'عذراً، لا يمكن معالجة طلبك في الوقت الحالي. يرجى الانتظار أو التواصل معنا عبر الواتساب.');
                    return;
                }

                if (!response.ok || !result || result.success !== true) {
                    isBlocked = true;
                    alert((result && result.error) || 'حدث خطأ أثناء إرسال الطلب. يرجى المحاولة مرة أخرى.');
                    return;
                }

                orderCreatedSuccessfully = true;
                finalOrderId = result.orderId || orderId;
                const sharedEventId = result.eventId || eventId;

                // Record successful attempt in local storage
                try {
                    localStorage.setItem(attemptsKey, JSON.stringify({
                        count: currentAttempts + 1,
                        timestamp: Date.now()
                    }));
                } catch (e) {}

                // ── Fire Deduplicated Meta Pixel Purchase Event ONLY after order is confirmed ──
                if (typeof window.fbq === 'function') {
                    try {
                        window.fbq('track', 'Purchase', {
                            content_name: 'Yamaha Sac à Dos + Sacoche',
                            content_type: 'product',
                            value: grandTotalNum,
                            currency: 'DZD',
                            num_items: currentQty
                        }, {
                            eventID: sharedEventId
                        });
                        console.log('[Meta Pixel] Browser Purchase event tracked with eventID:', sharedEventId, grandTotalNum, 'DZD');
                    } catch (pxErr) {
                        console.warn('[Meta Pixel] Event tracking error:', pxErr);
                    }
                }

                // Sync order locally for Admin Dashboard
                try {
                    const existingStr = localStorage.getItem('orva_admin_orders');
                    let list = existingStr ? JSON.parse(existingStr) : [];
                    list.unshift({
                        orderId: finalOrderId,
                        fullName: nameVal,
                        phone: phoneVal,
                        wilaya: fullLocationText,
                        deliveryType: deliveryTypeLabel,
                        grandTotal: grandTotalNum + ' د.ج',
                        priceNum: grandTotalNum,
                        status: 'pending',
                        date: new Date().toISOString().split('T')[0],
                        remarks: []
                    });
                    localStorage.setItem('orva_admin_orders', JSON.stringify(list));
                } catch (lsErr) {}
            } catch (err) {
                console.warn('Backend serverless dispatch local fallback.', err);
                // In local preview fallback without API server running, show receipt
                orderCreatedSuccessfully = true;
            } finally {
                isSubmitting = false;
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnContent;
                if (!isBlocked && orderCreatedSuccessfully) {
                    showSuccessModal(nameVal, phoneVal, finalOrderId, fullLocationText);
                }
            }
        });
    }

    /* --------------------------------------------------------------------------
       5. Success Order Receipt Modal
       -------------------------------------------------------------------------- */
    const successModal = document.getElementById('successModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const modalOrderSummary = document.getElementById('modalOrderSummary');

    function showSuccessModal(name, phone, orderId, fullLocationText) {
        const deliveryTypeLabel = selectedDeliveryMode === 'stopdesk' ? 'توصيل للمكتب (Stop Desk)' : 'توصيل للمنزل';
        const deliveryTimeVal = selectedWilayaObj ? selectedWilayaObj.time : '24 - 48 H';
        const productTotal = currentQty * UNIT_PRICE;
        const shippingFee = currentShippingCost;
        const grandTotal = productTotal + shippingFee;

        if (modalOrderSummary) {
            modalOrderSummary.innerHTML = `
                <div class="receipt-card">
                    <div class="receipt-header-title">
                        <i class="fa-solid fa-receipt text-cyan"></i>
                        <span>فاتورة حساب التكلفة الكلية</span>
                    </div>
                    
                    <div class="receipt-item">
                        <span>رقم الطلب:</span>
                        <strong class="text-cyan">${orderId}</strong>
                    </div>
                    <div class="receipt-item">
                        <span>الاسم الكامل:</span>
                        <strong>${name}</strong>
                    </div>
                    <div class="receipt-item">
                        <span>رقم الهاتف:</span>
                        <strong dir="ltr">${phone}</strong>
                    </div>
                    <div class="receipt-item">
                        <span>الولاية والبلدية:</span>
                        <strong>${fullLocationText || 'الولاية المختارة'}</strong>
                    </div>
                    <div class="receipt-item">
                        <span>نوع التوصيل:</span>
                        <strong class="text-cyan">${deliveryTypeLabel}</strong>
                    </div>
                    <div class="receipt-item">
                        <span>مدة التوصيل:</span>
                        <span class="delivery-time-badge"><i class="fa-solid fa-bolt"></i> ${deliveryTimeVal}</span>
                    </div>
                    <div class="receipt-item">
                        <span>الهدايا المجانية:</span>
                        <strong class="text-cyan">AirPods + ساعة يد</strong>
                    </div>
                    
                    <div class="receipt-divider"></div>
                    
                    <div class="receipt-item">
                        <span>سعر الحقيبة (${currentQty} قطعة):</span>
                        <strong>${productTotal} د.ج</strong>
                    </div>
                    <div class="receipt-item">
                        <span>مصاريف التوصيل:</span>
                        <strong>${shippingFee} د.ج</strong>
                    </div>
                    
                    <div class="receipt-divider bold-divider"></div>
                    
                    <div class="receipt-item receipt-total-row">
                        <span>المبلغ الإجمالي عند الاستلام:</span>
                        <strong class="grand-total-price">${grandTotal} د.ج</strong>
                    </div>
                </div>
            `;
        }

        if (successModal) {
            successModal.classList.add('active');
        }
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            if (successModal) successModal.classList.remove('active');
            orderForm.reset();
            currentQty = 1;
            qtyInput.value = 1;
            currentShippingCost = 0;
            updateOrderTotals();
        });
    }

    /* --------------------------------------------------------------------------
       6. Contact Us Modal Toggle
       -------------------------------------------------------------------------- */
    const contactNavBtn = document.getElementById('contactNavBtn');
    const contactModal = document.getElementById('contactModal');
    const closeContactBtn = document.getElementById('closeContactBtn');
    const closeContactModalBtn = document.getElementById('closeContactModalBtn');

    function toggleContactModal(open) {
        if (!contactModal) return;
        if (open) contactModal.classList.add('active');
        else contactModal.classList.remove('active');
    }

    if (contactNavBtn) {
        contactNavBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleContactModal(true);
        });
    }

    if (closeContactBtn) closeContactBtn.addEventListener('click', () => toggleContactModal(false));
    if (closeContactModalBtn) closeContactModalBtn.addEventListener('click', () => toggleContactModal(false));
});


// Lightweight Visitor Analytics Tracking Beacon
(function() {
    try {
        if (typeof window === 'undefined') return;
        const payload = JSON.stringify({
            event: 'page_view',
            page: window.location.pathname,
            referrer: document.referrer || '',
            sessionId: sessionStorage.getItem('orva_sid') || (function() {
                const sid = 's_' + Math.random().toString(36).substring(2, 10);
                sessionStorage.setItem('orva_sid', sid);
                return sid;
            })()
        });
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/analytics', new Blob([payload], { type: 'application/json' }));
        } else {
            fetch('/api/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function(){});
        }
    } catch (_) {}
})();
