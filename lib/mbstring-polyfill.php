<?php
/**
 * Minimal mbstring polyfill for local Windows PHP builds without ext-mbstring.
 * Hostinger LiteSpeed normally provides mbstring; these fall back to UTF-8-aware
 * iconv/strlen approximations only when the extension is missing.
 */
if (!function_exists('mb_strlen')) {
    function mb_strlen($string, $encoding = null)
    {
        if (function_exists('iconv_strlen')) {
            $len = @iconv_strlen((string)$string, $encoding ?: 'UTF-8');
            if ($len !== false) {
                return $len;
            }
        }
        return strlen((string)$string);
    }
}

if (!function_exists('mb_substr')) {
    function mb_substr($string, $start, $length = null, $encoding = null)
    {
        $string = (string)$string;
        if (function_exists('iconv_substr')) {
            if ($length === null) {
                $part = @iconv_substr($string, (int)$start, null, $encoding ?: 'UTF-8');
            } else {
                $part = @iconv_substr($string, (int)$start, (int)$length, $encoding ?: 'UTF-8');
            }
            if ($part !== false) {
                return $part;
            }
        }
        if ($length === null) {
            return substr($string, (int)$start);
        }
        return substr($string, (int)$start, (int)$length);
    }
}
