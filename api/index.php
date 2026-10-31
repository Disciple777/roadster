<?php
/**
 * Roadster Thruster leaderboard & ghosts.
 *
 *   GET  ?a=top&track=city&mode=race[&id=…]       top 20 (race: fastest time, course: highest score)
 *   POST {a:"submit", id, name, track, mode, laps, time_ms, score[, traffic, rivals, difficulty][, ghost]}
 *                                                 records an official run; returns the driver's rank
 *   GET  ?a=ghosts&track=city&course=street&id=…  your best course replay and the best one by someone else
 *
 *   GET  ?a=official&track=city                   the official obstacle course layout ({items} or null = built-in)
 *   POST {a:"share", id, name, cname, track, items[, cid]}   shares a player course; returns its 5-letter code
 *   GET  ?a=shared&code=ABCDE                     one shared course
 *   GET  ?a=shared_list                           the newest shared courses (no items)
 *   POST {a:"admin_check" | "official_save" | "shared_delete", key, ...}   race control (passkey)
 *
 * Only official runs count: a 2-lap street race in heavy traffic against 7 pro rivals, or 1 lap of the
 * obstacle course.
 */
declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

const TRACKS = ['city', 'highway'];
const MODES = ['race', 'course'];
const COURSES = ['street'];
const OFFICIAL_LAPS = ['race' => 2, 'course' => 1];
const OFFICIAL_RACE = ['traffic' => 'heavy', 'rivals' => 7, 'difficulty' => 'pro'];
const TOP_N = 20;
const LEVEL_MAX_ITEMS = 600;
const LEVEL_MAX_JSON = 200000;
const SHARES_PER_DAY = 20;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const GHOST_STRIDE = 8;          // t, x, y, z, qx, qy, qz, qw
const GHOST_MAX_FRAMES = 9000;   // 15 minutes at 10 Hz

$a = (string) rd_in('a', '');
if ($a === 'top') top();
if ($a === 'submit') submit();
if ($a === 'ghosts') ghosts();
if ($a === 'official') official();
if ($a === 'share') share();
if ($a === 'shared') shared();
if ($a === 'shared_list') shared_list();
if ($a === 'admin_check') { rd_admin(); rd_json(['ok' => true]); }
if ($a === 'official_save') official_save();
if ($a === 'shared_delete') shared_delete();
rd_fail(400, 'bad_action');

/** ORDER BY for "better first" in each mode. */
function order(string $mode): string {
    return $mode === 'race' ? 'time_ms ASC, updated_at ASC' : 'score DESC, time_ms ASC, updated_at ASC';
}

/** How many drivers on this board beat (time, score). */
function rank(PDO $db, string $p, string $track, string $mode, int $time, int $score): int {
    if ($mode === 'race') {
        $st = $db->prepare("SELECT COUNT(*) FROM {$p}scores WHERE track = ? AND mode = 'race' AND time_ms < ?");
        $st->execute([$track, $time]);
    } else {
        $st = $db->prepare("SELECT COUNT(*) FROM {$p}scores WHERE track = ? AND mode = 'course' AND (score > ? OR (score = ? AND time_ms < ?))");
        $st->execute([$track, $score, $score, $time]);
    }
    return (int) $st->fetchColumn() + 1;
}

function top(): void {
    $track = rd_pick('track', TRACKS);
    $mode = rd_pick('mode', MODES);
    $me = rd_pid(false);
    $db = rd_db(); $p = rd_prefix();
    $st = $db->prepare("SELECT pid, name, time_ms, score, runs, updated_at FROM {$p}scores WHERE track = ? AND mode = ? ORDER BY " . order($mode) . ' LIMIT ' . TOP_N);
    $st->execute([$track, $mode]);
    $rows = [];
    foreach ($st->fetchAll() as $r) {
        $rows[] = ['name' => $r['name'], 'time_ms' => (int) $r['time_ms'], 'score' => (int) $r['score'], 'runs' => (int) $r['runs'], 'at' => (int) $r['updated_at'], 'me' => $me !== null && hash_equals($r['pid'], $me)];
    }
    $mine = null;
    if ($me !== null) {
        $st = $db->prepare("SELECT time_ms, score FROM {$p}scores WHERE pid = ? AND track = ? AND mode = ?");
        $st->execute([$me, $track, $mode]);
        if ($r = $st->fetch()) $mine = ['time_ms' => (int) $r['time_ms'], 'score' => (int) $r['score'], 'rank' => rank($db, $p, $track, $mode, (int) $r['time_ms'], (int) $r['score'])];
    }
    $total = $db->prepare("SELECT COUNT(*) FROM {$p}scores WHERE track = ? AND mode = ?");
    $total->execute([$track, $mode]);
    rd_json(['ok' => true, 'rows' => $rows, 'mine' => $mine, 'total' => (int) $total->fetchColumn()]);
}

