import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { createPortableTemp } from './portable-temp.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const temporary = await createPortableTemp(projectRoot, 'vitest');
const vitestEntry = resolve(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');
const vitestArguments = process.argv.slice(2);
const defaultNormalRun = vitestArguments.length === 1 && vitestArguments[0] === 'run';
const observableIndex = vitestArguments.indexOf('--observable');
const observable = observableIndex >= 0 || defaultNormalRun;
if (observableIndex >= 0) vitestArguments.splice(observableIndex, 1);

const suiteIndex = vitestArguments.findIndex((argument) => argument.startsWith('--suite='));
const suite =
  suiteIndex >= 0
    ? vitestArguments[suiteIndex]?.slice('--suite='.length)
    : defaultNormalRun
      ? 'normal'
      : undefined;
if (suiteIndex >= 0) vitestArguments.splice(suiteIndex, 1);
if (suite !== undefined && suite !== 'normal' && suite !== 'capacity') {
  throw new Error('Vitest suite must be normal or capacity.');
}

const childEnvironment = { ...process.env, ...temporary.env };
delete childEnvironment.REDNOTE_VITEST_SUITE;
if (suite !== undefined) childEnvironment.REDNOTE_VITEST_SUITE = suite;

let observation;
if (observable) {
  const observationBase = join(projectRoot, '.rednote-temp', 'validation');
  await mkdir(observationBase, { recursive: true });
  const root = await mkdtemp(join(observationBase, 'vitest-'));
  const relativeRoot = relative(projectRoot, root).replaceAll('\\', '/');
  const resultPath = `${relativeRoot}/results.json`;
  vitestArguments.push('--reporter=default', '--reporter=json', `--outputFile.json=${resultPath}`);
  observation = {
    metadataPath: join(root, 'run.json'),
    startedAt: new Date(),
    stderr: createWriteStream(join(root, 'stderr.log')),
    stdout: createWriteStream(join(root, 'stdout.log')),
  };
  await writeObservation({ status: 'RUNNING' });
  console.log(`[validation] evidence: ${relativeRoot}`);
}

async function writeObservation(values) {
  if (!observation) return;
  await writeFile(
    observation.metadataPath,
    `${JSON.stringify({
      command: ['vitest', ...vitestArguments],
      startedAt: observation.startedAt.toISOString(),
      ...values,
    })}\n`,
  );
}

async function closeObservationStreams() {
  if (!observation) return;
  await Promise.all(
    [observation.stdout, observation.stderr].map(
      (stream) => new Promise((resolveClose) => stream.end(resolveClose)),
    ),
  );
}

let observationFinalized = false;
try {
  const child = spawn(process.execPath, [vitestEntry, ...vitestArguments], {
    cwd: projectRoot,
    env: childEnvironment,
    stdio: observable ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  });
  if (observation) {
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      observation.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      observation.stderr.write(chunk);
    });
  }
  const outcome = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => {
      resolveExit({ code, signal });
    });
  });
  await closeObservationStreams();
  if (observation) {
    const endedAt = new Date();
    await writeObservation({
      durationMilliseconds: endedAt.getTime() - observation.startedAt.getTime(),
      endedAt: endedAt.toISOString(),
      exitCode: outcome.code,
      signal: outcome.signal,
      status: outcome.signal === null ? 'COMPLETED' : 'SIGNALLED',
    });
    observationFinalized = true;
  }
  if (outcome.signal !== null) throw new Error(`Vitest terminated by ${outcome.signal}.`);
  process.exitCode = outcome.code ?? 1;
} catch (error) {
  if (observation && !observationFinalized) {
    await closeObservationStreams();
    const endedAt = new Date();
    await writeObservation({
      durationMilliseconds: endedAt.getTime() - observation.startedAt.getTime(),
      endedAt: endedAt.toISOString(),
      exitCode: 1,
      failureType: error instanceof Error ? error.name : 'UnknownError',
      status: 'HARNESS_ERROR',
    });
  }
  throw error;
} finally {
  await closeObservationStreams();
  await temporary.cleanup();
}
