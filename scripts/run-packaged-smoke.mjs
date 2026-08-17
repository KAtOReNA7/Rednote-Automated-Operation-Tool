import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses';

import {
  allocateLoopbackPort,
  assertCommonReport,
  assertPortReleased,
  assertProcessesExited,
  assertSocketSnapshot,
  createSmokeProcessCollector,
  inspectControlledProcesses,
  recordObservationStage,
  waitForExit,
  waitForSmokeReport,
} from './issue011-smoke-support.mjs';
import {
  assertIssue013CapabilityFixture,
  startIssue013CapabilityFixture,
} from './issue013-capability-smoke-fixture.mjs';
import { createPortableTemp } from './portable-temp.mjs';
import { R08_EXPERIENCE_FILES } from './package-contract.mjs';
import { startR07PackagedProviderFixture } from './r07-packaged-provider-fixture.mjs';

const projectRoot = resolve(import.meta.dirname, '..');

function seedLegacyR07ReadinessFixture(smokeWorkspace) {
  const databasePath = join(
    smokeWorkspace,
    'userData 中文 空格',
    'v2-project-data',
    'database',
    'rednote.sqlite',
  );
  const database = new DatabaseSync(databasePath);
  try {
    const changed = database
      .prepare(
        `UPDATE app_settings
         SET setup_state = 'PROVIDER_CONFIG_INCOMPLETE',
             revision = revision + 1,
             updated_at = ?
         WHERE id = 'app'
           AND provider_base_url IS NOT NULL
           AND research_model_id IS NOT NULL
           AND writing_model_id IS NOT NULL
           AND review_model_id IS NULL
           AND credential_reference = 'CONTENT_AI_API_KEY'`,
      )
      .run(new Date().toISOString()).changes;
    const state = database
      .prepare(
        `SELECT credential_reference, research_model_id, review_model_id, setup_state, writing_model_id
         FROM app_settings WHERE id = 'app'`,
      )
      .get();
    if (
      changed !== 1 ||
      state?.setup_state !== 'PROVIDER_CONFIG_INCOMPLETE' ||
      state.review_model_id !== null ||
      state.credential_reference !== 'CONTENT_AI_API_KEY' ||
      state.research_model_id === null ||
      state.writing_model_id === null
    )
      throw new Error('R07 legacy readiness fixture was not established.');
  } finally {
    database.close();
  }
}

