import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";

import forge from "node-forge";

const DEFAULT_PORT = "3000";
const DEFAULT_HOST = "0.0.0.0";
const CERT_DAYS = 7;

function isPrivateIpv4(address) {
  const octets = address.split(".").map(Number);
  const [first, second] = octets;

  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function scoreNetworkAddress(candidate) {
  const name = candidate.name.toLowerCase();
  let score = 0;

  if (isPrivateIpv4(candidate.address)) {
    score += 30;
  }

  if (/^(en|eth|wlan|wi-fi|wifi|ethernet)/i.test(candidate.name)) {
    score += 20;
  }

  if (/docker|veth|vmware|virtualbox|bridge|utun|awdl|llw|loopback|vpn|tailscale|zerotier/i.test(name)) {
    score -= 40;
  }

  if (candidate.address.startsWith("169.254.")) {
    score -= 30;
  }

  return score;
}

function detectLanHost() {
  if (process.env.LAN_IP) {
    return process.env.LAN_IP;
  }

  const candidates = Object.entries(networkInterfaces())
    .flatMap(([name, addresses]) => (addresses ?? []).map((address) => ({ name, address })))
    .filter((candidate) => candidate.address.family === "IPv4")
    .filter((candidate) => !candidate.address.internal)
    .map((candidate) => ({
      name: candidate.name,
      address: candidate.address.address,
    }))
    .sort((left, right) => scoreNetworkAddress(right) - scoreNetworkAddress(left));

  return candidates[0]?.address ?? "127.0.0.1";
}

function createSerialNumber() {
  const serial = randomBytes(16);
  serial[0] &= 0x7f;

  return serial.toString("hex") || "01";
}

function createAltNames(lanHost) {
  const altNames = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
  ];

  if (isIP(lanHost)) {
    altNames.push({ type: 7, ip: lanHost });
  } else {
    altNames.push({ type: 2, value: lanHost });
  }

  return altNames;
}

function createSelfSignedCertificate(lanHost) {
  const pki = forge.pki;
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  const now = new Date();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = createSerialNumber();
  cert.validity.notBefore = new Date(now.getTime() - 60_000);
  cert.validity.notAfter = new Date(now.getTime() + CERT_DAYS * 24 * 60 * 60 * 1000);

  const attrs = [
    { name: "commonName", value: lanHost },
    { name: "organizationName", value: "Squat Coach Development" },
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: createAltNames(lanHost) },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    certPem: pki.certificateToPem(cert),
    keyPem: pki.privateKeyToPem(keys.privateKey),
  };
}

function removeDirectory(directory) {
  rmSync(directory, { force: true, recursive: true });
}

const port = process.env.PORT ?? DEFAULT_PORT;
const host = process.env.HOST ?? DEFAULT_HOST;
const lanHost = detectLanHost();
const certDirectory = mkdtempSync(path.join(tmpdir(), "squat-https-"));
const keyFile = path.join(certDirectory, "key.pem");
const certFile = path.join(certDirectory, "cert.pem");
const certificate = createSelfSignedCertificate(lanHost);

writeFileSync(keyFile, certificate.keyPem, { mode: 0o600 });
writeFileSync(certFile, certificate.certPem, { mode: 0o600 });

console.log("HTTPS dev server for iPhone Safari sensor testing:");
console.log(`  Local:  https://localhost:${port}`);
console.log(`  LAN:    https://${lanHost}:${port}`);
console.log("Safari may show a self-signed certificate warning on first access.");
console.log("Set LAN_IP=<address> to override automatic LAN IP detection.\n");

const nextArgs = [
  "next",
  "dev",
  "--experimental-https",
  "--experimental-https-key",
  keyFile,
  "--experimental-https-cert",
  certFile,
  "-H",
  host,
  "-p",
  port,
];
const child = spawn("bunx", nextArgs, {
  shell: process.platform === "win32",
  stdio: "inherit",
});
let exiting = false;

function shutdown(signal) {
  if (exiting) {
    return;
  }

  exiting = true;
  child.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

child.on("error", (error) => {
  removeDirectory(certDirectory);
  console.error(error);
  process.exit(1);
});

child.on("exit", (code) => {
  removeDirectory(certDirectory);
  process.exit(code ?? 0);
});
