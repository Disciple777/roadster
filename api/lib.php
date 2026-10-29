<?php
/**
 * Roadster Thruster API helpers: config, database, JSON in/out.
 *
 * api/config.php exists ONLY on the server. tools/push-config.mjs renders it
 * from .env.deploy and uploads it; tools/deploy.mjs never uploads anything
 * config-shaped and refuses to run if a local copy appears.
 *
 * Every table is prefixed (default "rdstr_") because the database is shared
 * with other games.
 */
declare(strict_types=1);

function rd_json($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function rd_fail(int $status, string $code, string $message = ''): void {
    rd_json(['ok' => false, 'error' => $code, 'message' => $message], $status);
}

function rd_config(): array {
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $path = __DIR__ . '/config.php';
    if (!is_file($path)) rd_fail(503, 'no_config', 'api/config.php is missing on the server. Run: node tools/push-config.mjs --yes');
    $cfg = require $path;
    return $cfg;
}

/** Table prefix. ?sandbox=1 (used by local development) writes to separate test tables. */
function rd_prefix(): string {
    $p = rd_config()['prefix'] ?? 'rdstr_';
    return !empty($_GET['sandbox']) ? $p . 'sbx_' : $p;
}

function rd_db(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;
    $c = rd_config();
    $dsn = "mysql:host={$c['db_host']};port={$c['db_port']};dbname={$c['db_name']};charset=utf8mb4";
    try {
        $pdo = new PDO($dsn, $c['db_user'], $c['db_pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    } catch (PDOException $e) {
        rd_fail(500, 'db_unavailable', 'Could not connect to the database.');
    }
    rd_install($pdo);
    return $pdo;
}

/** Idempotent: creates the tables on first use. */
function rd_install(PDO $pdo): void {
    $p = rd_prefix();
    // best official result per driver, per track and mode
    $pdo->exec("CREATE TABLE IF NOT EXISTS {$p}scores (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        pid CHAR(64) NOT NULL,
        name VARCHAR(16) NOT NULL,
        track VARCHAR(16) NOT NULL,
        mode VARCHAR(8) NOT NULL,
        time_ms INT UNSIGNED NOT NULL,
        score INT UNSIGNED NOT NULL DEFAULT 0,
        runs INT UNSIGNED NOT NULL DEFAULT 1,
        created_at INT UNSIGNED NOT NULL,
        updated_at INT UNSIGNED NOT NULL,
        UNIQUE KEY uq_driver (pid, track, mode),
        KEY idx_time (track, mode, time_ms),
        KEY idx_score (track, mode, score)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    // the replay of each driver's best course run, for ghosts
    $pdo->exec("CREATE TABLE IF NOT EXISTS {$p}ghosts (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        pid CHAR(64) NOT NULL,
        name VARCHAR(16) NOT NULL,
        track VARCHAR(16) NOT NULL,
        course VARCHAR(16) NOT NULL,
        score INT UNSIGNED NOT NULL,
        time_ms INT UNSIGNED NOT NULL,
        frames MEDIUMTEXT NOT NULL,
        created_at INT UNSIGNED NOT NULL,
        UNIQUE KEY uq_driver (pid, track, course),
        KEY idx_best (track, course, score)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

function rd_body(): array {
    static $body = null;
    if ($body !== null) return $body;
    $raw = file_get_contents('php://input', false, null, 0, 600000);
    $body = json_decode((string) $raw, true);
    if (!is_array($body)) $body = [];
    return $body;
}

function rd_in(string $key, $default = null) {
    $b = rd_body();
    if (array_key_exists($key, $b)) return $b[$key];
    return $_GET[$key] ?? $default;
}

/** Drivers are anonymous: the browser keeps a random id and the server only stores its hash. */
function rd_pid(bool $required = true): ?string {
    $id = (string) rd_in('id', '');
    if (!preg_match('/^[a-f0-9]{32}$/', $id)) {
        if ($required) rd_fail(400, 'bad_id');
        return null;
    }
    return hash('sha256', 'rdstr:' . $id);
}

function rd_name($raw): string {
    $n = strtoupper(trim(preg_replace('/\s+/', ' ', (string) $raw)));
    $n = preg_replace('/[^A-Z0-9 _\-.!?]/', '', $n);
    $n = substr($n, 0, 12);
    return $n === '' ? 'DRIVER' : $n;
}

function rd_pick(string $key, array $allowed): string {
    $v = (string) rd_in($key, '');
    if (!in_array($v, $allowed, true)) rd_fail(400, 'bad_' . $key);
    return $v;
}
