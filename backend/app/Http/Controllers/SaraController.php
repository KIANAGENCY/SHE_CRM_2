<?php

namespace App\Http\Controllers;

use App\Exceptions\CrmException;
use App\Services\CrmAuth;
use App\Services\CrmDatabase;
use App\Services\SaraStore;
use Illuminate\Database\Connection;
use Illuminate\Http\Request;

class SaraController extends Controller
{
    public function __construct(private CrmAuth $auth, private CrmDatabase $database, private SaraStore $store) {}

    public function handle(Request $request, string $path = '')
    {
        if ($request->isMethod('POST') && $path === 'auth/login') {
            $result = $this->auth->authenticate($request, false, true);
            $ctx = $this->database->transaction(fn (Connection $db) => $this->database->context($db, $result['user']), $result['user']['id'], true);

            return response()->json(['context' => $ctx])->withCookie($this->auth->cookie($result['token']));
        }
        if ($request->isMethod('POST') && $path === 'auth/logout') {
            $this->auth->logout($request);

            return response()->json(['ok' => true])->withCookie($this->auth->cookie('', 0));
        }
        $user = $this->auth->user($request);
        if (! $user && $request->isMethod('GET') && $path === 'session') {
            return response()->json(['context' => null]);
        }
        if (! $user) {
            throw new CrmException(401, 'Inicia sesión para continuar.');
        }
        $ctx = $this->database->transaction(fn (Connection $db) => $this->database->context($db, $user), $user['id'], true);
        if ($request->isMethod('GET') && $path === 'session') {
            return response()->json(['context' => $ctx]);
        }
        if (($request->isMethod('GET') && $path === 'state') || ($request->isMethod('POST') && $path === 'refresh')) {
            $this->store->refresh($ctx, $path === 'refresh');

            return response()->json($this->store->snapshot($ctx));
        }
        if ($request->isMethod('POST') && $path === 'sync') {
            return response()->json(['revision' => $this->store->save($ctx, $request->json()->all())]);
        }
        throw new CrmException(404,'Ruta desconocida.');
    }
}
