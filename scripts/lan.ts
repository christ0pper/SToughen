/**
 * Prints the address to open on your phone, and checks the things that stop it
 * working.
 *
 *   npm run lan
 *
 * The app is one server with one database. The phone does not hold a copy of
 * anything - it renders from this PC - so a file uploaded here is on the phone
 * the moment the page is refreshed. There is nothing to sync.
 */

import { networkInterfaces } from 'node:os';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 3000);

/** Every IPv4 address this machine can be reached on from the local network. */
function lanAddresses(): { name: string; address: string }[] {
  const found: { name: string; address: string }[] = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      // 169.254.x.x is what Windows assigns when DHCP failed - it reaches nothing.
      if (entry.address.startsWith('169.254.')) continue;
      found.push({ name, address: entry.address });
    }
  }
  return found;
}

function firewallAllows(port: number): boolean | null {
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command',
       `(Get-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -ErrorAction SilentlyContinue |` +
       ` Get-NetFirewallPortFilter | Where-Object { $_.LocalPort -eq ${port} } | Measure-Object).Count`],
      { encoding: 'utf8' },
    );
    return Number(out.trim()) > 0;
  } catch {
    return null;
  }
}

function envValue(key: string): string | null {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(line);
    if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

const addresses = lanAddresses();

console.log('');
if (addresses.length === 0) {
  console.log('  This PC has no local network address. Connect it to the same');
  console.log('  Wi-Fi or wired network as the phone, then run this again.\n');
  process.exitCode = 1;
} else {
  console.log('  Open this on the phone, on the same Wi-Fi:\n');
  for (const { name, address } of addresses) {
    console.log(`      http://${address}:${PORT}        (${name})`);
  }
  console.log('\n  In the phone browser, use Add to Home Screen - it then opens');
  console.log('  like an app, full screen, with no address bar.\n');
}

const allowed = firewallAllows(PORT);
if (allowed === false) {
  console.log(`  ! Windows Firewall has no inbound rule for port ${PORT}, so the`);
  console.log('    phone will time out. Run this once, as Administrator:\n');
  console.log(`      netsh advfirewall firewall add rule name="Payroll ${PORT}" ^`);
  console.log(`        dir=in action=allow protocol=TCP localport=${PORT}\n`);
} else if (allowed === null) {
  console.log(`  ? Could not read the firewall rules. If the phone times out,`);
  console.log(`    allow inbound TCP ${PORT}.\n`);
}

if (envValue('AUTH_DISABLED') === 'true') {
  console.log('  ! AUTH_DISABLED=true. Anyone on this network who opens that');
  console.log('    address is signed in as an Admin, with no password. Remove it');
  console.log('    from .env before the phone - or anything else - can reach this.\n');
}

console.log('  Serve it with:  npm run build  then  npm run start:lan');
console.log('  (`npm run dev` also works but is several times slower.)\n');
console.log('  Everything is one database on this PC. Upload a file here and the');
console.log('  phone shows it on the next refresh - there is no copy to sync.\n');