async function assertV2R04Export(smokeWorkspace) {
  const exportRoot = join(smokeWorkspace, 'userData 中文 空格', 'v2-project-data', 'exports', 'v2');
  const exportNames = await readdir(exportRoot);
  if (exportNames.length !== 1 || !/^r04-[a-f0-9]{24}$/u.test(exportNames[0]))
    throw new Error('V2-R04 smoke must produce one opaque export directory.');
  const directory = join(exportRoot, exportNames[0]);
  const manifestText = await readFile(join(directory, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.aiDisclosure !== false ||
    manifest.packages?.length !== 3 ||
    manifestText.includes(smokeWorkspace) ||
    /secret|pinnedComment|置顶评论/iu.test(manifestText)
  )
    throw new Error('V2-R04 export manifest is invalid.');
  const expectedNames = [
    'body.txt',
    'cover.png',
    'material-notes.txt',
    'suggested-time.txt',
    'tags.txt',
    'title.txt',
  ];
  for (const item of manifest.packages) {
    const files = Object.values(item.files ?? {});
    const child = String(files[0]?.path ?? '').split('/')[0];
    if (
      files.length !== 6 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(item.suggestedTime) ||
      (await readdir(join(directory, child))).sort().join('\n') !== expectedNames.join('\n')
    )
      throw new Error('V2-R04 package shape is invalid.');
    for (const file of files) {
      if (
        typeof file.path !== 'string' ||
        isAbsolute(file.path) ||
        file.path.includes('..') ||
        file.path.includes('\\') ||
        !/^[a-f0-9]{64}$/u.test(file.sha256)
      )
        throw new Error('V2-R04 export contains an unsafe file reference.');
      const bytes = await readFile(join(directory, file.path));
      if (
        bytes.length === 0 ||
        createHash('sha256').update(bytes).digest('hex') !== file.sha256 ||
        !(await stat(join(directory, file.path))).isFile()
      )
        throw new Error('V2-R04 exported file failed verification.');
    }
  }
  const startHere = await readFile(join(directory, 'START-HERE.txt'), 'utf8');
  if (
    !startHere.includes(
      '这是本地发布包，最终需由用户在小红书官方端手动发布；系统未登录或操作平台。',
    )
  )
    throw new Error('V2-R04 manual-publishing boundary is missing.');
  return { exportId: exportNames[0], packageCount: manifest.packages.length };
}
const outputDirectory = join(projectRoot, 'out');
const packageNames = (await readdir(outputDirectory)).filter((name) => name.endsWith('-win32-x64'));
if (packageNames.length !== 1) {
  throw new Error('Expected exactly one packaged Windows x64 application directory.');
}

const packageDirectory = join(outputDirectory, packageNames[0]);
const executablePath = join(packageDirectory, 'RednoteMysteryOperations.exe');
const resourcesPath = join(packageDirectory, 'resources');
const appAsar = join(resourcesPath, 'app.asar');
const unpackedApp = join(resourcesPath, 'app');

await stat(executablePath);
await stat(appAsar);
const [v2Launcher, legacyLauncher, checklist] = await Promise.all([
  readFile(join(packageDirectory, R08_EXPERIENCE_FILES.defaultLauncher), 'utf8'),
  readFile(join(packageDirectory, R08_EXPERIENCE_FILES.legacyLauncher), 'utf8'),
  readFile(join(packageDirectory, R08_EXPERIENCE_FILES.checklist), 'utf8'),
]);
if (
  !v2Launcher.includes('%~dp0RednoteMysteryOperations.exe') ||
  /--(?:legacy|v2)-shell/u.test(v2Launcher) ||
  (legacyLauncher.match(/--legacy-shell/gu) ?? []).length !== 1 ||
  legacyLauncher.includes('--v2-shell') ||
  !checklist.startsWith('Rednote Studio V2-R08 精确构建体验清单') ||
  !checklist.includes('PR 保持 Draft，禁止提前合并。') ||
  (process.env.REDNOTE_EXACT_HEAD_SHA !== undefined &&
    !checklist.includes(process.env.REDNOTE_EXACT_HEAD_SHA))
) {
  throw new Error('Packaged V2 launchers or exact-head checklist are invalid.');
}
try {
  await stat(unpackedApp);
  throw new Error('Packaged application contains an unpacked resources/app directory.');
} catch (error) {
  if (error instanceof Error && !('code' in error && error.code === 'ENOENT')) {
    throw error;
  }
}

const fuses = await getCurrentFuseWire(executablePath);
if (
  fuses.version !== FuseVersion.V1 ||
  fuses[FuseV1Options.RunAsNode] !== FuseState.DISABLE ||
  fuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable] !== FuseState.DISABLE ||
  fuses[FuseV1Options.EnableNodeCliInspectArguments] !== FuseState.DISABLE ||
  fuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] !== FuseState.ENABLE ||
  fuses[FuseV1Options.OnlyLoadAppFromAsar] !== FuseState.ENABLE
) {
  throw new Error('Packaged executable does not carry the required Electron fuse policy.');
}

const childEnvironment = { ...process.env };
delete childEnvironment.DESKTOP_DEV_SERVER_URL;
delete childEnvironment.ELECTRON_RUN_AS_NODE;
delete childEnvironment.NODE_OPTIONS;

