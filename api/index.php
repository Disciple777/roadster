<?php
/**
 * Roadster Thruster leaderboard & ghosts.
 *
 *   GET  ?a=top&track=city&mode=race[&id=…]       top 20 (race: fastest time, course: highest score)
 *   POST {a:"submit", id, name, track, mode, laps, time_ms, score[, ghost]}
 *                                                 records an official run; returns the driver's rank
 *   GET  ?a=ghosts&track=city&course=street&id=…  your best course replay and the best one by someone else
 *
 * Only official runs count: 2 laps for a street race, 1 lap for the obstacle course.
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
const TOP_N = 20;
const GHOST_STRIDE = 8;          // t, x, y, z, qx, qy, qz, qw
const GHOST_MAX_FRAMES = 9000;   // 15 minutes at 10 Hz

$a = (string) rd_in('a', '');
if ($a === 'top') top();
if ($a === 'submit') submit();
if ($a === 'ghosts') ghosts();
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
