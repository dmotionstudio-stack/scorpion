# Remote control

See and work this computer (Windows or Mac) from a phone, tablet or another computer's browser.
Settings → Connections → Remote control. It is **off** until you turn it on.

- Pair: press "Pair a device", open the address shown on the other device, type the 6-digit code (5 minutes, 5 tries).
- Every session is approved on this computer ("Allow this time"), unless you ticked "Allow without asking" for that device.
- One device at a time. While someone is in, a red banner shows on top of the screen with a Stop button; Ctrl+Alt+Shift+K ends it too.
  A session also ends after 5 quiet minutes, when the device is removed, or when remote control is turned off.
- HTTPS with a certificate made on this computer (`<data folder>/remote-control/`); check its fingerprint on the first visit.
  Only this computer answers by default; "home network" allows private addresses only. From outside, use a VPN such as Tailscale
  (100.64.0.0/10 is accepted), never a router port forward.
- Everything is logged to `<data folder>/remote-control/log.txt`.
- Mac: allow Scorpion under Privacy & Security → Screen Recording and Accessibility. (Written and unit-tested; not yet tried on a real Mac.)
