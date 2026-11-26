// Vérifie l'état App Store de toutes les apps du compte et poste sur Discord
// quand l'une d'elles change de statut (avec le tableau de toutes les apps).
//
// Variables (secrets GitHub) : ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY,
// DISCORD_WEBHOOK_URL. Optionnel : IGNORED_BUNDLE_IDS (séparés par des virgules).
// État précédent : state.json (commité par le workflow).

import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildMessage, diff, summarize } from './status.mjs';

const STATE_FILE = new URL('../state.json', import.meta.url);
const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY, DISCORD_WEBHOOK_URL } = process.env;
const ignored = new Set((process.env.IGNORED_BUNDLE_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const dryRun = process.argv.includes('--dry-run');

for (const [name, value] of Object.entries({ ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY })) {
  if (!value) throw new Error(`Variable manquante : ${name}`);
}
if (!dryRun && !DISCORD_WEBHOOK_URL) throw new Error('Variable manquante : DISCORD_WEBHOOK_URL');

/** Jeton App Store Connect (ES256, 10 min), signé sans dépendance. */
function ascToken() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' })}.${b64({
    iss: ASC_ISSUER_ID,
    iat: now,
    exp: now + 600,
    aud: 'appstoreconnect-v1',
  })}`;
  const key = createPrivateKey(ASC_PRIVATE_KEY.replace(/\\n/g, '\n'));
  const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `${unsigned}.${signature.toString('base64url')}`;
}

const token = ascToken();
async function asc(path) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`App Store Connect ${res.status} sur ${path} : ${await res.text()}`);
  return res.json();
}

const apps = (await asc('/v1/apps?limit=200&fields[apps]=name,bundleId')).data.filter(
  (a) => !ignored.has(a.attributes.bundleId)
);

const current = {};
for (const app of apps) {
  const res = await asc(
    `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=10&include=build` +
      '&fields[appStoreVersions]=versionString,appVersionState,appStoreState,createdDate,build&fields[builds]=version'
  );
  const builds = new Map((res.included ?? []).filter((i) => i.type === 'builds').map((b) => [b.id, b.attributes.version]));
  const versions = res.data
    .map((v) => ({
      version: v.attributes.versionString,
      build: builds.get(v.relationships?.build?.data?.id) ?? null,
      state: v.attributes.appVersionState ?? v.attributes.appStoreState,
      createdDate: v.attributes.createdDate ?? '',
    }))
    .sort((a, b) => (a.createdDate < b.createdDate ? 1 : -1));
  current[app.id] = { name: app.attributes.name, ...summarize(versions) };
}

const firstRun = !existsSync(STATE_FILE);
const previous = firstRun ? {} : JSON.parse(readFileSync(STATE_FILE, 'utf8'));
const changes = diff(previous, current);

if (firstRun || changes.length > 0) {
  const message = buildMessage(changes, current);
  if (dryRun) {
    console.log(JSON.stringify(message, null, 2));
  } else {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    if (!res.ok) throw new Error(`Discord ${res.status} : ${await res.text()}`);
  }
  console.log(firstRun ? 'Premier passage : tableau posté.' : `${changes.length} changement(s) posté(s).`);
} else {
  console.log(`Aucun changement (${apps.length} apps).`);
}

if (!dryRun) writeFileSync(STATE_FILE, JSON.stringify(current, null, 2) + '\n');
