// Règles pures : état d'une app à partir de ses versions App Store, détection
// des changements et message Discord. Testé dans test/status.test.mjs.

/** Libellé et pastille de chaque état App Store Connect (appVersionState). */
export const STATES = {
  READY_FOR_DISTRIBUTION: { label: 'en ligne', dot: '🟢' },
  PROCESSING_FOR_DISTRIBUTION: { label: 'en cours de mise en ligne', dot: '🟢' },
  PENDING_DEVELOPER_RELEASE: { label: 'validée, à publier', dot: '🟣' },
  PENDING_APPLE_RELEASE: { label: 'validée, sortie programmée', dot: '🟣' },
  ACCEPTED: { label: 'validée', dot: '🟣' },
  IN_REVIEW: { label: 'en review', dot: '🔵' },
  WAITING_FOR_REVIEW: { label: 'en attente de review', dot: '🟡' },
  READY_FOR_REVIEW: { label: 'prête pour la review', dot: '🟡' },
  WAITING_FOR_EXPORT_COMPLIANCE: { label: 'en attente (export compliance)', dot: '🟡' },
  PREPARE_FOR_SUBMISSION: { label: 'en préparation', dot: '⚪' },
  REJECTED: { label: 'rejetée', dot: '🔴' },
  METADATA_REJECTED: { label: 'métadonnées rejetées', dot: '🔴' },
  INVALID_BINARY: { label: 'binaire invalide', dot: '🔴' },
  DEVELOPER_REJECTED: { label: 'retirée de la review', dot: '⚪' },
};

const LIVE = new Set(['READY_FOR_DISTRIBUTION', 'PROCESSING_FOR_DISTRIBUTION']);
const IGNORED = new Set(['REPLACED_WITH_NEW_VERSION', 'REMOVED_FROM_SALE']);

/** Titre du message pour un passage vers cet état. */
const HEADLINES = {
  IN_REVIEW: (app) => `🔵 ${app} passe en review`,
  WAITING_FOR_REVIEW: (app) => `🟡 ${app} est envoyée en review`,
  PENDING_DEVELOPER_RELEASE: (app) => `🟣 ${app} est validée par Apple, à publier`,
  PENDING_APPLE_RELEASE: (app) => `🟣 ${app} est validée par Apple`,
  ACCEPTED: (app) => `🟣 ${app} est validée par Apple`,
  READY_FOR_DISTRIBUTION: (app) => `🎉 ${app} est en ligne`,
  PROCESSING_FOR_DISTRIBUTION: (app) => `🟢 ${app} part en ligne`,
  REJECTED: (app) => `🔴 ${app} est rejetée par Apple`,
  METADATA_REJECTED: (app) => `🔴 ${app} : métadonnées rejetées`,
  INVALID_BINARY: (app) => `🔴 ${app} : binaire invalide`,
  DEVELOPER_REJECTED: (app) => `⚪ ${app} est retirée de la review`,
  PREPARE_FOR_SUBMISSION: (app) => `⚪ ${app} prépare une nouvelle version`,
};

/**
 * Compare deux versions « 1.1.53 » numériquement ; « 1.0 » = « 1.0.0 ».
 * < 0 si a < b, 0 si égales, > 0 si a > b.
 */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Version lisible : « 1.1.53 (270) » ou « 1.1.53 ». */
export function versionLabel(v) {
  return v.build ? `${v.version} (${v.build})` : v.version;
}

/**
 * Résumé d'une app à partir de ses versions iOS (de la plus récente à la plus
 * ancienne) : la version en ligne et la version en cours (si elle existe).
 * versions : [{ version, build, state, createdDate }]
 */
export function summarize(versions) {
  const relevant = versions.filter((v) => !IGNORED.has(v.state));
  const live = relevant.find((v) => LIVE.has(v.state)) ?? null;
  const pending =
    relevant.find((v) => !LIVE.has(v.state) && (!live || v.createdDate > live.createdDate)) ?? null;
  return {
    live: live ? { version: live.version, build: live.build ?? null } : null,
    pending: pending
      ? { version: pending.version, build: pending.build ?? null, state: pending.state }
      : null,
  };
}

