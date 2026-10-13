<?php

namespace App\Services;

use App\Exceptions\CrmException;
use Illuminate\Database\Connection;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Cookie;

class CrmAuth
{
    public function __construct(private CrmDatabase $database) {}

    public function user(Request $request): ?array
    {
        $token = $request->cookie('she_session', '');
        if (! is_string($token) || ! preg_match('/^[a-f0-9]{64}$/D', $token)) {
            return null;
        }
        $user = $this->database->connection()->selectOne('select u.id,u.email from auth.sessions s join auth.users u on u.id=s.user_id where s.token_hash=? and s.expires_at>now()', [hash('sha256', $token)]);

        return $user ? (array) $user : null;
    }

    public function password(mixed $password): string
    {
        if (! is_string($password) || strlen($password) < 12 || strlen($password) > 256) {
            throw new CrmException(400, 'Usa una contraseña de 12 a 256 caracteres.');
        }

        return password_hash($password, PASSWORD_ARGON2ID);
    }

    public function authenticate(Request $request, bool $signup = false, bool $alias = false): array
    {
        $body = $request->json()->all();
        $email = $body[$alias ? 'username' : 'email'] ?? '';
        $email = is_string($email) ? strtolower(trim($email)) : '';
        if ($alias && $email === config('crm.login_alias')) {
            $email = config('crm.owner_email');
        }
        $password = $body['password'] ?? null;
        if (! filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254 || ! is_string($password) || strlen($password) > 256) {
            throw new CrmException(400, 'Correo o contraseña inválidos.');
        }
        // Ignore spoofed forwarding headers; the proxy peer shares a conservative limit.
        $peer = $request->server('REMOTE_ADDR', 'local');
        $db = $this->database->connection();
        $limit = $db->selectOne("insert into auth.login_limits(key,attempts,reset_at) values(?,1,now()+interval '15 minutes') on conflict(key) do update set attempts=case when auth.login_limits.reset_at<now() then 1 else auth.login_limits.attempts+1 end,reset_at=case when auth.login_limits.reset_at<now() then now()+interval '15 minutes' else auth.login_limits.reset_at end returning attempts", [hash('sha256', $peer)]);
        if ($limit->attempts > 30) {
            throw new CrmException(429, 'Demasiados intentos. Intenta de nuevo en 15 minutos.');
        }
        if ($signup) {
            foreach (['fullName', 'workspaceName'] as $field) {
                if (! is_string($body[$field] ?? null) || mb_strlen(trim($body[$field])) < 2 || mb_strlen($body[$field]) > 120) {
                    throw new CrmException(400, 'Indica nombre y espacio de trabajo (2 a 120 caracteres).');
                }
            }
            $hash = $this->password($password);

            return $this->database->transaction(function (Connection $db) use ($email, $hash, $body) {
                $db->select('select pg_advisory_xact_lock(90121012)');
                if (! config('crm.registration') && $db->selectOne('select 1 from auth.users limit 1')) {
                    throw new CrmException(403, 'El registro está cerrado. Solicita acceso a Dirección.');
                }
                $user = (array) $db->selectOne('insert into auth.users(email,password_hash,raw_user_meta_data) values(?,?,?::jsonb) returning id,email', [$email, $hash, json_encode(['full_name' => trim($body['fullName']), 'workspace_name' => trim($body['workspaceName'])])]);

                return ['user' => $user, 'token' => $this->session($db, $user['id'])];
            });
        }
        $user = $db->selectOne('select id,email,password_hash from auth.users where email=?', [$email]);
        $dummy = '$argon2id$v=19$m=65536,t=4,p=1$c29tZXNhbHRzb21lc2FsdA$0XC38VU/LIXizDV+xVcUPvlcg/iBNbzAAODLXEGHg2U';
        if (! password_verify($password, $user->password_hash ?? $dummy) || ! $user) {
            throw new CrmException(401, 'Correo o contraseña incorrectos.');
        }

        return $this->database->transaction(fn (Connection $db) => ['user' => ['id' => $user->id, 'email' => $user->email], 'token' => $this->session($db, $user->id)]);
    }

    private function session(Connection $db, string $user): string
    {
        $token = bin2hex(random_bytes(32));
        $db->delete('delete from auth.sessions where expires_at<=now()');
        $db->insert("insert into auth.sessions(token_hash,user_id,expires_at) values(?,?,now()+interval '7 days')", [hash('sha256', $token), $user]);

        return $token;
    }

    public function cookie(string $token, int $age = 604800): Cookie
    {
        return Cookie::create('she_session')->withValue($token)->withExpires(time() + $age)->withPath('/')->withSecure((bool) config('crm.secure_cookie'))->withHttpOnly(true)->withSameSite('strict');
    }

    public function logout(Request $request): void
    {
        $this->database->connection()->delete('delete from auth.sessions where token_hash=?', [hash('sha256', (string) $request->cookie('she_session', ''))]);
    }
}
