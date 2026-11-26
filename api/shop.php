<?php
/**
 * Roadster Thruster FULL GAME: accounts, the PayPal purchase, and the license admin.
 *
 * Buying: the game asks for {a:"buy", token} and opens the PayPal "Buy Now" URL it gets back. The account id rides
 * along in PayPal's `custom` field, and PayPal posts an Instant Payment Notification to ?a=ipn when the payment
 * clears. ipn() asks PayPal to confirm it (VERIFIED), checks receiver, amount, currency and item, logs it in
 * {prefix}payments and turns the full game on for that account. A refund or reversal of that payment turns it off.
 * The receiving PayPal account is 'paypal_email' in config.php (PAYPAL_EMAIL in .env.deploy, via push-config).
 *
 * By hand (admin.html, race-control passkey): lic_grant turns it on for any email (the account is made if it does
 * not exist yet, and whoever signs up with that email gets it), lic_revoke turns it off, pw_reset gives a new password.
 */
declare(strict_types=1);

const SHOP_PRICE = '4.99';                 // USD; also in js/account.js (G.FULL_PRICE)
const SHOP_ITEM = 'RT-FULL';
const SHOP_NAME = 'Roadster Thruster: Full Game';
const SHOP_BASE = 'https://guatermelon.com/roadster/';
const PW_MIN = 6;

function shop_route(string $a): void {
    switch ($a) {
        case 'signup': signup(); break;
        case 'login': login(); break;
        case 'logout': logout(); break;
        case 'me': me(); break;
        case 'buy': buy(); break;
        case 'save_get': save_get(); break;
        case 'save_put': save_put(); break;
        case 'ipn': ipn(); break;
        case 'lic_list': rd_admin(); lic_list(); break;
        case 'lic_grant': rd_admin(); lic_grant(); break;
        case 'lic_revoke': rd_admin(); lic_revoke(); break;
        case 'pw_reset': rd_admin(); pw_reset(); break;
        case 'pay_list': rd_admin(); pay_list(); break;
    }
}

function shop_paypal(): string {
    return strtolower(trim((string) (rd_config()['paypal_email'] ?? '')));
}

function post_only(): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') rd_fail(405, 'post_only');
}

/** What the game is told about an account. */
function acct_out(array $a): array {
    return ['email' => $a['email'], 'full' => (int) $a['full'] === 1, 'since' => (int) $a['full_at'], 'price' => SHOP_PRICE];
}

function new_token(int $accountId): string {
    $t = bin2hex(random_bytes(32));
    $now = time();
    $db = rd_db(); $p = rd_prefix();
    $db->prepare("INSERT INTO {$p}tokens (token_hash, account_id, created_at, last_at) VALUES (?, ?, ?, ?)")->execute([hash('sha256', $t), $accountId, $now, $now]);
    $db->prepare("UPDATE {$p}accounts SET last_at = ? WHERE id = ?")->execute([$now, $accountId]);
    return $t;
}

function find_account(string $email): ?array {
    $st = rd_db()->prepare('SELECT * FROM ' . rd_prefix() . 'accounts WHERE email = ?');
    $st->execute([$email]);
    return $st->fetch() ?: null;
}

/** An account for this email, made (with no password yet) if there isn't one. */
function account_for(string $email): array {
    $a = find_account($email);
    if ($a) return $a;
    rd_db()->prepare('INSERT INTO ' . rd_prefix() . 'accounts (email, created_at) VALUES (?, ?)')->execute([$email, time()]);
    return find_account($email);
}

function password_in(): string {
    $pw = (string) rd_in('password', '');
    if (strlen($pw) < PW_MIN || strlen($pw) > 200) rd_fail(400, 'bad_password', 'Use a password of at least ' . PW_MIN . ' characters.');
    return $pw;
}

function signup(): void {
    post_only();
    $email = rd_email(rd_in('email', ''));
    $pw = password_in();
    $db = rd_db(); $p = rd_prefix();
    $a = find_account($email);
    if ($a && $a['pass_hash'] !== '') rd_fail(409, 'taken', 'There is already an account with that email. Sign in instead.');
    $hash = password_hash($pw, PASSWORD_DEFAULT);
    if ($a) $db->prepare("UPDATE {$p}accounts SET pass_hash = ? WHERE id = ?")->execute([$hash, $a['id']]); // a gift or a payment made before the account
    else $db->prepare("INSERT INTO {$p}accounts (email, pass_hash, created_at) VALUES (?, ?, ?)")->execute([$email, $hash, time()]);
    $a = find_account($email);
    rd_json(['ok' => true, 'token' => new_token((int) $a['id']), 'account' => acct_out($a)]);
}