function submit(): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') rd_fail(405, 'post_only');
    $pid = rd_pid();
    $name = rd_name(rd_in('name', ''));
    $track = rd_pick('track', TRACKS);
    $mode = rd_pick('mode', MODES);
    if ((int) rd_in('laps', 0) !== OFFICIAL_LAPS[$mode]) rd_fail(400, 'not_official', 'Only official-length runs are ranked.');
    if ($mode === 'race' && ((string) rd_in('traffic', '') !== OFFICIAL_RACE['traffic'] || (int) rd_in('rivals', 0) !== OFFICIAL_RACE['rivals']
        || (string) rd_in('difficulty', '') !== OFFICIAL_RACE['difficulty'])) rd_fail(400, 'not_official', 'Ranked street races use heavy traffic and 7 pro rivals.');
    $time = (int) rd_in('time_ms', 0);
    $score = (int) rd_in('score', 0);
    if ($time < 15000 || $time > 3600000) rd_fail(400, 'bad_time');
    if ($score < 0 || $score > 20000000) rd_fail(400, 'bad_score');

    $db = rd_db(); $p = rd_prefix(); $now = time();
    $st = $db->prepare("SELECT id, time_ms, score FROM {$p}scores WHERE pid = ? AND track = ? AND mode = ?");
    $st->execute([$pid, $track, $mode]);
    $old = $st->fetch();
    $better = !$old || ($mode === 'race'
        ? $time < (int) $old['time_ms']
        : $score > (int) $old['score'] || ($score === (int) $old['score'] && $time < (int) $old['time_ms']));
    if (!$old) {
        $db->prepare("INSERT INTO {$p}scores (pid, name, track, mode, time_ms, score, runs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)")
           ->execute([$pid, $name, $track, $mode, $time, $score, $now, $now]);
    } elseif ($better) {
        $db->prepare("UPDATE {$p}scores SET name = ?, time_ms = ?, score = ?, runs = runs + 1, updated_at = ? WHERE id = ?")
           ->execute([$name, $time, $score, $now, $old['id']]);
    } else {
        $db->prepare("UPDATE {$p}scores SET name = ?, runs = runs + 1 WHERE id = ?")->execute([$name, $old['id']]);
    }

    // a course personal best brings its replay along: that becomes this driver's ghost
    $ghostSaved = false;
    if ($mode === 'course' && $better) {
        $frames = ghost_frames(rd_in('ghost'));
        if ($frames !== null) {
            $db->prepare("INSERT INTO {$p}ghosts (pid, name, track, course, score, time_ms, frames, created_at) VALUES (?, ?, ?, 'street', ?, ?, ?, ?)
                          ON DUPLICATE KEY UPDATE name = VALUES(name), score = VALUES(score), time_ms = VALUES(time_ms), frames = VALUES(frames), created_at = VALUES(created_at)")
               ->execute([$pid, $name, $track, $score, $time, $frames, $now]);
            $ghostSaved = true;
        }
    }
    $bt = $better ? $time : (int) $old['time_ms'];
    $bs = $better ? $score : (int) $old['score'];
    $total = $db->prepare("SELECT COUNT(*) FROM {$p}scores WHERE track = ? AND mode = ?");
    $total->execute([$track, $mode]);
    rd_json(['ok' => true, 'best' => $better, 'rank' => rank($db, $p, $track, $mode, $bt, $bs), 'total' => (int) $total->fetchColumn(), 'ghost' => $ghostSaved]);
}

/** Validate a replay: a flat list of numbers, GHOST_STRIDE per frame, times increasing. Returns compact JSON or null. */
function ghost_frames($g): ?string {
    if (!is_array($g)) return null;
    $n = count($g);
    if ($n < GHOST_STRIDE * 10 || $n % GHOST_STRIDE !== 0 || $n > GHOST_STRIDE * GHOST_MAX_FRAMES) return null;
    $out = [];
    $lastT = -1.0;
    for ($i = 0; $i < $n; $i++) {
        $v = $g[$i];
        if (!is_int($v) && !is_float($v)) return null;
        $v = (float) $v;
        if (!is_finite($v) || abs($v) > 100000) return null;
        $k = $i % GHOST_STRIDE;
        if ($k === 0) { if ($v < $lastT) return null; $lastT = $v; }
        $out[] = round($v, $k < 4 ? 2 : 3);
    }
    return json_encode($out);
}

