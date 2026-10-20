---
title: "The invisible layer decides when one host runs several apps"
description: "On a shared host the firewall chain, the proxy rule, the trust proxy setting and PID 1 each fail without an error; only a measurement proves them."
pubDate: 2026-08-03
track: "infrastructure"
tags: ["docker", "traefik", "iptables", "systemd"]
sources: ["infra/fermer-un-port-publie-par-docker.md", "infra/routage-par-proxy-inverse-declaratif.md", "infra/derriere-un-proxy-le-limiteur-compte-tout-le-monde-ensemble.md", "infra/serveur-qui-repond-au-ping-mais-rien-derriere.md", "infra/conteneur-dont-le-pid-1-est-bun-run-sort-en-139.md", "infra/environnements-de-dev-jetables-par-conteneur.md"]
---

I run several applications on shared hosts, on separate subdomains behind Traefik. A count on one of them: 19 containers, 6 for a platform of disposable development environments, 2 service nodes for a project, and 9 routing files on the proxy side, most of them one per application. An ordinary setup, and it lied to me three times.

A port I had closed, with the rule visible in `iptables -L`, still answered from the Internet. A user saw "insufficient balance" while the browser reported a CORS error, and the cause was a password rule in the proxy. A rate limit, documented and in place, counted every visitor as one person. Each time, the layer I believed transparent was the one deciding, and it decided without an error.

## The chain depends on who listens

An `INPUT` rule does not see a port published by Docker, and a `DOCKER-USER` rule does not see a host process. Traffic to a container is forwarded, not delivered locally, so it never crosses `INPUT`. The wrong chain is accepted, listed, and has no effect.

Order matters as much as the chain. The accepts are inserted at the top with `-I`, the drop is appended with `-A`:

```bash
iptables -I INPUT -p tcp --dport 3009 -s <proxy-network-cidr> -j ACCEPT
iptables -I INPUT -p tcp --dport 3009 -s <loopback> -j ACCEPT
iptables -A INPUT -p tcp --dport 3009 -j DROP
```

A uniform `-A` would place the accepts after the drop, never reached, and the service becomes unreachable even by its own proxy.

Rules do not survive a reboot, which reopens the port and reports nothing, so the lock is an idempotent script replayed by a `oneshot` systemd unit with `RemainAfterExit=yes`, after `docker.service`. Testing from the host proves nothing for a Docker port, because a connection from the host to its own public address bypasses `DOCKER-USER`. The proof is the DROP rule's packet counters increasing in `iptables -L DOCKER-USER -v -n`, and a test from another machine.

## A prefix captures more than you meant

I added a proxy rule to put an API's documentation page behind a password:

```yaml
rule: "Host(`…`) && PathPrefix(`/api`)"
```

Three application controllers lived under that prefix: `api/onchain`, `api/pools`, `api/balances`. The prefix captured them all. The proxy answered 401 in plain text before reaching the application, so without any `Access-Control-Allow-Origin` header. The browser reported a CORS error, and the screen turned it into "insufficient balance". The symptom was three levels away from the cause.

The fix enumerates exact paths:

```yaml
rule: >
  Host(`…`) && (
    Path(`/api`) || Path(`/api/`) ||
    PathPrefix(`/api-`) || PathPrefix(`/api/swagger`) || PathPrefix(`/api/favicon`)
  )
```

This form fails on the right side: a forgotten path gives an unprotected documentation page, visible and fixable, instead of a broken API. The clue that settled it: a 400 instead of a 401 proves the request crossed the authentication layer, so `curl -s -o /dev/null -w '%{http_code}\n'` must give 401 on `/api` and not on `/api/onchain/…`.

## Behind a proxy, the limiter counts everyone together

An Express or NestJS backend that limits its public routes by `request.ip` sees the proxy's address until it is told to trust the proxy, and "20 per hour per IP" becomes 20 per hour for everyone. Measured on 5 October 2026 against a real Express application: without trust, two callers announcing different addresses in `X-Forwarded-For` share one counter; with the proxy's network declared, each is itself, and a caller from outside that network cannot assign itself an address.

