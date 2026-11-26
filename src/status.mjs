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
    const pending = app.pending
      ? `${STATES[app.pending.state]?.dot ?? '⚪'} ${app.pending.version} ${stateLabel(app.pending.state)}`
      : '';
    return `${appDot(app)} ${app.name.padEnd(nameWidth)}${live}${pending}`.trimEnd();
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

/**
 * Embed Discord : le changement en tête (s'il y en a), puis les apps internes
 * et externes, chacune dans un bloc aligné. changes vide = tableau seul.
 */
export function buildMessage(changes, current, now = new Date()) {
  const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const apps = Object.values(current);

  const sections = GROUPS.map(({ key, title }) => {
    const group = apps
      .filter((a) => (a.group ?? 'internal') === key)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return group.length ? `**${title}**\n\`\`\`\n${boardLines(group, apps).join('\n')}\n\`\`\`` : '';
  }).filter(Boolean);

  let title = '📱 État des apps';
  let header = '';
  if (changes.length > 0) {
    const first = changes[0];
    title =
      changes.length === 1
        ? (HEADLINES[first.toState] ?? ((a) => `🔔 ${a} vient de changer de statut`))(first.name)
        : `🔔 ${changes.length} apps viennent de changer de statut`;
    header = changes.map((c) => changeLine(c, changes.length > 1)).join('\n') + '\n\n';
  }

  const color =
    changes.length === 0
      ? 0x5865f2
      : { IN_REVIEW: 0x3b82f6, READY_FOR_DISTRIBUTION: 0x22c55e, PENDING_DEVELOPER_RELEASE: 0xa855f7, REJECTED: 0xef4444 }[
          changes[0].toState
        ] ?? 0xf59e0b;

  return {
    embeds: [
      {
        title,
        description: header + sections.join('\n'),
        color,
        footer: { text: `Mis à jour à ${time}` },
      },
    ],
  };
}
