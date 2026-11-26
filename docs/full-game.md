# Full game

One payment of **$4.99 USD**. The account then has the full game on every device it signs in on.
Sales help fund real online multiplayer.

## Free demo vs full
| | Free web demo | Full game |
|---|---|---|
| Tracks | City, Highway, Canyon | all 8 |
| Stunt Challenge | Act I (levels 1–5); the ranked run stops after level 5 | all 15 levels |
| Obstacle Course | on the 3 free tracks | every track |
| Modes | race, course, challenge | + World Tour, Multiplayer, Course Editor |
| Cars | `G.START_CARS` | all of them, each with its own unlock goal |

Client: `G.FREE`, `G.isFull()` and `G.trackOpen()` are in `js/account.js`. Game locks (`.full-lock`, `needFull()`, `wireFull()`) are in `js/game.js`.
`G.carUnlocked` in `js/car.js` and the demo cut in `js/challenge.js` apply the rest of the split.
Server: `submit` refuses tour runs and any track outside `FREE_TRACKS` unless the token belongs to a full account.
The client locks can be tampered with, but the full-game leaderboards can't.

## Accounts
Accounts are email + password (`password_hash`). The server keeps only the sha256 of each session token.
API actions are `signup`, `login`, `logout`, `me` and `buy` (always POST). An activation on an email nobody has signed up with
creates an *unclaimed* account, and the first sign-up with that email claims it.
There is no email reset: a forgotten password gets a new one from admin.html ("New password"), which Oscar sends to the player.

## PayPal
- `buy` returns a PayPal `_xclick` URL (item RT-FULL, custom `rt<account id>`) and opens it in a new tab.
  PayPal comes back to `?paid=1`, and the game polls `me` until the payment shows up.
- `ipn` verifies the notification with PayPal and checks the receiver, item, amount and USD. It then grants the account and logs
  the notification in `rdstr_payments`. A refund or reversal takes the game off; a canceled reversal gives it back.
- Setup:
  1. Add `PAYPAL_EMAIL=...` to `.env.deploy` and run `node tools/push-config.mjs --yes`.
  2. In PayPal, turn on IPN under Account Settings → Notifications → Instant payment notifications, with the URL
     `https://guatermelon.com/roadster/api/index.php?a=ipn`.
  Until step 1 is done, `buy` answers `shop_closed`. Manual activation works without either step.

## Admin
`admin.html` needs the race-control passkey. It shows accounts and PayPal notifications. From there Oscar can
activate (gift / paid another way / tester), revoke, or give someone a new password.
On localhost it uses the sandbox tables (`sbx_`).

## Install
The game is a PWA (`manifest.json`, `icons/`). Browsers that support installing show an INSTALL button in the FULL GAME panel.

## Cloud save
Signed-in players get every `rt_` localStorage key except `acct`, `driverId`, `edClip`, `syncRev` and `syncDirty`.
That covers settings, unlocked cars, progress, records, stunt levels, courses and the tour, and it follows the account
(table `rdstr_saves`, actions `save_get` / `save_put`, `save_rev` in `me`).
- `G.store.set` is wrapped in `js/account.js`. A changed key is marked dirty and sent 3 s later.
  `pagehide` sends a last keepalive write.
- Writes are versioned: `save_put` with an outdated `rev` returns the newer save. The client merges it and tries again.
- Merging never loses progress:
  - `unlockedCars` and progress arrays are combined (union), and progress flags are combined (OR).
  - Stunt and course records keep the higher value, and lap records the lower one.
  - `myCourses` is combined by course id.
  - For any other key, this browser's value wins if it changed that key since the last sync. Otherwise the account's value wins.
- Signing in starts from the account's save. When another device's save changes this browser's data, the game reloads
  once the player is back in the menu, and shows "SAVE LOADED FROM YOUR ACCOUNT".

## Owners: download again
An owner's FULL GAME panel shows **DOWNLOAD THE GAME**.
- When the browser offers it, the button opens the install prompt. Otherwise the panel shows install steps for that browser
  (Chrome/Edge, Android, iOS, Safari, Firefox).
- The installed app resizes its window to the screen when it opens narrow (`window.resizeTo`, allowed in app windows).
