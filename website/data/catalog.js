// Everything the store sells, in one place. The browser shows these prices and
// the checkout API charges them, so this file is the only one to edit when a
// price, an edition or a shipping option changes. Prices are in cents.

export const CURRENCY = 'usd';

// The version on sale now. Download links for Standard and Complete stay on the
// version that was bought; Lifetime always gets this one.
export const CURRENT_VERSION = '0.1.8';

// Scorpion OS has its own version, separate from the app's.
export const OS_VERSION = '0.1';

// Each platform lists the files a buyer of it can download. File names match
// what the build writes (electron-builder, os/build-iso.sh).
export const PLATFORMS = {
  win: {
    label: 'Windows 10 or 11 (64-bit)',
    short: 'Windows',
    files: (v) => [
      { key: 'win', label: 'Windows installer (installed or portable)', file: `Scorpion Setup ${v}.exe` },
    ],
  },
  'mac-arm': {
    label: 'Mac with Apple Silicon (M1 to M4)',
    short: 'Mac (Apple Silicon)',
    files: (v) => [
      { key: 'mac-arm', label: 'Mac with Apple Silicon', file: `Scorpion-${v}-arm64.dmg` },
    ],
  },
  'mac-intel': {
    label: 'Mac with an Intel processor',
    short: 'Mac (Intel)',
    files: (v) => [
      { key: 'mac-intel', label: 'Mac with an Intel processor', file: `Scorpion-${v}.dmg` },
    ],
  },
  linux: {
    label: 'Linux, 64-bit (Ubuntu, Debian or any other)',
    short: 'Linux',
    files: (v) => [
      { key: 'linux-deb', label: 'Linux: Ubuntu and Debian (.deb)', file: `scorpion_${v}_amd64.deb` },
      { key: 'linux-appimage', label: 'Linux: any distribution (AppImage)', file: `Scorpion-${v}.AppImage` },
    ],
  },
};

export const EXTRA_FILES = {
  models: {
    label: 'Offline model pack (Qwen3 4B + document search)',
    short: 'Model pack',
    file: (v) => `Scorpion-${v}-model-pack.zip`,
  },
  os: {
    label: 'Scorpion OS: boot from a USB stick or install it',
    short: 'Scorpion OS',
    file: () => `scorpion-os-${OS_VERSION}-amd64.iso`,
  },
};

export const EDITIONS = [
  {
    id: 'standard',
    name: 'Standard',
    price: 2900,
    tagline: 'Scorpion for the computer you use every day.',
    // Standard is one platform, picked at checkout.
    choosePlatform: true,
    extras: [],
    lifetime: false,
    features: [
      'One platform: Windows, Mac or Linux',
      'Chat, agent, voice and memory',
      'The ORB, hand gestures and the intent wheel',
      'Download the model inside the app',
      'The version you buy, yours forever',
    ],
  },
  {
    id: 'complete',
    name: 'Complete',
    price: 4900,
    featured: true,
    tagline: 'Every installer, Scorpion OS and the models, so it installs with no internet.',
    choosePlatform: false,
    extras: ['models', 'os'],
    lifetime: false,
    features: [
      'Windows, Mac and Linux installers',
      'Scorpion OS, the whole operating system',
      'Everything in Standard',
      'Offline model pack included',
      'The version you buy, yours forever',
    ],
  },
  {
    id: 'lifetime',
    name: 'Lifetime',
    price: 9900,
    tagline: 'Every Scorpion release from now on, at no extra cost.',
    choosePlatform: false,
    extras: ['models', 'os'],
    lifetime: true,
    features: [
      'Everything in Complete',
      'Every future version, free',
      'Same download link, always the newest build',
      'Priority email support',
      'Early builds before they ship',
    ],
  },
];

export const USB_STICKS = [
  {
    id: 'usb-64',
    name: 'Scorpion USB 64 GB',
    price: 4900,
    tagline: 'Boots Scorpion OS on any PC, and runs Scorpion on Windows and Mac.',
    features: [
      'Boots Scorpion OS: nothing to install',
      'Scorpion for Windows and Mac, run from the stick',
      'Qwen3 4B and the voice preloaded',
      'Works with no internet, ever',
    ],
  },
  {
    id: 'usb-128',
    name: 'Scorpion USB 128 GB',
    price: 6900,
    tagline: 'Every tested model, and room to carry your whole AI around.',
    features: [
      'Everything on the 64 GB stick',
      'All six tested models preloaded',
      'Room for your chats, models and documents',
      'Install Scorpion OS from it, alone or beside Windows',
    ],
  },
];

export const SHIPPING = [
  { id: 'standard', label: 'Standard shipping', detail: '5 to 10 business days', price: 600 },
  { id: 'express', label: 'Express shipping', detail: '2 to 4 business days', price: 1900 },
];

// Countries a USB stick can ship to (ISO 3166-1 alpha-2), as Stripe Checkout expects.
export const SHIP_COUNTRIES = [
  'US', 'CA', 'MX', 'HT', 'DO', 'JM', 'BS', 'GB', 'IE', 'FR', 'BE', 'NL', 'DE', 'AT',
  'CH', 'ES', 'PT', 'IT', 'SE', 'NO', 'DK', 'FI', 'PL', 'RO', 'BR', 'AR', 'CL', 'CO',
  'AU', 'NZ', 'JP', 'KR', 'SG', 'IN', 'AE', 'ZA', 'NG',
];

export const findEdition = (id) => EDITIONS.find((e) => e.id === id) || null;
export const findStick = (id) => USB_STICKS.find((s) => s.id === id) || null;

export function formatPrice(cents) {
  const amount = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: CURRENCY.toUpperCase(),
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
