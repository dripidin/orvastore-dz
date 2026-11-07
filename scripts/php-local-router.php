<?php
/**
 * Router for `php -S 127.0.0.1:8000 scripts/php-local-router.php`
 * Serves static files and routes /api/*.php correctly.
 */
$uri = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/');
$root = dirname(__DIR__);
$path = $root . str_replace('/', DIRECTORY_SEPARATOR, $uri);

if ($uri !== '/' && is_file($path)) {
    return false; // serve as-is
}

// Pretty API paths: /api/send-order -> api/send-order.php
if (preg_match('#^/api/([a-z0-9\-]+)/?$#i', $uri, $m)) {
    $php = $root . '/api/' . $m[1] . '.php';
    if (is_file($php)) {
        require $php;
        return true;
    }
}

if (is_dir($path)) {
    $index = rtrim($path, '/\\') . DIRECTORY_SEPARATOR . 'index.html';
    if (is_file($index)) {
        header('Content-Type: text/html; charset=utf-8');
        readfile($index);
        return true;
    }
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo "Not found: {$uri}\n";
return true;
