<?php

use App\Http\Controllers\CrmController;
use App\Http\Controllers\SaraController;
use App\Http\Controllers\WebhookController;
use App\Http\Middleware\CrmRequest;
use Illuminate\Support\Facades\Route;

Route::middleware(CrmRequest::class)->group(function () {
    Route::match(['GET', 'POST'], 'crm/{path?}', [CrmController::class, 'handle'])->where('path', '.*');
    Route::match(['GET', 'POST'], 'sara/{path?}', [SaraController::class, 'handle'])->where('path', '.*');
});
Route::match(['GET', 'POST'], 'whatsapp-relay', [WebhookController::class, 'relay']);
Route::match(['GET', 'POST'], 'meta-whatsapp-webhook', [WebhookController::class, 'meta']);
