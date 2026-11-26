// Vérifie l'état App Store de toutes les apps du compte et poste sur Discord
// quand l'une d'elles change de statut (avec le tableau de toutes les apps).
//
// Variables (secrets GitHub) : ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY,
// DISCORD_WEBHOOK_URL. Optionnel (variable GitHub) : IGNORED_APPS, apps à ne
// jamais suivre, séparées par des virgules : bundle id, ou début du nom de
// l'app (sans tenir compte des majuscules). Ex. « Chat AI, Tourny ».
// État précédent : state.json (commité par le workflow).

import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildBoardMessage, buildChangeMessage, diff, summarize } from './status.mjs';

const STATE_FILE = new URL('../state.json', import.meta.url);
// Noms courts, groupes, apps externes et exclusions (cf. apps.json).
const config = JSON.parse(readFileSync(new URL('../apps.json', import.meta.url), 'utf8'));
const shortNames = new Map((config.internal ?? []).map((a) => [String(a.id), a.name]));
const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY, DISCORD_WEBHOOK_URL } = process.env;
const ignored = [(config.ignored ?? []).join(','), process.env.IGNORED_APPS, process.env.IGNORED_BUNDLE_IDS]
  .join(',')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const isIgnored = ({ id, name, bundleId }) =>
  ignored.some((i) => id === i || bundleId.toLowerCase() === i || name.toLowerCase().startsWith(i));
const dryRun = process.argv.includes('--dry-run');
// Démo : 3 faux changements sur Parkeur, 10 s d'écart, puis nettoyage.
const demo = process.argv.includes('--demo');
// Reposter le tableau même sans changement (bouton « refresh » du workflow).
const refresh = process.argv.includes('--refresh');

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
  (a) => !isIgnored({ id: a.id, ...a.attributes })
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
  // Dernier build envoyé (TestFlight) : version, numéro, état de traitement.
  const tf = await asc(
    `/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=1&include=preReleaseVersion` +
      '&fields[builds]=version,uploadedDate,processingState,preReleaseVersion&fields[preReleaseVersions]=version'
  );
  const build = tf.data?.[0];
  const preRelease = (tf.included ?? []).find((i) => i.type === 'preReleaseVersions');
  current[app.id] = {
    // Nom court d'apps.json, sinon le nom App Store (app pas encore renommée).
    name: shortNames.get(app.id) ?? app.attributes.name,
    group: 'internal',
    ...summarize(versions),
    testflight: build
      ? {
          version: preRelease?.attributes.version ?? null,
          build: build.attributes.version,
          state: build.attributes.processingState,
          uploadedDate: build.attributes.uploadedDate,
        }
      : null,
  };
}

// Apps externes (autres comptes) : version en ligne sur l'App Store public.
for (const ext of config.external ?? []) {
  const res = await fetch(`https://itunes.apple.com/lookup?id=${ext.appStoreId}&country=${ext.country ?? 'fr'}`);
  const result = res.ok ? (await res.json()).results?.[0] : null;
  if (!result) {
    console.warn(`App externe introuvable sur l'App Store : ${ext.name} (${ext.appStoreId})`);
    continue;
  }
  current[`ext:${ext.appStoreId}`] = {
    name: ext.name,
    group: 'external',
    live: { version: result.version, build: null },
    pending: null,
  };
}

// --- Discord (webhook) : poster en récupérant l'id, supprimer ses messages.
async function discordPost(message) {
  const res = await fetch(`${DISCORD_WEBHOOK_URL}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`Discord ${res.status} : ${await res.text()}`);
  return (await res.json()).id;
}
async function discordDelete(id) {
  if (!id) return;
  const res = await fetch(`${DISCORD_WEBHOOK_URL}/messages/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) console.warn(`Discord : suppression de ${id} impossible (${res.status})`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// État précédent : { apps, boardMessageId } (ancien format : les apps seules).
const firstRun = !existsSync(STATE_FILE);
const saved = firstRun ? {} : JSON.parse(readFileSync(STATE_FILE, 'utf8'));
const previous = saved.apps ?? (saved.boardMessageId === undefined ? saved : {});
let boardMessageId = saved.boardMessageId ?? null;
const save = (apps) =>
  writeFileSync(STATE_FILE, JSON.stringify({ boardMessageId, apps }, null, 2) + '\n');

if (demo) {
  const id = Object.keys(current).find((k) => current[k].name === 'Parkeur');
  if (!id) throw new Error('Démo : Parkeur introuvable');
  const base = current[id];
  const steps = [
    { live: base.live, pending: { version: '1.1.53', build: '270', state: 'WAITING_FOR_REVIEW' } },
    { live: base.live, pending: { version: '1.1.53', build: '270', state: 'IN_REVIEW' } },
    { live: base.live, pending: { version: '1.1.53', build: '270', state: 'PENDING_DEVELOPER_RELEASE' } },
    { live: { version: '1.1.53', build: '270' }, pending: null },
  ];
  const demoMessages = [];
  let demoBoard = null;
  await discordDelete(boardMessageId); // le vrai tableau revient à la fin
  for (let i = 1; i < steps.length; i++) {
    const before = { ...current, [id]: { ...base, ...steps[i - 1] } };
    const after = { ...current, [id]: { ...base, ...steps[i] } };
    for (const change of diff(before, after)) {
      demoMessages.push(await discordPost(buildChangeMessage(change, { demo: true })));
    }
    await discordDelete(demoBoard);
    demoBoard = await discordPost(buildBoardMessage(after, new Date(), { demo: true }));
    console.log(`Démo : étape ${i}/3 postée`);
    if (i < steps.length - 1) await sleep(10_000);
  }
  await sleep(60_000);
  for (const m of [...demoMessages, demoBoard]) await discordDelete(m);
  boardMessageId = await discordPost(buildBoardMessage(current));
  save(firstRun ? current : previous); // la démo ne touche pas à l'état des apps
  console.log('Démo terminée : messages de démo supprimés, vrai tableau reposté.');
  process.exit(0);
}

const changes = diff(previous, current);
// Nouveau champ suivi (ex. TestFlight) absent de l'état enregistré : on
// reposte le tableau une fois, sans message par app.
const schemaChanged = Object.entries(current).some(
  ([id, app]) => 'testflight' in app && previous[id] && !('testflight' in previous[id])
);
if (firstRun || changes.length > 0 || schemaChanged || refresh) {
  if (dryRun) {
    for (const c of changes) console.log(JSON.stringify(buildChangeMessage(c), null, 2));
    console.log(JSON.stringify(buildBoardMessage(current), null, 2));
  } else {
    // Historique : un message court par changement, qui reste.
    for (const change of changes) await discordPost(buildChangeMessage(change));
    // Tableau : un seul dans le salon, toujours en bas.
    await discordDelete(boardMessageId);
    boardMessageId = await discordPost(buildBoardMessage(current));
  }
  console.log(
    firstRun
      ? 'Premier passage : tableau posté.'
      : changes.length
        ? `${changes.length} changement(s) posté(s).`
        : 'Tableau reposté.'
  );
} else {
  console.log(`Aucun changement (${Object.keys(current).length} apps).`);
}

if (!dryRun) save(current);
