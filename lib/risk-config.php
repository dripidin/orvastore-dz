<?php
/**
 * ORVA STORE — Risk Engine Configuration
 * Strictly implements Trust & Risk rules:
 * 1. Algeria-only orders (phone format + geo header)
 * 2. Max 3 orders per phone number (24h)
 * 3. Max 3 orders per device (24h)
 * 4. Max 2 orders per WiFi / IP address (24h)
 * 5. Max 3 items per order quantity
 */
return [
    'WINDOW_MINUTES' => 1440, // 24 hours
    'MAX_PHONE_ORDERS' => 3,
    'MAX_DEVICE_ORDERS' => 3,
    'MAX_IP_ORDERS' => 2,
    'MAX_QUANTITY_PER_ORDER' => 3,
    
    'SCORE_WEIGHTS' => [
        'NON_ALGERIAN_GEO' => 100,
        'QUANTITY_EXCEEDED' => 100,
        'HONEYPOT_TRIGGERED' => 100,
        'PHONE_LIMIT_EXCEEDED' => 90,
        'DEVICE_LIMIT_EXCEEDED' => 90,
        'IP_LIMIT_EXCEEDED' => 90,
        'RAPID_SUBMISSION' => 35,
        'MULTI_DEVICE_IDENTITY' => 40,
        'PREVIOUS_REJECTION' => 50,
        'INVALID_PHONE_PATTERN' => 90,
    ],
    
    // Thresholds: 0-29 LOW, 30-59 MEDIUM, 60-79 HIGH, >= 80 CRITICAL/BLOCK
    'THRESHOLDS' => [
        'LOW' => 30,
        'MEDIUM' => 60,
        'HIGH' => 80
    ],
    
    'MIN_FORM_SECONDS' => 4.0,
    'MULTI_DEVICE_THRESHOLD' => 3,
    'PHONE_REGEX' => '/^0[567]\d{8}$/',
    'RETENTION_DAYS' => 30,
    'EVENTS_FILE' => dirname(__DIR__) . '/data/risk-events.json',
];