function ghosts(): void {
    $track = rd_pick('track', TRACKS);
    $course = rd_pick('course', COURSES);
    $me = rd_pid(false);
    $db = rd_db(); $p = rd_prefix();
    $pack = fn($r) => $r ? ['name' => $r['name'], 'score' => (int) $r['score'], 'time_ms' => (int) $r['time_ms'], 'frames' => json_decode($r['frames'], true)] : null;
    $mine = null;
    if ($me !== null) {
        $st = $db->prepare("SELECT name, score, time_ms, frames FROM {$p}ghosts WHERE pid = ? AND track = ? AND course = ?");
        $st->execute([$me, $track, $course]);
        $mine = $st->fetch() ?: null;
    }
    $st = $db->prepare("SELECT name, score, time_ms, frames FROM {$p}ghosts WHERE track = ? AND course = ? AND pid <> ? ORDER BY score DESC, time_ms ASC LIMIT 1");
    $st->execute([$track, $course, $me ?? '']);
    $other = $st->fetch() ?: null;
    rd_json(['ok' => true, 'mine' => $pack($mine), 'other' => $pack($other)]);
}

// ---------------- obstacle courses ----------------

/** A course is a list of {t, s, p}: piece type, metres along the lap, numeric parameters (numbers or small nested lists). */
function level_items($raw): string {
    if (!is_array($raw) || !array_is_list($raw)) rd_fail(400, 'bad_items');
    if (count($raw) > LEVEL_MAX_ITEMS) rd_fail(400, 'too_many_items', 'A course holds at most ' . LEVEL_MAX_ITEMS . ' pieces.');
    $num = function ($v, int $depth) use (&$num): bool {
        if (is_int($v) || is_float($v)) return is_finite((float) $v) && abs((float) $v) < 1e6;
        if (is_array($v) && array_is_list($v) && $depth < 3 && count($v) <= 64) { foreach ($v as $x) if (!$num($x, $depth + 1)) return false; return true; }
        return false;
    };
    $out = [];
    foreach ($raw as $it) {
        if (!is_array($it)) rd_fail(400, 'bad_items');
        $t = $it['t'] ?? null; $s = $it['s'] ?? null; $p = $it['p'] ?? [];
        if (!is_string($t) || !preg_match('/^[a-z0-9]{2,12}$/', $t)) rd_fail(400, 'bad_items');
        if ((!is_int($s) && !is_float($s)) || !is_finite((float) $s) || abs((float) $s) > 1e5) rd_fail(400, 'bad_items');
        if (!is_array($p) || count($p) > 16) rd_fail(400, 'bad_items');
        $pp = [];
        foreach ($p as $k => $v) {
            if (!is_string($k) || !preg_match('/^[a-z0-9]{1,8}$/i', $k) || !$num($v, 1)) rd_fail(400, 'bad_items');
            $pp[$k] = $v;
        }
        $out[] = ['t' => $t, 's' => round((float) $s, 2), 'p' => (object) $pp];
    }
    $json = json_encode($out);
    if ($json === false || strlen($json) > LEVEL_MAX_JSON) rd_fail(400, 'too_big', 'This course is too big to save.');
    return $json;
}

function course_name($raw): string {
    $n = strtoupper(trim(preg_replace('/\s+/', ' ', (string) $raw)));
    $n = substr((string) preg_replace('/[^A-Z0-9 _\-.!?\'#&]/', '', $n), 0, 24);
    return $n === '' ? 'CUSTOM COURSE' : $n;
}

function official(): void {
    $track = rd_pick('track', TRACKS);
    $db = rd_db(); $p = rd_prefix();
    $st = $db->prepare("SELECT items, updated_at FROM {$p}levels WHERE kind = 'official' AND code = ?");
    $st->execute([$track]);
    $r = $st->fetch();
    rd_json(['ok' => true, 'items' => $r ? json_decode($r['items'], true) : null, 'at' => $r ? (int) $r['updated_at'] : 0]);
}

