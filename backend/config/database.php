<?php

$postgres = [
    'driver' => 'pgsql', 'host' => env('DB_HOST', '127.0.0.1'),
    'port' => env('DB_PORT', 55432), 'database' => env('DB_DATABASE', 'she_crm'),
    'username' => env('DB_USERNAME', 'she_api'), 'password' => env('DB_PASSWORD', ''),
    'charset' => 'utf8', 'prefix' => '', 'prefix_indexes' => true,
    'search_path' => 'public', 'sslmode' => env('DB_SSLMODE', 'prefer'),
];

return [
    'default' => 'pgsql',
    'connections' => [
        'pgsql' => array_merge($postgres, ['url' => env('DATABASE_URL')]),
        'pgsql_admin' => array_merge($postgres, ['url' => env('DATABASE_ADMIN_URL')]),
    ],
    'migrations' => ['table' => 'laravel_migrations', 'update_date_on_publish' => true],
];
