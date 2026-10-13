<?php

use App\Exceptions\CrmException;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->validateCsrfTokens(except: ['api/*']);
        // Preserve the existing API contract: empty text fields are meaningful.
        $middleware->trimStrings(except: [fn ($request) => $request->is('api/*')]);
        $middleware->convertEmptyStringsToNull(except: [fn ($request) => $request->is('api/*')]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(fn ($request) => $request->is('api/*'));
        $exceptions->render(function (Throwable $error, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }
            $status = $error instanceof CrmException ? $error->status : null;
            if ($error instanceof QueryException) {
                $status = ['23P01' => 409, '23505' => 409, '23503' => 400, '23514' => 400, '23502' => 400, '22P02' => 400, '22007' => 400, '22008' => 400, '22003' => 400, '42501' => 403, 'P0002' => 404, '22023' => 400, '40001' => 409, '40P01' => 409][$error->errorInfo[0] ?? ''] ?? 500;
            }
            if ($status === null && $error instanceof HttpExceptionInterface) {
                $status = $error->getStatusCode();
            }
            $status ??= 500;
            $message = $error instanceof CrmException ? $error->getMessage() : match ($status) {
                400 => 'Los datos no cumplen las reglas del CRM.', 401 => 'Inicia sesión para continuar.',
                403 => 'Permisos insuficientes.', 404 => 'Registro no encontrado.', 405 => 'Método no permitido.',
                409 => 'Conflicto de datos. Recarga e intenta de nuevo.', default => 'No fue posible completar la operación.',
            };

            return response()->json(['ok' => false, 'error' => $message], $status)->withHeaders(['Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff']);
        });
    })->create();
