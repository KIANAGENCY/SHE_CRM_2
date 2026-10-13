<?php

namespace App\Http\Middleware;

use App\Exceptions\CrmException;
use Closure;
use Illuminate\Http\Request;

class CrmRequest
{
    public function handle(Request $request, Closure $next)
    {
        if (strlen($request->getContent()) > 1048576) {
            throw new CrmException(413, 'El cuerpo supera 1 MiB.');
        }
        if ($request->isMethod('POST')) {
            $origin = config('crm.origin') ?: $request->getSchemeAndHttpHost();
            if (! config('crm.origin') && ! in_array(parse_url($origin, PHP_URL_HOST), ['localhost', '127.0.0.1', '[::1]'], true)) {
                throw new CrmException(403, 'Configura APP_ORIGIN para este dominio.');
            }
            if ($request->header('Origin') !== $origin || $request->header('Sec-Fetch-Site') === 'cross-site') {
                throw new CrmException(403, 'Origen no autorizado.');
            }
            if (! str_starts_with($request->header('Content-Type', ''), 'application/json')) {
                throw new CrmException(415, 'Se requiere application/json.');
            }
            try {
                $body = json_decode($request->getContent(), false, 512, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                throw new CrmException(400, 'JSON inválido.');
            }
            if (! is_object($body)) {
                throw new CrmException(400, 'Se requiere un objeto JSON.');
            }
        }

        return $next($request)->withHeaders(['Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff']);
    }
}
