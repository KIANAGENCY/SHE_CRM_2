<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use RuntimeException;

class SchemaInstaller
{
    public function migrate(): array
    {
        $db = DB::connection('pgsql_admin');

        return $db->transaction(function () use ($db) {
            $db->select('select pg_advisory_xact_lock(90121013)');
            $db->unprepared(file_get_contents(base_path('../database/bootstrap.sql')));
            $db->statement('create table if not exists public.schema_migrations(name text primary key,checksum text not null,applied_at timestamptz not null default now())');
            $applied = [];
            foreach (['../supabase/migrations', '../database/migrations'] as $directory) {
                $files = glob(base_path($directory.'/*.sql'));
                sort($files);
                foreach ($files as $file) {
                    $name = basename($file);
                    $sql = file_get_contents($file);
                    $checksum = hash('sha256', $sql);
                    $previous = $db->selectOne('select checksum from public.schema_migrations where name=?', [$name]);
                    if ($previous) {
                        if ($previous->checksum !== $checksum) {
                            throw new RuntimeException('Migración aplicada fue modificada: '.$name);
                        }

                        continue;
                    }
                    $db->unprepared($sql);
                    $db->insert('insert into public.schema_migrations(name,checksum) values(?,?)', [$name, $checksum]);
                    $applied[] = $name;
                }
            }
            $url = parse_url(config('database.connections.pgsql.url') ?? '');
            if (($url['user'] ?? config('database.connections.pgsql.username')) !== 'she_api') {
                throw new RuntimeException('DATABASE_URL debe usar she_api.');
            }
            $password = rawurldecode($url['pass'] ?? config('database.connections.pgsql.password'));
            if ($password === '') {
                throw new RuntimeException('Configura la contraseña de she_api.');
            }
            $literal = $db->getPdo()->quote($password);
            $db->statement('alter role she_api password '.$literal);

            return $applied;
        });
    }
}
