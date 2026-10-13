<?php

namespace App\Services;

use App\Exceptions\CrmException;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CrmDatabase
{
    public function connection(): Connection
    {
        $db = DB::connection('pgsql');
        if ($db->selectOne('select current_user as name')->name !== 'she_api') {
            throw new CrmException(503, 'La API requiere el rol restringido she_api.');
        }

        return $db;
    }

    public function transaction(callable $callback, ?string $user = null, bool $readOnly = false): mixed
    {
        $db = $this->connection();

        return $db->transaction(function () use ($db, $callback, $user, $readOnly) {
            if ($readOnly) {
                $db->statement('set transaction isolation level repeatable read read only');
            }
            $db->statement("set local statement_timeout='10s'");
            if ($user) {
                $db->statement('set local role authenticated');
                $db->select("select set_config('request.jwt.claim.sub', ?, true)", [$user]);
            }

            return $callback($db);
        });
    }

    public function context(Connection $db, array $user, ?string $workspace = null): array
    {
        if ($workspace && ! preg_match('/^[a-f0-9-]{36}$/iD', $workspace)) {
            throw new CrmException(400, 'Espacio inválido.');
        }
        $membership = $db->selectOne('select m.role,w.id,w.name from public.workspace_members m join public.workspaces w on w.id=m.workspace_id where m.user_id=? '.($workspace ? 'and w.id=? ' : '').'order by m.created_at,w.id limit 1', $workspace ? [$user['id'], $workspace] : [$user['id']]);
        if (! $membership) {
            throw new CrmException(403, 'No tienes acceso a este espacio.');
        }

        return ['user' => $user, 'workspace' => ['id' => $membership->id, 'name' => $membership->name], 'role' => $membership->role, 'roleLabel' => ['owner' => 'Dirección', 'admin' => 'Administración', 'sales' => 'Ventas', 'production' => 'Producción'][$membership->role]];
    }

    public function revision(Connection $db, string $workspace, mixed $expected): void
    {
        $row = $db->selectOne('select revision from public.workspace_revisions where workspace_id=? for update', [$workspace]);
        if (! $row || (! is_int($expected) && ! is_string($expected)) || (string) $expected !== (string) $row->revision) {
            throw new CrmException(409, 'Otro usuario modificó los datos. Recarga antes de guardar.');
        }
    }

    public function bump(Connection $db, string $workspace): int
    {
        return (int) $db->selectOne('update public.workspace_revisions set revision=revision+1 where workspace_id=? returning revision', [$workspace])->revision;
    }

    public function audit(Connection $db, array $ctx, string $action): void
    {
        $db->insert('insert into public.audit_log(workspace_id,id,actor,action) values(?,?,?,?)', [$ctx['workspace']['id'], (string) Str::uuid(), $ctx['user']['email'], $action]);
    }
}
