// What the quick settings panel says (quick.js), as plain functions so they
// are tested on their own. `s` is the main process's quick state
// (linux-control.js quickState).

// Under the Wi-Fi tile: the network, Off, Wired, or that there's no Wi-Fi.
export function wifiSub(wifi = {}) {
  if (!wifi.adapter) return wifi.wired ? 'Wired' : 'No Wi-Fi';
  if (!wifi.on) return 'Off';
  return wifi.connected || (wifi.wired ? 'Wired' : 'Not connected');
}
export function btSub(bt = {}) {
  if (!bt.adapter) return 'No Bluetooth';
  if (!bt.on) return 'Off';
  const on = (bt.devices || []).filter((d) => d.connected);
  return on.length ? on.map((d) => d.name).join(', ') : 'On';
}
// "87% · Charging", "54% · 3 h 10 min left"; null without a battery.
export function batteryLine(b = {}) {
  if (typeof b.battery !== 'number') return null;
  const detail = b.time || (b.charging ? (b.battery >= 100 ? 'Fully charged' : 'Charging') : 'On battery');
  return { pct: `${b.battery}%`, detail };
}
// Signal strength (0-100) as 1-4 lit bars.
export const bars = (signal) => Math.max(1, Math.min(4, Math.ceil((Number(signal) || 0) / 25)));
// Networks: the one in use first, then by strength (as nmcli lists them).
// A secured network not already known needs a password typed in.
export const needsPassword = (net, known = []) => Boolean(net?.secure) && !net.connected && !known.includes(net.ssid);
