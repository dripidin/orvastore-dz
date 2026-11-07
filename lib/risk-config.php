<?php
/**
 * Risk Engine config — mirrors Services plan ecom / lib/riskConfig.js
 */
return [
    'RATE_LIMIT' => ['maxRequests' => 2, 'windowMinutes' => 1440],
    'SCORE_WEIGHTS' => [
        'RATE_LIMIT_HIT' => 85,
        'RAPID_SUBMISSION' => 35,
        'HONEYPOT_TRIGGERED' => 100,
        'MULTI_DEVICE_IDENTITY' => 40,
        'PREVIOUS_REJECTION' => 50,
        'REPEATED_PHONE' => 85,
        'INVALID_PHONE_PATTERN' => 30,
    ],
    // 0–29 LOW, 30–59 MEDIUM, 60–79 HIGH, 80–100 CRITICAL/BLOCK
    'THRESHOLDS' => ['LOW' => 30, 'MEDIUM' => 60, 'HIGH' => 80],
    'MIN_FORM_SECONDS' => 8,
    'MULTI_DEVICE_THRESHOLD' => 3,
    'PHONE_REGEX' => '/^0[567]\d{8}$/',
    'RETENTION_DAYS' => 30,
    'EVENTS_FILE' => dirname(__DIR__) . '/data/risk-events.json',
];
