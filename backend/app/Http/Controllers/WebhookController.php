<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class WebhookController extends Controller
{
    private function error(int $status, string $error)
    {
        return response()->json(['ok' => false, 'error' => $error], $status)->header('Cache-Control', 'no-store');
    }

    private function url(): ?string
    {
        $url = config('crm.webhook_url');
        $parts = parse_url($url ?? '');

        return is_string($url) && filter_var($url, FILTER_VALIDATE_URL) && in_array($parts['scheme'] ?? '', ['http', 'https'], true) && ! isset($parts['user']) && ! isset($parts['pass']) ? $url : null;
    }

    private function valid(string $raw): bool
    {
        $body = json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
        if (! is_array($body) || ($body['object'] ?? '') !== 'whatsapp_business_account' || ! is_array($body['entry'] ?? null) || ! array_is_list($body['entry']) || ! $body['entry']) {
            return false;
        }
        foreach ($body['entry'] as $entry) {
            if (! is_array($entry) || ! is_string($entry['id'] ?? null) || $entry['id'] === '') {
                return false;
            }
        }

        return true;
    }

    private function forward(string $raw, array $headers)
    {
        try {
            $response = Http::withHeaders($headers)->withBody($raw, 'application/json')->withoutRedirecting()->connectTimeout(5)->timeout(8)->post($this->url());
            if (! $response->successful()) {
                return response()->json(['ok' => false, 'error' => 'n8n_rejected_event', 'upstreamStatus' => $response->status()], 502);
            }

            return response()->json(['ok' => true, 'accepted' => true], 202);
        } catch (\Throwable) {
            return $this->error(502, 'n8n_unavailable');
        }
    }

    public function relay(Request $request)
    {
        if ($request->isMethod('GET')) {
            return response()->json(['ok' => true, 'service' => 'she-whatsapp-relay']);
        }
        $secret = config('crm.relay_secret');
        if (! $secret || ! $this->url()) {
            return $this->error(503, 'relay_not_configured');
        }
        if (! hash_equals($secret, $request->header('x-she-relay-secret', ''))) {
            return $this->error(401, 'unauthorized');
        }
        $raw = $request->getContent();
        if (strlen($raw) > 1048576) {
            return $this->error(413, 'payload_too_large');
        }
        try {
            if (! $this->valid($raw)) {
                return $this->error(400, 'invalid_whatsapp_payload');
            }
        } catch (\JsonException) {
            return $this->error(400, 'invalid_json');
        }

        return $this->forward($raw, ['x-she-relay-secret' => $secret]);
    }

    public function meta(Request $request)
    {
        if ($request->isMethod('GET')) {
            // PHP normalizes dots in query names; parse the original query string.
            $params = [];
            foreach (explode('&', $request->server('QUERY_STRING', '')) as $item) {
                $pair = explode('=', $item, 2);
                $params[urldecode($pair[0])] = urldecode($pair[1] ?? '');
            }
            $challenge = $params['hub.challenge'] ?? $request->query('hub.challenge', $request->query('hub_challenge'));
            $mode = $params['hub.mode'] ?? $request->query('hub.mode', $request->query('hub_mode'));
            $token = $params['hub.verify_token'] ?? $request->query('hub.verify_token', $request->query('hub_verify_token', ''));
            if ($mode !== 'subscribe' || ! is_string($challenge) || $challenge === '') {
                return $this->error(400, 'invalid_verification_request');
            }
            if (! config('crm.meta_token')) {
                return $this->error(503, 'meta_webhook_not_configured');
            }
            if (! is_string($token) || ! hash_equals(config('crm.meta_token'), $token)) {
                return $this->error(403, 'invalid_verify_token');
            }

            return response($challenge, 200)->header('Content-Type', 'text/plain; charset=utf-8')->header('Cache-Control', 'no-store');
        }
        $secret = config('crm.meta_secret');
        if (! $secret || ! $this->url()) {
            return $this->error(503, 'meta_webhook_not_configured');
        }
        $signature = $request->header('x-hub-signature-256', '');
        if (! preg_match('/^sha256=[a-fA-F0-9]{64}$/D', $signature)) {
            return $this->error(401, 'invalid_signature');
        }
        $raw = $request->getContent();
        if (strlen($raw) > 1048576) {
            return $this->error(413, 'payload_too_large');
        }
        if (! hash_equals('sha256='.hash_hmac('sha256', $raw, $secret), strtolower($signature))) {
            return $this->error(401, 'invalid_signature');
        }
        try {
            if (! $this->valid($raw)) {
                return $this->error(400, 'invalid_whatsapp_payload');
            }
        } catch (\JsonException) {
            return $this->error(400,'invalid_json');
        }

        return $this->forward($raw,['x-she-source' => 'meta-whatsapp']);
    }
}
