'use strict';
// =============================================================================
// Helper Worker for Multi-Process Settings Mutation Concurrency Stress Test
// =============================================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.local') });

const {
    saveTemplateDraft,
    activateTemplate,
    restoreTemplateDefault,
    toggleTemplate
} = require('../../lib/admin-settings-store');

const workerId = process.argv[2] || 'w1';
const iterations = parseInt(process.argv[3] || '10', 10);

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    for (let i = 0; i < iterations; i++) {
        try {
            // 1. Save draft
            saveTemplateDraft('ORDER_CREATED', `Worker ${workerId} Iter ${i} Content {{order_id}}`, true, `worker_${workerId}`);
            
            // Jitter
            if (i % 3 === 0) {
                await sleep(5 + Math.floor(Math.random() * 15));
            }

            // 2. Activate
            activateTemplate('ORDER_CREATED', `worker_${workerId}`);

            // 3. Toggle
            toggleTemplate('ORDER_CREATED', i % 2 === 0, `worker_${workerId}`);

            // 4. Save draft on another event
            saveTemplateDraft('SHIPMENT_CREATED', `Worker ${workerId} Shipment Iter ${i} {{order_id}}`, true, `worker_${workerId}`);

            // 5. Restore default on shipment
            if (i % 2 === 1) {
                restoreTemplateDefault('SHIPMENT_CREATED', `worker_${workerId}`);
            }
        } catch (err) {
            console.error(`[Worker ${workerId}] FAILURE at iteration ${i}:`, err.message);
            process.exit(1);
        }
    }
    console.log(`WORKER_${workerId}_SUCCESS`);
    process.exit(0);
}

run().catch(err => {
    console.error(`[Worker ${workerId}] Unhandled:`, err);
    process.exit(1);
});
