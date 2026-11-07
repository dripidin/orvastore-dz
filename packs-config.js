/**
 * =============================================================================
 * ORVA STORE â€” Multi-Product Packs Planner & Central Configuration System
 * =============================================================================
 * Defines pack architectures, pricing structures, included bundle items,
 * themes (Light + Red Accent), and metadata for dynamic landing page generation.
 * =============================================================================
 */

(function (global) {
    'use strict';

    const PACKS_CONFIG = {
        // â”€â”€ Pack 1: Tools & Maintenance 4-in-1 Pack â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        'PACK_001': {
            packId: 'PACK_001',
            skuId: 'SKU_MULTI_01',
            slug: 'pack1',
            packName: 'Ø¨Ø§Ùƒ Ø§Ù„Ø®Ø¯Ù…Ø© ÙˆØ§Ù„ØµÙŠØ§Ù†Ø© 4 ÙÙŠ 1 â€” Ù…Ù†ÙØ§Ø® TOYOTA ÙˆØ·Ù‚Ù… Ù…ÙØ§ØªÙŠØ­ ÙˆÙ…ÙÙƒØ§Øª',
            shortTitle: 'باك كومبريسار و المفاتيح 4 في 1',
            badge: 'ðŸ”¥ 4 Ø£Ø¯ÙˆØ§Øª Ø£Ø³Ø§Ø³ÙŠØ© ÙÙŠ Ø¨Ø§Ùƒ ÙˆØ§Ø­Ø¯',
            price: 4950,
            originalPrice: 9750,
            discount: '49% ØªØ®ÙÙŠØ¶',
            currency: 'Ø¯.Ø¬',
            deliveryNote: 'Ø§Ù„ØªÙˆØµÙŠÙ„ Ù…ØªÙˆÙØ± Ù„Ø¬Ù…ÙŠØ¹ 58 ÙˆÙ„Ø§ÙŠØ© ÙˆØ§Ù„Ø¯ÙØ¹ Ø¹Ù†Ø¯ Ø§Ù„Ø§Ø³ØªÙ„Ø§Ù… (COD)',
            description: 'Ø¨Ø§Ùƒ Ø¹Ù…Ù„ÙŠ ÙˆÙ…ØªÙƒØ§Ù…Ù„ Ù„Ù„Ø³ÙŠØ§Ø±Ø© ÙˆØ§Ù„Ù…Ù†Ø²Ù„: Ù…Ù†ÙØ§Ø® Ø¹Ø¬Ù„Ø§Øª TOYOTAØŒ Ø¹Ù„Ø¨Ø© Ù…ÙØ§ØªÙŠØ­ ÙˆØ±Ø¤ÙˆØ³ 46 Ù‚Ø·Ø¹Ø© STARLCE PROØŒ Ù…ÙÙƒ Ù…Ø±Ù† 11 Ù‚Ø·Ø¹Ø©ØŒ ÙˆØ·Ù‚Ù… 6 Ù…ÙÙƒØ§Øª.',
            heroImage: 'pack 1 4950/pack1 4950.webp',
            heroGallery: [
                'pack 1 4950/pack1 4950.webp',
                'pack 1 4950/IMG_4461.webp',
                'pack 1 4950/IMG_4462.webp',
                'pack 1 4950/IMG_4465.webp',
                'pack 1 4950/IMG_4528.webp'
            ],
            theme: {
                name: 'light-red-prime',
                mode: 'light',
                primaryColor: '#D90429',       // Vibrant energetic red
                primaryHover: '#EF233C',
                accentColor: '#D90429',
                accentSoft: 'rgba(217, 4, 41, 0.08)',
                accentBorder: 'rgba(217, 4, 41, 0.25)',
                bgColor: '#F8F9FA',
                cardBg: '#FFFFFF',
                textColor: '#0F172A',
                mutedColor: '#64748B'
            },
            features: [
                'Ù…Ù†ÙØ§Ø® Ø¹Ø¬Ù„Ø§Øª TOYOTA Accessories Ù…Ø¹ Ø¹Ø¯Ø§Ø¯ Ø¶ØºØ· Ù…Ø¯Ù…Ø¬',
                'Ø¹Ù„Ø¨Ø© Ù…ÙØ§ØªÙŠØ­ ÙˆØ±Ø¤ÙˆØ³ 46 Ù‚Ø·Ø¹Ø© STARLCE PRO Ù…Ø¹ ÙƒÙ„ÙŠÙƒÙŠ',
                'Ù…ÙÙƒ Ù…Ø±Ù† STARLCE PRO â€“ 11 Ù‚Ø·Ø¹Ø© Ù„Ù„Ø£Ù…Ø§ÙƒÙ† Ø§Ù„Ø¶ÙŠÙ‚Ø©',
                'Ø·Ù‚Ù… Ù…ÙÙƒØ§Øª 6 Ù‚Ø·Ø¹ Ø¨Ù…Ù‚Ø§Ø¨Ø¶ Ù…Ø±ÙŠØ­Ø© Ù„Ù„Ø§Ø³ØªØ¹Ù…Ø§Ù„ Ø§Ù„ÙŠÙˆÙ…ÙŠ',
                'Ø¶Ù…Ø§Ù† Ø§Ù„Ø¬ÙˆØ¯Ø© ÙˆÙ…Ø¹Ø§ÙŠÙ†Ø© Ø§Ù„Ø³Ù„Ø¹Ø© Ù‚Ø¨Ù„ Ø¯ÙØ¹ Ø§Ù„Ù…Ø³ØªØ­Ù‚Ø§Øª',
                'ØªÙˆØµÙŠÙ„ Ù„Ø¬Ù…ÙŠØ¹ Ø§Ù„ÙˆÙ„Ø§ÙŠØ§Øª ÙˆØ§Ù„Ø¯ÙØ¹ Ø¹Ù†Ø¯ Ø§Ù„Ø§Ø³ØªÙ„Ø§Ù…'
            ],
            products: [
                {
                    id: 'PROD_01',
                    name: 'Ù…Ù†ÙØ§Ø® Ø¹Ø¬Ù„Ø§Øª TOYOTA Accessories',
                    category: 'Ù…Ù†ÙØ§Ø® Ø¹Ø¬Ù„Ø§Øª',
                    price: 2400,
                    image: 'pack 1 4950/pack1 4950.webp',
                    badge: 'Ø¹Ø¯Ø§Ø¯ Ø¶ØºØ· Ù…Ø¯Ù…Ø¬',
                    isGift: false,
                    description: 'Ù…Ù†ÙØ§Ø® Ø¹Ù…Ù„ÙŠ ÙˆÙ…Ø«Ø§Ù„ÙŠ Ù„Ù„Ø³ÙŠØ§Ø±Ø© Ù…Ø¹ Ø¹Ø¯Ø§Ø¯ Ø¶ØºØ· Ù„Ù…Ø±Ø§Ù‚Ø¨Ø© Ø§Ù„Ø¹Ø¬Ù„Ø§Øª.'
                },
                {
                    id: 'PROD_02',
                    name: 'Ø¹Ù„Ø¨Ø© Ù…ÙØ§ØªÙŠØ­ ÙˆØ±Ø¤ÙˆØ³ 46 Ù‚Ø·Ø¹Ø© STARLCE PRO',
                    category: 'Ø·Ù‚Ù… Ù…ÙØ§ØªÙŠØ­ ÙˆØ±Ø§ØªØ´ÙŠØª',
                    price: 1800,
                    image: 'pack 1 4950/IMG_4461.webp',
                    badge: 'Ø·Ù‚Ù… Ù…ØªÙƒØ§Ù…Ù„ 46 Ù‚Ø·Ø¹Ø©',
                    isGift: false,
                    description: 'Ø·Ù‚Ù… Ù…ØªÙƒØ§Ù…Ù„ Ù…Ø¹ Ø°Ø±Ø§Ø¹ Ratchet ÙˆØ±Ø¤ÙˆØ³ ØµÙŠØ§Ù†Ø© Ù…ØªØ¹Ø¯Ø¯Ø©.'
                },
                {
                    id: 'PROD_03',
                    name: 'Ù…ÙÙƒ Ù…Ø±Ù† STARLCE PRO â€“ 11 Ù‚Ø·Ø¹Ø©',
                    category: 'Ù…ÙÙƒ Ù…Ø±Ù† Ù…ØªØ¹Ø¯Ø¯ Ø§Ù„Ø±Ø¤ÙˆØ³',
                    price: 1100,
                    image: 'pack 1 4950/IMG_4462.webp',
                    badge: 'Ù„Ù„Ø£Ù…Ø§ÙƒÙ† Ø§Ù„Ø¶ÙŠÙ‚Ø©',
                    isGift: false,
                    description: 'Ø®Ø±Ø·ÙˆÙ… Ù…Ø±Ù† Ù…Ø¹ Ø±Ø¤ÙˆØ³ Ù…ØªØ¹Ø¯Ø¯Ø© Ù„Ù„ÙˆØµÙˆÙ„ Ù„Ù„Ø²ÙˆØ§ÙŠØ§ Ø§Ù„ØµØ¹Ø¨Ø©.'
                },
                {
                    id: 'PROD_04',
                    name: 'Ø·Ù‚Ù… Ù…ÙÙƒØ§Øª 6 Ù‚Ø·Ø¹',
                    category: 'Ù…ÙÙƒØ§Øª ÙŠØ¯ÙˆÙŠØ©',
                    price: 900,
                    image: 'pack 1 4950/IMG_4465.webp',
                    badge: '6 Ù…ÙÙƒØ§Øª Ù…ØªÙ†ÙˆØ¹Ø©',
                    isGift: false,
                    description: 'Ù…ÙÙƒØ§Øª Ø¨Ù…Ù‚Ø§Ø¨Ø¶ Ù…Ø±ÙŠØ­Ø© Ù„Ù…Ø®ØªÙ„Ù Ø£Ø¹Ù…Ø§Ù„ Ø§Ù„ÙÙƒ ÙˆØ§Ù„ØªØ±ÙƒÙŠØ¨.'
                }
            ]
        },

        // â”€â”€ Pack 2: Pro Tools & Workshop 5-in-1 Pack â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        'PACK_002': {
            packId: 'PACK_002',
            skuId: 'SKU_MULTI_02',
            slug: 'pack2',
            packName: 'Ø¨Ø§Ùƒ Ø§Ù„Ù…Ø­ØªØ±ÙÙŠÙ† ÙˆØ§Ù„ÙˆØ±Ø´Ø© 5 ÙÙŠ 1 â€” Ù…Ø§ÙƒÙŠÙ†Ø© CROWN 20V ÙˆØ·Ù‚Ù… Ù…ÙÙƒØ§Øª ÙˆØ·Ù‚Ù… Ù…ÙØ§ØªÙŠØ­',
            shortTitle: 'باك الفيسوز كراون Elite',
            badge: 'ðŸ”¥ 5 Ø£Ø¯ÙˆØ§Øª Ø§Ø­ØªØ±Ø§ÙÙŠØ© ÙÙŠ Ø¨Ø§Ùƒ ÙˆØ§Ø­Ø¯',
            price: 13390,
            originalPrice: 21250,
            discount: '37% ØªØ®ÙÙŠØ¶',
            currency: 'Ø¯.Ø¬',
            deliveryNote: 'Ø§Ù„ØªÙˆØµÙŠÙ„ Ù…ØªÙˆÙØ± Ù„Ø¬Ù…ÙŠØ¹ 58 ÙˆÙ„Ø§ÙŠØ© ÙˆØ§Ù„Ø¯ÙØ¹ Ø¹Ù†Ø¯ Ø§Ù„Ø§Ø³ØªÙ„Ø§Ù… (COD)',
            description: 'Ø¨Ø§Ùƒ Ø¹Ù…Ù„ÙŠ ÙˆÙ…ØªÙƒØ§Ù…Ù„ Ù„Ù„ÙˆØ±Ø´Ø© ÙˆØ§Ù„ØµÙŠØ§Ù†Ø© ÙˆØ§Ù„Ù…Ù†Ø²Ù„: Ù…Ø§ÙƒÙŠÙ†Ø© CROWN 20V Ø¨Ø¨Ø·Ø§Ø±ÙŠØªÙŠÙ† Ùˆ29 Ù‚Ø·Ø¹Ø©ØŒ Ø·Ù‚Ù… Ù…ÙÙƒØ§Øª 6 Ù‚Ø·Ø¹ØŒ Ø¹Ù„Ø¨Ø© Ù…ÙØ§ØªÙŠØ­ 46 Ù‚Ø·Ø¹Ø©ØŒ Ù…ÙÙƒ Ù…Ø±Ù† 11 Ù‚Ø·Ø¹Ø©ØŒ ÙˆÙ‚ÙØ§Ø²Ø§Øª GILAN.',
            heroImage: 'pack2 12950/pack2 12950.webp',
            heroGallery: [
                'pack2 12950/pack2 12950.webp',
                'images products/IMG_4470.webp',
                'images products/IMG_4462.webp',
                'images products/IMG_4465.webp',
                'images products/IMG_4461.webp',
                'images products/IMG_4459.webp'
            ],
            theme: {
                name: 'light-red-sport',
                mode: 'light',
                primaryColor: '#E63946',       // Vibrant deep crimson
                primaryHover: '#D90429',
                accentColor: '#E63946',
                accentSoft: 'rgba(230, 57, 70, 0.08)',
                accentBorder: 'rgba(230, 57, 70, 0.25)',
                bgColor: '#F8F9FA',
                cardBg: '#FFFFFF',
                textColor: '#0F172A',
                mutedColor: '#64748B'
            },
            features: [
                'Ù…Ø§ÙƒÙŠÙ†Ø© Ø«Ù‚Ø¨ CROWN 20V Ø§Ù„Ø£ØµÙ„ÙŠØ© Ù…Ø¹ Ø¨Ø·Ø§Ø±ÙŠØªÙŠÙ† 20V Ùˆ29 Ù‚Ø·Ø¹Ø© ÙˆÙ…Ù„Ø­Ù‚',
                'Ø·Ù‚Ù… Ù…ÙÙƒØ§Øª 6 Ù‚Ø·Ø¹ Ø¨Ù…Ù‚Ø§Ø¨Ø¶ Ù…Ø±ÙŠØ­Ø© Ù„Ù…Ø®ØªÙ„Ù Ø£Ø¹Ù…Ø§Ù„ Ø§Ù„ÙÙƒ ÙˆØ§Ù„ØªØ±ÙƒÙŠØ¨',
                'Ø¹Ù„Ø¨Ø© Ù…ÙØ§ØªÙŠØ­ ÙˆØ±Ø¤ÙˆØ³ 46 Ù‚Ø·Ø¹Ø© STARLCE PRO Ù…Ø¹ Ø°Ø±Ø§Ø¹ Ratchet',
                'Ù…ÙÙƒ Ù…Ø±Ù† STARLCE PRO â€“ 11 Ù‚Ø·Ø¹Ø© Ù„Ù„Ø£Ù…Ø§ÙƒÙ† Ø§Ù„Ø¶ÙŠÙ‚Ø© ÙˆØ§Ù„ØµØ¹Ø¨Ø©',
                'Ù‚ÙØ§Ø²Ø§Øª Ø­Ù…Ø§ÙŠØ© Ø§Ø­ØªØ±Ø§ÙÙŠØ© GILAN Ù„Ù…Ù‚Ø§ÙˆÙ…Ø© Ø§Ù„Ø§Ù†Ø²Ù„Ø§Ù‚',
                'ØªÙˆØµÙŠÙ„ Ù„Ø¬Ù…ÙŠØ¹ Ø§Ù„ÙˆÙ„Ø§ÙŠØ§Øª ÙˆØ§Ù„Ø¯ÙØ¹ Ø¹Ù†Ø¯ Ø§Ù„Ø§Ø³ØªÙ„Ø§Ù…'
            ],
            products: [
                {
                    id: 'PROD_05',
                    name: 'Ù…Ø§ÙƒÙŠÙ†Ø© Ø«Ù‚Ø¨ CROWN 20V Ø§Ù„Ø£ØµÙ„ÙŠØ© (2 Ø¨Ø·Ø§Ø±ÙŠØ§Øª + 29 Ù‚Ø·Ø¹Ø©)',
                    category: 'Ù…Ø§ÙƒÙŠÙ†Ø§Øª Ø«Ù‚Ø¨ Ù„Ø§Ø³Ù„ÙƒÙŠØ©',
                    price: 6500,
                    image: 'images products/IMG_4470.webp',
                    badge: '2 Ø¨Ø·Ø§Ø±ÙŠØ§Øª 20V',
                    isGift: false,
                    description: 'Ù…Ø§ÙƒÙŠÙ†Ø© Ø«Ù‚Ø¨ ÙˆÙÙƒ Ù‚ÙˆÙŠØ© Ù…Ø¹ Ø¨Ø·Ø§Ø±ÙŠØªÙŠÙ† 20V ÙˆØ­Ù‚ÙŠØ¨Ø© ØªØ­ØªÙˆÙŠ Ø¹Ù„Ù‰ 29 Ù…Ù„Ø­Ù‚Ø§Ù‹.'
                },
                {
                    id: 'PROD_06',
                    name: 'Ø·Ù‚Ù… Ù…ÙÙƒØ§Øª 6 Ù‚Ø·Ø¹',
                    category: 'Ù…ÙÙƒØ§Øª ÙŠØ¯ÙˆÙŠØ©',
                    price: 900,
                    image: 'images products/IMG_4462.webp',
                    badge: '6 Ù…ÙÙƒØ§Øª Ù…ØªÙ†ÙˆØ¹Ø©',
                    isGift: false,
                    description: 'Ù…ÙÙƒØ§Øª Ø¨Ù…Ù‚Ø§Ø¨Ø¶ Ù…Ø±ÙŠØ­Ø© Ù„Ù…Ø®ØªÙ„Ù Ø£Ø¹Ù…Ø§Ù„ Ø§Ù„ÙÙƒ ÙˆØ§Ù„ØªØ±ÙƒÙŠØ¨.'
                },
                {
                    id: 'PROD_07',
                    name: 'Ø¹Ù„Ø¨Ø© Ù…ÙØ§ØªÙŠØ­ ÙˆØ±Ø¤ÙˆØ³ 46 Ù‚Ø·Ø¹Ø© STARLCE PRO',
                    category: 'Ø·Ù‚Ù… Ù…ÙØ§ØªÙŠØ­ ÙˆØ±Ø§ØªØ´ÙŠØª',
                    price: 1800,
                    image: 'images products/IMG_4465.webp',
                    badge: 'Ø·Ù‚Ù… Ù…ØªÙƒØ§Ù…Ù„ 46 Ù‚Ø·Ø¹Ø©',
                    isGift: false,
                    description: 'Ø·Ù‚Ù… Ù…ØªÙƒØ§Ù…Ù„ Ù…Ø¹ Ø°Ø±Ø§Ø¹ Ratchet ÙˆØ±Ø¤ÙˆØ³ ØµÙŠØ§Ù†Ø© Ù…ØªØ¹Ø¯Ø¯Ø©.'
                },
                {
                    id: 'PROD_08',
                    name: 'Ù…ÙÙƒ Ù…Ø±Ù† STARLCE PRO â€“ 11 Ù‚Ø·Ø¹Ø©',
                    category: 'Ù…ÙÙƒ Ù…Ø±Ù† Ù…ØªØ¹Ø¯Ø¯ Ø§Ù„Ø±Ø¤ÙˆØ³',
                    price: 1100,
                    image: 'images products/IMG_4461.webp',
                    badge: 'Ù„Ù„Ø£Ù…Ø§ÙƒÙ† Ø§Ù„Ø¶ÙŠÙ‚Ø©',
                    isGift: false,
                    description: 'Ø®Ø±Ø·ÙˆÙ… Ù…Ø±Ù† Ù…Ø¹ Ø±Ø¤ÙˆØ³ Ù…ØªØ¹Ø¯Ø¯Ø© Ù„Ù„ÙˆØµÙˆÙ„ Ù„Ù„Ø²ÙˆØ§ÙŠØ§ Ø§Ù„ØµØ¹Ø¨Ø©.'
                },
                {
                    id: 'PROD_09',
                    name: 'Ù‚ÙØ§Ø²Ø§Øª Ø¹Ù…Ù„ ÙˆØ­Ù…Ø§ÙŠØ© Ø§Ø­ØªØ±Ø§ÙÙŠØ© GILAN',
                    category: 'Ù…Ø¹Ø¯Ø§Øª Ø­Ù…Ø§ÙŠØ©',
                    price: 350,
                    image: 'images products/IMG_4459.webp',
                    badge: 'Ù…Ù‚Ø§ÙˆÙ…Ø© Ù„Ù„Ø§Ù†Ø²Ù„Ø§Ù‚',
                    isGift: false,
                    description: 'Ù‚ÙØ§Ø²Ø§Øª Ø¹Ù…Ù„ Ù…Ø±ÙŠØ­Ø© ØªÙˆÙØ± Ù‚Ø¨Ø¶Ø© Ù…Ø­ÙƒÙ…Ø© ÙˆØ­Ù…Ø§ÙŠØ© ØªØ§Ù…Ø© Ù„Ù„ÙŠØ¯ÙŠÙ† Ø£Ø«Ù†Ø§Ø¡ Ø§Ù„ØµÙŠØ§Ù†Ø©.'
                }
            ]
        }

        // ── Pack 3: Welding & Workshop Pack ────────────────────────────────
        'PACK_003': {
            packId: 'PACK_003',
            skuId: 'SKU_MULTI_03',
            slug: 'pack3',
            packName: 'باك سودير كراون الصلب — ماكينة لحام CROWN MMA-200 MINI + قفازات حماية GILAN',
            shortTitle: 'باك سودير كراون الصلب',
            badge: '⚡ ماكينة لحام CROWN + قفازات حماية GILAN',
            price: 15950,
            originalPrice: 25000,
            discount: null,
            currency: 'د.ج',
            deliveryNote: 'التوصيل متوفر لجميع 58 ولاية والدفع عند الاستلام (COD)',
            description: 'باك عملي للورشة: ماكينة لحام CROWN CT33102 MMA-200 MINI مع قفازات حماية GILAN Anti-Cut، قناع لحام، فرشاة سلك، طقم مفكات 6 قطع KKKR، وكوابل لحام مع ملقط.',
            heroImage: 'pack3 15950/pack3 15950.webp',
            heroGallery: [
                'pack3 15950/pack3 15950.webp'
            ],
            theme: {
                name: 'light-red-weld',
                mode: 'light',
                primaryColor: '#E63946',
                primaryHover: '#D90429',
                accentColor: '#E63946',
                accentSoft: 'rgba(230, 57, 70, 0.08)',
                accentBorder: 'rgba(230, 57, 70, 0.25)',
                bgColor: '#F8F9FA',
                cardBg: '#FFFFFF',
                textColor: '#0F172A',
                mutedColor: '#64748B'
            },
            features: [
                'ماكينة لحام CROWN CT33102 MMA-200 MINI مع ضبط الأمبير',
                'تحكم في قوة اللحام حسب قطر الباڨيتة (Current Control)',
                'نظام أمان VRD — تنقص التوتر الكهربائي في وضع الاستعداد',
                'قفازات حماية GILAN Anti-Cut لمقاومة الجروح والانزلاق',
                'طقم مفكات 6 قطع KKKR بمقابض مريحة',
                'قناع لحام + فرشاة سلك + كوابل لحام مع ملقط'
            ],
            products: [
                {
                    id: 'PROD_10',
                    name: 'ماكينة لحام CROWN CT33102 MMA-200 MINI',
                    category: 'ماكينات لحام',
                    price: 12000,
                    image: 'pack3 15950/pack3 15950.webp',
                    badge: 'MMA + VRD',
                    isGift: false,
                    description: 'ماكينة لحام بالقوس الكهربائي مع تحكم بالأمبير ونظام أمان VRD مدمج.'
                },
                {
                    id: 'PROD_11',
                    name: 'قفازات حماية GILAN Anti-Cut',
                    category: 'معدات حماية',
                    price: 350,
                    image: 'pack3 15950/pack3 15950.webp',
                    badge: 'مقاومة للجروح',
                    isGift: false,
                    description: 'قفازات عمل توفر حماية من الجروح والخدوش مع قبضة ثابتة.'
                },
                {
                    id: 'PROD_12',
                    name: 'طقم مفكات 6 قطع KKKR',
                    category: 'مفكات يدوية',
                    price: 900,
                    image: 'pack3 15950/pack3 15950.webp',
                    badge: '6 مفكات متنوعة',
                    isGift: false,
                    description: 'مفكات بمقابض مريحة لمختلف أعمال الفك والتركيب.'
                },
                {
                    id: 'PROD_13',
                    name: 'قناع لحام + فرشاة سلك + كوابل لحام',
                    category: 'ملحقات لحام',
                    price: 2700,
                    image: 'pack3 15950/pack3 15950.webp',
                    badge: 'ملحقات أساسية',
                    isGift: false,
                    description: 'قناع حماية الوجه أثناء اللحام، فرشاة تنظيف السلك، وكوابل لحام مع ملقط.'
                }
            ]
        }
    };

    /**
     * Helper utilities to query pack plans
     */
    function getPackById(packId) {
        return PACKS_CONFIG[packId] || null;
    }

    function getAllPacks() {
        return Object.values(PACKS_CONFIG);
    }

    const exporter = {
        PACKS_CONFIG,
        getPackById,
        getAllPacks
    };

    // Browser environment
    if (typeof window !== 'undefined') {
        window.PACKS_CONFIG = PACKS_CONFIG;
        window.getPackById = getPackById;
        window.getAllPacks = getAllPacks;
    }

    // Node.js module environment
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exporter;
    }

})(typeof window !== 'undefined' ? window : globalThis);