The rule: name the network, never count hops. `trust proxy: 1` and `true` say "there is a proxy" without saying which, so Express believes the header of anyone reaching the port. The default trusts nobody, and the application warns once when it sees `X-Forwarded-For` from a peer it does not trust, naming that peer. That warning is how I found the right network: on Dokploy, Traefik reaches the container through the overlay network `dokploy-network`, not through the compose bridge the container is also attached to. Then I proved the effect in staging: one normal call, one with a forged `X-Forwarded-For`, and the limiter key counted both under the caller's real address.

## A port that accepts proves nothing

A VPS stopped letting me in over SSH: an endless wait, no error, no refusal. Three probes question three layers. `ping` proves the kernel's network stack is alive. A TCP connection proves the kernel accepts and the socket is still bound. Only the first application byte, an SSH banner or an HTTP response, proves the process is alive. The trap is in the middle: the `SYN/ACK` is emitted by the kernel from the listen backlog, before the application calls `accept()`. A scan that reports `22 OPEN` proves a bound socket, not a working `sshd`. The client says it:

```
ssh -vv <user>@<host>
debug1: Connection established.
debug1: Local version string SSH-2.0-OpenSSH_10.5
Connection timed out during banner exchange
```

The test that settles it is probing another port than 22. If 22, 80 and 443 all accept the connection and all return zero bytes, the kernel is up and user space is not: a full disk, exhausted memory or a runaway load, by frequency. None of it can be confirmed from outside; it takes the hoster's out-of-band console.

## PID 1 is a launcher

An image built on `node:20` where bun only installs and launches: `CMD ["bun", "run", "start:prod"]`, and `start:prod` is `node dist/main.js`. Inside the container PID 1 is bun, and the Node application is its child. `docker compose stop` returned code 139, and the third party deploying the image asked whether that was safe during a money operation.

I reproduced it on 5 October 2026 without Docker, by giving the process the PID 1 role of a new namespace:

```bash
unshare --pid --fork --mount-proc <command> &   # the command becomes PID 1 of its namespace
kill -TERM <host pid of the command>             # what `docker stop` does
wait $!                                          # unshare returns its child's code
```

`bun run start:prod` (bun 1.3.14) as PID 1: segmentation fault, code 139, while the Node child did nothing. `node script.js` without a SIGTERM handler: the signal is ignored, SIGKILL after the grace period, code 137. `node script.js` with `process.on('SIGTERM', …)`: clean exit, code 0.

A PID 1 has no default action: a signal with no handler is ignored, only SIGKILL and SIGSTOP always pass, and `docker stop` sends SIGTERM, waits 10 s by default, then SIGKILL. `bun run`, `npm run`, `sh -c` sit between Docker and the application, and nothing guarantees they pass the signal on; when PID 1 dies, the kernel kills the whole namespace and the child disappears without running a line.

A clean stop needs both: the application as PID 1, `CMD ["node", "dist/main.js"]`, or a real init with `init: true` in the compose, and a shutdown handler with a `stop_grace_period` long enough to finish a request. Fixing only the `CMD` turns "139 at once" into "137 after ten seconds".

## Isolation is not a security boundary

The disposable environments buy reproducibility and the right to break everything. But an environment on the same host as production shares its kernel, its disk and its bandwidth; containers separate processes and filesystems, not a kernel. "It is isolated, so it is safe" is false; the honest version is "it is compartmentalised, so ordinary accidents do not spread", and if the stakes justify it, the only solid answer is a separate host. Each environment also adds an administration interface and service ports to close explicitly, and the disk wears out silently until saturation hits everything on the host, production included. I watch the host's disk, not the container's.

## What I keep

- The wrong iptables chain is accepted, listed, and does nothing; the proof is a DROP counter that increases.
- A path prefix in the proxy answers before the app and without its headers; a CORS error can be a 401 from the proxy.
- `trust proxy` names a network, read from the application's own warning; on Dokploy it is the overlay, not the compose bridge.
- A port that accepts a connection proves a bound socket; only the first application byte proves a process.
- A launcher as PID 1 exits 139 on SIGTERM; a clean stop needs node or an init as PID 1 plus a handler, and a container is not a security boundary on a shared host.