/** Clé comparable d'un état d'app : ce qui, s'il change, mérite un message. */
function key(s) {
  return JSON.stringify([s?.live?.version ?? null, s?.pending?.version ?? null, s?.pending?.state ?? null]);
}

/**
 * Changements entre l'ancien et le nouvel état, par app.
 * previous / current : { [appId]: { name, live, pending } }
 */
export function diff(previous, current) {
  const changes = [];
  for (const [id, now] of Object.entries(current)) {
    const before = previous[id];
    if (!before) continue; // app nouvelle : apparaît dans le tableau, sans message dédié
    const tfChange = testflightChange(id, before, now);
    if (tfChange) changes.push(tfChange);
    if (key(before) === key(now)) continue;
    const fromState = before.pending?.state ?? (before.live ? 'READY_FOR_DISTRIBUTION' : null);
    const toState = now.pending?.state ?? (now.live ? 'READY_FOR_DISTRIBUTION' : null);
    const version = now.pending ?? now.live;
    changes.push({
      id,
      name: now.name,
      fromState,
      toState,
      version,
      fromLive: before.live?.version ?? null,
    });
  }
  return changes;
}

/**
 * Changement TestFlight : nouveau build envoyé, ou fin de traitement d'un
 * build. Un état enregistré avant le suivi TestFlight (champ absent) ne
 * déclenche rien, pour ne pas annoncer d'un coup tous les derniers builds.
 */
function testflightChange(id, before, now) {
  if (!('testflight' in before) || !now.testflight) return null;
  const prev = before.testflight;
  const tf = now.testflight;
  const isNew = !prev || prev.build !== tf.build || prev.version !== tf.version;
  if (!isNew && prev.state === tf.state) return null;
  return { kind: 'testflight', id, name: now.name, testflight: tf, isNew };
}

/** Titre d'un changement TestFlight. */
function testflightHeadline(c) {
  const tf = c.testflight;
  const label = versionLabel({ version: tf.version ?? '?', build: tf.build });
  if (tf.state === 'VALID') return `🧪 ${c.name} ${label} est dispo sur TestFlight`;
  if (tf.state === 'FAILED' || tf.state === 'INVALID') return `🔴 ${c.name} · build ${label} invalide`;
  return `🛠 ${c.name} · build ${label} envoyée sur TestFlight`;
}

const stateLabel = (s) => STATES[s]?.label ?? s?.toLowerCase().replaceAll('_', ' ') ?? '—';
const pretty = (s) =>
  s ? s.toLowerCase().replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—';

/** Pastille d'ensemble d'une app : rouge si rejetée, verte si en ligne. */
function appDot(app) {
  if (app.pending && ['REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'].includes(app.pending.state)) return '🔴';
  if (app.live) return '🟢';
  return STATES[app.pending?.state]?.dot ?? '⚪';
}

/**
 * Lignes alignées d'un groupe d'apps, pour un bloc monospace :
 * pastille, nom court, version en ligne, puis ce qui est en cours.
 */
export function boardLines(apps, widthsFrom = apps) {
  // Largeurs calculées sur toutes les apps du message : les deux blocs
  // (internes, externes) partagent les mêmes colonnes.
  const nameWidth = Math.max(...widthsFrom.map((a) => a.name.length), 4) + 2;
  const liveWidth = Math.max(...widthsFrom.map((a) => (a.live?.version ?? '—').length), 4) + 3;
  return apps.map((app) => {
    const live = (app.live?.version ?? '—').padEnd(liveWidth);
    const parts = [];
    if (app.pending) {
      parts.push(`${STATES[app.pending.state]?.dot ?? '⚪'} ${app.pending.version} ${stateLabel(app.pending.state)}`);
    }
    // Dernier build TestFlight, s'il est plus récent que ce qui est en ligne
    // ou en cours sur l'App Store.
    const tf = app.testflight;
    const newer = (v) => !v || compareVersions(tf.version, v) > 0;
    if (tf?.version && newer(app.live?.version) && newer(app.pending?.version)) {
      const tfDot = tf.state === 'VALID' ? '🧪' : tf.state === 'FAILED' || tf.state === 'INVALID' ? '🔴' : '🛠';
      parts.push(`${tfDot} TF ${versionLabel({ version: tf.version, build: tf.build })}`);
    }
    return `${appDot(app)} ${app.name.padEnd(nameWidth)}${live}${parts.join(' · ')}`.trimEnd();
  });
}

