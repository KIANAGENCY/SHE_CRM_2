<?php

namespace App\Http\Controllers;

use App\Exceptions\CrmException;
use App\Services\CrmAuth;
use App\Services\CrmDatabase;
use Illuminate\Database\Connection;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CrmController extends Controller
{
    private const COLUMNS = [
        'clients' => 'name legal_name rfc address contact position phone email owner_name last_order created_on aroma notes channel',
        'products' => 'name size price sku', 'aromas' => 'name family notes intensity areas product_ids approved',
        'opportunities' => 'client_id stage route amount next_action owner_name created_on',
        'quotes' => 'client_id lines subtotal discount total valid_until payment shipping delivery channel status version acceptance_reference accepted_at created_at',
        'orders' => 'client_id opportunity_id quote_id total status confirmed created_on due_on tracking channel invoice_amount delivered_on',
        'samples' => 'opportunity_id client_id status aroma result tracking',
        'appointments' => 'client_id owner_name start_at duration type', 'tasks' => 'client_id title',
        'conversations' => 'client_id human messages', 'crm_settings' => 'discount_limit initialized',
    ];

    public function __construct(private CrmDatabase $database, private CrmAuth $auth) {}

    public function handle(Request $request, string $path = '')
    {
        if ($request->isMethod('GET') && $path === 'health') {
            $this->database->connection()->select('select 1');

            return response()->json(['ok' => true, 'database' => 'postgresql', 'backend' => 'laravel']);
        }
        if ($request->isMethod('POST') && in_array($path, ['auth/login', 'auth/signup'], true)) {
            $result = $this->auth->authenticate($request, $path === 'auth/signup');

            return response()->json(['user' => $result['user'], 'session' => true])->withCookie($this->auth->cookie($result['token']));
        }
        if ($request->isMethod('POST') && $path === 'auth/logout') {
            $this->auth->logout($request);

            return response()->json(['ok' => true])->withCookie($this->auth->cookie('', 0));
        }
        $user = $this->auth->user($request);
        if ($request->isMethod('GET') && $path === 'session' && ! $user) {
            return response()->json(['context' => null]);
        }
        if (! $user) {
            throw new CrmException(401, 'Inicia sesión para continuar.');
        }
        if ($request->isMethod('GET') && in_array($path, ['session', 'state', 'members'], true)) {
            return response()->json($this->database->transaction(function (Connection $db) use ($request, $path, $user) {
                $ctx = $this->database->context($db, $user, $request->query('workspace'));
                if ($path === 'session') {
                    return ['context' => $ctx];
                }
                $workspace = $ctx['workspace']['id'];
                if ($path === 'members') {
                    return ['members' => $db->select('select user_id,role from public.workspace_members where workspace_id=?', [$workspace])];
                }
                $rows = [];
                foreach (array_merge(array_keys(self::COLUMNS), ['notifications', 'audit_log']) as $table) {
                    $order = $table === 'crm_settings' ? 'workspace_id' : 'id';
                    $rows[$table] = array_map($this->decodeRow(...), $db->select("select * from public.$table where workspace_id=? order by $order", [$workspace]));
                }

                return ['rows' => $rows, 'revision' => (int) $db->selectOne('select revision from public.workspace_revisions where workspace_id=?', [$workspace])->revision];
            }, $user['id'], true));
        }
        if ($request->isMethod('POST') && in_array($path, ['sync', 'pack', 'members'], true)) {
            $body = $request->json()->all();
            if (! is_string($body['workspace'] ?? null)) {
                throw new CrmException(400, 'Indica el espacio de trabajo.');
            }
            if ($path === 'members') {
                $this->database->transaction(function (Connection $db) use ($user, $body) {
                    $this->authorizeMember($this->database->context($db, $user, $body['workspace']), $body);
                }, $user['id'], true);
            }
            $hash = $path === 'members' && ! empty($body['password']) ? $this->auth->password($body['password']) : null;

            return response()->json($this->database->transaction(function (Connection $db) use ($user, $path, $body, $hash) {
                $ctx = $this->database->context($db, $user, $body['workspace']);
                $workspace = $ctx['workspace']['id'];
                $this->database->revision($db, $workspace, $body['revision'] ?? null);
                if ($path === 'sync') {
                    $this->sync($db, $ctx, $body['changes'] ?? null);
                }
                if ($path === 'pack') {
                    if ($ctx['role'] !== 'production') {
                        throw new CrmException(403, 'Operación reservada para Producción.');
                    }
                    if (! is_string($body['orderId'] ?? null) || strlen($body['orderId']) > 120) {
                        throw new CrmException(400, 'Pedido inválido.');
                    }
                    $db->select('select public.pack_order(?,?)', [$workspace, $body['orderId']]);
                }
                if ($path === 'members') {
                    $this->member($db, $ctx, $body, $hash);
                }

                return ['ok' => true, 'revision' => $this->database->bump($db, $workspace)];
            }, $user['id']));
        }
        throw new CrmException(404, 'Ruta no encontrada.');
    }

    private function decodeRow(object $row): array
    {
        $row = (array) $row;
        foreach (['lines', 'messages'] as $key) {
            if (isset($row[$key]) && is_string($row[$key])) {
                $row[$key] = json_decode($row[$key], true, flags: JSON_THROW_ON_ERROR);
            }
        }
        if (isset($row['product_ids']) && is_string($row['product_ids'])) {
            // IDs are restricted to simple identifiers by validation; parse PostgreSQL text[].
            $row['product_ids'] = $row['product_ids'] === '{}' ? [] : str_getcsv(substr($row['product_ids'], 1, -1), ',', '"', '\\');
        }

        return $row;
    }

    private function sync(Connection $db, array $ctx, mixed $changes): void
    {
        if (! is_array($changes) || ! array_is_list($changes) || count($changes) > 1000) {
            throw new CrmException(400, 'Se permiten hasta 1000 cambios por transacción.');
        }
        if ($ctx['role'] === 'production') {
            throw new CrmException(403, 'Producción solo puede registrar el empaque.');
        }
        foreach ($changes as $change) {
            if (! is_array($change)) {
                throw new CrmException(400, 'Cambio inválido.');
            }
            $table = $change['table'] ?? '';
            $id = $change['id'] ?? null;
            $operation = $change['operation'] ?? '';
            if (! is_string($table) || ! isset(self::COLUMNS[$table]) || ! in_array($operation, ['insert', 'update', 'delete'], true)) {
                throw new CrmException(400, 'Operación no permitida.');
            }
            if (! is_string($id) || ! preg_match('/^[A-Za-z0-9_-]{1,120}$/D', $id)) {
                throw new CrmException(400, 'Identificador inválido.');
            }
            if ($ctx['role'] === 'sales' && (in_array($table, ['products', 'aromas', 'crm_settings'], true) || ($table === 'orders' && $operation !== 'insert'))) {
                throw new CrmException(403, 'Tu perfil no permite esta operación.');
            }
            if ($table === 'crm_settings' && ($operation !== 'update' || $id !== $ctx['workspace']['id'])) {
                throw new CrmException(400, 'Ajustes inválidos.');
            }
            $keys = $table === 'crm_settings' ? [$ctx['workspace']['id']] : [$ctx['workspace']['id'], $id];
            $predicate = $table === 'crm_settings' ? 'workspace_id=?' : 'workspace_id=? and id=?';
            $before = $db->selectOne("select * from public.$table where $predicate", $keys);
            if ($operation !== 'insert' && ! $before) {
                throw new CrmException(404, 'Registro no encontrado.');
            }
            if ($operation === 'insert' && $before) {
                throw new CrmException(409, 'El registro ya existe.');
            }
            if ($operation === 'delete') {
                if (! in_array($table, ['appointments', 'tasks'], true)) {
                    throw new CrmException(400, 'La API solo elimina citas y tareas.');
                }
                if (! $db->delete("delete from public.$table where $predicate", $keys)) {
                    throw new CrmException(403, 'Operación denegada.');
                }
            } else {
                $values = $change['values'] ?? null;
                if (! is_array($values) || ! $values || array_is_list($values)) {
                    throw new CrmException(400, 'Campos inválidos.');
                }
                $fields = array_keys($values);
                if (array_diff($fields, explode(' ', self::COLUMNS[$table]))) {
                    throw new CrmException(400, 'Campo no permitido.');
                }
                $this->validateFields($values);
                $parameters = [];
                foreach ($values as $field => $value) {
                    if (in_array($field, ['lines', 'messages'], true)) {
                        $value = json_encode($value, JSON_THROW_ON_ERROR);
                    }
                    if ($field === 'product_ids') {
                        $value = '{'.implode(',', array_map(fn ($id) => '"'.str_replace(['\\', '"'], ['\\\\', '\\"'], $id).'"', $value)).'}';
                    }
                    $parameters[] = $value;
                }
                if ($operation === 'insert') {
                    $placeholders = implode(',', array_fill(0, count($keys) + count($parameters), '?'));
                    $after = $db->selectOne("insert into public.$table(workspace_id,id,".implode(',', $fields).") values($placeholders) returning *", [...$keys, ...$parameters]);
                } else {
                    $sets = implode(',', array_map(fn ($field) => "$field=?", $fields));
                    $after = $db->selectOne("update public.$table set $sets where $predicate returning *", [...$parameters, ...$keys]);
                }
                if (! $after) {
                    throw new CrmException(403, 'Operación denegada.');
                }
                if ($table === 'orders' && ($operation === 'insert' || $before->status !== $after->status)) {
                    $event = $operation === 'insert' ? 'Pedido confirmado' : $after->status;
                    $db->insert("insert into public.notifications(workspace_id,id,event_key,order_id,event,status) values(?,?,?,?,?,'Pendiente de integración') on conflict(workspace_id,event_key) do nothing", [$ctx['workspace']['id'], (string) Str::uuid(), "$id:$event", $id, $event]);
                }
            }
            $this->database->audit($db, $ctx, "$operation $table: $id");
        }
    }

    private function validateFields(array $values): void
    {
        foreach ($values as $key => $value) {
            if ($value === null && in_array($key, ['last_order', 'shipping', 'acceptance_reference', 'accepted_at', 'opportunity_id', 'quote_id', 'due_on', 'delivered_on'], true)) {
                continue;
            }
            if (in_array($key, ['stage', 'amount', 'price', 'subtotal', 'discount', 'total', 'shipping', 'version', 'invoice_amount', 'duration', 'discount_limit'], true)) {
                if ((! is_int($value) && ! is_float($value)) || ! is_finite((float) $value) || (in_array($key, ['stage', 'version', 'duration'], true) && floor($value) !== (float) $value)) {
                    throw new CrmException(400, "Valor numérico inválido: $key.");
                }
            } elseif (in_array($key, ['approved', 'confirmed', 'human', 'initialized'], true)) {
                if (! is_bool($value)) {
                    throw new CrmException(400, "Valor booleano inválido: $key.");
                }
            } elseif (in_array($key, ['lines', 'messages', 'product_ids'], true)) {
                if (! is_array($value) || ! array_is_list($value) || count($value) > 1000) {
                    throw new CrmException(400, "Lista inválida: $key.");
                }
                foreach ($value as $item) {
                    if ($key === 'product_ids' && (! is_string($item) || ! preg_match('/^[A-Za-z0-9_-]{1,120}$/D', $item))) {
                        throw new CrmException(400, 'Productos inválidos.');
                    }
                    if ($key === 'messages' && (! is_array($item) || ! is_string($item['by'] ?? null) || ! is_string($item['text'] ?? null) || strlen($item['text']) > 20000)) {
                        throw new CrmException(400, 'Mensaje inválido.');
                    }
                }
            } elseif (! is_string($value) || strlen($value) > 20000) {
                throw new CrmException(400, "Texto inválido: $key.");
            }
        }
    }

    private function authorizeMember(array $ctx, array $body): void
    {
        if ($ctx['role'] !== 'owner' || ! in_array($body['role'] ?? '', ['admin', 'sales', 'production'], true)) {
            throw new CrmException(403, 'Solo Dirección administra el equipo.');
        }
    }

    private function member(Connection $db, array $ctx, array $body, ?string $hash): void
    {
        $this->authorizeMember($ctx, $body);
        $email = $body['email'] ?? null;
        if (! is_string($email) || ! filter_var(trim($email), FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
            throw new CrmException(400, 'Correo inválido.');
        }
        $db->statement('reset role');
        $member = $db->selectOne('select id from auth.users where email=?', [strtolower(trim($email))]);
        if (! $member) {
            if (! $hash || ! is_string($body['fullName'] ?? null) || mb_strlen(trim($body['fullName'])) < 2 || mb_strlen($body['fullName']) > 120) {
                throw new CrmException(400, 'Indica nombre y contraseña para el nuevo integrante.');
            }
            $member = $db->selectOne('insert into auth.users(email,password_hash,raw_user_meta_data) values(?,?,?::jsonb) returning id', [strtolower(trim($email)), $hash, json_encode(['full_name' => trim($body['fullName']), 'managed' => true])]);
        }
        if ($member->id === $ctx['user']['id']) {
            throw new CrmException(403, 'No puedes cambiar tu propio perfil.');
        }
        $db->statement('set local role authenticated');
        $previous = $db->selectOne('select role from public.workspace_members where workspace_id=? and user_id=?', [$ctx['workspace']['id'], $member->id]);
        if (($previous->role ?? '') === 'owner') {
            throw new CrmException(403, 'No se puede reemplazar Dirección.');
        }
        $db->insert('insert into public.workspace_members(workspace_id,user_id,role) values(?,?,?) on conflict(workspace_id,user_id) do update set role=excluded.role', [$ctx['workspace']['id'], $member->id, $body['role']]);
        $this->database->audit($db, $ctx, "Miembro $member->id: ".$body['role']);
    }
}
