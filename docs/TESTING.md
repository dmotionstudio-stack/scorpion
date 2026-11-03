# Testing Scorpion

A change isn't done until it has run where people will use it. Unit tests and
page previews come first because they're fast, but they stand in for the real
thing: before building the next feature on top of a change, check it on its
target.

## What runs by itself

| Where | What | When |
|---|---|---|
| `npm test` | Unit tests (gestures, the shell's placement, settings migrations, the shell API, the OS theme files…) | Every build, and before every commit |
| `scripts/smoke-test.mjs` | The packaged app on Windows and both Macs: it starts, its window and page load, the model engine runs in a process of its own and reports the hardware, the Windows helper builds and lists windows, older settings are brought up to date, updates from GitHub are on (and the Windows build has the updater's app-update.yml) | The release workflow, after building; a failure stops the release |
| `os/test/boot-test.mjs` | Scorpion OS in QEMU: boots to the session; Scorpion comes back after it crashes; the screen locks, and the lock comes back after swaylock crashes; the machine sleeps, wakes, and shows its lock screen (judged by pictures, which must not be black); the UEFI and BIOS boot menus | The Scorpion OS workflow, after building the ISO |

## What to check by hand, by area

- **Windows desktop features** (the taskbars, the dot and wheel, Stage, the
  desktop background, the hand mouse): a test copy with its own data folder
  (`SCORPION_DATA_DIR`), driven through Chrome's debugging protocol. Test
  copies set `taskbarAlwaysOn: false` (never hide the Windows taskbar) and use
  auto-hide, or put the work area back afterwards.
- **Anything in `os/`**: an ISO from the Scorpion OS workflow, booted in a VM
  (VirtualBox or QEMU): the live session at least, and the installed system
  for anything about installing, starting up, sleeping or updating.
- **The model engine**: a test copy loading a real model and answering
  (`window.scorpion.loadModel()`, then a chat); the reply's text is in the
  message's `blocks`.
- **Gestures**: the synthetic-hand tests in `test/gestures.test.js` measure
  lag and shiver; feel comes only from a real camera and hand.

## Writing a new check

- Add a step to `os/rootfs/usr/lib/scorpion-os/boot-test-steps` that writes
  a `SCORPION-…` line to the console, and teach `os/test/boot-test.mjs` to
  wait for it (and take a picture if it's about the screen).
- Add a check to `scripts/smoke-test.mjs` for anything the packaged app must
  do on start.
- A setting whose meaning changes gets a step at the end of `MIGRATIONS` in
  `src/main/store.js` (never edit or reorder the shipped ones) and a case in
  `test/store-migrate.test.js`.
