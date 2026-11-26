import { resolve } from 'node:path';
import ts from 'typescript';

const nodeTests = 'tsconfig.test-node.json';
const workerTests = 'tsconfig.test.json';
const projects = ['tsconfig.json', 'tsconfig.node.json', 'tsconfig.local.json', 'tsconfig.dashboard.json', nodeTests, workerTests];
export const diagnosticHost = {
  getCanonicalFileName: (path) => path,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => ts.sys.newLine,
};

export function readProjects(root) {
  const parsed = new Map(projects.map((project) => {
    const config = ts.getParsedCommandLineOfConfigFile(resolve(root, project), {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        throw new Error(ts.formatDiagnostics([diagnostic], diagnosticHost));
      },
    });
    if (config.errors.length) throw new Error(ts.formatDiagnostics(config.errors, diagnosticHost));
    return [project, config];
  }));
  // Vitest's existing Node-only roster has one home: the Node test config's `files`.
  // Subtract those roots (and its Node harness/load roots) from the Worker test project.
  const nodeRoots = new Set(parsed.get(nodeTests).fileNames);
  const worker = parsed.get(workerTests);
  worker.fileNames = worker.fileNames.filter((file) => !nodeRoots.has(file));
  return parsed;
}
