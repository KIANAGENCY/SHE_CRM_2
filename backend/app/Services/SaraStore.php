<?php

namespace App\Services;

use App\Exceptions\CrmException;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\Http;

class SaraStore
{
    private const COLLECTIONS = ['clients', 'opportunities', 'products', 'aromas', 'quotes', 'orders', 'samples', 'appointments', 'tasks', 'notifications', 'audit', 'conversations'];

    public function __construct(private CrmDatabase $database) {}

    private function row(Connection $db, string $workspace, bool $lock = false): object
    {
        return $db->selectOne('select revision,payload from public.sara_snapshots where workspace_id=?'.($lock ? ' for update' : ''), [$workspace]) ?? (object) ['revision' => 0, 'payload' => '{}'];
    }

    private function write(Connection $db, string $workspace, array $payload, int $revision): void
    {
        $db->insert('insert into public.sara_snapshots(workspace_id,revision,payload) values(?,?,?::jsonb) on conflict(workspace_id) do update set revision=excluded.revision,payload=excluded.payload,updated_at=now()', [$workspace, $revision, json_encode($payload, JSON_THROW_ON_ERROR)]);
    }

    public function snapshot(array $ctx): array
    {
        return $this->database->transaction(function (Connection $db) use ($ctx) {
            $row = $this->row($db, $ctx['workspace']['id']);

            return ['state' => $this->project(json_decode($row->payload, true, flags: JSON_THROW_ON_ERROR), (int) $row->revision, $ctx), 'revision' => (int) $row->revision];
        }, $ctx['user']['id'], true);
    }

    public function refresh(array $ctx, bool $force = false): void
    {
        if ($ctx['role'] === 'production') {
            return;
        }
        $current = $this->database->transaction(fn (Connection $db) => $this->row($db, $ctx['workspace']['id']), $ctx['user']['id'], true);
        $payload = json_decode($current->payload, true, flags: JSON_THROW_ON_ERROR);
        if (! $force && ($payload['lastAttempt'] ?? 0) > time() - 300) {
            return;
        }
        $incoming = null;
        $error = 'La conexión de SARA está pendiente de configuración.';
        $file = config('crm.sara_connection');
        $configured = is_file($file) ? json_decode(file_get_contents($file), true) : null;
        if (is_array($configured) && ! empty($configured['url'])) {
            try {
                $config = $configured;
                $url = parse_url($config['url'] ?? '');
                if (($url['scheme'] ?? '') !== 'https' || ($url['host'] ?? '') !== 'anluxagency.app.n8n.cloud' || ! str_starts_with($url['path'] ?? '', '/webhook/') || isset($url['user']) || isset($url['pass']) || ! is_string($config['token'] ?? null)) {
                    throw new \RuntimeException;
                }
                $response = Http::withHeaders(['x-sara-crm-token' => $config['token']])->withoutRedirecting()->connectTimeout(5)->timeout(20)->get($config['url']);
                if (! $response->successful()) {
                    throw new \RuntimeException;
                }
                if (strlen($response->body()) > 20 * 1024 * 1024) {
                    throw new \RuntimeException;
                }
                $incoming = json_decode($response->body(), true, flags: JSON_THROW_ON_ERROR);
                $this->validateSource($incoming);
                $error = '';
            } catch (\Throwable) {
                $incoming = null;
                $error = 'No fue posible actualizar SARA desde n8n.';
            }
        }
        $this->database->transaction(function (Connection $db) use ($ctx, $incoming, $error) {
            // Serialize even the first insert; merge source data without discarding team edits.
            $db->select('select pg_advisory_xact_lock(hashtextextended(?,0))', ['sara:'.$ctx['workspace']['id']]);
            $row = $this->row($db, $ctx['workspace']['id'], true);
            $payload = json_decode($row->payload, true, flags: JSON_THROW_ON_ERROR);
            $revision = (int) $row->revision;
            if ($incoming) {
                $fingerprint = hash('sha256', json_encode($incoming, JSON_THROW_ON_ERROR));
                if (($payload['fingerprint'] ?? '') !== $fingerprint) {
                    $revision++;
                }
                foreach (['rows', 'messages'] as $key) {
                    $id = $key === 'rows' ? 'id' : 'message_key';
                    $merged = [];
                    foreach (array_merge($payload[$key] ?? [], $incoming[$key] ?? []) as $record) {
                        $merged[(string) $record[$id]] = $record;
                    }
                    $payload[$key] = array_values($merged);
                }
                $payload['columns'] = $incoming['columns'];
                $payload['fingerprint'] = $fingerprint;
                $payload['lastSync'] = gmdate('c');
            }
            $payload['error'] = $error;
            $payload['lastAttempt'] = time();
            $this->write($db, $ctx['workspace']['id'], $payload, $revision);
        }, $ctx['user']['id']);
    }