function share(): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') rd_fail(405, 'post_only');
    $pid = rd_pid();
    $track = rd_pick('track', TRACKS);
    $raw = rd_in('items');
    $items = level_items($raw);
    $n = count($raw);
    if ($n < 1) rd_fail(400, 'empty', 'Add some pieces before sharing.');
    $author = rd_name(rd_in('name', ''));
    $name = course_name(rd_in('cname', ''));
    $cid = substr((string) preg_replace('/[^a-z0-9]/', '', strtolower((string) rd_in('cid', ''))), 0, 16);
    $db = rd_db(); $p = rd_prefix(); $now = time();
    // sharing the same course again updates it and keeps its code
    if ($cid !== '') {
        $st = $db->prepare("SELECT id, code FROM {$p}levels WHERE kind = 'shared' AND pid = ? AND cid = ?");
        $st->execute([$pid, $cid]);
        if ($r = $st->fetch()) {
            $db->prepare("UPDATE {$p}levels SET track = ?, name = ?, author = ?, n = ?, items = ?, updated_at = ? WHERE id = ?")
               ->execute([$track, $name, $author, $n, $items, $now, $r['id']]);
            rd_json(['ok' => true, 'code' => $r['code'], 'updated' => true]);
        }
    }
    $st = $db->prepare("SELECT COUNT(*) FROM {$p}levels WHERE kind = 'shared' AND pid = ? AND created_at > ?");
    $st->execute([$pid, $now - 86400]);
    if ((int) $st->fetchColumn() >= SHARES_PER_DAY) rd_fail(429, 'limit', 'Sharing limit reached for today.');
    for ($k = 0; $k < 8; $k++) {
        $code = '';
        for ($j = 0; $j < 5; $j++) $code .= CODE_ALPHABET[random_int(0, strlen(CODE_ALPHABET) - 1)];
        try {
            $db->prepare("INSERT INTO {$p}levels (kind, code, track, name, author, pid, cid, n, items, plays, created_at, updated_at) VALUES ('shared', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)")
               ->execute([$code, $track, $name, $author, $pid, $cid, $n, $items, $now, $now]);
            rd_json(['ok' => true, 'code' => $code]);
        } catch (PDOException $e) {
            if ((string) $e->getCode() !== '23000') throw $e; // duplicate code: roll again
        }
    }
    rd_fail(500, 'no_code');
}

function shared(): void {
    $code = strtoupper((string) rd_in('code', ''));
    if (!preg_match('/^[A-Z0-9]{5}$/', $code)) rd_fail(400, 'bad_code');
    $db = rd_db(); $p = rd_prefix();
    $st = $db->prepare("SELECT code, track, name, author, items, plays FROM {$p}levels WHERE kind = 'shared' AND code = ?");
    $st->execute([$code]);
    $r = $st->fetch();
    if (!$r) rd_fail(404, 'not_found', 'No course with that code.');
    $db->prepare("UPDATE {$p}levels SET plays = plays + 1 WHERE kind = 'shared' AND code = ?")->execute([$code]);
    rd_json(['ok' => true, 'course' => ['code' => $r['code'], 'track' => $r['track'], 'name' => $r['name'], 'author' => $r['author'], 'plays' => (int) $r['plays'] + 1, 'items' => json_decode($r['items'], true)]]);
}

function shared_list(): void {
    $db = rd_db(); $p = rd_prefix();
    $st = $db->query("SELECT code, track, name, author, n, plays, created_at FROM {$p}levels WHERE kind = 'shared' ORDER BY created_at DESC LIMIT 30");
    $rows = array_map(fn($r) => ['code' => $r['code'], 'track' => $r['track'], 'name' => $r['name'], 'author' => $r['author'], 'n' => (int) $r['n'], 'plays' => (int) $r['plays'], 'at' => (int) $r['created_at']], $st->fetchAll());
    rd_json(['ok' => true, 'rows' => $rows]);
}

function official_save(): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') rd_fail(405, 'post_only');
    rd_admin();
    $track = rd_pick('track', TRACKS);
    $raw = rd_in('items');
    $db = rd_db(); $p = rd_prefix(); $now = time();
    if ($raw === null) {
        $db->prepare("DELETE FROM {$p}levels WHERE kind = 'official' AND code = ?")->execute([$track]);
    } else {
        $items = level_items($raw);
        $db->prepare("INSERT INTO {$p}levels (kind, code, track, name, n, items, created_at, updated_at) VALUES ('official', ?, ?, 'OFFICIAL', ?, ?, ?, ?)
                      ON DUPLICATE KEY UPDATE n = VALUES(n), items = VALUES(items), updated_at = VALUES(updated_at)")
           ->execute([$track, $track, count($raw), $items, $now, $now]);
    }
    $reset = !empty(rd_in('reset'));
    if ($reset) {
        $db->prepare("DELETE FROM {$p}scores WHERE track = ? AND mode = 'course'")->execute([$track]);
        $db->prepare("DELETE FROM {$p}ghosts WHERE track = ? AND course = 'street'")->execute([$track]);
    }
    rd_json(['ok' => true, 'reset' => $reset]);
}

function shared_delete(): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') rd_fail(405, 'post_only');
    rd_admin();
    $code = strtoupper((string) rd_in('code', ''));
    if (!preg_match('/^[A-Z0-9]{5}$/', $code)) rd_fail(400, 'bad_code');
    $db = rd_db(); $p = rd_prefix();
    $db->prepare("DELETE FROM {$p}levels WHERE kind = 'shared' AND code = ?")->execute([$code]);
    rd_json(['ok' => true]);
}
