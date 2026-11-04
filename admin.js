/**
 * =============================================================================
 * ORVA STORE — Enterprise Logistics & Management Controller (Light Edition)
 * Couriers: Ecotrack (Redex/DHD/Conexlog/MSM Go), Yalidine, ZR Express, Noest, Maystro
 * =============================================================================
 */

(function () {
    'use strict';

    // ── 1. Strict 100% Bilingual Dictionary ──────────────────────────────────
    const I18N = {
        fr: {
            brandSub: "Tableau de bord",
            searchPlaceholder: "Rechercher par commande, nom, téléphone, wilaya...",
            statusConnected: "Connecté",
            statusSync: "Synchronisé",
            catMain: "MENU PRINCIPAL",
            navDashboard: "Aperçu & Statistiques",
            navOrders: "Gestion des Commandes",
            navAnalytics: "Website Analytics",
            catLogistics: "LOGISTIQUE & TRANSPORTEURS",
            navCreate: "Créer un Colis",
            navTariffs: "Tarifs 58 Wilayas",
            navSettings: "Configuration Transporteurs",
            bannerTag: "Système de Gestion Intégré • Algérie 58 Wilayas",
            bannerTitle: "Tableau de bord logistique & Suivi des Ventes",
            bannerDesc: "Passerelle multicanal connectée aux transporteurs locaux, Google Sheets et Facebook Meta CAPI.",
            btnNewColis: "Nouveau Colis",
            btnExport: "Exporter Excel",
            kpiTotal: "Total Commandes",
            kpiRevenue: "Chiffre d'Affaires COD",
            kpiPending: "En Attente / Préparation",
            kpiShipped: "En Livraison (Transporteurs)",
            kpiReturned: "Retours (Retournés)",
            kpiLiveSync: "Synchronisé",
            kpiToShip: "À expédier",
            kpiReturnRate: "Colis non aboutis",
            chartTrendTitle: "Tendance Quotidienne des Commandes (7 Derniers Jours)",
            chartWilayasTitle: "Top Wilayas les Plus Demandées",
            liveDataBadge: "Données en direct",
            analyticsTitle: "Website Analytics",
            lblReferrers: "Sources de Trafic (Référents)",
            lblDevices: "Appareils & Systèmes",
            lblTopCities: "Villes & Wilayas Principales",
            lblBrowsers: "Navigateurs & Réseau Edge",
            tableTitle: "Journal des Commandes & Expéditions",
            tabAll: "Toutes",
            tabPending: "⏳ En Attente",
            tabShipped: "🚚 Expédiées",
            tabDelivered: "✅ Livrées",
            tabReturned: "⚠️ Retours",
            tableFilterPlaceholder: "Filtrer par nom, téléphone, commune, code...",
            allWilayasOption: "Toutes les Wilayas (58 Wilayas)",
            btnTariffs: "Grille Tarifaire",
            thOrder: "Réf / Tracking",
            thCustomer: "Client",
            thPhone: "Téléphone",
            thDestination: "Wilaya & Commune",
            thAmount: "Montant COD",
            thCarrierStatus: "Statut Transporteur",
            thOrderStatus: "État Commande",
            thActions: "Actions Logistiques",
            loadingOrders: "Chargement des commandes...",
            modalCreateTitle: "Créer et expédier un colis vers le transporteur",
            lblAutoFill: "Sélectionner une commande boutique pour pré-remplir :",
            optSelectOrder: "-- Sélectionner une commande --",
            lblFullName: "Nom complet du client *",
            lblPhone: "Numéro de téléphone *",
            lblWilaya: "Wilaya (58 Wilayas) *",
            lblCommune: "Commune *",
            lblDeliveryType: "Type de livraison",
            optHome: "🏠 Livraison à domicile (Domicile)",
            optDesk: "🏢 Récupération au bureau (Stop Desk)",
            lblPrice: "Montant à encaisser (COD DZD) *",
            lblAddress: "Adresse détaillée / Quartier",
            lblTariffApplied: "Frais de livraison appliqués :",
            btnCancel: "Annuler",
            btnSendToCourier: "Expédier au transporteur ⚡",
            modalTrackTitle: "Suivi en direct du colis (Tracking)",
            lblTrackingCode: "Code de suivi :",
            lblCurrentStatus: "État actuel :",
            modalLabelTitle: "Étiquette Officielle du Transporteur",
            btnOpenOfficialPdf: "Ouvrir / Télécharger le Bordereau PDF",
            btnClose: "Fermer",
            modalSettingsTitle: "Configuration des Transporteurs & Passerelles Algérie",
            lblActiveCarrier: "Sélectionner le transporteur actif pour les expéditions :",
            lblStorageMode: "Moteur de Données & Synchronisation :",
            btnTestCarrier: "Tester la connexion API avec le transporteur ⚡",
            modalTariffsTitle: "Grille Tarifaire des 58 Wilayas d'Algérie",
            thWilaya: "Wilaya",
            thHomeRate: "Livraison à Domicile",
            thDeskRate: "Récupération au Bureau (Stop Desk)",
            thCoverage: "Couverture",
            catDataSecurity: "SÉCURITÉ & ANTI-FRAUDE",
            navRisk: "Bouclier Anti-Fraude & Trust",
            tabRisk: "🛡️ Risque & Fraude",
            modalRiskTitle: "Bouclier Anti-Fraude & Évaluation de Confiance",
            tabConfirmed: "📞 Confirmées",
            tabCancelled: "❌ Annulées",
            statusPendingBadge: "En Attente",
            statusConfirmedBadge: "Confirmé",
            statusShippedBadge: "Chez Transporteur",
            statusDeliveredBadge: "Livré ✅",
            statusReturnedBadge: "Retourné ⚠️",
            statusCancelledBadge: "Annulé",
            alertLabelNotShipped: "L'étiquette officielle n'est disponible qu'après l'envoi du colis au transporteur. Cliquez d'abord sur 'Expédier'."
        },
        ar: {
            catDataSecurity: "البيانات والأمان ومكافحة الاحتيال",
            navRisk: "درع الحماية ومكافحة الاحتيال",
            tabRisk: "🛡️ الاحتيال والمخاطر",
            modalRiskTitle: "تقييم الأمان ودرع مكافحة الاحتيال الذكي",
            brandSub: "لوحة التحكم",
            searchPlaceholder: "ابحث برقم الطلب، الاسم، الهاتف، الولاية...",
            statusConnected: "متصل",
            statusSync: "متزامن",
            catMain: "القائمة الرئيسية",
            navDashboard: "نظرة عامة والتحليلات",
            navOrders: "إدارة الطلبيات والشحن",
            navAnalytics: "تحليلات الموقع (Website Analytics)",
            catLogistics: "اللوجستيك والتوصيل",
            navCreate: "إنشاء طرد جديد",
            navTariffs: "تعرفات 58 ولاية",
            navSettings: "إعدادات شركات التوصيل",
            bannerTag: "نظام إدارة المبيعات الموحد • الجزائر 58 ولاية",
            bannerTitle: "لوحة التحكم اللوجستية وتتبع المبيعات",
            bannerDesc: "ربط متكامل مع شركات التوصيل الجزائرية وقاعدة بيانات إكسل وشيتس وفيسبوك ميتا.",
            btnNewColis: "طرد جديد",
            btnExport: "تصدير إكسل",
            kpiTotal: "إجمالي الطلبيات",
            kpiRevenue: "مداخيل الدفع عند الاستلام",
            kpiPending: "قيد الانتظار / التجهيز",
            kpiShipped: "في التوصيل (الشركات)",
            kpiReturned: "الطرود المرتجعة",
            kpiLiveSync: "متزامن حياً",
            chartTrendTitle: "حركة الطلبيات اليومية (آخر 7 أيام)",
            chartWilayasTitle: "توزيع الولايات الأكثر طلباً",
            liveDataBadge: "بيانات مباشرة",
            analyticsTitle: "إحصائيات الزوار والأجهزة و Facebook CAPI",
            lblReferrers: "مصادر الزيارات (Référents)",
            lblDevices: "أجهزة الزوار",
            lblBrowsers: "المتصفحات والأنظمة",
            tableTitle: "سجل الطلبيات والشحنات",
            tabAll: "الكل",
            tabPending: "⏳ قيد الانتظار",
            tabShipped: "🚚 تم الشحن",
            tabDelivered: "✅ تم التسليم",
            tabReturned: "⚠️ مرتجعات",
            tableFilterPlaceholder: "تصفية بالاسم، الهاتف، البلدية، الكود...",
            allWilayasOption: "كل الولايات (58 ولاية)",
            btnTariffs: "قائمة الأسعار",
            thOrder: "المرجع / التتبع",
            thCustomer: "الزبون",
            thPhone: "الهاتف",
            thDestination: "الولاية والبلدية",
            thAmount: "المبلغ المستحق (COD)",
            thCarrierStatus: "حالة التوصيل",
            thOrderStatus: "حالة الطلب",
            thActions: "إجراءات الشحن",
            loadingOrders: "جاري تحميل الطلبيات...",
            modalCreateTitle: "إنشاء وإرسال طرد جديد إلى شركة التوصيل",
            lblAutoFill: "اختر طلبية واردة من المتجر للتعبئة التلقائية :",
            optSelectOrder: "-- اختر طلبية --",
            lblFullName: "الاسم الكامل للزبون *",
            lblPhone: "رقم الهاتف *",
            lblWilaya: "الولاية (58 ولاية) *",
            lblCommune: "البلدية *",
            lblDeliveryType: "نوع التوصيل",
            optHome: "🏠 توصيل للمنزل (Domicile)",
            optDesk: "🏢 استلام من المكتب (Stop Desk)",
            lblPrice: "المبلغ للدفع عند الاستلام (د.ج) *",
            lblAddress: "العنوان التفصيلي / الحي",
            lblTariffApplied: "تكلفة التوصيل المطبقة :",
            btnCancel: "إلغاء",
            btnSendToCourier: "إرسال فوري لشركة التوصيل ⚡",
            modalTrackTitle: "تتبع مسار الطرد حياً (Tracking)",
            lblTrackingCode: "رقم التتبع :",
            lblCurrentStatus: "الحالة الحالية :",
            modalLabelTitle: "الملصق الرسمي لشركة التوصيل",
            btnOpenOfficialPdf: "فتح / تحميل بوليصة الشحن الرسمية PDF",
            btnClose: "إغلاق",
            modalSettingsTitle: "إعدادات شركات التوصيل والربط في الجزائر",
            lblActiveCarrier: "اختر شركة التوصيل المعتمدة للشحن :",
            lblStorageMode: "محرك التخزين والمزامنة :",
            btnTestCarrier: "فحص الاتصال مع سيرفر شركة التوصيل ⚡",
            modalTariffsTitle: "تعرفات التوصيل عبر 58 ولاية جزائرية",
            thWilaya: "الولاية",
            thHomeRate: "توصيل للمنزل",
            thDeskRate: "استلام من المكتب (Stop Desk)",
            thCoverage: "التغطية",
            tabConfirmed: "📞 مؤكدة",
            tabCancelled: "❌ ملغاة",
            statusPendingBadge: "قيد الانتظار",
            statusConfirmedBadge: "مؤكدة",
            statusShippedBadge: "في شبكة التوصيل",
            statusDeliveredBadge: "تم التسليم ✅",
            statusReturnedBadge: "مرتجع ⚠️",
            statusCancelledBadge: "ملغاة",
            alertLabelNotShipped: "الملصق الرسمي متاح فقط بعد إرسال الطرد إلى شركة التوصيل. يرجى الضغط على 'إرسال' أولاً."
        }
    };

    // ── 2. Standard 58 Wilayas Mapping ────────────────────────────────────────
    const WILAYAS_MAP = {
        1: { nameFr: "01 - Adrar", nameAr: "01 - أدرار", home: 1000, desk: 600 },
        2: { nameFr: "02 - Chlef", nameAr: "02 - الشلف", home: 700, desk: 400 },
        3: { nameFr: "03 - Laghouat", nameAr: "03 - الأغواط", home: 900, desk: 500 },
        4: { nameFr: "04 - Oum El Bouaghi", nameAr: "04 - أم البواقي", home: 800, desk: 450 },
        5: { nameFr: "05 - Batna", nameAr: "05 - باتنة", home: 800, desk: 450 },
        6: { nameFr: "06 - Béjaïa", nameAr: "06 - بجاية", home: 750, desk: 400 },
        7: { nameFr: "07 - Biskra", nameAr: "07 - بسكرة", home: 550, desk: 350 },
        8: { nameFr: "08 - Béchar", nameAr: "08 - بشار", home: 1000, desk: 600 },
        9: { nameFr: "09 - Blida", nameAr: "09 - البليدة", home: 600, desk: 350 },
        10: { nameFr: "10 - Bouira", nameAr: "10 - البويرة", home: 700, desk: 400 },
        11: { nameFr: "11 - Tamanrasset", nameAr: "11 - تمنراست", home: 1400, desk: 900 },
        12: { nameFr: "12 - Tébessa", nameAr: "12 - تبسة", home: 850, desk: 500 },
        13: { nameFr: "13 - Tlemcen", nameAr: "13 - تلمسان", home: 800, desk: 450 },
        14: { nameFr: "14 - Tiaret", nameAr: "14 - تيارت", home: 800, desk: 450 },
        15: { nameFr: "15 - Tizi Ouzou", nameAr: "15 - تيزي وزو", home: 700, desk: 400 },
        16: { nameFr: "16 - Alger", nameAr: "16 - الجزائر", home: 400, desk: 300 },
        17: { nameFr: "17 - Djelfa", nameAr: "17 - الجلفة", home: 900, desk: 500 },
        18: { nameFr: "18 - Jijel", nameAr: "18 - جيجل", home: 750, desk: 400 },
        19: { nameFr: "19 - Sétif", nameAr: "19 - سطيف", home: 750, desk: 400 },
        20: { nameFr: "20 - Saïda", nameAr: "20 - سعيدة", home: 850, desk: 500 },
        21: { nameFr: "21 - Skikda", nameAr: "21 - سكيكدة", home: 800, desk: 450 },
        22: { nameFr: "22 - Sidi Bel Abbès", nameAr: "22 - سيدي بلعباس", home: 800, desk: 450 },
        23: { nameFr: "23 - Annaba", nameAr: "23 - عنابة", home: 800, desk: 450 },
        24: { nameFr: "24 - Guelma", nameAr: "24 - قالمة", home: 800, desk: 450 },
        25: { nameFr: "25 - Constantine", nameAr: "25 - قسنطينة", home: 750, desk: 400 },
        26: { nameFr: "26 - Médéa", nameAr: "26 - المدية", home: 700, desk: 400 },
        27: { nameFr: "27 - Mostaganem", nameAr: "27 - مستغانم", home: 800, desk: 450 },
        28: { nameFr: "28 - M'Sila", nameAr: "28 - المسيلة", home: 800, desk: 450 },
        29: { nameFr: "29 - Mascara", nameAr: "29 - معسكر", home: 800, desk: 450 },
        30: { nameFr: "30 - Ouargla", nameAr: "30 - ورقلة", home: 950, desk: 550 },
        31: { nameFr: "31 - Oran", nameAr: "31 - وهران", home: 750, desk: 400 },
        32: { nameFr: "32 - El Bayadh", nameAr: "32 - البيض", home: 1000, desk: 600 },
        33: { nameFr: "33 - Illizi", nameAr: "33 - إليزي", home: 1400, desk: 900 },
        34: { nameFr: "34 - Bordj Bou Arréridj", nameAr: "34 - برج بوعريريج", home: 750, desk: 400 },
        35: { nameFr: "35 - Boumerdès", nameAr: "35 - بومرداس", home: 600, desk: 350 },
        36: { nameFr: "36 - El Tarf", nameAr: "36 - الطارف", home: 850, desk: 500 },
        37: { nameFr: "37 - Tindouf", nameAr: "37 - تندوف", home: 1500, desk: 1000 },
        38: { nameFr: "38 - Tissemsilt", nameAr: "38 - تيسمسيلت", home: 850, desk: 500 },
        39: { nameFr: "39 - El Oued", nameAr: "39 - الوادي", home: 950, desk: 550 },
        40: { nameFr: "40 - Khenchela", nameAr: "40 - خنشلة", home: 850, desk: 500 },
        41: { nameFr: "41 - Souk Ahras", nameAr: "41 - سوق أهراس", home: 850, desk: 500 },
        42: { nameFr: "42 - Tipaza", nameAr: "42 - تيبازة", home: 600, desk: 350 },
        43: { nameFr: "43 - Mila", nameAr: "43 - ميلة", home: 750, desk: 400 },
        44: { nameFr: "44 - Aïn Defla", nameAr: "44 - عين الدفلى", home: 700, desk: 400 },
        45: { nameFr: "45 - Naâma", nameAr: "45 - النعامة", home: 1000, desk: 600 },
        46: { nameFr: "46 - Aïn Témouchent", nameAr: "46 - عين تموشنت", home: 800, desk: 450 },
        47: { nameFr: "47 - Ghardaïa", nameAr: "47 - غرداية", home: 950, desk: 550 },
        48: { nameFr: "48 - Relizane", nameAr: "48 - غليزان", home: 800, desk: 450 },
        49: { nameFr: "49 - Timimoun", nameAr: "49 - تيميمون", home: 1100, desk: 700 },
        50: { nameFr: "50 - Bordj Badji Mokhtar", nameAr: "50 - برج باجي مختار", home: 1600, desk: 1100 },
        51: { nameFr: "51 - Ouled Djellal", nameAr: "51 - أولاد جلال", home: 900, desk: 500 },
        52: { nameFr: "52 - Béni Abbès", nameAr: "52 - بني عباس", home: 1100, desk: 700 },
        53: { nameFr: "53 - In Salah", nameAr: "53 - عين صالح", home: 1400, desk: 900 },
        54: { nameFr: "54 - In Guezzam", nameAr: "54 - عين قزام", home: 1600, desk: 1100 },
        55: { nameFr: "55 - Touggourt", nameAr: "55 - تقرت", home: 950, desk: 550 },
        56: { nameFr: "56 - Djanet", nameAr: "56 - جانت", home: 1500, desk: 1000 },
        57: { nameFr: "57 - El M'Ghair", nameAr: "57 - المغير", home: 950, desk: 550 },
        58: { nameFr: "58 - El Meniaa", nameAr: "58 - المنيعة", home: 1100, desk: 700 }
    };

    // State Variables
    let ordersList = [];
    let currentFilter = 'all';
    let currentWilayaFilter = '';
    let searchQuery = '';
    let currentLang = 'fr';
    let activeCourierId = 'redex';
    let autoSyncInterval = null;

    // ── 3. Main Controller Object ────────────────────────────────────────────
    const storeAdmin = {
        init: function () {
            this.initAuthCheck();
            this.initCarrierSettings();
            this.setupSidebarEvents();
            this.populateWilayaDropdowns();
            this.fetchOrders();
            this.fetchAnalytics();

            // Auto-refresh every 20 seconds
            if (!autoSyncInterval) {
                autoSyncInterval = setInterval(() => this.fetchOrders(false), 20000);
            }
        },

        // -----------------------------------------------------------------
        // SECURITY NOTE (Phase 5D): orva_carrier_token is the Ecotrack/Redex
        // carrier API key entered by the operator in the Settings modal.
        // It is NOT the admin session token.
        //
        // Limitation: Storing it in localStorage exposes it to any JS running
        // on the same origin. The recommended migration path is:
        //   1. Store the carrier token as an environment variable on Hostinger.
        //   2. The server (delivery.php) proxies all carrier API calls.
        //   3. Remove the token from localStorage entirely.
        //
        // Until that migration is done (requires server-side changes), this
        // stores the carrier token in sessionStorage instead of localStorage
        // so it is cleared when the browser tab closes. This reduces, but does
        // not eliminate, the XSS risk.
        // -----------------------------------------------------------------

        getStoredCarrierToken: function () {
            return sessionStorage.getItem('orva_carrier_token') || '';
        },

        getStoredCarrierBaseUrl: function () {
            return sessionStorage.getItem('orva_carrier_base_url') || 'https://redex.ecotrack.dz';
        },

        saveCarrierSettings: function () {
            const tokenInput = document.getElementById('settingsApiToken');
            const urlInput = document.getElementById('settingsBaseUrl');
            if (tokenInput) {
                // Migrated from localStorage to sessionStorage (Phase 5D).
                // TODO: Migrate to server-side env var + proxy endpoint.
                sessionStorage.setItem('orva_carrier_token', tokenInput.value.trim());
            }
            if (urlInput) {
                sessionStorage.setItem('orva_carrier_base_url', urlInput.value.trim() || 'https://redex.ecotrack.dz');
            }
        },

        initCarrierSettings: function () {
            const tokenInput = document.getElementById('settingsApiToken');
            const urlInput = document.getElementById('settingsBaseUrl');
            if (tokenInput) {
                tokenInput.value = this.getStoredCarrierToken();
                tokenInput.addEventListener('input', () => this.saveCarrierSettings());
                tokenInput.addEventListener('change', () => this.saveCarrierSettings());
            }
            if (urlInput) {
                urlInput.value = this.getStoredCarrierBaseUrl();
                urlInput.addEventListener('input', () => this.saveCarrierSettings());
                urlInput.addEventListener('change', () => this.saveCarrierSettings());
            }
        },

        initAuthCheck: async function () {
            const overlay = document.getElementById('adminAuthOverlay');
            if (!overlay) return;
            overlay.style.display = 'flex';

            try {
                const res = await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'session' })
                });
                const data = await res.json().catch(() => ({}));

                if (res.ok && data.success) {
                    sessionStorage.setItem('orva_admin_logged', 'true');
                    sessionStorage.removeItem('orva_admin_token');
                    overlay.style.display = 'none';
                } else {
                    sessionStorage.removeItem('orva_admin_logged');
                    sessionStorage.removeItem('orva_admin_token');
                    setTimeout(() => {
                        document.getElementById('adminAuthPassword')?.focus();
                    }, 300);
                }
            } catch (authError) {
                sessionStorage.removeItem('orva_admin_logged');
                sessionStorage.removeItem('orva_admin_token');
                setTimeout(() => {
                    document.getElementById('adminAuthPassword')?.focus();
                }, 300);
            }
        },

        handleAuthSubmit: async function (e) {
            if (e) e.preventDefault();
            const input = document.getElementById('adminAuthPassword');
            const err = document.getElementById('adminAuthError');
            const submitBtn = document.querySelector('.auth-btn-submit');
            const pass = input ? input.value.trim() : '';

            if (!pass) return;

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.style.opacity = '0.7';
            }

            try {
                // Verify against Vercel backend environment key (ADMIN_PASSWORD)
                let res = await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: pass })
                });

                // Fallback to /api/delivery?action=login if /api/auth returns 404
                if (res.status === 404) {
                    res = await fetch('/api/delivery?action=login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password: pass })
                    });
                }

                const data = await res.json().catch(() => ({}));

                if (res.ok && data.success) {
                    sessionStorage.setItem('orva_admin_logged', 'true');
                    sessionStorage.removeItem('orva_admin_token');
                    const overlay = document.getElementById('adminAuthOverlay');
                    if (overlay) overlay.style.display = 'none';
                    if (err) err.style.display = 'none';
                    this.fetchOrders(true);
                } else {
                    if (err) {
                        err.textContent = currentLang === 'fr' 
                            ? 'Mot de passe incorrect. Veuillez vérifier la variable ADMIN_PASSWORD sur Vercel.' 
                            : 'كلمة المرور غير صحيحة. يرجى التأكد من مفتاح ADMIN_PASSWORD في Vercel.';
                        err.style.display = 'block';
                    }
                    if (input) {
                        input.value = '';
                        input.focus();
                    }
                }
            } catch (networkErr) {
                console.warn('[Admin Auth Network Error]:', networkErr);
                if (err) {
                    err.textContent = currentLang === 'fr' 
                        ? 'Erreur réseau lors de la vérification du mot de passe.' 
                        : 'حدث خطأ في الاتصال أثناء التحقق من كلمة السر.';
                    err.style.display = 'block';
                }
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.style.opacity = '1';
                }
            }
        },

        logout: async function () {
            try {
                const res = await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'logout' })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) throw new Error('تعذر إنهاء جلسة الإدارة.');
            } catch {
                this.showToast(
                    currentLang === 'fr' ? 'Impossible de fermer la session.' : 'تعذر إنهاء جلسة الإدارة؛ تحقق من الاتصال وأعد المحاولة.',
                    'error'
                );
                return;
            }

            sessionStorage.removeItem('orva_admin_logged');
            sessionStorage.removeItem('orva_admin_token');
            const overlay = document.getElementById('adminAuthOverlay');
            if (overlay) overlay.style.display = 'flex';
            const input = document.getElementById('adminAuthPassword');
            if (input) {
                input.value = '';
                input.focus();
            }
        },

        toggleMobileCharts: function () {
            document.body.classList.toggle('show-charts');
            const btnText = document.getElementById('toggleChartsBtnText');
            if (btnText) {
                const isShowing = document.body.classList.contains('show-charts');
                btnText.textContent = isShowing 
                    ? (currentLang === 'fr' ? 'Masquer les graphiques' : 'إخفاء الرسوم والتحليلات') 
                    : (currentLang === 'fr' ? 'Afficher les graphiques et métriques' : 'عرض الرسوم البيانية والتحليلات المتقدمة');
            }
        },

        renderMobileOrders: function (orders) {
            const container = document.getElementById('mobileOrdersContainer');
            if (!container) return;

            if (!orders || orders.length === 0) {
                container.innerHTML = `
                    <div style="text-align:center; padding: 30px; background:#fff; border-radius:16px; border:1px solid var(--border-color); color:var(--text-muted);">
                        <i class="fa-solid fa-inbox fa-2x mb-2" style="opacity:0.3;"></i>
                        <p>${currentLang === 'fr' ? 'Aucune commande trouvée' : 'لا توجد أي طلبيات حالياً'}</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = orders.map(o => {
                const rawPhone = String(o.phone || '').replace(/\D/g, '');
                const waPhone = rawPhone.startsWith('0') ? '213' + rawPhone.slice(1) : (rawPhone.startsWith('213') ? rawPhone : '213' + rawPhone);
                const waText = encodeURIComponent(`السلام عليكم ${o.fullName || 'أخي الكريم'}، نتصل بك من متجر ORVA Store لتأكيد طلبيتك رقم ${o.orderId} (${o.productName || 'باقة الأدوات'}).`);

                const statusSelectHtml = this.renderStatusSelect(o);

                return `
                    <div class="mobile-order-card">
                        <div class="card-top-row">
                            <span class="card-order-id">${o.orderId}</span>
                            ${statusSelectHtml}
                        </div>

                        <div class="card-customer-row">
                            <div>
                                <div class="card-customer-name">${o.fullName || 'زبون'}</div>
                                <div class="card-location"><i class="fa-solid fa-location-dot text-amber"></i> ${o.wilaya || 'غير محدد'} (${o.commune || ''})</div>
                            </div>
                            <span class="card-order-date">${(o.date || o.createdAt || '').slice(0, 10)}</span>
                        </div>

                        <div class="card-product-row">
                            <span class="card-product-name"><i class="fa-solid fa-box text-primary"></i> ${o.productName || 'Pack 1'}</span>
                            <span class="card-total-price">${o.grandTotal || (o.priceNum + ' DZD')}</span>
                        </div>

                        <div class="card-mobile-actions">
                            <a href="tel:${o.phone}" class="btn-mobile-call">
                                <i class="fa-solid fa-phone"></i> <span>${currentLang === 'fr' ? 'Appeler' : 'اتصال'} (${o.phone})</span>
                            </a>
                            <a href="https://wa.me/${waPhone}?text=${waText}" target="_blank" class="btn-mobile-whatsapp">
                                <i class="fa-brands fa-whatsapp"></i> <span>${currentLang === 'fr' ? 'WhatsApp' : 'واتساب'}</span>
                            </a>
                        </div>

                        <div class="card-mobile-actions card-mobile-ops">
                            <button type="button" class="btn-mobile-ship" onclick="storeAdmin.openAutoFillShipModal('${o.orderId}')">
                                <i class="fa-solid fa-truck-fast"></i> <span>${currentLang === 'fr' ? 'Expédier au transporteur' : 'إرسال لشركة التوصيل'}</span>
                            </button>
                            <button type="button" class="btn-mobile-delete" onclick="event.stopPropagation(); storeAdmin.deleteColis('${o.orderId}')">
                                <i class="fa-solid fa-trash-can"></i> <span>${currentLang === 'fr' ? 'Supprimer' : 'حذف الطلبية'}</span>
                            </button>
                        </div>

                        <div class="card-secondary-actions">
                            <div style="font-size:11px; color:var(--text-muted); font-weight:600;">
                                ${o.in_redex ? '🚚 ' + (o.redex_tracking_code || 'في التوصيل') : (currentLang === 'fr' ? 'Non expédié' : 'لم تشحن بعد')}
                            </div>
                            <div style="display:flex; gap:6px;">
                                <button type="button" class="btn-action-sm btn-act-print" onclick="storeAdmin.printOfficialLabel('${o.orderId}')" title="${currentLang === 'fr' ? 'Étiquette' : 'طباعة'}">
                                    <i class="fa-solid fa-print"></i> <span>${currentLang === 'fr' ? 'Étiquette' : 'طباعة الملصق'}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        },

        switchTab: function (tabId) {
            document.querySelectorAll('.sidebar-nav .nav-link').forEach(l => l.classList.remove('active'));
            const targetLink = document.querySelector(`.sidebar-nav .nav-link[href="#${tabId}"]`);
            if (targetLink) targetLink.classList.add('active');

            if (tabId === 'dashboard') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else if (tabId === 'orders') {
                const sec = document.getElementById('ordersSection');
                if (sec) sec.scrollIntoView({ behavior: 'smooth' });
            } else if (tabId === 'analytics') {
                const sec = document.getElementById('analyticsSection');
                if (sec) sec.scrollIntoView({ behavior: 'smooth' });
                this.fetchAnalytics();
            }
        },

        setupSidebarEvents: function () {
            const toggleBtn = document.getElementById('sidebarToggleBtn');
            const sidebar = document.getElementById('appSidebar');
            const backdrop = document.getElementById('sidebarBackdrop');

            if (toggleBtn && sidebar) {
                toggleBtn.addEventListener('click', () => {
                    if (window.innerWidth <= 992) {
                        sidebar.classList.toggle('open');
                        backdrop?.classList.toggle('active');
                    } else {
                        sidebar.classList.toggle('collapsed');
                    }
                });
            }
        },

        closeMobileSidebar: function () {
            document.getElementById('appSidebar')?.classList.remove('open');
            document.getElementById('sidebarBackdrop')?.classList.remove('active');
        },

        populateWilayaDropdowns: function () {
            const formSelect = document.getElementById('formWilayaCode');
            const tableSelect = document.getElementById('wilayaFilterSelect');

            if (formSelect) {
                formSelect.innerHTML = `<option value="">-- ${currentLang === 'fr' ? 'Choisir la Wilaya' : 'اختر الولاية'} --</option>`;
            }
            if (tableSelect) {
                tableSelect.innerHTML = `<option value="">${currentLang === 'fr' ? 'Toutes les Wilayas (58 Wilayas)' : 'كل الولايات (58 ولاية)'}</option>`;
            }

            for (let i = 1; i <= 58; i++) {
                const w = WILAYAS_MAP[i];
                if (!w) continue;
                const label = currentLang === 'fr' ? w.nameFr : w.nameAr;

                if (formSelect) {
                    const opt = document.createElement('option');
                    opt.value = i;
                    opt.textContent = label;
                    formSelect.appendChild(opt);
                }

                if (tableSelect) {
                    const opt = document.createElement('option');
                    opt.value = i;
                    opt.textContent = label;
                    tableSelect.appendChild(opt);
                }
            }
        },

        fetchOrders: async function (showAnimation = false) {
            const icon = document.getElementById('refreshIcon');
            if (showAnimation && icon) icon.classList.add('fa-spin');

            try {
                const res = await fetch('/api/delivery?action=get_all_orders');
                const json = await res.json();
                if (json.success && Array.isArray(json.data)) {
                    ordersList = json.data;
                    this.renderTable();
                    this.updateKPIs();
                    this.renderCharts();
                    this.populateAutoFillDropdown();
                    this.fetchAnalytics();

                    // If opened directly from Telegram notification with ?orderId=
                    try {
                        const urlParams = new URLSearchParams(window.location.search);
                        const targetOrderId = urlParams.get('orderId');
                        if (targetOrderId && !searchQuery) {
                            const searchInput = document.getElementById('globalSearchInput');
                            if (searchInput) {
                                searchInput.value = targetOrderId;
                                this.handleSearch(targetOrderId);
                            }
                        }
                    } catch (e) {
                        console.warn('[StoreAdmin] Query param parse error:', e);
                    }
                }
            } catch (err) {
                console.warn('[StoreAdmin] Fetch orders error:', err);
            } finally {
                if (showAnimation && icon) {
                    setTimeout(() => icon.classList.remove('fa-spin'), 600);
                }
            }
        },

        fetchAnalytics: async function () {
            try {
                const res = await fetch('/api/delivery?action=analytics');
                const json = await res.json();
                if (!json.success) return;

                // KPI Mini Cards
                if (json.overview) {
                    const visEl = document.getElementById('anTotalVisitors');
                    if (visEl) visEl.textContent = Number(json.overview.totalVisitors).toLocaleString();

                    const pvEl = document.getElementById('anPageViews');
                    if (pvEl) pvEl.textContent = Number(json.overview.pageViews).toLocaleString();

                    const crEl = document.getElementById('anConversionRate');
                    if (crEl) crEl.textContent = json.overview.conversionRate || '3.8%';

                    const durEl = document.getElementById('anAvgDuration');
                    if (durEl) durEl.textContent = json.overview.avgSessionDuration || '2m 45s';
                }

                // Referrers List
                if (Array.isArray(json.referrers)) {
                    const refEl = document.getElementById('referrersList');
                    if (refEl) {
                        refEl.innerHTML = json.referrers.map(r => `
                            <div class="analytics-row">
                                <span>${r.name}</span>
                                <strong>${r.share}</strong>
                            </div>
                        `).join('');
                    }
                }

                // Devices List
                if (Array.isArray(json.devices)) {
                    const devEl = document.getElementById('devicesList');
                    if (devEl) {
                        devEl.innerHTML = json.devices.map(d => `
                            <div class="analytics-row">
                                <span>${d.name}</span>
                                <strong style="color:var(--emerald);">${d.share}</strong>
                            </div>
                        `).join('');
                    }
                }

                // Top Cities / Wilayas List
                if (Array.isArray(json.topCities)) {
                    const cityEl = document.getElementById('citiesList');
                    if (cityEl) {
                        cityEl.innerHTML = json.topCities.map(c => `
                            <div class="analytics-row">
                                <span>${c.city}</span>
                                <strong style="color:var(--amber);">${c.share}</strong>
                            </div>
                        `).join('');
                    }
                }

                // Browsers List
                if (Array.isArray(json.browsers)) {
                    const brEl = document.getElementById('browsersList');
                    if (brEl) {
                        brEl.innerHTML = json.browsers.map(b => `
                            <div class="analytics-row">
                                <span>${b.name}</span>
                                <strong style="color:var(--purple);">${b.share}</strong>
                            </div>
                        `).join('');
                    }
                }
            } catch (e) {
                console.warn('[StoreAdmin] fetchAnalytics error:', e);
            }
        },

        renderTable: function () {
            const tbody = document.getElementById('ordersTableBody');
            const countEl = document.getElementById('tableOrdersCount');
            if (!tbody) return;

            let filtered = ordersList.slice();

            // Status Filter Tab
            if (currentFilter === 'pending') {
                filtered = filtered.filter(o => !o.in_redex && (o.status === 'pending' || o.status === 'قيد الانتظار'));
            } else if (currentFilter === 'confirmed') {
                filtered = filtered.filter(o => o.status === 'confirmed' || o.status === 'مؤكدة');
            } else if (currentFilter === 'shipped') {
                filtered = filtered.filter(o => o.in_redex || o.status === 'shipped' || (o.status && o.status.includes('Redex')));
            } else if (currentFilter === 'delivered') {
                filtered = filtered.filter(o => o.status === 'delivered' || (o.status && o.status.includes('Livré')));
            } else if (currentFilter === 'returned') {
                filtered = filtered.filter(o => o.status === 'returned' || (o.status && (o.status.includes('Retour') || o.status.includes('مرتجع'))));
            } else if (currentFilter === 'cancelled') {
                filtered = filtered.filter(o => o.status === 'cancelled' || o.status === 'ملغاة');
            } else if (currentFilter === 'risk') {
                filtered = filtered.filter(o => (o.riskScore && o.riskScore >= 40) || o.riskLevel === 'HIGH' || o.riskDecision === 'BLOCK');
            }

            // Wilaya Dropdown Filter
            if (currentWilayaFilter) {
                filtered = filtered.filter(o => {
                    const match = String(o.wilaya || '').match(/^(\d{1,2})/);
                    return match && parseInt(match[1]) === parseInt(currentWilayaFilter);
                });
            }

            // Search Query Filter
            if (searchQuery) {
                const q = searchQuery.toLowerCase().trim();
                filtered = filtered.filter(o =>
                    (o.orderId && o.orderId.toLowerCase().includes(q)) ||
                    (o.fullName && o.fullName.toLowerCase().includes(q)) ||
                    (o.phone && o.phone.includes(q)) ||
                    (o.wilaya && o.wilaya.toLowerCase().includes(q)) ||
                    (o.commune && o.commune.toLowerCase().includes(q)) ||
                    (o.redex_tracking_code && o.redex_tracking_code.toLowerCase().includes(q)) ||
                    (o.tracking_code && o.tracking_code.toLowerCase().includes(q))
                );
            }

            if (countEl) countEl.textContent = `${filtered.length} ${currentLang === 'fr' ? 'commandes' : 'طلبية'}`;

            if (filtered.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" class="text-center py-5 text-muted">
                            <i class="fa-solid fa-inbox fa-2x mb-2" style="display:block;opacity:0.3;"></i>
                            <span>${currentLang === 'fr' ? 'Aucune commande ne correspond aux critères.' : 'لا توجد طلبيات تطابق الفلتر المحدد.'}</span>
                        </td>
                    </tr>
                `;
                this.renderMobileOrders([]);
                return;
            }

            tbody.innerHTML = '';
            filtered.forEach(o => {
                const tr = document.createElement('tr');
                
                // Status Selector
                const statusSelectHtml = this.renderStatusSelect(o);

                // Courier Status Badge
                const isInCourier = o.in_redex || (o.tracking_code && o.tracking_code.startsWith('ECE'));
                const carrierBadge = isInCourier
                    ? `<span class="status-badge badge-shipped"><span class="live-dot pulse-green" style="width:6px;height:6px;"></span> ${o.redex_tracking_code || o.tracking_code || 'En Transit'}</span>`
                    : `<span class="status-badge badge-pending">${currentLang === 'fr' ? 'Non Expédié' : 'لم يُرسل بعد'}</span>`;

                // Row Actions
                const actionsHtml = isInCourier ? `
                    <div class="table-actions-flex">
                        <button class="btn-action-sm btn-act-track" onclick="storeAdmin.trackColis('${o.orderId}')" title="${currentLang === 'fr' ? 'Suivre le colis' : 'تتبع الطرد'}">
                            <i class="fa-solid fa-route"></i> ${currentLang === 'fr' ? 'Suivre' : 'تتبع'}
                        </button>
                        <button class="btn-action-sm btn-act-print" onclick="storeAdmin.printOfficialLabel('${o.orderId}')" title="${currentLang === 'fr' ? 'Étiquette Officielle PDF' : 'الملصق الرسمي'}">
                            <i class="fa-solid fa-print"></i> ${currentLang === 'fr' ? 'Étiquette' : 'ملصق'}
                        </button>
                        <button type="button" class="btn-action-sm btn-act-del" onclick="event.stopPropagation(); storeAdmin.deleteColis('${o.orderId}')" title="${currentLang === 'fr' ? 'Supprimer' : 'حذف'}">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                ` : `
                    <div class="table-actions-flex">
                        <button class="btn-action-sm btn-act-ship" onclick="storeAdmin.openAutoFillShipModal('${o.orderId}')" title="${currentLang === 'fr' ? 'Expédier au transporteur' : 'إرسال للتوصيل'}">
                            <i class="fa-solid fa-truck-fast"></i> ${currentLang === 'fr' ? 'Expédier ⚡' : 'إرسال ⚡'}
                        </button>
                        <button class="btn-action-sm btn-act-print" onclick="storeAdmin.printOfficialLabel('${o.orderId}')" title="${currentLang === 'fr' ? 'Étiquette' : 'ملصق'}">
                            <i class="fa-solid fa-print"></i>
                        </button>
                        <button type="button" class="btn-action-sm btn-act-del" onclick="event.stopPropagation(); storeAdmin.deleteColis('${o.orderId}')" title="${currentLang === 'fr' ? 'Supprimer' : 'حذف'}">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                `;

                // Risk & Trust Badge (Risk Shield Paused by Admin)
                const riskPill = `<div style="margin-top:4px;"><span class="status-badge badge-delivered" onclick="storeAdmin.viewRisk('${o.orderId}')" style="cursor:pointer; font-size:10px;" title="درع الأمان معطل مؤقتاً">🟢 ${currentLang === 'fr' ? 'Approuvé (Bouclier en pause)' : 'معتمد (الدرع معطل)'}</span></div>`;

                tr.innerHTML = `
                    <td>
                        <strong style="font-family:'JetBrains Mono', monospace; color:var(--primary);">${o.orderId}</strong>
                        <br><small style="color:var(--text-muted);">${(o.date || o.createdAt || '').slice(0, 10)}</small>
                    </td>
                    <td>
                        <strong>${o.fullName || 'Client'}</strong>
                    </td>
                    <td>
                        <a href="tel:${o.phone}" style="color:var(--primary); text-decoration:none; font-family:monospace; font-weight:700;">
                            ${o.phone}
                        </a>
                    </td>
                    <td>
                        <span>${o.wilaya || '16 - Alger'}</span>
                        <br><small style="color:var(--text-muted);">${o.commune || 'Alger'} (${o.deliveryType || 'Domicile'})</small>
                    </td>
                    <td>
                        <strong style="color:var(--emerald);">${o.grandTotal || (o.priceNum + ' DZD')}</strong>
                    </td>
                    <td>${carrierBadge}</td>
                    <td>
                        ${statusSelectHtml}
                        ${riskPill}
                    </td>
                    <td>${actionsHtml}</td>
                `;

                tbody.appendChild(tr);
            });

            this.renderMobileOrders(filtered);
        },

        updateKPIs: function () {
            const total = ordersList.length;
            const rev = ordersList.reduce((sum, o) => {
                const raw = String(o.priceNum || o.grandTotal || 0).replace(/[^\d]/g, '');
                return sum + (parseInt(raw, 10) || 4950);
            }, 0);
            const pending = ordersList.filter(o => !o.in_redex && (o.status === 'pending' || o.status === 'قيد الانتظار')).length;
            const shipped = ordersList.filter(o => o.in_redex || o.status === 'shipped' || (o.status && o.status.includes('Redex'))).length;
            
            // Accurately calculate Returned Packages
            const returned = ordersList.filter(o => {
                const s = String(o.status || '').toLowerCase();
                return s === 'returned' || s.includes('retour') || s.includes('مرتجع') || s.includes('echou') || s.includes('refus');
            }).length;

            const elTotal = document.getElementById('kpiTotalOrders');
            const elRev = document.getElementById('kpiRevenue');
            const elPending = document.getElementById('kpiPending');
            const elShipped = document.getElementById('kpiShipped');
            const elReturned = document.getElementById('kpiReturned');

            const sideTotal = document.getElementById('sideTotalBadge');
            const sidePending = document.getElementById('sidePendingBadge');

            if (elTotal) elTotal.textContent = total;
            if (elRev) elRev.textContent = rev.toLocaleString(currentLang === 'fr' ? 'fr-FR' : 'ar-DZ') + ' DZD';
            if (elPending) elPending.textContent = pending;
            if (elShipped) elShipped.textContent = shipped;
            if (elReturned) elReturned.textContent = returned;

            if (sideTotal) sideTotal.textContent = total;
            if (sidePending) sidePending.textContent = pending;
        },

        // ── 4. Real HTML5 Canvas Analytics Charts (Light Theme) ───────────────
        renderCharts: function () {
            this.renderTrendChart();
            this.renderWilayaChart();
        },

        renderTrendChart: function () {
            const canvas = document.getElementById('trendChartCanvas');
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            const w = canvas.width = canvas.parentElement.clientWidth || 500;
            const h = canvas.height = canvas.parentElement.clientHeight || 220;
            ctx.clearRect(0, 0, w, h);

            const PAD = { top: 20, right: 20, bottom: 35, left: 40 };
            const dayKeys = [];
            const dayLabels = [];
            const daysFr = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
            const daysAr = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
            const today = new Date();

            for (let i = 6; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(today.getDate() - i);
                dayKeys.push(d.toISOString().slice(0, 10));
                dayLabels.push(currentLang === 'fr' ? daysFr[d.getDay()] : daysAr[d.getDay()]);
            }

            const counts = dayKeys.map(k =>
                ordersList.filter(o => (o.date || o.createdAt || '').slice(0, 10) === k).length
            );

            const maxVal = Math.max(...counts, 4);
            const chartW = w - PAD.left - PAD.right;
            const chartH = h - PAD.top - PAD.bottom;
            const stepX = chartW / (counts.length - 1);

            const pts = counts.map((v, i) => ({
                x: PAD.left + i * stepX,
                y: PAD.top + chartH - (v / maxVal) * chartH
            }));

            // Grid lines
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 1;
            for (let g = 0; g <= 4; g++) {
                const gy = PAD.top + (chartH / 4) * g;
                ctx.beginPath();
                ctx.moveTo(PAD.left, gy);
                ctx.lineTo(w - PAD.right, gy);
                ctx.stroke();
            }

            // Fill Area Gradient
            const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + chartH);
            grad.addColorStop(0, 'rgba(79, 70, 229, 0.2)');
            grad.addColorStop(1, 'rgba(79, 70, 229, 0.0)');

            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, pts[i].y);
            }
            ctx.lineTo(pts[pts.length - 1].x, PAD.top + chartH);
            ctx.lineTo(pts[0].x, PAD.top + chartH);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();

            // Line Stroke
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, pts[i].y);
            }
            ctx.strokeStyle = '#4f46e5';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Points
            pts.forEach((p, idx) => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.strokeStyle = '#4f46e5';
                ctx.lineWidth = 2;
                ctx.stroke();

                // X-Axis Label
                ctx.fillStyle = '#64748b';
                ctx.font = '11px Plus Jakarta Sans, Cairo, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(dayLabels[idx], p.x, h - 10);
            });
        },

        renderWilayaChart: function () {
            const canvas = document.getElementById('wilayaChartCanvas');
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            const w = canvas.width = canvas.parentElement.clientWidth || 300;
            const h = canvas.height = canvas.parentElement.clientHeight || 220;
            ctx.clearRect(0, 0, w, h);

            const wilayaCounts = {};
            ordersList.forEach(o => {
                const wName = (o.wilaya || '16 - Alger').split('—')[0].trim();
                wilayaCounts[wName] = (wilayaCounts[wName] || 0) + 1;
            });

            const sorted = Object.entries(wilayaCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
            if (sorted.length === 0) {
                sorted.push(['16 - Alger', 1], ['07 - Biskra', 1], ['31 - Oran', 1]);
            }

            const maxCount = Math.max(...sorted.map(s => s[1]), 1);
            const barHeight = 20;
            const gap = 16;
            const startY = 16;

            sorted.forEach(([name, count], i) => {
                const y = startY + i * (barHeight + gap);
                const barWidth = ((w - 120) * (count / maxCount));

                // Label
                ctx.fillStyle = '#0f172a';
                ctx.font = 'bold 11px Plus Jakarta Sans, Cairo, sans-serif';
                ctx.textAlign = currentLang === 'fr' ? 'left' : 'right';
                const labelX = currentLang === 'fr' ? 10 : w - 10;
                ctx.fillText(name.slice(0, 14), labelX, y + 14);

                // Background track
                ctx.fillStyle = '#f1f5f9';
                ctx.beginPath();
                ctx.roundRect(110, y, w - 140, barHeight, 4);
                ctx.fill();

                // Bar fill
                ctx.fillStyle = i === 0 ? '#059669' : i === 1 ? '#0891b2' : '#4f46e5';
                ctx.beginPath();
                ctx.roundRect(110, y, Math.max(barWidth, 8), barHeight, 4);
                ctx.fill();

                // Count text
                ctx.fillStyle = '#475569';
                ctx.font = 'bold 10px monospace';
                ctx.textAlign = 'left';
                ctx.fillText(count + (currentLang === 'fr' ? ' colis' : ' طرد'), 110 + barWidth + 6, y + 14);
            });
        },

        // ── 5. Official Carrier Label (Bordereau PDF Fetch) ───────────────────
        printOfficialLabel: async function (orderId) {
            const o = ordersList.find(item => item.orderId === orderId);
            const dict = I18N[currentLang];

            // Check if dispatched to courier
            const trackingCode = o?.redex_tracking_code || o?.tracking_code;
            if (!o?.in_redex && !trackingCode) {
                alert(dict.alertLabelNotShipped);
                return;
            }

            const token = this.getStoredCarrierToken();
            const directPdfUrl = `/api/delivery?action=label_pdf&tracking=${encodeURIComponent(trackingCode)}&token=${encodeURIComponent(token)}`;

            document.getElementById('lblTitleOrder').textContent = `${dict.thOrder} : ${o.orderId} (${trackingCode})`;
            document.getElementById('lblDescText').textContent = `${currentLang === 'fr' ? 'Transporteur' : 'شركة التوصيل'}: Redex Delivery DZ`;
            const btn = document.getElementById('btnDownloadOfficialPdf');
            if (btn) {
                btn.href = directPdfUrl;
                btn.target = '_blank';
            }
            document.getElementById('labelModal').classList.add('active');
        },

        // ── 6. Live Tracking Timeline Modal ───────────────────────────────────
        trackColis: function (orderId) {
            const o = ordersList.find(item => item.orderId === orderId);
            const code = o?.redex_tracking_code || o?.tracking_code || orderId;
            const dict = I18N[currentLang];

            document.getElementById('trackModalCode').textContent = code;
            document.getElementById('trackModalStatus').textContent = o?.status === 'delivered' ? dict.statusDeliveredBadge : dict.statusShippedBadge;

            const timeline = document.getElementById('trackTimeline');
            if (currentLang === 'fr') {
                timeline.innerHTML = `
                    <div class="timeline-step completed">
                        <h5>Commande confirmée dans la boutique</h5>
                        <p>Détails du panier validés pour le client ${o?.fullName || ''}</p>
                        <time>${(o?.createdAt || '2026-08-21T10:00:00Z').replace('T', ' ').slice(0, 16)}</time>
                    </div>
                    <div class="timeline-step completed">
                        <h5>Expédié vers la passerelle de livraison</h5>
                        <p>Bordereau officiel généré avec code de suivi : ${code}</p>
                        <time>${(o?.updatedAt || '2026-08-21T12:00:00Z').replace('T', ' ').slice(0, 16)}</time>
                    </div>
                    <div class="timeline-step completed">
                        <h5>Arrivée au centre de tri régional</h5>
                        <p>Colis en cours de distribution vers la wilaya : ${o?.wilaya || 'Destination'}</p>
                        <time>Aujourd'hui</time>
                    </div>
                    <div class="timeline-step">
                        <h5>En cours de livraison chez le client</h5>
                        <p>Contact téléphonique prévu au numéro : ${o?.phone || ''}</p>
                    </div>
                `;
            } else {
                timeline.innerHTML = `
                    <div class="timeline-step completed">
                        <h5>تم تسجيل وتأكيد الطلبية في المتجر</h5>
                        <p>تم استلام سلة المشتريات للزبون ${o?.fullName || ''}</p>
                        <time>${(o?.createdAt || '2026-08-21T10:00:00Z').replace('T', ' ').slice(0, 16)}</time>
                    </div>
                    <div class="timeline-step completed">
                        <h5>تم الشحن عبر شركة التوصيل</h5>
                        <p>تم توليد بوليصة الشحن الرسمية برقم التتبع : ${code}</p>
                        <time>${(o?.updatedAt || '2026-08-21T12:00:00Z').replace('T', ' ').slice(0, 16)}</time>
                    </div>
                    <div class="timeline-step completed">
                        <h5>الوصول لمركز الفرز والتوزيع</h5>
                        <p>الطرد في الطريق نحو ولاية : ${o?.wilaya || 'الوجهة'}</p>
                        <time>اليوم</time>
                    </div>
                    <div class="timeline-step">
                        <h5>مع الموزع للتسليم</h5>
                        <p>سيتم الاتصال بالرقم : ${o?.phone || ''}</p>
                    </div>
                `;
            }

            document.getElementById('trackingModal').classList.add('active');
        },

        // ── 7. Parcel Creation & Carrier Dispatch ─────────────────────────────
        openCreateModal: function () {
            document.getElementById('packageModalTitle').textContent = I18N[currentLang].modalCreateTitle;
            document.getElementById('formOrderId').value = '';
            document.getElementById('formClientName').value = '';
            document.getElementById('formClientPhone').value = '';
            document.getElementById('formWilayaCode').value = '16';
            this.onWilayaChange('16');
            document.getElementById('formAddress').value = '';
            document.getElementById('formPrice').value = '4950';
            document.getElementById('packageModal').classList.add('active');
        },

        openAutoFillShipModal: function (orderId) {
            const o = ordersList.find(item => item.orderId === orderId);
            if (!o) return;

            document.getElementById('packageModalTitle').textContent = `${I18N[currentLang].btnSendToCourier} (${orderId})`;
            document.getElementById('formOrderId').value = o.orderId;
            document.getElementById('formClientName').value = o.fullName || '';
            document.getElementById('formClientPhone').value = o.phone || '';

            const wilayaMatch = (o.wilaya || '').match(/^(\d{1,2})/);
            const wCode = wilayaMatch ? wilayaMatch[1] : '16';
            document.getElementById('formWilayaCode').value = wCode;
            this.onWilayaChange(wCode);

            // Auto-select or pre-fill commune if already in the order
            if (o.commune) {
                const communeSelect = document.getElementById('formCommuneSelect');
                if (communeSelect) {
                    let matched = false;
                    for (let i = 0; i < communeSelect.options.length; i++) {
                        const optVal = communeSelect.options[i].value;
                        if (optVal === o.commune || optVal.includes(o.commune) || o.commune.includes(optVal)) {
                            communeSelect.selectedIndex = i;
                            matched = true;
                            break;
                        }
                    }
                    if (!matched) {
                        const opt = document.createElement('option');
                        opt.value = o.commune;
                        opt.textContent = o.commune;
                        opt.selected = true;
                        communeSelect.prepend(opt);
                    }
                }
            }

            document.getElementById('formAddress').value = o.address || '';
            
            // Clean price parsing for modal prefill
            const rawPrice = String(o.priceNum || o.grandTotal || '').replace(/[^\d]/g, '');
            const isPack2 = String(o.productName || o.orderId || '').includes('13390') || String(o.productName || o.orderId || '').includes('12950') || String(o.productName || o.orderId || '').includes('pack2') || String(o.productName || '').includes('5');
            const priceVal = parseInt(rawPrice, 10) || (isPack2 ? 13390 : 4950);
            document.getElementById('formPrice').value = priceVal;
            document.getElementById('packageModal').classList.add('active');
        },

        populateAutoFillDropdown: function () {
            const sel = document.getElementById('autoFillOrderSelect');
            if (!sel) return;
            sel.innerHTML = `<option value="">${I18N[currentLang].optSelectOrder}</option>`;
            ordersList.forEach(o => {
                const opt = document.createElement('option');
                opt.value = o.orderId;
                const statusTag = o.in_redex ? '🟢 Expédié' : '⏳ En attente';
                opt.textContent = `${o.orderId} — ${o.fullName} (${o.phone}) [${statusTag}]`;
                sel.appendChild(opt);
            });
        },

        onSelectOrderToAutoFill: function (orderId) {
            if (!orderId) return;
            this.openAutoFillShipModal(orderId);
        },

        onWilayaChange: function (wilayaCode) {
            const communeSelect = document.getElementById('formCommuneSelect');
            if (!communeSelect) return;
            communeSelect.innerHTML = '';

            const wNum = parseInt(wilayaCode) || 16;
            const communesSource = window.algeriaCommunes || window.AlgeriaCommunes || {};
            const list = communesSource[String(wNum)] || communesSource[wNum];
            
            if (list && Array.isArray(list) && list.length > 0) {
                list.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c;
                    opt.textContent = c;
                    communeSelect.appendChild(opt);
                });
            } else {
                const fallbackList = ['Centre Ville', 'Zone 1', 'Zone 2'];
                fallbackList.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c;
                    opt.textContent = c;
                    communeSelect.appendChild(opt);
                });
            }

            this.updateTariffDisplay();
        },

        onCommuneChange: function () {
            this.updateTariffDisplay();
        },

        updateTariffDisplay: function () {
            const wCode = parseInt(document.getElementById('formWilayaCode')?.value) || 16;
            const type = document.getElementById('formDeliveryType')?.value || 'home';
            const banner = document.getElementById('tariffDisplayPrice');

            const tariff = WILAYAS_MAP[wCode] || { home: 500, desk: 350 };
            const price = type === 'stopdesk' ? tariff.desk : tariff.home;

            if (banner) {
                banner.textContent = `${price} DZD`;
            }
        },

        handlePackageSubmit: async function (e) {
            e.preventDefault();
            const btn = document.getElementById('btnSubmitPackage');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Expédition en cours...';
            }

            const orderId = document.getElementById('formOrderId').value;
            const fullName = document.getElementById('formClientName').value;
            const phone = document.getElementById('formClientPhone').value;
            const wilayaCode = document.getElementById('formWilayaCode').value;
            const commune = document.getElementById('formCommuneSelect').value;
            const deliveryType = document.getElementById('formDeliveryType').value;
            const price = document.getElementById('formPrice').value;

            const token = this.getStoredCarrierToken();
            const baseUrl = this.getStoredCarrierBaseUrl();

            const numPriceVal = parseInt(String(price).replace(/[^\d]/g, ''), 10) || 4950;
            let resolvedPName = 'PACK 4EN1 4950';
            if (numPriceVal > 8000 || String(orderId).includes('pack2') || String(orderId).includes('13390') || String(orderId).includes('12950')) {
                resolvedPName = 'PACK 5EN1 13390';
            }

            const payload = {
                courierId: activeCourierId,
                token: token,
                baseUrl: baseUrl,
                orderId: orderId || ('ORVA-' + Math.floor(10000 + Math.random() * 90000)),
                fullName: fullName,
                phone: phone,
                wilaya: `${wilayaCode} - ${WILAYAS_MAP[wilayaCode]?.nameFr || ''}`,
                wilayaCode: wilayaCode,
                commune: commune,
                deliveryType: deliveryType,
                price: numPriceVal,
                grandTotal: numPriceVal + ' DZD',
                priceNum: numPriceVal,
                productList: resolvedPName
            };

            try {
                const res = await fetch('/api/delivery?action=create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const json = await res.json();

                if (json.success) {
                    const tracking = json.data?.tracking_code || json.tracking_code || payload.orderId;
                    const successAlert = currentLang === 'ar'
                        ? `✅ تم إرسال الطرد بنجاح إلى شركة التوصيل (Redex Delivery)!\nرقم التتبع الرسمي: ${tracking}`
                        : `✅ Colis expédié avec succès vers Redex!\nCode de suivi officiel: ${tracking}`;
                    alert(successAlert);
                    this.closeModal('packageModal');
                    await this.fetchOrders(true);
                } else {
                    alert(`⚠️ ${json.error || 'Impossible d\'expédier le colis'}`);
                }
            } catch (err) {
                alert(`❌ Erreur: ${err.message}`);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> ${I18N[currentLang].btnSendToCourier}`;
                }
            }
        },

        // ── 8. Delete & Sync Order ────────────────────────────────────────────
        deleteColis: async function (orderId) {
            if (!orderId) return;

            const confirmMsg = currentLang === 'fr'
                ? `Êtes-vous sûr de vouloir supprimer définitivement la commande #${orderId} ?`
                : `هل أنت متأكد من حذف الطلبية #${orderId} بشكل نهائي؟`;
            if (!confirm(confirmMsg)) return;

            // Optimistic UI update: Remove from local memory and UI immediately
            const originalOrders = [...ordersList];
            ordersList = ordersList.filter(o => o.orderId !== orderId);
            this.renderTable();
            this.updateKPIs();

            this.showToast(
                currentLang === 'fr' ? `Suppression de la commande #${orderId}...` : `جاري حذف الطلبية #${orderId}...`,
                'info'
            );

            try {
                const res = await fetch(`/api/delivery?action=delete&id=${encodeURIComponent(orderId)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId: orderId, id: orderId })
                });
                const json = await res.json().catch(() => ({}));

                if (res.ok && json.success) {
                    this.showToast(
                        currentLang === 'fr' ? `Commande #${orderId} supprimée avec succès.` : `تم حذف الطلبية #${orderId} بنجاح.`,
                        'success'
                    );
                    this.fetchOrders(false);
                } else {
                    // Revert if error
                    ordersList = originalOrders;
                    this.renderTable();
                    this.updateKPIs();
                    this.showToast(
                        currentLang === 'fr' ? `Échec de la suppression: ${json.error || 'Erreur inconnue'}` : `تعذر حذف الطلبية: ${json.error || 'خطأ غير معروف'}`,
                        'error'
                    );
                }
            } catch (e) {
                // Revert on network exception
                ordersList = originalOrders;
                this.renderTable();
                this.updateKPIs();
                this.showToast(
                    currentLang === 'fr' ? `Erreur réseau: ${e.message}` : `خطأ في الاتصال: ${e.message}`,
                    'error'
                );
            }
        },

        // ── 9. Filters & Language Switcher ────────────────────────────────────
        filterByStatus: function (status) {
            currentFilter = status;
            document.querySelectorAll('.tab-btn').forEach(btn => {
                if (btn.getAttribute('data-status') === status) btn.classList.add('active');
                else btn.classList.remove('active');
            });
            this.renderTable();
        },

        filterByWilaya: function (wCode) {
            currentWilayaFilter = wCode;
            this.renderTable();
        },

        handleSearch: function (val) {
            searchQuery = val;
            this.renderTable();
        },

        switchTab: function (tab) {
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            const target = document.querySelector(`.nav-link[href="#${tab}"]`);
            if (target) target.classList.add('active');
            if (tab === 'orders') {
                document.getElementById('ordersSection')?.scrollIntoView({ behavior: 'smooth' });
            } else if (tab === 'analytics') {
                document.getElementById('analyticsSection')?.scrollIntoView({ behavior: 'smooth' });
            }
        },

        closeModal: function (modalId) {
            document.getElementById(modalId)?.classList.remove('active');
        },

        openTariffsModal: function () {
            const tbody = document.getElementById('tariffsTableBody');
            if (tbody) {
                tbody.innerHTML = '';
                for (let i = 1; i <= 58; i++) {
                    const w = WILAYAS_MAP[i];
                    if (!w) continue;
                    const tr = document.createElement('tr');
                    const wName = currentLang === 'fr' ? w.nameFr : w.nameAr;
                    tr.innerHTML = `
                        <td><strong>${wName}</strong></td>
                        <td style="color:var(--emerald); font-weight:700;">${w.home} DZD</td>
                        <td style="color:var(--primary); font-weight:700;">${w.desk} DZD</td>
                        <td><span class="status-badge badge-delivered">58 Wilayas</span></td>
                    `;
                    tbody.appendChild(tr);
                }
            }
            document.getElementById('tariffsModal').classList.add('active');
        },

        openSettingsModal: function () {
            const tokenInput = document.getElementById('settingsApiToken');
            const urlInput = document.getElementById('settingsBaseUrl');
            if (tokenInput) tokenInput.value = this.getStoredCarrierToken();
            if (urlInput) urlInput.value = this.getStoredCarrierBaseUrl();
            document.getElementById('settingsModal').classList.add('active');
        },

        onCarrierChange: function (carrierId) {
            activeCourierId = carrierId;
            const carrierNames = {
                redex: 'Redex Delivery',
                dhd: 'DHD Express',
                conexlog: 'Conexlog DZ',
                msmgo: 'MSM Go Express',
                yalidine: 'Yalidine Express',
                zrexpress: 'ZR Express',
                noest: 'Noest Delivery',
                maystro: 'Maystro Delivery',
                anderson: 'Anderson Express'
            };
            const navName = document.getElementById('navCourierName');
            if (navName) navName.textContent = carrierNames[carrierId] || 'Ecotrack DZ';
        },

        testCarrierConnection: async function () {
            this.saveCarrierSettings();
            const token = this.getStoredCarrierToken();
            const baseUrl = this.getStoredCarrierBaseUrl();
            const resEl = document.getElementById('settingsTestResult');
            resEl.innerHTML = '<span style="color:var(--primary);"><i class="fa-solid fa-spinner fa-spin"></i> Test de connexion en cours avec Redex DZ...</span>';
            try {
                const res = await fetch(`/api/delivery?action=test_courier&courierId=${activeCourierId}&token=${encodeURIComponent(token)}&baseUrl=${encodeURIComponent(baseUrl)}`);
                const json = await res.json();
                if (json.success) {
                    resEl.innerHTML = `<span style="color:var(--emerald); font-weight:700;">${json.message}</span>`;
                } else {
                    resEl.innerHTML = `<span style="color:var(--rose); font-weight:700;">❌ Échec: ${json.error || 'Connexion refusée'}</span>`;
                }
            } catch (e) {
                resEl.innerHTML = `<span style="color:var(--rose);">❌ Échec: ${e.message}</span>`;
            }
        },

        setLanguage: function (lang) {
            currentLang = lang;
            document.documentElement.dir = (lang === 'ar') ? 'rtl' : 'ltr';
            document.documentElement.lang = lang;

            const langLabel = document.getElementById('currentLangLabel');
            if (langLabel) langLabel.textContent = (lang === 'ar') ? 'ع' : 'FR';

            document.querySelectorAll('.lang-btn, .lang-dropdown-opt, .mobile-lang-btn').forEach(btn => {
                if (btn.getAttribute('data-lang') === lang) btn.classList.add('active');
                else btn.classList.remove('active');
            });

            const dict = I18N[lang] || I18N.fr;
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                if (dict[key]) el.textContent = dict[key];
            });

            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                const key = el.getAttribute('data-i18n-placeholder');
                if (dict[key]) el.placeholder = dict[key];
            });

            this.populateWilayaDropdowns();
            this.renderTable();
            this.updateKPIs();
            this.renderCharts();
        },

        // ── 10. Navigation & Dropdowns ───────────────────────────────────────
        toggleMobileNav: function (forceState) {
            const overlay = document.getElementById('mobileNavFullscreen');
            if (!overlay) return;
            if (typeof forceState === 'boolean') {
                if (forceState) overlay.classList.add('active');
                else overlay.classList.remove('active');
            } else {
                overlay.classList.toggle('active');
            }
        },

        closeMobileNav: function () {
            document.getElementById('mobileNavFullscreen')?.classList.remove('active');
        },

        toggleLangDropdown: function (forceState) {
            const dd = document.getElementById('langSubmenuDropdown');
            if (!dd) return;
            if (typeof forceState === 'boolean') {
                if (forceState) dd.classList.add('active');
                else dd.classList.remove('active');
            } else {
                dd.classList.toggle('active');
            }
        },

        // ── 11. Official Carrier Label & Tracking ────────────────────────────
        printOfficialLabel: function (orderId) {
            const o = ordersList.find(item => item.orderId === orderId);
            if (!o) return;

            const trackingCode = o.redex_tracking_code || o.tracking_code || (o.in_redex ? ('ECE' + o.orderId.replace(/\D/g, '')) : '');
            
            if (!trackingCode && !o.in_redex) {
                const msg = currentLang === 'fr' 
                    ? "L'étiquette officielle n'est disponible qu'après l'envoi du colis au transporteur. Cliquez d'abord sur 'Expédier ⚡'."
                    : "الملصق الرسمي متاح فقط بعد إرسال الطرد إلى شركة التوصيل. يرجى الضغط على 'إرسال ⚡' أولاً.";
                alert(msg);
                return;
            }

            const codeDisplay = trackingCode || ('ECEOSK' + (o.orderId || '').replace(/\D/g, ''));
            const carrierNames = {
                redex: 'REDEX ECOTRACK DZ',
                dhd: 'DHD EXPRESS DZ',
                conexlog: 'CONEXLOG EXPRESS',
                msmgo: 'MSM GO EXPRESS',
                yalidine: 'YALIDINE EXPRESS',
                zrexpress: 'ZR EXPRESS PROCOLIS',
                noest: 'NOEST DELIVERY',
                maystro: 'MAYSTRO DELIVERY',
                anderson: 'ANDERSON EXPRESS'
            };

            const carrierTitle = carrierNames[activeCourierId] || 'REDEX ECOTRACK DZ';
            const carrierPortals = {
                redex: 'https://redex.ecotrack.dz',
                dhd: 'https://platform.dhd-dz.com',
                conexlog: 'https://conexlog.ecotrack.dz',
                msmgo: 'https://msmgo.ecotrack.dz',
                yalidine: 'https://yalidine.app',
                zrexpress: 'https://zrexpress.com',
                noest: 'https://noest-delivery.com',
                maystro: 'https://maystro-delivery.com',
                anderson: 'https://anderson-express.com'
            };

            // Populate the Official Shipping Label
            const lblCarrierTag = document.getElementById('lblCarrierTag');
            if (lblCarrierTag) lblCarrierTag.textContent = carrierTitle;

            const lblDateStamp = document.getElementById('lblDateStamp');
            if (lblDateStamp) lblDateStamp.textContent = (o.date || o.createdAt || new Date().toISOString()).slice(0, 10);

            const lblBarcodeCode = document.getElementById('lblBarcodeCode');
            if (lblBarcodeCode) lblBarcodeCode.textContent = codeDisplay;

            const lblOrderRefTag = document.getElementById('lblOrderRefTag');
            if (lblOrderRefTag) lblOrderRefTag.textContent = `Réf: ${o.orderId}`;

            const lblClientNameText = document.getElementById('lblClientNameText');
            if (lblClientNameText) lblClientNameText.textContent = o.fullName || 'Client ORVA';

            const lblClientPhoneText = document.getElementById('lblClientPhoneText');
            if (lblClientPhoneText) lblClientPhoneText.textContent = o.phone || '0550000000';

            const lblDestinationText = document.getElementById('lblDestinationText');
            if (lblDestinationText) lblDestinationText.textContent = `${o.wilaya || '16 - Alger'} (${o.commune || 'Centre'})`;

            const lblAddressText = document.getElementById('lblAddressText');
            if (lblAddressText) lblAddressText.textContent = o.address || 'Adresse confirmée au téléphone';

            const isDesk = (o.deliveryType === 'stopdesk' || (o.deliveryType && o.deliveryType.toLowerCase().includes('stop')));
            const lblDeliveryTypeBadge = document.getElementById('lblDeliveryTypeBadge');
            if (lblDeliveryTypeBadge) {
                lblDeliveryTypeBadge.textContent = isDesk ? '🏢 STOP DESK (AU BUREAU)' : '🏠 À DOMICILE (DOMICILE)';
            }

            const lblAmountText = document.getElementById('lblAmountText');
            if (lblAmountText) lblAmountText.textContent = o.grandTotal || (o.priceNum ? (o.priceNum + ' DZD') : '4,900 DZD');

            const lblProductNote = document.getElementById('lblProductNote');
            if (lblProductNote) lblProductNote.textContent = `📦 Contenu: ${o.productName || 'Sac Banane Moto Yamaha (كرطابل يماها)'}`;

            const btnPortal = document.getElementById('btnCarrierPortalLink');
            if (btnPortal) btnPortal.href = carrierPortals[activeCourierId] || 'https://redex.ecotrack.dz';

            document.getElementById('labelModal')?.classList.add('active');
        },

        triggerPrintLabel: function () {
            window.print();
        },

        trackColis: async function (orderId) {
            const o = ordersList.find(item => item.orderId === orderId);
            if (!o) return;
            const code = o.redex_tracking_code || o.tracking_code || ('ECE' + o.orderId.replace(/\D/g, ''));
            
            const codeEl = document.getElementById('trackModalCode');
            if (codeEl) codeEl.textContent = code;

            const statusEl = document.getElementById('trackModalStatus');
            if (statusEl) statusEl.textContent = o.status || 'En cours de livraison';

            const timelineEl = document.getElementById('trackTimeline');
            if (timelineEl) {
                timelineEl.innerHTML = `
                    <div class="timeline-step completed mb-3">
                        <h5>📦 Colis pris en charge par ${activeCourierId.toUpperCase()}</h5>
                        <p>Centre de tri Alger Hub - Expédition validée</p>
                        <time>${(o.date || o.createdAt || '').slice(0, 16)}</time>
                    </div>
                    <div class="timeline-step mb-3">
                        <h5>🚚 En cours d'acheminement vers ${o.wilaya || 'la wilaya de destination'}</h5>
                        <p>Attribué au livreur du secteur (${o.commune || 'Centre'})</p>
                        <time>Aujourd'hui</time>
                    </div>
                `;
            }

            document.getElementById('trackingModal')?.classList.add('active');
        },

        // ── 12. Trust & Risk Shield Operations ───────────────────────────────
        openRiskDashboard: function () {
            this.filterByStatus('risk');
            document.getElementById('ordersSection')?.scrollIntoView({ behavior: 'smooth' });
        },

        viewRisk: function (orderId) {
            const o = ordersList.find(item => item.orderId === orderId);
            if (!o) return;

            const score = o.riskScore || 0;
            const level = o.riskLevel || (score >= 40 ? 'HIGH' : score > 15 ? 'MEDIUM' : 'LOW');
            const decision = o.riskDecision || (score >= 80 ? 'BLOCK' : score >= 40 ? 'REVIEW' : 'ALLOW');
            const reasons = (o.riskReasons && Array.isArray(o.riskReasons) && o.riskReasons.length > 0)
                ? o.riskReasons
                : ['Trafic organique vérifié', 'Format téléphone algérien valide (05/06/07)', 'Empreinte appareil conforme'];

            const modalBody = document.getElementById('riskModalBody');
            if (modalBody) {
                modalBody.innerHTML = `
                    <div style="background:#fffbeb; color:#92400e; border:1px solid #fde68a; padding:12px; border-radius:var(--radius-sm); margin-bottom:14px; font-size:13px; font-weight:600;">
                        ${currentLang === 'fr'
                            ? '⚠️ Le système d\'évaluation du risque est actuellement mis en pause par l\'administration. Toutes les commandes sont approuvées sans restriction.'
                            : '⚠️ نظام تقييم الخطورة معطل مؤقتاً بأمر الإدارة — جميع الطلبيات معتمدة ومقبولة تلقائياً بنسبة خطر 0%.'
                        }
                    </div>
                    <div class="tracking-summary-card mb-3">
                        <div>
                            <span>${currentLang === 'fr' ? 'Commande :' : 'الطلب :'}</span>
                            <strong style="color:var(--primary);">${orderId}</strong>
                        </div>
                        <div>
                            <span>${currentLang === 'fr' ? 'Indice de Risque :' : 'درجة الخطورة :'}</span>
                            <strong style="color:${score >= 40 ? 'var(--rose)' : 'var(--emerald)'}; font-size:18px;">${score} / 100</strong>
                        </div>
                    </div>

                    <div class="form-group mb-3">
                        <label class="form-label">${currentLang === 'fr' ? 'Décision Intelligente IA :' : 'القرار التلقائي للذكاء الاصطناعي :'}</label>
                        <input type="text" class="app-input" value="${decision} (${level})" readonly>
                    </div>

                    <div class="form-group mb-3">
                        <label class="form-label">${currentLang === 'fr' ? 'Indicateurs & Facteurs de Confiance :' : 'مؤشرات الأمان وعوامل التقييم :'}</label>
                        <div style="background:var(--bg-app); padding:12px; border-radius:var(--radius-sm); border:1px solid var(--border-color); font-size:12px;">
                            ${reasons.map(r => `<div style="margin-bottom:6px;">• <code>${r}</code></div>`).join('')}
                        </div>
                    </div>

                    <div class="form-group">
                        <label class="form-label">${currentLang === 'fr' ? 'Actions Administrateur :' : 'إجراءات المدير السريعة :'}</label>
                        <div style="display:flex; gap:10px; flex-wrap:wrap;">
                            <button type="button" class="app-btn app-btn-sm app-btn-primary" onclick="storeAdmin.overrideRisk('${orderId}', 'trust')">
                                ✅ ${currentLang === 'fr' ? 'Valider comme Client Fiable' : 'توثيق كـ زبون موثوق'}
                            </button>
                            <button type="button" class="app-btn app-btn-sm app-btn-secondary" onclick="storeAdmin.overrideRisk('${orderId}', 'block')" style="color:var(--rose);">
                                🚫 ${currentLang === 'fr' ? 'Bloquer le Numéro' : 'حظر رقم الهاتف'}
                            </button>
                        </div>
                    </div>
                `;
            }

            document.getElementById('riskModal')?.classList.add('active');
        },

        overrideRisk: async function (orderId, action) {
            try {
                const res = await fetch('/api/risk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId, action })
                });
                const json = await res.json();
                if (json.success) {
                    alert(currentLang === 'fr' ? `✅ Action '${action}' appliquée avec succès.` : `✅ تم تطبيق الإجراء (${action}) بنجاح.`);
                    this.closeModal('riskModal');
                    await this.fetchOrders(true);
                } else {
                    alert('Erreur: ' + (json.error || 'Impossible d\'appliquer l\'action'));
                }
            } catch (e) {
                alert('Erreur réseau: ' + e.message);
            }
        },

        renderStatusSelect: function (o) {
            let norm = String(o.status || 'pending').toLowerCase().trim();
            if (norm === 'قيد الانتظار' || norm === 'en attente') norm = 'pending';
            else if (norm === 'مؤكدة' || norm === 'confirme' || norm === 'confirmee') norm = 'confirmed';
            else if (norm === 'تم الشحن' || norm === 'expedie' || norm === 'shipped' || o.in_redex) norm = 'shipped';
            else if (norm === 'تم التسليم' || norm === 'livre' || norm === 'livree' || norm === 'delivered') norm = 'delivered';
            else if (norm === 'مرتجع' || norm === 'retour' || norm === 'retourne' || norm === 'returned') norm = 'returned';
            else if (norm === 'ملغاة' || norm === 'annule' || norm === 'annulee' || norm === 'cancelled') norm = 'cancelled';
            else if (!['pending', 'confirmed', 'shipped', 'delivered', 'returned', 'cancelled'].includes(norm)) norm = 'pending';

            const isAr = currentLang === 'ar';
            return `
                <div class="status-select-wrap">
                    <select class="status-select status-select-${norm}" data-current="${norm}" onchange="storeAdmin.changeOrderStatus('${o.orderId}', this.value, this)" title="${isAr ? 'تغيير حالة الطلبية' : 'Modifier le statut'}">
                        <option value="pending" ${norm === 'pending' ? 'selected' : ''}>⏳ ${isAr ? 'قيد الانتظار' : 'En Attente'}</option>
                        <option value="confirmed" ${norm === 'confirmed' ? 'selected' : ''}>📞 ${isAr ? 'مؤكدة' : 'Confirmé'}</option>
                        <option value="shipped" ${norm === 'shipped' ? 'selected' : ''}>🚚 ${isAr ? 'تم الشحن' : 'Expédié'}</option>
                        <option value="delivered" ${norm === 'delivered' ? 'selected' : ''}>✅ ${isAr ? 'تم التسليم' : 'Livré'}</option>
                        <option value="returned" ${norm === 'returned' ? 'selected' : ''}>⚠️ ${isAr ? 'مرتجع' : 'Retourné'}</option>
                        <option value="cancelled" ${norm === 'cancelled' ? 'selected' : ''}>❌ ${isAr ? 'ملغاة' : 'Annulé'}</option>
                    </select>
                </div>
            `;
        },

        changeOrderStatus: async function (orderId, newStatus, selectEl) {
            if (!orderId || !newStatus) return;

            const oldStatus = selectEl ? selectEl.getAttribute('data-current') : null;
            if (selectEl) {
                selectEl.classList.add('is-updating');
                selectEl.disabled = true;
            }

            try {
                const res = await fetch('/api/delivery?action=update_status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId, status: newStatus })
                });

                const json = await res.json().catch(() => ({}));

                if (res.ok && json.success) {
                    const ord = ordersList.find(x => x.orderId === orderId);
                    if (ord) {
                        ord.status = newStatus;
                    }

                    if (selectEl) {
                        selectEl.setAttribute('data-current', newStatus);
                        selectEl.className = `status-select status-select-${newStatus}`;
                    }

                    // Sync other selects for the same order if present (e.g. table vs mobile)
                    document.querySelectorAll(`.status-select[onchange*="${orderId}"]`).forEach(el => {
                        if (el !== selectEl) {
                            el.value = newStatus;
                            el.setAttribute('data-current', newStatus);
                            el.className = `status-select status-select-${newStatus}`;
                        }
                    });

                    const label = this.getStatusLabel(newStatus);
                    this.showToast(
                        currentLang === 'fr' 
                            ? `Commande #${orderId} mise à jour vers : ${label}` 
                            : `تم تحديث حالة الطلبية #${orderId} إلى "${label}" بنجاح`,
                        'success'
                    );

                    this.updateKPIs();
                } else {
                    throw new Error(json.error || 'Erreur lors de la mise à jour');
                }
            } catch (err) {
                console.error('[Admin] Error updating order status:', err);
                if (selectEl && oldStatus) {
                    selectEl.value = oldStatus;
                    selectEl.className = `status-select status-select-${oldStatus}`;
                }
                this.showToast(
                    currentLang === 'fr' 
                        ? `Échec de mise à jour : ${err.message}` 
                        : `فشل تحديث الحالة: ${err.message}`,
                    'error'
                );
            } finally {
                if (selectEl) {
                    selectEl.classList.remove('is-updating');
                    selectEl.disabled = false;
                }
            }
        },

        getStatusLabel: function (status) {
            const s = String(status || '').toLowerCase().trim();
            const isAr = currentLang === 'ar';
            if (s === 'confirmed' || s === 'مؤكدة') return isAr ? 'مؤكدة 📞' : 'Confirmé 📞';
            if (s === 'shipped' || s === 'تم الشحن') return isAr ? 'تم الشحن 🚚' : 'Expédié 🚚';
            if (s === 'delivered' || s === 'تم التسليم') return isAr ? 'تم التسليم ✅' : 'Livré ✅';
            if (s === 'returned' || s === 'مرتجع') return isAr ? 'مرتجع ⚠️' : 'Retourné ⚠️';
            if (s === 'cancelled' || s === 'ملغاة') return isAr ? 'ملغاة ❌' : 'Annulé ❌';
            return isAr ? 'قيد الانتظار ⏳' : 'En Attente ⏳';
        },

        showToast: function (msg, type = 'success') {
            let container = document.getElementById('adminToastContainer');
            if (!container) {
                container = document.createElement('div');
                container.id = 'adminToastContainer';
                container.className = 'admin-toast-container';
                document.body.appendChild(container);
            }

            const toast = document.createElement('div');
            toast.className = `admin-toast toast-${type}`;
            const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
            toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${msg}</span>`;

            container.appendChild(toast);

            setTimeout(() => {
                toast.classList.add('toast-fadeout');
                setTimeout(() => toast.remove(), 350);
            }, 3000);
        },

        exportExcel: function () {
            window.open('/data/excel/Orders.xlsx', '_blank');
        }
    };

    window.storeAdmin = storeAdmin;
    document.addEventListener('DOMContentLoaded', () => storeAdmin.init());
})();
