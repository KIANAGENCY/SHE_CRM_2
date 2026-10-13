# SHE CRM · Laravel backend

Laravel 13 + PostgreSQL; React remains in the parent project.

See [local setup, APIs and VPS deployment](../docs/LARAVEL.md).

Use `composer install`, configure `.env`, and run `php artisan she:migrate`.
Start locally with `php artisan serve --host=127.0.0.1 --port=8000`.
Tests: `composer test` against a configured PostgreSQL server.

Production uses `../deployment/laravel-compose.yaml`, PHP-FPM and Nginx.
Administrative database credentials belong only to migration jobs; the API uses `she_api`.