function login(): void {
    post_only();
    $email = rd_email(rd_in('email', ''));
    $pw = (string) rd_in('password', '');
    $a = find_account($email);
    if (!$a || $a['pass_hash'] === '' || !password_verify($pw, $a['pass_hash'])) {
        usleep(700000); // slows down guessing
        if ($a && $a['pass_hash'] === '') rd_fail(403, 'unclaimed', 'This email has no password yet: choose one with CREATE ACCOUNT.');
        rd_fail(403, 'bad_login', 'Wrong email or password.');
    }
    if (password_needs_rehash($a['pass_hash'], PASSWORD_DEFAULT)) {
        rd_db()->prepare('UPDATE ' . rd_prefix() . 'accounts SET pass_hash = ? WHERE id = ?')->execute([password_hash($pw, PASSWORD_DEFAULT), $a['id']]);
    }
    rd_json(['ok' => true, 'token' => new_token((int) $a['id']), 'account' => acct_out($a)]);
}

function logout(): void {
    post_only();
    $t = (string) rd_in('token', '');
    if (preg_match('/^[a-f0-9]{64}$/', $t)) rd_db()->prepare('DELETE FROM ' . rd_prefix() . 'tokens WHERE token_hash = ?')->execute([hash('sha256', $t)]);
    rd_json(['ok' => true]);
}

function me(): void {
    $a = rd_account();
    if (!$a) rd_fail(401, 'signed_out', 'Signed out.');
    rd_json(['ok' => true, 'account' => acct_out($a), 'save_rev' => save_rev((int) $a['id'])]);
}

// ---------------- cloud save: settings, unlocked cars, records, courses follow the account ----------------
const SAVE_MAX = 400000; // bytes of JSON

function save_rev(int $id): int {
    $p = rd_prefix();
    $st = rd_db()->prepare("SELECT rev FROM {$p}saves WHERE account_id = ?");
    $st->execute([$id]);
    return (int) $st->fetchColumn();
}

function save_row(int $id): array {
    $p = rd_prefix();
    $st = rd_db()->prepare("SELECT rev, data FROM {$p}saves WHERE account_id = ?");
    $st->execute([$id]);
    $r = $st->fetch();
    return $r ? ['rev' => (int) $r['rev'], 'data' => json_decode($r['data'], true) ?: new stdClass()] : ['rev' => 0, 'data' => new stdClass()];
}

function save_get(): void {
    $a = rd_account();
    if (!$a) rd_fail(401, 'signed_out', 'Signed out.');
    rd_json(['ok' => true] + save_row((int) $a['id']));
}

/** Write the save if nobody else wrote since `rev` (the client's last known); otherwise answer with the newer one to merge. */
function save_put(): void {
    $a = rd_account();
    if (!$a) rd_fail(401, 'signed_out', 'Signed out.');
    $data = rd_in('data');
    if (!is_array($data) || ($data && array_is_list($data))) rd_fail(400, 'bad_save');
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false || strlen($json) > SAVE_MAX) rd_fail(413, 'save_too_big', 'The save is too big.');
    $base = (int) rd_in('rev', 0);
    $id = (int) $a['id'];
    $db = rd_db(); $p = rd_prefix(); $now = time();
    if ($base === 0) {
        $st = $db->prepare("INSERT IGNORE INTO {$p}saves (account_id, rev, data, updated_at) VALUES (?, 1, ?, ?)");
        $st->execute([$id, $json, $now]);
    } else {
        $st = $db->prepare("UPDATE {$p}saves SET rev = rev + 1, data = ?, updated_at = ? WHERE account_id = ? AND rev = ?");
        $st->execute([$json, $now, $id, $base]);
    }
    if ($st->rowCount() !== 1) rd_json(['ok' => true, 'conflict' => true] + save_row($id));
    rd_json(['ok' => true, 'rev' => $base + 1]);
}

/** The PayPal "Buy Now" link for the signed-in account. */
function buy(): void {
    $a = rd_account();
    if (!$a) rd_fail(401, 'signed_out', 'Sign in first.');
    if ((int) $a['full']) rd_fail(409, 'owned', 'You already have the full game.');
    $to = shop_paypal();
    if ($to === '') rd_fail(503, 'shop_closed', 'Buying is not open yet. Please try again soon.');
    $q = http_build_query([
        'cmd' => '_xclick',
        'business' => $to,
        'item_name' => SHOP_NAME,
        'item_number' => SHOP_ITEM,
        'amount' => SHOP_PRICE,
        'currency_code' => 'USD',
        'quantity' => 1,
        'no_shipping' => 1,
        'no_note' => 1,
        'charset' => 'utf-8',
        'custom' => 'rt' . $a['id'],
        'notify_url' => SHOP_BASE . 'api/index.php?a=ipn' . (empty($_GET['sandbox']) ? '' : '&sandbox=1'),
        'return' => SHOP_BASE . '?paid=1',
        'cancel_return' => SHOP_BASE . '?paid=0',
        'rm' => 1,
    ]);
    rd_json(['ok' => true, 'url' => 'https://www.paypal.com/cgi-bin/webscr?' . $q]);
}