    public function validateSource(mixed $source): void
    {
        if (! is_array($source) || ($source['schemaVersion'] ?? null) !== 1 || ! is_array($source['rows'] ?? null) || count($source['rows']) > 100000 || ! is_array($source['columns'] ?? null) || ! is_array($source['messages'] ?? [])) {
            throw new CrmException(400, 'Formato de SARA inválido.');
        }
        foreach ($source['rows'] as $row) {
            if (! is_array($row) || ! is_string($row['whatsapp_id'] ?? null) || $row['whatsapp_id'] === '' || ! isset($row['id'])) {
                throw new CrmException(400, 'Contacto de SARA inválido.');
            }
        }
        foreach ($source['messages'] ?? [] as $message) {
            if (! is_array($message) || empty($message['message_key']) || empty($message['contact_id']) || ! in_array($message['actor'] ?? '', ['client', 'sara'], true)) {
                throw new CrmException(400, 'Historial de SARA inválido.');
            }
        }
    }

    public function save(array $ctx, array $body): int
    {
        if ($ctx['role'] === 'production') {
            throw new CrmException(403, 'Producción solo puede registrar el empaque.');
        }
        $changes = $body['changes'] ?? null;
        if (! is_array($changes) || ! array_is_list($changes) || count($changes) > 1000) {
            throw new CrmException(400, 'Cambios inválidos.');
        }

        return $this->database->transaction(function (Connection $db) use ($ctx, $body, $changes) {
            $workspace = $ctx['workspace']['id'];
            $db->select('select pg_advisory_xact_lock(hashtextextended(?,0))', ['sara:'.$workspace]);
            $row = $this->row($db, $workspace, true);
            $revision = (int) $row->revision;
            if (! is_int($body['revision'] ?? null) || $body['revision'] !== $revision) {
                throw new CrmException(409, 'SARA actualizó los datos. Recarga antes de guardar.');
            }
            $payload = json_decode($row->payload, true, flags: JSON_THROW_ON_ERROR);
            foreach ($changes as $change) {
                if (! is_array($change)) {
                    throw new CrmException(400, 'Registro inválido.');
                }
                $collection = $change['collection'] ?? '';
                $id = $change['id'] ?? null;
                $op = $change['operation'] ?? '';
                if (! in_array($collection, self::COLLECTIONS, true) || ! is_string($id) || ! preg_match('/^[A-Za-z0-9_-]{1,120}$/D', $id) || ! in_array($op, ['put', 'delete'], true)) {
                    throw new CrmException(400, 'Registro inválido.');
                }
                if ($ctx['role'] === 'sales' && in_array($collection, ['products', 'aromas', 'orders', 'notifications', 'audit'], true)) {
                    throw new CrmException(403, 'Tu perfil no permite esta operación.');
                }
                if ($op === 'delete' && ! in_array($collection, ['tasks', 'appointments'], true)) {
                    throw new CrmException(400, 'No se permite borrar este registro.');
                }
                $value = $change['value'] ?? null;
                if ($op === 'put' && (! is_array($value) || ($value['id'] ?? null) !== $id || strlen(json_encode($value)) > 200000)) {
                    throw new CrmException(400, 'Datos inválidos.');
                }
                if ($value) {
                    unset($value['sara'], $value['source']);
                    if (str_starts_with($id, 'sara-')) {
                        $state = $this->project($payload, $revision, $ctx);
                        $current = array_values(array_filter($state[$collection], fn ($record) => $record['id'] === $id))[0] ?? [];
                        $patch = $payload['overrides'][$collection][$id]['value'] ?? ['id' => $id];
                        foreach ($value as $key => $input) {
                            if ($key !== 'id' && ($current[$key] ?? null) !== $input) {
                                $patch[$key] = $input;
                            }
                        }
                        $value = $patch;
                    }
                }
                $payload['overrides'][$collection][$id] = ['deleted' => $op === 'delete', 'value' => $value];
                $this->database->audit($db, $ctx, "SARA $op $collection: $id");
            }
            if (array_key_exists('discountLimit', $body)) {
                if (! in_array($ctx['role'], ['owner', 'admin'], true)) {
                    throw new CrmException(403, 'Tu perfil no permite cambiar descuentos.');
                }
                $limit = $body['discountLimit'];
                if ((! is_int($limit) && ! is_float($limit)) || ! is_finite((float) $limit) || $limit < 0 || $limit > 100) {
                    throw new CrmException(400, 'Descuento inválido.');
                }
                $payload['discountLimit'] = $limit;
            }
            $this->write($db, $workspace, $payload, $revision + 1);

            return $revision + 1;
        }, $ctx['user']['id']);
    }

