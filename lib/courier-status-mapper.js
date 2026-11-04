'use strict';
// =============================================================================
// ORVA Store — Centralized Courier Status Mapper (CommonJS)
// Provides deterministic mapping between raw Algerian courier codes & ORVA statuses.
// Adheres strictly to Phase 7G & Phase 8D rules:
// - Explicit mapping, no speculative guessing.
// - Original raw status strictly preserved in rawStatus.
// - Unknown codes map to UNKNOWN / Unknown.
// - RETURN_IN_PROGRESS -> Returning.
// - RETURNED_TO_SENDER -> Returned.
// - Zero side-effects on order financials, inventory, or internal state.
// =============================================================================

const RAW_CODE_TO_NORMALIZED = {
    // ── Delivered Codes ────────────────────────────────────────────────────────
    LIVRE_CLIENT: 'DELIVERED_TO_CUSTOMER',
    LIVRE: 'DELIVERED_TO_CUSTOMER',
    LIVRÉ: 'DELIVERED_TO_CUSTOMER',
    DELIVERED: 'DELIVERED_TO_CUSTOMER',
    DELIVERED_TO_CUSTOMER: 'DELIVERED_TO_CUSTOMER',
    RECUPERE_PAR_CLIENT: 'DELIVERED_TO_CUSTOMER',
    COLIS_LIVRE: 'DELIVERED_TO_CUSTOMER',
    ENCAISSE: 'DELIVERED_TO_CUSTOMER',
    LIVRAISON_REUSSIE: 'DELIVERED_TO_CUSTOMER',

    // ── Out For Delivery ───────────────────────────────────────────────────────
    OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
    EN_COURS_LIVRAISON: 'OUT_FOR_DELIVERY',
    EN_DISTRIBUTION: 'OUT_FOR_DELIVERY',
    SORTI_POUR_LIVRAISON: 'OUT_FOR_DELIVERY',
    DISPATCHE_LIVREUR: 'OUT_FOR_DELIVERY',
    AVEC_LIVREUR: 'OUT_FOR_DELIVERY',

    // ── In Transit ─────────────────────────────────────────────────────────────
    IN_TRANSIT: 'IN_TRANSIT',
    EN_TRANSIT: 'IN_TRANSIT',
    EXPEDIE: 'IN_TRANSIT',
    EXPÉDIÉ: 'IN_TRANSIT',
    EN_ACHEMINEMENT: 'IN_TRANSIT',
    TRANSFERT_HUB: 'IN_TRANSIT',
    VERS_WILAYA: 'IN_TRANSIT',
    EN_VOYAGE: 'IN_TRANSIT',
    DEPART_CENTRE: 'IN_TRANSIT',

    // ── Picked Up ──────────────────────────────────────────────────────────────
    PICKED_UP: 'PICKED_UP',
    RAMASSE: 'PICKED_UP',
    RAMASSÉ: 'PICKED_UP',
    RECU_AU_CENTRE: 'PICKED_UP',
    COLIS_RECU: 'PICKED_UP',
    DEPOSE_HUB: 'PICKED_UP',
    ENTREPOT_ORIGINE: 'PICKED_UP',

    // ── Pending ────────────────────────────────────────────────────────────────
    PENDING: 'PENDING',
    EN_ATTENTE: 'PENDING',
    PRET_A_EXPEDIER: 'PENDING',
    PRÊT_À_EXPÉDIER: 'PENDING',
    COMMANDE_CREEE: 'PENDING',
    ENREGISTRE: 'PENDING',
    ATTENTE_RAMASSAGE: 'PENDING',

    // ── Delivery Failed ────────────────────────────────────────────────────────
    DELIVERY_FAILED: 'DELIVERY_FAILED',
    ECHEC_LIVRAISON: 'DELIVERY_FAILED',
    ÉCHEC_LIVRAISON: 'DELIVERY_FAILED',
    NON_LIVRE: 'DELIVERY_FAILED',
    ABSENT: 'DELIVERY_FAILED',
    CLIENT_INJOIGNABLE: 'DELIVERY_FAILED',
    ADRESSE_INCOMPLETE: 'DELIVERY_FAILED',
    REPORTE: 'DELIVERY_FAILED',
    TENTATIVE_ECHOUEE: 'DELIVERY_FAILED',

    // ── Customer Refused ───────────────────────────────────────────────────────
    CUSTOMER_REFUSED: 'CUSTOMER_REFUSED',
    REFUSE: 'CUSTOMER_REFUSED',
    REFUSÉ: 'CUSTOMER_REFUSED',
    CLIENT_REFUSE: 'CUSTOMER_REFUSED',
    REFUS_CLIENT: 'CUSTOMER_REFUSED',
    ANNULE_PAR_CLIENT: 'CUSTOMER_REFUSED',
    REFUS_PAIEMENT: 'CUSTOMER_REFUSED',

    // ── Return In Progress ─────────────────────────────────────────────────────
    RETURN_IN_PROGRESS: 'RETURN_IN_PROGRESS',
    RETOUR_EN_COURS: 'RETURN_IN_PROGRESS',
    RETOUR_AU_CENTRE: 'RETURN_IN_PROGRESS',
    EN_COURS_DE_RETOUR: 'RETURN_IN_PROGRESS',
    RETOUR_HUB_BISKRA: 'RETURN_IN_PROGRESS',

    // ── Returned To Sender ─────────────────────────────────────────────────────
    RETURNED_TO_SENDER: 'RETURNED_TO_SENDER',
    RETOURNE: 'RETURNED_TO_SENDER',
    RETOURNÉ: 'RETURNED_TO_SENDER',
    RETOUR_EXPEDITEUR: 'RETURNED_TO_SENDER',
    RETOUR_CONFIRME: 'RETURNED_TO_SENDER',
    CLOTURE_RETOUR: 'RETURNED_TO_SENDER'
};

