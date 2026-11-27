import { resolve } from 'node:path';
import ts from 'typescript';
import { diagnosticHost, readProjects } from './lib/typeProjects.mjs';

for (const [project, { fileNames, options, projectReferences }] of readProjects(resolve(import.meta.dirname, '..'))) {
  const program = ts.createProgram({ rootNames: fileNames, options: { ...options, noEmit: true }, projectReferences });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    console.error(`${project}:\n${ts.formatDiagnostics(diagnostics, diagnosticHost)}`);
    process.exitCode = 1;
  }
}