const results = [];
const r07BlackboxOnly = process.env.REDNOTE_R07_BLACKBOX_ONLY === '1';
if (!r07BlackboxOnly) {
  for (const mode of ['disabled', 'enabled']) {
    const temporary = await createPortableTemp(projectRoot, `packaged-smoke-${mode}`);
    const capabilityFixture = await startIssue013CapabilityFixture();
    const port = await allocateLoopbackPort();
    const outputPath = join(temporary.root, `issue006-smoke-${randomUUID()}.json`);
    const smokeWorkspace = await mkdtemp(join(temporary.root, 'rednote-issue010-smoke-'));
    const modeEnvironment = {
      ...childEnvironment,
      ...temporary.env,
    };
    const child = spawn(
      executablePath,
      [
        '--issue006-smoke',
        '--legacy-shell',
        `--issue006-smoke-output=${outputPath}`,
        `--issue010-smoke-workspace=${smokeWorkspace}`,
        `--issue011-smoke-mode=${mode}`,
        `--issue011-smoke-port=${port}`,
        `--issue013-smoke-port=${capabilityFixture.port}`,
      ],
      {
        cwd: packageDirectory,
        env: modeEnvironment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const processCollector = createSmokeProcessCollector(child.pid);
    const stdoutEnded = processCollector.attachStream(child.stdout);
    const exitPromise = waitForExit(child);
    try {
      const reportStartedAt = Date.now();
      const report = await waitForSmokeReport(outputPath);
      recordObservationStage('smoke-report-ready', reportStartedAt, { mode, packaged: true });
      assertIssue013CapabilityFixture(capabilityFixture, report);
      const networkProcessIds = await processCollector.waitForStages();
      const snapshot = await inspectControlledProcesses(networkProcessIds);
      const socketStartedAt = Date.now();
      const socketEvidence = assertSocketSnapshot(snapshot, mode, port, capabilityFixture.port);
      recordObservationStage('socket-policy-check', socketStartedAt, {
        mode,
        packaged: true,
        ...socketEvidence,
      });
      const exitStartedAt = Date.now();
      const exitCode = await exitPromise;
      recordObservationStage('electron-exit-wait', exitStartedAt, {
        exitCode,
        mode,
        packaged: true,
      });
      if (exitCode !== 0) {
        throw new Error(
          `Packaged executable smoke exited with ${String(exitCode)} and report ${JSON.stringify(report)}: ${stderr}`,
        );
      }
      await stdoutEnded;
      const finalProcessIds = processCollector.finish();
      assertCommonReport(report, true, mode, port);
      await assertProcessesExited(finalProcessIds);
      await assertPortReleased(port);
      results.push({
        mode,
        ...socketEvidence,
        portReleased: true,
        processCount: finalProcessIds.length,
        processesExited: true,
      });
    } finally {
      if (child.exitCode === null) {
        child.kill();
        await exitPromise.catch(() => undefined);
      }
      await capabilityFixture.close();
      await rm(outputPath, { force: true });
      await rm(smokeWorkspace, {
        force: true,
        maxRetries: 20,
        recursive: true,
        retryDelay: 100,
      });
      await temporary.cleanup();
    }
  }

  {
    const temporary = await createPortableTemp(projectRoot, 'packaged-smoke-v2');
    const smokeWorkspace = await mkdtemp(join(temporary.root, 'rednote-issue010-smoke-'));
    try {
      for (const attempt of [1, 2]) {
        const outputPath = join(temporary.root, `issue006-smoke-${randomUUID()}.json`);
        const child = spawn(
          executablePath,
          [
            '--issue006-smoke',
            `--issue006-smoke-output=${outputPath}`,
            `--issue010-smoke-workspace=${smokeWorkspace}`,
          ],
          {
            cwd: packageDirectory,
            env: { ...childEnvironment, ...temporary.env },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          },
        );
        const processCollector = createSmokeProcessCollector(child.pid);
        const stdoutEnded = processCollector.attachStream(child.stdout);
        const exitPromise = waitForExit(child);
        try {
          const report = await waitForSmokeReport(outputPath);
          const processIds = await processCollector.waitForStages();
          const socketEvidence = assertSocketSnapshot(
            await inspectControlledProcesses(processIds),
            'disabled',
            43_119,
            43_120,
          );
          const exitCode = await exitPromise;
          await stdoutEnded;
          const finalProcessIds = processCollector.finish();
          if (
            exitCode !== 0 ||
            report.ok !== true ||
            report.packaged !== true ||
            report.mode !== 'v2' ||
            report.renderer?.navigationCount !== 7 ||
            report.renderer?.mockMode !== false ||
            report.security?.preload !== true ||
            report.runtime?.ipcRegistered !== true ||
            report.runtime?.projectDataRootInitialized !== true ||
            report.runtime?.sqliteInitialized !== true ||
            report.runtime?.v2TableCount !== 8 ||
            report.runtime?.personaRevision !== 0 ||
            report.runtime?.planRevision !== 2 ||
            report.security?.externalRequestAttempts !== 0
          )
            throw new Error(`V2 packaged smoke failed: ${JSON.stringify(report)}`);
          await assertProcessesExited(finalProcessIds);
          const exportEvidence = await assertV2R04Export(smokeWorkspace);
          results.push({
            attempt,
            ...exportEvidence,
            mode: 'v2',
            ...socketEvidence,
            processCount: finalProcessIds.length,
            processesExited: true,
          });
        } finally {
          if (child.exitCode === null) {
            child.kill();
            await exitPromise.catch(() => undefined);
          }
          await rm(outputPath, { force: true });
        }
      }
    } finally {
      await rm(smokeWorkspace, { force: true, maxRetries: 20, recursive: true, retryDelay: 100 });
      await temporary.cleanup();
    }
  }
}

{
  const temporary = await createPortableTemp(projectRoot, 'packaged-r07-blackbox');
  const smokeWorkspace = await mkdtemp(join(temporary.root, 'rednote-issue010-smoke-'));
  const fixture = await startR07PackagedProviderFixture();
  try {
    for (const attempt of [1, 2, 3]) {
      const outputPath = join(temporary.root, `issue006-smoke-${randomUUID()}.json`);
      const child = spawn(
        executablePath,
        [
          '--issue006-smoke',
          `--issue006-smoke-output=${outputPath}`,
          `--issue010-smoke-workspace=${smokeWorkspace}`,
          `--r07-blackbox-port=${fixture.port}`,
          `--r07-blackbox-attempt=${attempt}`,
        ],
        {
          cwd: packageDirectory,
          env: { ...childEnvironment, ...temporary.env },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
      let stderr = '';
      let stdout = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => (stdout += chunk));
      const processCollector = createSmokeProcessCollector(child.pid);
      const stdoutEnded = processCollector.attachStream(child.stdout);
      const exitPromise = waitForExit(child, 75_000);
      try {
        let report;
        try {
          report = await Promise.race([
            waitForSmokeReport(outputPath, 65_000),
            exitPromise.then((code) => {
              throw new Error(`ELECTRON_EXITED:${String(code)}`);
            }),
          ]);
        } catch (error) {
          throw new Error(
            `R07 blackbox report unavailable: ${error instanceof Error ? error.message : 'UNKNOWN'}; requests=${JSON.stringify(fixture.requests)}; stdout=${stdout.slice(0, 1024)}; stderr=${stderr.slice(0, 1024)}`,
            { cause: error },
          );
        }
        if (report.ok !== true) {
          throw new Error(
            `R07 packaged blackbox reported failure: ${JSON.stringify(report)}; requests=${JSON.stringify(fixture.requests)}`,
          );
        }
        const processIds = await processCollector.waitForStages();
        const socketEvidence = assertSocketSnapshot(
          await inspectControlledProcesses(processIds),
          'disabled',
          43_119,
          fixture.port,
        );
        const exitCode = await exitPromise;
        await stdoutEnded;
        const finalProcessIds = processCollector.finish();
        const blackbox = report.renderer?.blackbox;
        if (
          exitCode !== 0 ||
          report.ok !== true ||
          blackbox?.attempt !== attempt ||
          blackbox.buildCommit.length !== 40 ||
          (attempt === 1 ? blackbox.commentPersisted : !blackbox.commentPersisted) ||
          (attempt === 1 ? blackbox.directMessagePersisted : !blackbox.directMessagePersisted) ||
          (attempt === 1 ? blackbox.contentCount !== 0 : blackbox.contentCount !== 3) ||
          blackbox.imageRequestCount !== 0 ||
          (attempt === 1 ? blackbox.previewCanConfirm : !blackbox.previewCanConfirm) ||
          (attempt === 1
            ? blackbox.previewRequestCount !== 0
            : blackbox.previewRequestCount !== 3) ||
          blackbox.providerProtocol !== 'CHAT_COMPLETIONS' ||
          report.security?.externalRequestAttempts !== 0
        )
          throw new Error(
            `R07 packaged blackbox failed: ${JSON.stringify(report)} ${stderr.slice(0, 512)}`,
          );
        await assertProcessesExited(finalProcessIds);
        if (attempt === 1) seedLegacyR07ReadinessFixture(smokeWorkspace);
        results.push({
          attempt,
          buildCommit: blackbox.buildCommit,
          mode: 'v2-r07-blackbox',
          ...socketEvidence,
          processCount: finalProcessIds.length,
          processesExited: true,
        });
      } finally {
        if (child.exitCode === null) {
          child.kill();
          await exitPromise.catch(() => undefined);
        }
        await rm(outputPath, { force: true });
      }
    }
    const production = fixture.requests.filter(
      ({ actionKind }) => actionKind !== 'CAPABILITY_PROBE',
    );
    if (
      production.filter(({ actionKind }) => actionKind === 'CONTENT_COPY_VERSION').length !== 3 ||
      production.filter(({ actionKind }) => actionKind === 'REPLY_SUGGESTION').length !== 2 ||
      fixture.requests.some(({ authorizationPresent }) => !authorizationPresent)
    )
      throw new Error(
        `R07 packaged provider request contract failed: ${JSON.stringify(fixture.requests)}`,
      );
  } finally {
    await fixture.close();
    await assertPortReleased(fixture.port);
    await rm(smokeWorkspace, { force: true, maxRetries: 20, recursive: true, retryDelay: 100 });
    await temporary.cleanup();
  }
}

process.stdout.write(
  `${JSON.stringify({ externalConnections: 0, fuses: true, packaged: true, results })}\n`,
);