/** Ancienne ligne (texte riche), gardée pour les tests et le debug. */
export function boardLine(app) {
  const parts = [];
  if (app.live) parts.push(`iOS ${app.live.version} en ligne`);
  if (app.pending) {
    parts.push(`${STATES[app.pending.state]?.dot ?? '⚪'} ${app.pending.version} ${stateLabel(app.pending.state)}`);
  }
  return `${appDot(app)} **${app.name}** — ${parts.length ? parts.join(' · ') : 'rien en cours'}`;
}

const GROUPS = [
  { key: 'internal', title: '🏠 Apps internes' },
  { key: 'external', title: '🤝 Apps externes' },
];

/** Ligne d'en-tête d'un changement. */
function changeLine(c, multiple) {
  const prefix = multiple ? `**${c.name}** · ` : '';
  // Nouvelle version en ligne sans état intermédiaire connu (apps externes).
  if (c.fromState === c.toState && c.toState === 'READY_FOR_DISTRIBUTION') {
    return `${prefix}iOS ${c.fromLive ?? '—'} → ${c.version?.version ?? '—'}`;
  }
  return `${prefix}iOS ${c.version ? versionLabel(c.version) : ''} · ${pretty(c.fromState)} → ${pretty(c.toState)}`;
}

const COLORS = {
  IN_REVIEW: 0x3b82f6,
  WAITING_FOR_REVIEW: 0xeab308,
  READY_FOR_DISTRIBUTION: 0x22c55e,
  PROCESSING_FOR_DISTRIBUTION: 0x22c55e,
  PENDING_DEVELOPER_RELEASE: 0xa855f7,
  PENDING_APPLE_RELEASE: 0xa855f7,
  ACCEPTED: 0xa855f7,
  REJECTED: 0xef4444,
  METADATA_REJECTED: 0xef4444,
  INVALID_BINARY: 0xef4444,
};

/** Message court d'un changement, gardé dans le salon comme historique. */
export function buildChangeMessage(change, { demo = false } = {}) {
  if (change.kind === 'testflight') {
    const title = testflightHeadline(change);
    const tf = change.testflight;
    return {
      embeds: [
        {
          title: demo ? `🧪 ${title}` : title,
          description:
            tf.state === 'VALID'
              ? 'Prête pour les testeurs'
              : tf.state === 'FAILED' || tf.state === 'INVALID'
                ? 'Apple a refusé le binaire'
                : 'En cours de traitement par Apple',
          color: tf.state === 'VALID' ? 0x14b8a6 : tf.state === 'FAILED' || tf.state === 'INVALID' ? 0xef4444 : 0x94a3b8,
          ...(demo ? { footer: { text: 'Démo : message supprimé dans un instant' } } : {}),
        },
      ],
    };
  }
  const title = (HEADLINES[change.toState] ?? ((a) => `🔔 ${a} vient de changer de statut`))(change.name);
  return {
    embeds: [
      {
        title: demo ? `🧪 ${title}` : title,
        description: changeLine(change, false),
        color: COLORS[change.toState] ?? 0xf59e0b,
        ...(demo ? { footer: { text: 'Démo : message supprimé dans un instant' } } : {}),
      },
    ],
  };
}

/**
 * Tableau de toutes les apps (internes puis externes, blocs alignés). Un seul
 * dans le salon : l'ancien est supprimé quand le nouveau est posté.
 */
export function buildBoardMessage(current, now = new Date(), { demo = false } = {}) {
  const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const apps = Object.values(current);
  const sections = GROUPS.map(({ key, title }) => {
    const group = apps
      .filter((a) => (a.group ?? 'internal') === key)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return group.length ? `**${title}**\n\`\`\`\n${boardLines(group, apps).join('\n')}\n\`\`\`` : '';
  }).filter(Boolean);
  return {
    embeds: [
      {
        title: demo ? '🧪 📱 État des apps (démo)' : '📱 État des apps',
        description: sections.join('\n'),
        color: 0x5865f2,
        footer: { text: `Mis à jour à ${time}` },
      },
    ],
  };
}
