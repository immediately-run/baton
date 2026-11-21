#!/usr/bin/env node
// B-135: local review check for the production job, not a substitute for the forge gate.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const token = /\bCLOUDFLARE_API_TOKEN\b/i;
// A separate --prefix value is an argument, even if the directory is named "ci".
const npmCi = /\bnpm[ \t]+(?:--prefix[ \t]+(?:"[^"\n]*"|'[^'\n]*'|[^\s"';&|]+)[ \t]+|(?!--prefix[ \t])--?[^\s]+[ \t]+)*(?:ci|clean-install|ic|install-clean|isntall-clean)(?=$|[\s;&|<>()])/;

export function check(source) {
  const workflow = parse(source);
  const jobs = Object.entries(workflow?.jobs ?? {});
  const isProduction = (job) => (job?.environment?.name ?? job?.environment) === 'production';
  const errors = [];
  if (token.test(JSON.stringify(workflow?.env))) errors.push('workflow env references the deploy token');
  if (!jobs.some(([, job]) => isProduction(job))) errors.push('no job declares the production environment');

  for (const [id, job] of jobs) {
    if (!isProduction(job)) {
      if (token.test(JSON.stringify(job))) errors.push(`${id}: references the production deploy token`);
      continue;
    }
    if (!Array.isArray(job.steps) || !job.steps.length) {
      errors.push(`${id}: production must declare its steps inline`);
      continue;
    }
    for (const [i, step] of job.steps.entries()) {
      const at = `${id}, step ${i + 1}`;
      if (Object.hasOwn(step.with ?? {}, 'cache') || /^actions\/cache(?:[\/@]|$)/i.test(step.uses ?? '')) {
        errors.push(`${at}: production must not use a cache`);
      }
      if (/^actions\/setup-node@/i.test(step.uses ?? '') && String(step.with?.['package-manager-cache']) !== 'false') {
        errors.push(`${at}: set package-manager-cache to false or omit setup-node`);
      }
      if (npmCi.test(step.run ?? '')) errors.push(`${at}: production must not run npm ci`);
    }
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv[2] ?? new URL('../.github/workflows/baton-deploy.yml', import.meta.url);
  const errors = check(readFileSync(file, 'utf8'));
  for (const error of errors) console.error(`check-baton-deploy: ${error}`);
  if (errors.length) process.exitCode = 1;
  else console.log('check-baton-deploy: no cache or npm ci found in the production job');
}