// ---------------- PayPal IPN ----------------

/** Ask PayPal whether it really sent this notification. */
function ipn_verify(string $raw): string {
    $body = 'cmd=_notify-validate&' . $raw;
    $url = 'https://ipnpb.paypal.com/cgi-bin/webscr';
    $ua = 'RoadsterThruster-IPN';
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
            CURLOPT_SSL_VERIFYPEER => true, CURLOPT_HTTPHEADER => ['Connection: Close', 'User-Agent: ' . $ua],
        ]);
        $res = curl_exec($ch);
        curl_close($ch);
        return is_string($res) ? trim($res) : '';
    }
    $ctx = stream_context_create(['http' => ['method' => 'POST', 'timeout' => 30, 'content' => $body,
        'header' => "Content-Type: application/x-www-form-urlencoded\r\nConnection: Close\r\nUser-Agent: $ua\r\n"]]);
    $res = @file_get_contents($url, false, $ctx);
    return is_string($res) ? trim($res) : '';
}

function ipn(): void {
    post_only();
    $raw = (string) file_get_contents('php://input', false, null, 0, 100000);
    $f = $_POST;
    $s = fn(string $k, int $n = 190) => substr(trim((string) ($f[$k] ?? '')), 0, $n);
    $txn = $s('txn_id', 32);
    $status = $s('payment_status', 24);
    $payer = strtolower($s('payer_email'));
    $gross = $s('mc_gross', 16);
    $cur = $s('mc_currency', 8);
    $parent = $s('parent_txn_id', 32);
    $db = rd_db(); $p = rd_prefix(); $now = time();

    // every notification is logged once; false = PayPal resent one we already handled (unique txn_id + status)
    $log = function (string $verdict, $acct = null) use ($db, $p, $txn, $parent, $status, $payer, $gross, $cur, $now): bool {
        try {
            $db->prepare("INSERT INTO {$p}payments (txn_id, parent_txn, status, account_id, payer_email, gross, currency, verdict, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
               ->execute([$txn === '' ? null : $txn, $parent, $status, $acct === null ? null : (int) $acct, $payer, $gross, $cur, substr($verdict, 0, 48), $now]);
            return true;
        } catch (PDOException $e) {
            if ((string) $e->getCode() === '23000') return false;
            throw $e;
        }
    };
    $done = function (): void { http_response_code(200); echo 'OK'; exit; };

    if (ipn_verify($raw) !== 'VERIFIED') { $log('invalid'); $done(); }

    $me = shop_paypal();
    $recv = strtolower($s('receiver_email')); $biz = strtolower($s('business'));
    if ($me === '' || ($recv !== $me && $biz !== $me)) { $log('ignored: other receiver'); $done(); }

    // a refund or reversal takes the full game back from whoever that payment gave it to
    if (in_array($status, ['Refunded', 'Reversed', 'Canceled_Reversal'], true) && $parent !== '') {
        $st = $db->prepare("SELECT account_id FROM {$p}payments WHERE txn_id = ? AND verdict = 'granted' LIMIT 1");
        $st->execute([$parent]);
        $acct = $st->fetchColumn();
        if (!$acct) { $log('ignored: unknown parent payment'); $done(); }
        if ($status === 'Canceled_Reversal') {
            if ($log('regranted', $acct)) $db->prepare("UPDATE {$p}accounts SET full = 1, full_src = 'paypal', full_note = ?, full_at = ? WHERE id = ?")->execute([$parent, $now, $acct]);
        } elseif ($log('revoked', $acct)) {
            $db->prepare("UPDATE {$p}accounts SET full = 0, full_note = ? WHERE id = ? AND full_src = 'paypal'")->execute([strtolower($status) . ' ' . $parent, $acct]);
        }
        $done();
    }

    if ($s('item_number', 32) !== SHOP_ITEM) { $log('ignored: other item'); $done(); }
    if ($status !== 'Completed') { $log('waiting: ' . $status); $done(); } // e.g. Pending (an eCheck): a Completed one follows
    if ($cur !== 'USD' || (float) $gross + 0.001 < (float) SHOP_PRICE) { $log('ignored: amount ' . $gross . ' ' . $cur); $done(); }

    // whose is it: the account id we put in `custom`, else the PayPal email (an account is made for it if needed)
    $acct = null;
    if (preg_match('/^rt(\d+)$/', $s('custom', 32), $m)) {
        $st = $db->prepare("SELECT id FROM {$p}accounts WHERE id = ?");
        $st->execute([(int) $m[1]]);
        $acct = $st->fetchColumn() ?: null;
    }
    if (!$acct && filter_var($payer, FILTER_VALIDATE_EMAIL)) $acct = account_for($payer)['id'];
    if (!$acct) { $log('ignored: no account'); $done(); }
    if ($log('granted', $acct)) {
        $db->prepare("UPDATE {$p}accounts SET full = 1, full_src = 'paypal', full_note = ?, full_at = ? WHERE id = ?")->execute([$txn, $now, $acct]);
    }
    $done();
}

// ---------------- license admin (admin.html) ----------------

function admin_row(array $a): array {
    return ['email' => $a['email'], 'full' => (int) $a['full'] === 1, 'src' => $a['full_src'], 'note' => $a['full_note'], 'full_at' => (int) $a['full_at'],
            'created_at' => (int) $a['created_at'], 'last_at' => (int) $a['last_at'], 'claimed' => $a['pass_hash'] !== ''];
}

function lic_list(): void {
    $q = strtolower(trim((string) rd_in('q', '')));
    $db = rd_db(); $p = rd_prefix();
    if ($q !== '') {
        $st = $db->prepare("SELECT * FROM {$p}accounts WHERE email LIKE ? ORDER BY created_at DESC LIMIT 100");
        $st->execute(['%' . str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $q) . '%']);
    } else {
        $st = $db->query("SELECT * FROM {$p}accounts ORDER BY full DESC, GREATEST(full_at, created_at) DESC LIMIT 200");
    }
    $rows = array_map('admin_row', $st->fetchAll());
    $c = $db->query("SELECT COUNT(*) AS n, COALESCE(SUM(full), 0) AS f, COALESCE(SUM(full = 1 AND full_src = 'paypal'), 0) AS paid FROM {$p}accounts")->fetch();
    rd_json(['ok' => true, 'rows' => $rows, 'accounts' => (int) $c['n'], 'full' => (int) $c['f'], 'paid' => (int) $c['paid'],
             'price' => SHOP_PRICE, 'paypal' => shop_paypal() !== '']);
}

