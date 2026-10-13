<?php

use App\Services\CrmAuth;
use App\Services\SchemaInstaller;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

Artisan::command('she:migrate', function (SchemaInstaller $installer) {
    foreach ($installer->migrate() as $file) {
        $this->info('Migración: '.$file);
    }
    $this->info('PostgreSQL preparado; API con rol she_api.');
})->purpose('Apply the CRM PostgreSQL schema with checksums');

Artisan::command('she:provision-admin', function (CrmAuth $auth) {
    // Credentials arrive over stdin, never as command-line arguments or output.
    $body = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
    $email = strtolower(trim($body['email'] ?? config('crm.owner_email')));
    if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Correo inválido.');
    }
    $hash = $auth->password($body['password'] ?? null);
    DB::connection('pgsql_admin')->transaction(function ($db) use ($body, $email, $hash) {
        $db->select('select pg_advisory_xact_lock(90121012)');
        if ($db->selectOne('select 1 from auth.users limit 1')) {
            throw new RuntimeException('Ya existe una cuenta; no se sobrescribe.');
        }
        $db->insert('insert into auth.users(email,password_hash,raw_user_meta_data) values(?,?,?::jsonb)', [$email, $hash, json_encode(['full_name' => $body['fullName'] ?? 'Dirección', 'workspace_name' => $body['workspaceName'] ?? 'Hotel Expert'])]);
    });
    $this->info('Cuenta principal creada; registro público cerrado.');
})->purpose('Create the first CRM owner from a private stdin JSON payload');

Artisan::command('she:import-sara', function () {
    $payload = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
    if (! is_array($payload)) {
        throw new RuntimeException('Respaldo inválido.');
    }
    DB::connection('pgsql_admin')->transaction(function ($db) use ($payload) {
        $workspace = $db->selectOne("select workspace_id from public.workspace_members where role='owner' order by created_at limit 1");
        if (! $workspace) {
            throw new RuntimeException('Crea Dirección antes de importar.');
        }
        if ($db->selectOne('select 1 from public.sara_snapshots where workspace_id=?', [$workspace->workspace_id])) {
            throw new RuntimeException('El destino ya contiene datos.');
        }
        $db->insert('insert into public.sara_snapshots(workspace_id,revision,payload) values(?,?,?::jsonb)', [$workspace->workspace_id, $payload['revision'] ?? 0, json_encode($payload, JSON_THROW_ON_ERROR)]);
    });
    $this->info('Respaldo SARA importado en PostgreSQL sin sobrescribir datos.');
})->purpose('Import an offline SARA snapshot into an empty PostgreSQL workspace');
