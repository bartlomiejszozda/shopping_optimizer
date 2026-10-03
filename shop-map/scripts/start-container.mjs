import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('npm', ['run', 'db:generate']);
run('npm', ['run', 'build']);
const stateDir = join(process.cwd(), '.wrangler', 'state');
mkdirSync(stateDir, { recursive: true });
const markerPath = join(stateDir, 'aisle-applied-migrations.json');
const applied = new Set(existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf8')) : []);
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
for (const migration of journal.entries) {
  if (applied.has(migration.tag)) continue;
  run('node', ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--config', 'dist/server/wrangler.json', '--persist-to', '.wrangler/state', '--file', `drizzle/${migration.tag}.sql`]);
  applied.add(migration.tag);
  writeFileSync(markerPath, JSON.stringify([...applied]));
}
run('npm', ['run', 'dev', '--', '--hostname', '0.0.0.0']);