function lic_grant(): void {
    post_only();
    $email = rd_email(rd_in('email', ''));
    $src = (string) rd_in('src', 'gift');
    if (!in_array($src, ['gift', 'manual', 'tester'], true)) $src = 'manual';
    $note = substr(trim((string) rd_in('note', '')), 0, 190);
    $a = account_for($email);
    rd_db()->prepare('UPDATE ' . rd_prefix() . 'accounts SET full = 1, full_src = ?, full_note = ?, full_at = ? WHERE id = ?')->execute([$src, $note, time(), $a['id']]);
    rd_json(['ok' => true, 'row' => admin_row(find_account($email))]);
}

function lic_revoke(): void {
    post_only();
    $email = rd_email(rd_in('email', ''));
    $a = find_account($email);
    if (!$a) rd_fail(404, 'not_found', 'No account with that email.');
    rd_db()->prepare('UPDATE ' . rd_prefix() . 'accounts SET full = 0, full_note = ? WHERE id = ?')->execute(['revoked ' . date('Y-m-d'), $a['id']]);
    rd_json(['ok' => true, 'row' => admin_row(find_account($email))]);
}

/** A new random password for an account (shown once in the admin), and every device signed out. */
function pw_reset(): void {
    post_only();
    $email = rd_email(rd_in('email', ''));
    $a = find_account($email);
    if (!$a) rd_fail(404, 'not_found', 'No account with that email.');
    $abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    $pw = '';
    for ($i = 0; $i < 10; $i++) $pw .= $abc[random_int(0, strlen($abc) - 1)];
    $db = rd_db(); $p = rd_prefix();
    $db->prepare("UPDATE {$p}accounts SET pass_hash = ? WHERE id = ?")->execute([password_hash($pw, PASSWORD_DEFAULT), $a['id']]);
    $db->prepare("DELETE FROM {$p}tokens WHERE account_id = ?")->execute([$a['id']]);
    rd_json(['ok' => true, 'password' => $pw]);
}

function pay_list(): void {
    $p = rd_prefix();
    $st = rd_db()->query("SELECT y.txn_id, y.status, y.payer_email, y.gross, y.currency, y.verdict, y.created_at, a.email AS account
                          FROM {$p}payments y LEFT JOIN {$p}accounts a ON a.id = y.account_id ORDER BY y.id DESC LIMIT 100");
    rd_json(['ok' => true, 'rows' => array_map(fn($r) => [
        'txn' => (string) $r['txn_id'], 'status' => $r['status'], 'payer' => $r['payer_email'], 'gross' => $r['gross'], 'currency' => $r['currency'],
        'verdict' => $r['verdict'], 'at' => (int) $r['created_at'], 'account' => (string) ($r['account'] ?? ''),
    ], $st->fetchAll())]);
}
