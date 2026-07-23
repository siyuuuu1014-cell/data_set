/** One-time restore script for nuwa localStorage.
 *  Run in browser console or visit /restore.html.
 *  Or: open Browser DevTools → Sources → Snippets → New → paste this → run.
 */
(async function restoreNuwaData() {
  const API = '/api/video-annotation/annotate-sets/restore';
  const tasks = await (await fetch(API)).json();
  const raw = localStorage.getItem('nuwa-store');
  const data = raw ? JSON.parse(raw) : { projects: [], tables: {}, annotateSets: {} };

  // ── clickhouse project ────────────────────────────────────
  const CH = 'mr1h21v5';
  if (!data.projects.find(p => p.id === CH)) {
    data.projects.push({ id: CH, name: 'clickhouse', createdAt: '2025-07-01T00:00:00.000Z' });
  }
  const tableNames = [
    'content_feature', 'content_feature2', 'published_asset',
    'published_commerce', 'published_prompt', 'test',
    'u2a_behavior', 'u2c_behavior', 'u2p_behavior',
    'u2u_behavior', 'user_profile_features',
  ];
  if (!data.tables[CH]) data.tables[CH] = [];
  for (const n of tableNames) {
    if (!data.tables[CH].find(t => t.name === n))
      data.tables[CH].push({ id: n + '_' + Date.now(), name: n, columns: [], rows: [], rowCount: 0 });
  }

  // ── Annotate sets ─────────────────────────────────────────
  const projectIds = new Set(data.projects.map(p => p.id));
  for (const t of tasks) {
    if (!projectIds.has(t.projectId)) {
      data.projects.push({ id: t.projectId, name: t.projectName, createdAt: new Date().toISOString() });
      projectIds.add(t.projectId);
    }
  }
  for (const t of tasks) {
    if (!data.annotateSets[t.projectId]) data.annotateSets[t.projectId] = [];
    if (!data.annotateSets[t.projectId].find(s => s.id === t.set.id))
      data.annotateSets[t.projectId].push(t.set);
  }

  localStorage.setItem('nuwa-store', JSON.stringify(data));

  console.log('nuwa data restored:', data.projects.length, 'projects,',
    Object.values(data.annotateSets).reduce((s, a) => s + a.length, 0), 'annotate sets');
  console.table(data.projects.map(p => ({
    name: p.name, id: p.id,
    sets: (data.annotateSets[p.id] || []).map(s => s.name).join(', ')
  })));

  location.reload();
})();
