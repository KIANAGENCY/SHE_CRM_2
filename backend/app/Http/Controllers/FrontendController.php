<?php

namespace App\Http\Controllers;

class FrontendController extends Controller
{
    public function __invoke(string $path = '')
    {
        $root = realpath(config('crm.frontend'));
        $file = $root ? realpath($root.DIRECTORY_SEPARATOR.($path ?: 'index.html')) : false;
        abort_unless($file && str_starts_with($file, $root.DIRECTORY_SEPARATOR) && is_file($file), 404);
        $extension = pathinfo($file, PATHINFO_EXTENSION);
        abort_unless(in_array($extension, ['html', 'js', 'css', 'svg', 'png', 'ico', 'woff2'], true), 404);
        $index = file_get_contents($root.'/index.html');
        preg_match_all('/<script\b[^>]*>(.*?)<\/script>/s', $index, $scripts);
        $hashes = array_map(fn ($script) => "'sha256-".base64_encode(hash('sha256', $script, true))."'", array_filter($scripts[1], fn ($script) => trim($script) !== ''));
        $policy = "default-src 'self'; script-src 'self' ".implode(' ', $hashes)."; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
        $types = ['html' => 'text/html; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'css' => 'text/css; charset=utf-8', 'svg' => 'image/svg+xml'];

        return response()->file($file, ['Content-Type' => $types[$extension] ?? 'application/octet-stream', 'Cache-Control' => str_starts_with($path, 'assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'Content-Security-Policy' => $policy, 'X-Content-Type-Options' => 'nosniff', 'X-Frame-Options' => 'DENY', 'Referrer-Policy' => 'same-origin', 'Permissions-Policy' => 'camera=(), microphone=(), geolocation=()']);
    }
}