const STATUS_METADATA = {
    DELIVERED_TO_CUSTOMER: {
        labelAr: 'تم التسليم للزبون',
        labelEn: 'Delivered to Customer',
        badgeVariant: 'success'
    },
    OUT_FOR_DELIVERY: {
        labelAr: 'خرج للتسليم',
        labelEn: 'Out for Delivery',
        badgeVariant: 'secondary'
    },
    IN_TRANSIT: {
        labelAr: 'قيد النقل (In Transit)',
        labelEn: 'In Transit',
        badgeVariant: 'secondary'
    },
    PICKED_UP: {
        labelAr: 'تم استلام الناقل',
        labelEn: 'Picked Up',
        badgeVariant: 'secondary'
    },
    PENDING: {
        labelAr: 'بانتظار الناقل',
        labelEn: 'Pending Pickup',
        badgeVariant: 'outline'
    },
    DELIVERY_FAILED: {
        labelAr: 'تعذر التسليم',
        labelEn: 'Delivery Failed',
        badgeVariant: 'destructive'
    },
    CUSTOMER_REFUSED: {
        labelAr: 'رفض الزبون الاستلام',
        labelEn: 'Customer Refused',
        badgeVariant: 'destructive'
    },
    RETURN_IN_PROGRESS: {
        labelAr: 'مرتجع في الطريق',
        labelEn: 'Return in Progress',
        badgeVariant: 'warning'
    },
    RETURNED_TO_SENDER: {
        labelAr: 'أعيدت إلى المرسل',
        labelEn: 'Returned to Sender',
        badgeVariant: 'warning'
    },
    UNKNOWN: {
        labelAr: 'حالة غير معروفة',
        labelEn: 'Unknown Status',
        badgeVariant: 'outline'
    }
};

/**
 * Normalizes any external raw courier status code.
 * Unknown code returns 'UNKNOWN'.
 */
function normalizeCourierStatus(rawCode) {
    if (!rawCode || typeof rawCode !== 'string') {
        return 'UNKNOWN';
    }
    const clean = rawCode.trim().toUpperCase().replace(/[\s-]+/g, '_');
    return RAW_CODE_TO_NORMALIZED[clean] || 'UNKNOWN';
}

/**
 * Classifies customer receipt state based on normalized courier status.
 */
function classifyCustomerReceipt(status) {
    switch (status) {
        case 'DELIVERED_TO_CUSTOMER':
            return 'Received';
        case 'PENDING':
        case 'PICKED_UP':
        case 'IN_TRANSIT':
        case 'OUT_FOR_DELIVERY':
            return 'Not Yet Received';
        case 'DELIVERY_FAILED':
        case 'CUSTOMER_REFUSED':
            return 'Not Received / Failed';
        case 'RETURN_IN_PROGRESS':
            return 'Returning';
        case 'RETURNED_TO_SENDER':
            return 'Returned';
        case 'UNKNOWN':
        default:
            return 'Unknown';
    }
}

/**
 * Maps raw external status to full normalized mapping info.
 */
function mapExternalCourierStatus(rawCode) {
    const rawStatus = (typeof rawCode === 'string') ? rawCode.trim() : (rawCode ? String(rawCode) : '');
    const normalizedStatus = normalizeCourierStatus(rawStatus);
    const receiptClassification = classifyCustomerReceipt(normalizedStatus);
    const meta = STATUS_METADATA[normalizedStatus] || STATUS_METADATA.UNKNOWN;

    return {
        rawStatus,
        normalizedStatus,
        receiptClassification,
        ...meta
    };
}

module.exports = {
    RAW_CODE_TO_NORMALIZED,
    STATUS_METADATA,
    normalizeCourierStatus,
    classifyCustomerReceipt,
    mapExternalCourierStatus
};

