<?php

return [
    'origin' => env('APP_ORIGIN', ''),
    'registration' => env('ALLOW_REGISTRATION', false),
    'secure_cookie' => env('COOKIE_SECURE', false),
    'login_alias' => env('CRM_LOGIN_USER', 'direccion'),
    'owner_email' => env('CRM_OWNER_EMAIL', 'direccion@hotelexpert.mx'),
    'sara_connection' => env('SARA_CONNECTION_FILE', storage_path('app/private/sara-connection.json')),
    'frontend' => env('FRONTEND_DIRECTORY', base_path('../dist')),
    'webhook_url' => env('N8N_WHATSAPP_WEBHOOK_URL'),
    'relay_secret' => env('WHATSAPP_RELAY_SECRET'),
    'meta_token' => env('META_WHATSAPP_VERIFY_TOKEN'),
    'meta_secret' => env('META_WHATSAPP_APP_SECRET'),
];