    public function project(array $payload, int $revision, array $ctx): array
    {
        $catalog = json_decode(file_get_contents(resource_path('data/catalog.json')), true, flags: JSON_THROW_ON_ERROR);
        $state = array_fill_keys(self::COLLECTIONS, []);
        $state = array_merge($state, ['version' => 2, 'initialized' => true, 'role' => $ctx['roleLabel'], 'discountLimit' => $payload['discountLimit'] ?? 0, 'products' => $catalog['products'], 'aromas' => $catalog['aromas']]);
        $rows = $payload['rows'] ?? [];
        $messages = $payload['messages'] ?? [];
        $identities = array_column($rows, 'whatsapp_id');
        foreach ($messages as $message) {
            if (in_array($message['contact_id'], $identities, true)) {
                continue;
            }
            $history = array_values(array_filter($messages, fn ($m) => $m['contact_id'] === $message['contact_id']));
            usort($history, fn ($a, $b) => strcmp($a['occurred_at'] ?? '', $b['occurred_at'] ?? ''));
            $first = $history[0];
            $last = $history[array_key_last($history)];
            $row = array_fill_keys(array_column($payload['columns'] ?? [], 'name'), null);
            $rows[] = array_merge($row, ['id' => 'pending-'.substr(hash('sha256', $message['contact_id']), 0, 20), 'whatsapp_id' => $message['contact_id'], 'telefono' => $first['telefono'] ?? null, 'canal_origen' => $first['canal_origen'] ?? null, 'nombre_perfil' => $first['nombre_perfil'] ?? null, 'campana_origen' => $first['campana_origen'] ?? null, 'fecha_creacion' => $first['occurred_at'] ?? null, 'ultima_interaccion' => $last['occurred_at'] ?? null, 'etapa_pipeline' => 'nuevo', 'captured_without_ai' => true]);
            $identities[] = $message['contact_id'];
        }
        $text = fn ($value) => $value === null ? '' : (is_scalar($value) ? (string) $value : json_encode($value));
        $day = fn ($value) => preg_match('/^\d{4}-\d{2}-\d{2}/', $text($value)) ? substr($text($value), 0, 10) : '';
        foreach ($rows as $row) {
            $id = 'sara-'.substr(hash('sha256', $row['whatsapp_id']), 0, 24);
            $created = $day($row['fecha_creacion'] ?? $row['createdAt'] ?? null);
            $state['clients'][] = ['id' => $id, 'name' => $text($row['hotel_empresa'] ?? $row['nombre'] ?? $row['telefono'] ?? $row['whatsapp_id']), 'contact' => $text($row['nombre'] ?? null), 'legal' => '', 'rfc' => '', 'address' => $text($row['direccion_entrega'] ?? null), 'position' => $text($row['cargo'] ?? null), 'phone' => $text($row['telefono'] ?? (($row['canal_origen'] ?? '') === 'WhatsApp' ? $row['whatsapp_id'] : '')), 'email' => $text($row['correo'] ?? null), 'owner' => 'Sara IA', 'lastOrder' => null, 'created' => $created, 'aroma' => '', 'notes' => $text($row['resumen_conversacion'] ?? null), 'channel' => $text($row['canal_origen'] ?? null), 'sara' => $row];
            $stage = match ($row['etapa_pipeline'] ?? '') {
                'cotizacion','negociacion' => 2,'pedido','pago_pendiente','cliente' => 3,'nuevo' => 0,default => 1
            };
            $state['opportunities'][] = ['id' => $id.'-op', 'clientId' => $id, 'stage' => $stage, 'route' => ($row['muestra_solicitada'] ?? false) === true ? 'sample' : 'direct', 'amount' => null, 'next' => $text($row['ultima_accion_sara'] ?? $row['problema_principal'] ?? (! empty($row['captured_without_ai']) ? 'Pendiente de análisis de SARA' : '')), 'owner' => 'Sara IA', 'created' => $created, 'source' => 'sara', 'saraStage' => $text($row['etapa_pipeline'] ?? null)];
            if (($row['muestra_solicitada'] ?? false) === true) {
                $state['samples'][] = ['id' => $id.'-muestra', 'clientId' => $id, 'opportunityId' => $id.'-op', 'status' => 'Solicitada', 'aroma' => '', 'result' => '', 'tracking' => '', 'source' => 'sara', 'payment' => $text($row['muestra_pago_estado'] ?? null), 'shippingAccepted' => ($row['muestra_cargo_aceptado'] ?? false) === true];
            }
            if (! empty($row['google_calendar_event_id']) && ($row['estado_llamada'] ?? '') === 'confirmada' && strtotime($row['fecha_llamada_confirmada'] ?? '')) {
                $state['appointments'][] = ['id' => $id.'-cita', 'clientId' => $id, 'owner' => 'Comercial', 'start' => $row['fecha_llamada_confirmada'], 'duration' => 30, 'type' => 'Llamada', 'source' => 'sara', 'meet' => $text($row['google_meet_url'] ?? null), 'reference' => $text($row['meeting_reference'] ?? null), 'eventId' => $row['google_calendar_event_id']];
            }
            if (! empty($row['proximo_seguimiento'])) {
                $state['tasks'][] = ['id' => $id.'-tarea', 'clientId' => $id, 'title' => 'Seguimiento: '.$text($row['proximo_seguimiento']), 'source' => 'sara'];
            }
            $history = array_values(array_filter($messages, fn ($m) => $m['contact_id'] === $row['whatsapp_id']));
            usort($history, fn ($a, $b) => strcmp($a['occurred_at'] ?? '', $b['occurred_at'] ?? ''));
            $state['conversations'][] = ['id' => 'sara-chat-'.$row['id'], 'clientId' => $id, 'human' => ($row['requiere_humano'] ?? false) === true || ($row['human_manual_block'] ?? false) === true, 'source' => 'sara', 'summary' => $text($row['resumen_conversacion'] ?? null), 'messages' => array_map(fn ($m) => ['by' => $m['actor'] === 'sara' ? 'Sara IA' : 'Cliente', 'text' => $text($m['text'] ?? null), 'at' => $m['occurred_at'] ?? null], $history)];
        }
        foreach ($payload['overrides'] ?? [] as $collection => $records) {
            if (! in_array($collection, self::COLLECTIONS, true)) {
                continue;
            }
            foreach ($records as $id => $record) {
                $index = array_search($id, array_column($state[$collection], 'id'), true);
                if ($record['deleted']) {
                    if ($index !== false) {
                        array_splice($state[$collection], $index, 1);
                    }

continue;
                }
                if ($index !== false) {
                    $state[$collection][$index] = array_merge($state[$collection][$index], $record['value']);
                } else {
                    $state[$collection][] = $record['value'];
                }
            }
        }
        $state['saraSync'] = ['source' => 'n8n', 'count' => count($rows), 'lastSync' => $payload['lastSync'] ?? null, 'error' => $payload['error'] ?? 'La conexión de SARA está pendiente de configuración.', 'columns' => $payload['columns'] ?? [], 'revision' => $revision, 'intervalMinutes' => 5];

        return $state;
    }
}
