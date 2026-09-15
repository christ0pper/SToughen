# Reaching the payroll app from anywhere

The app runs on one PC. This puts a permanent HTTPS address in front of it, with
Cloudflare checking who you are *before* any request reaches the payroll data.

Nothing here opens a port on your router. `cloudflared` makes an outbound
connection to Cloudflare and traffic comes back down it, so it works behind
CGNAT and changes nothing on the network.

## What was already verified

A throwaway tunnel was pointed at a scratch copy of the app, and through it:

- the app served over public HTTPS;
- sign-in worked, and the session cookie came back `Secure` and `HttpOnly` —
  the app reads `x-forwarded-proto`, so it marks the cookie `Secure` on its own
  once a proxy speaks HTTPS, with no configuration;
- a 2.5&nbsp;MB upload reached the server whole. That is the size of a real
  monthly export, and it is the thing most likely to be silently truncated.

So the application side is known good. What follows is account setup, which
needs your Cloudflare login and a browser.

## Before you start

- A domain on Cloudflare. The free plan is enough. If the domain is registered
  elsewhere, add it in the Cloudflare dashboard and repoint its nameservers.
- `cloudflared` — already installed here at
  `C:\Program Files (x86)\cloudflared\cloudflared.exe`.
- `npm run preflight` passing. It refuses if the sign-in bypass is on, the
  session secret is the placeholder, or a password is guessable. **Do not skip
  this.** Everything below makes the app reachable from the internet.

## 1. Log in and create the tunnel

```powershell
cloudflared tunnel login          # opens a browser; pick your domain
cloudflared tunnel create payroll
```

`create` prints a tunnel UUID and writes a credentials JSON into
`%USERPROFILE%\.cloudflared\`. Note the UUID.

## 2. Point a hostname at it

```powershell
cloudflared tunnel route dns payroll payroll.example.com
```

Replace `example.com` with your domain. This creates the DNS record for you.

## 3. Write the config

Save as `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: payroll
credentials-file: C:\Users\Chris\.cloudflared\<TUNNEL-UUID>.json

ingress:
  - hostname: payroll.example.com
    service: http://localhost:3000
  # Anything not matched above is refused rather than quietly forwarded.
  - service: http_status:404
```

## 4. Gate it with Cloudflare Access

**This is the part that matters.** Without it the app is on the open internet
with only its own password in front of it, and login pages get found and probed
automatically. With it, Cloudflare demands identity first and unauthenticated
requests never reach the PC at all.

In the Cloudflare dashboard: **Zero Trust → Access → Applications → Add an
application → Self-hosted**.

- Application domain: `payroll.example.com`
- Add a policy: Action **Allow**, Include **Emails** → list the specific people.
  Not "everyone", not "any email ending in…" unless that domain is yours.
- Leave the default login method (one-time PIN by email) unless you already use
  Google or Microsoft sign-in.

The app keeps its own login as well. Two gates, deliberately: Cloudflare decides
who may reach the server, the app decides who may see payroll and whether they
are Admin or HR.

## 5. Run both as services, so a reboot recovers

```powershell
cloudflared service install        # run as Administrator
```

The app itself needs to come back too. Build it first, then run
`npm run start:lan` from a scheduled task set to **At startup**, running whether
or not you are logged on:

```powershell
npm run build
```

The PC has to be awake. Set sleep to Never on a machine that is meant to answer
at any hour, or the address simply stops responding when nobody is at the desk.

## 6. Check it

From a phone on mobile data, not Wi-Fi — otherwise you have only proved the LAN
works:

1. Open `https://payroll.example.com`.
2. Cloudflare asks for your email and sends a code.
3. The app's own login appears. Sign in.
4. **Add to Home Screen**, and it opens full screen like an app.

## Things worth knowing

**The upload is still done on the PC.** Nothing stops you uploading from the
phone, but the export lands in Downloads on the PC, and a 2.5&nbsp;MB file over
mobile data is slower than over the desk. The phone is for reading — checking a
period, looking someone up, approving.

**One database, no sync.** The phone renders from the PC. A file imported on the
PC is on the phone at the next refresh. There is no copy to reconcile and no
offline mode: no PC, no app.

**Back up the database.** Payroll lives in Supabase, whose free plan keeps no
backups. Remote access adds ways in; it adds nothing to recover lost data. Take
a `pg_dump` against `DIRECT_URL` on a schedule and keep it off this PC.

**Revoking someone** is done in Cloudflare Access, and takes effect immediately
— faster and more complete than disabling their account in the app, because they
stop reaching the server at all.
