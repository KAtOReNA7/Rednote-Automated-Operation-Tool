import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Issue 017 CDP real-browser recovery harness', () => {
  it('uses isolated dynamic Chrome and Edge sessions without a wildcard CDP origin', () => {
    const harness = source('scripts/run-clipper-real-smoke.mjs');
    expect(harness).toContain("'--remote-debugging-port=0'");
    expect(harness).toContain("'--remote-debugging-address=127.0.0.1'");
    expect(harness).toContain('DevToolsActivePort');
    expect(harness).toContain("'Extensions.loadUnpacked'");
    expect(harness).toContain("'Extensions.getExtensions'");
    expect(harness).toContain("'Browser.getVersion'");
    expect(harness).not.toContain("'Extensions.triggerAction'");
    expect(harness).not.toContain("'--remote-allow-origins=*'");
    expect(harness).not.toMatch(/[A-Z]:\\\\(?:Program Files|Users)\\/u);
  });

  it('uses CDP for page facts and an OS shortcut only for the real action gesture', () => {
    const harness = source('scripts/run-clipper-real-smoke.mjs');
    const action = source('scripts/trigger-clipper-action.ps1');
    expect(harness).toContain("'Runtime.evaluate'");
    expect(harness).toContain("'Target.activateTarget'");
    expect(harness).toContain("'DOM.querySelector'");
    expect(harness).toContain("'Input.dispatchMouseEvent'");
    expect(harness).toContain("'Input.insertText'");
    expect(action).toContain('SetForegroundWindow');
    expect(action).toContain('SendInput');
    expect(action).toContain("ValidateSet('chrome', 'edge')");
    expect(action).toContain('AutomationElement');
    expect(action).toContain('[char]0x63a8');
    expect(action).toContain('Invoke-VisibleElement');
    expect(action).not.toMatch(/AddressBar|LocationURL|window\.title|OCR/iu);
  });

  it('never persists or logs pairing codes, tokens, page text, or screenshot bodies', () => {
    const harness = source('scripts/run-clipper-real-smoke.mjs');
    expect(harness).not.toMatch(/writeFile\([^)]*(?:pairing|token|selectedText|screenshotData)/su);
    expect(harness).not.toMatch(
      /(?:console|stdout)\.(?:log|write)\([^)]*(?:pairingCode|token|selectedText)/su,
    );
    expect(harness).not.toContain('Extensions.getStorageItems');
    expect(harness).toContain('credentialsWrittenToDisk: false');
  });

  it('covers idempotency, offline behavior, managed screenshots, and zero downstream work', () => {
    const harness = source('scripts/run-clipper-real-smoke.mjs');
    expect(harness).toContain('replayOne.ok.receipt.clipId === replayTwo.ok.receipt.clipId');
    expect(harness).toContain('桌面应用当前离线');
    expect(harness).toContain('browserClipRuntime.readScreenshot');
    expect(harness).toContain('counts.jobs === 0');
    expect(harness).toContain('counts.fetch_runs === 0');
    expect(harness).toContain('counts.model_runs === 0');
  });
});
