<?php

namespace Tests\Feature;

use App\Services\SchemaInstaller;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PostgresCrmTest extends TestCase
{
    private string $name;

    protected function setUp(): void
    {
        parent::setUp();
        $this->encryptCookies = false;
        $url = config('database.connections.pgsql_admin.url');
        if (! $url) {
            $this->markTestSkipped('Configura PostgreSQL para las pruebas de integración.');
        }
        $this->name = 'she_crm_laravel_test_'.bin2hex(random_bytes(6));
        DB::connection('pgsql_admin')->statement('create database '.$this->name);
        config(['database.connections.test_maintenance' => config('database.connections.pgsql_admin')]);
        foreach (['pgsql', 'pgsql_admin'] as $connection) {
            $parts = parse_url(config("database.connections.$connection.url"));
            $target = $parts['scheme'].'://'.$parts['user'].':'.($parts['pass'] ?? '').'@'.$parts['host'].':'.($parts['port'] ?? 5432).'/'.$this->name;
            config(["database.connections.$connection.url" => $target]);
            DB::purge($connection);
        }
        config(['crm.origin' => 'http://localhost', 'crm.registration' => true, 'crm.secure_cookie' => false]);
        app(SchemaInstaller::class)->migrate();
        app(SchemaInstaller::class)->migrate();
    }

    protected function tearDown(): void
    {
        if (isset($this->name) && preg_match('/^she_crm_laravel_test_[a-f0-9]{12}$/D', $this->name)) {
            DB::disconnect('pgsql');
            DB::disconnect('pgsql_admin');
            DB::connection('test_maintenance')->statement('drop database '.$this->name.' with (force)');
            DB::purge('test_maintenance');
        }
        parent::tearDown();
    }

    private function api(string $path, ?array $body = null, string $token = '', string $prefix = 'crm', array $server = [])
    {
        return $this->call($body === null ? 'GET' : 'POST', "/api/$prefix$path", [], $token ? ['she_session' => $token] : [], [], array_merge(['CONTENT_TYPE' => 'application/json', 'HTTP_ORIGIN' => 'http://localhost', 'REMOTE_ADDR' => '127.0.0.1'], $server), $body === null ? null : json_encode($body ?: (object) []));
    }

    private function owner(string $email = 'owner@example.test'): array
    {
        $response = $this->api('/auth/signup', ['email' => $email, 'password' => 'Owner-test-password!', 'fullName' => 'Owner Test', 'workspaceName' => 'CRM Test']);
        $response->assertOk();
        $token = $response->headers->getCookies()[0]->getValue();
        $session = $this->api('/session', null, $token)->assertOk()->json('context');

        return [$token, $session['workspace']['id']];
    }

    public function test_sessions_registration_permissions_and_workspace_isolation(): void
    {
        $this->api('/health')->assertOk()->assertJson(['backend' => 'laravel', 'database' => 'postgresql']);
        $this->api('/state')->assertUnauthorized();
        [$token,$workspace] = $this->owner();
        $hash = DB::connection('pgsql_admin')->selectOne("select password_hash from auth.users where email='owner@example.test'")->password_hash;
        $this->assertStringStartsWith('$argon2id$', $hash);
        $this->api('/auth/login', ['email' => 'owner@example.test', 'password' => 'wrong'])->assertUnauthorized();
        $login = $this->api('/auth/login', ['email' => 'owner@example.test', 'password' => 'Owner-test-password!'])->assertOk();
        $this->assertTrue($login->headers->getCookies()[0]->isHttpOnly());
        $this->assertSame('strict', $login->headers->getCookies()[0]->getSameSite());
        [$other] = $this->owner('other@example.test');
        $this->api('/state?workspace='.$workspace, null, $other)->assertForbidden();
        config(['crm.registration' => false]);
        $this->api('/auth/signup', ['email' => 'closed@example.test', 'password' => 'Owner-test-password!', 'fullName' => 'Closed Owner', 'workspaceName' => 'Closed Workspace'])->assertForbidden();
        $this->api('/sync', ['workspace' => $workspace, 'revision' => 0, 'changes' => []], $token, 'crm', ['HTTP_ORIGIN' => 'https://attacker.test'])->assertForbidden();
        $this->api('/auth/logout', [], $token)->assertOk();
        $this->api('/state', null, $token)->assertUnauthorized();
        $role = DB::connection('pgsql')->selectOne('select rolsuper,rolbypassrls,rolinherit from pg_roles where rolname=current_user');
        $this->assertFalse($role->rolsuper);
        $this->assertFalse($role->rolbypassrls);
        $this->assertFalse($role->rolinherit);
    }

    public function test_sync_is_atomic_revision_checked_and_validates_real_business_rules(): void
    {
        [$token,$workspace] = $this->owner();
        $revision = 0;
        $change = fn ($table, $id, $values, $op = 'insert') => ['table' => $table, 'id' => $id, 'values' => $values, 'operation' => $op];
        $write = function ($changes) use ($token, $workspace, &$revision) {
            $response = $this->api('/sync', ['workspace' => $workspace, 'revision' => $revision, 'changes' => $changes], $token);
            if ($response->status() === 200) {
                $revision = $response->json('revision');
            }

return $response;
        };
        $write([$change('clients', 'rollback', ['name' => 'Rollback']), $change('tasks', 'bad', ['client_id' => 'missing', 'title' => 'Invalid'])])->assertStatus(400);
        $this->api('/state', null, $token)->assertJsonCount(0, 'rows.clients');
        $write([$change('clients;drop table auth.users', 'attack', ['name' => 'Attack'])])->assertStatus(400);
        $write([$change('clients', 'client', ['name' => 'Cliente uno', 'notes' => '', 'email' => '', 'phone' => '']), $change('products', 'p1', ['name' => 'Producto', 'sku' => 'SKU1', 'price' => 100]), $change('aromas', 'a1', ['name' => 'Aroma', 'approved' => true, 'product_ids' => ['p1']])])->assertOk();
        $this->api('/sync', ['workspace' => $workspace, 'revision' => 0, 'changes' => []], $token)->assertStatus(409);
        $state = $this->api('/state', null, $token)->assertOk();
        $this->assertSame(['p1'], $state->json('rows.aromas.0.product_ids'));
        $quote = ['client_id' => 'client', 'lines' => [['productId' => 'p1', 'aromaId' => 'a1', 'quantity' => 2, 'price' => 100]], 'subtotal' => 200, 'discount' => 0, 'total' => 200, 'valid_until' => '2099-12-31', 'status' => 'Aceptada', 'acceptance_reference' => 'Aceptado por correo', 'accepted_at' => '2026-10-13T12:00:00Z'];
        $write([$change('quotes', 'bad', array_merge($quote, ['total' => 1]))])->assertStatus(400);
        $write([$change('quotes', 'q1', $quote), $change('orders', 'o1', ['client_id' => 'client', 'quote_id' => 'q1', 'total' => 200, 'confirmed' => true])])->assertOk();
        $write([$change('orders', 'o1', ['status' => 'Entregado'], 'update')])->assertStatus(400);
        $appointment = ['client_id' => 'client', 'owner_name' => 'Vendedor', 'start_at' => '2099-01-01T10:00:00Z', 'duration' => 30, 'type' => 'Llamada'];
        $write([$change('appointments', 'ap1', $appointment)])->assertOk();
        $write([$change('appointments', 'ap2', array_merge($appointment, ['start_at' => '2099-01-01T10:15:00Z']))])->assertStatus(409);
        $state = $this->api('/state', null, $token)->assertOk();
        $this->assertSame('owner@example.test', $state->json('rows.audit_log.0.actor'));
        $this->assertSame('she_api', DB::connection('pgsql')->selectOne('select current_user as name')->name);
    }

    public function test_team_roles_and_production_pack_are_enforced(): void
    {
        [$owner,$workspace] = $this->owner();
        $revision = 0;
        $tokens = [];
        foreach (['sales', 'production'] as $role) {
            $response = $this->api('/members', ['workspace' => $workspace, 'revision' => $revision, 'email' => "$role@example.test", 'role' => $role, 'password' => 'Member-test-password!', 'fullName' => 'Test Member'], $owner)->assertOk();
            $revision = $response->json('revision');
            $login = $this->api('/auth/login', ['email' => "$role@example.test", 'password' => 'Member-test-password!'])->assertOk();
            $tokens[$role] = $login->headers->getCookies()[0]->getValue();
        }
        $this->api('/members', ['workspace' => $workspace, 'revision' => $revision, 'email' => 'sales@example.test', 'role' => 'admin', 'password' => 'short'], $tokens['sales'])->assertForbidden();
        $this->api('/sync', ['workspace' => $workspace, 'revision' => $revision, 'changes' => [['table' => 'products', 'id' => 'bad', 'operation' => 'insert', 'values' => ['name' => 'Bad', 'sku' => 'B', 'price' => 1]]]], $tokens['sales'])->assertForbidden();
        $this->api('/sync', ['workspace' => $workspace, 'revision' => $revision, 'changes' => []], $tokens['production'])->assertForbidden();
        $this->api('/pack', ['workspace' => $workspace, 'revision' => $revision, 'orderId' => 'missing'], $tokens['sales'])->assertForbidden();
        $this->api('/pack', ['workspace' => $workspace, 'revision' => $revision, 'orderId' => 'missing'], $tokens['production'])->assertNotFound();
        $changes = [
            ['table' => 'clients', 'id' => 'c1', 'operation' => 'insert', 'values' => ['name' => 'Cliente']],
            ['table' => 'products', 'id' => 'p1', 'operation' => 'insert', 'values' => ['name' => 'Producto', 'sku' => 'P1', 'price' => 100]],
            ['table' => 'aromas', 'id' => 'a1', 'operation' => 'insert', 'values' => ['name' => 'Aroma', 'approved' => true, 'product_ids' => ['p1']]],
            ['table' => 'quotes', 'id' => 'q1', 'operation' => 'insert', 'values' => ['client_id' => 'c1', 'lines' => [['productId' => 'p1', 'aromaId' => 'a1', 'quantity' => 1, 'price' => 100]], 'subtotal' => 100, 'discount' => 0, 'total' => 100, 'valid_until' => '2099-12-31', 'status' => 'Aceptada', 'acceptance_reference' => 'Por correo', 'accepted_at' => '2026-10-13T12:00:00Z']],
            ['table' => 'orders', 'id' => 'o1', 'operation' => 'insert', 'values' => ['client_id' => 'c1', 'quote_id' => 'q1', 'total' => 100, 'confirmed' => true]],
        ];
        $revision = $this->api('/sync', ['workspace' => $workspace, 'revision' => $revision, 'changes' => $changes], $owner)->assertOk()->json('revision');
        $revision = $this->api('/sync', ['workspace' => $workspace, 'revision' => $revision, 'changes' => [['table' => 'orders', 'id' => 'o1', 'operation' => 'update', 'values' => ['status' => 'En producción']]]], $owner)->assertOk()->json('revision');
        foreach ([1, 2] as $_) {
            $revision = $this->api('/pack', ['workspace' => $workspace, 'revision' => $revision, 'orderId' => 'o1'], $tokens['production'])->assertOk()->json('revision');
        }
        $state = $this->api('/state', null, $owner)->assertOk();
        $state->assertJsonPath('rows.orders.0.status', 'Empacado');
        $events = array_filter($state->json('rows.notifications'), fn ($row) => $row['event'] === 'Empacado');
        $this->assertCount(1, $events);
    }

    public function test_sara_persists_in_postgresql_and_keeps_workspace_isolation(): void
    {
        [$token,$workspace] = $this->owner();
        $this->api('/state', null, '', 'sara')->assertUnauthorized();
        $state = $this->api('/state', null, $token, 'sara')->assertOk();
        $this->assertCount(7, $state->json('state.products'));
        $this->assertCount(0, $state->json('state.clients'));
        $body = ['revision' => $state->json('revision'), 'changes' => [['collection' => 'clients', 'id' => 'c1', 'operation' => 'put', 'value' => ['id' => 'c1', 'name' => 'Persistido', 'contact' => 'Contacto']]]];
        $this->api('/sync', $body, $token, 'sara')->assertOk();
        $this->api('/sync', $body, $token, 'sara')->assertStatus(409);
        $this->api('/state', null, $token, 'sara')->assertJsonPath('state.clients.0.name', 'Persistido');
        [$other] = $this->owner('other@example.test');
        $this->api('/state', null, $other, 'sara')->assertJsonCount(0, 'state.clients');
        $this->assertSame(2, DB::connection('pgsql_admin')->selectOne('select count(*) as count from public.sara_snapshots')->count);
        $this->assertSame($workspace, DB::connection('pgsql_admin')->selectOne("select workspace_id from public.sara_snapshots where payload->'overrides'->'clients'->'c1' is not null")->workspace_id);
    }

    public function test_webhooks_verify_original_bytes_and_do_not_require_a_browser_session(): void
    {
        config(['crm.webhook_url' => 'https://n8n.example.test/webhook/test', 'crm.relay_secret' => 'relay-test', 'crm.meta_secret' => 'meta-test', 'crm.meta_token' => 'verify-test']);
        Http::fake(['n8n.example.test/*' => Http::response([], 200)]);
        $raw = ' {"object":"whatsapp_business_account","entry":[{"id":"123"}]} ';
        $this->call('POST', '/api/meta-whatsapp-webhook', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $raw, 'meta-test')], $raw)->assertStatus(202);
        Http::assertSent(fn ($request) => $request->body() === $raw && $request->header('x-she-source')[0] === 'meta-whatsapp');
        $this->call('POST', '/api/meta-whatsapp-webhook', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.str_repeat('0', 64)], $raw)->assertUnauthorized();
        $this->get('/api/meta-whatsapp-webhook?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=123')->assertOk()->assertContent('123');
        $this->get('/api/meta-whatsapp-webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123')->assertForbidden();
    }

    public function test_sara_refresh_preserves_edits_and_identity_and_rejects_invalid_source(): void
    {
        [$token] = $this->owner();
        $file = storage_path('app/private/test-sara-'.bin2hex(random_bytes(8)).'.json');
        file_put_contents($file, json_encode(['url' => 'https://anluxagency.app.n8n.cloud/webhook/test', 'token' => 'test-token']));
        config(['crm.sara_connection' => $file]);
        try {
            $source = ['schemaVersion' => 1, 'rows' => [], 'columns' => [['name' => 'whatsapp_id']], 'messages' => [['message_key' => 'm1', 'contact_id' => '555', 'actor' => 'client', 'text' => 'Hola', 'occurred_at' => '2026-10-13T10:00:00Z', 'canal_origen' => 'WhatsApp']]];
            $sequence = Http::sequence()->push($source);
            Http::fake(['anluxagency.app.n8n.cloud/*' => $sequence]);
            $first = $this->api('/refresh', [], $token, 'sara')->assertOk();
            $id = $first->json('state.clients.0.id');
            $this->assertTrue($first->json('state.clients.0.sara.captured_without_ai'));
            $this->api('/sync', ['revision' => $first->json('revision'), 'changes' => [['collection' => 'clients', 'id' => $id, 'operation' => 'put', 'value' => ['id' => $id, 'name' => 'Nombre del equipo']]]], $token, 'sara')->assertOk();
            $source['rows'] = [['id' => '1', 'whatsapp_id' => '555', 'nombre' => 'Analizado por SARA', 'etapa_pipeline' => 'cotizacion', 'cotizacion_solicitada' => true, 'future_field' => 'Conservado']];
            $sequence->push($source);
            $updated = $this->api('/refresh', [], $token, 'sara')->assertOk();
            $updated->assertJsonCount(1,'state.clients')->assertJsonPath('state.clients.0.id',$id)->assertJsonPath('state.clients.0.name','Nombre del equipo')->assertJsonPath('state.clients.0.sara.future_field','Conservado')->assertJsonCount(1,'state.conversations.0.messages');
            $updated->assertJsonCount(0,'state.orders');
            $sequence->push(['schemaVersion' => 99]);
            $failed = $this->api('/refresh',[],$token,'sara')->assertOk();
            $failed->assertJsonPath('state.clients.0.id',$id)->assertJsonPath('state.clients.0.name','Nombre del equipo');
            $this->assertNotSame('',$failed->json('state.saraSync.error'));
        } finally {
            unlink($file);
        }
    }
}
