import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
const extensionURL = 'chrome-extension://test-extension/';

function clickAction(tab) {
  let onClicked;
  const opened = [];
  runInNewContext(source, {
    URL,
    chrome: {
      action: { onClicked: { addListener: listener => { onClicked = listener; } } },
      runtime: { getURL: path => extensionURL + path },
      tabs: {
        create: options => { opened.push(options.url); },
        query: () => { throw new Error('must not enumerate browser tabs'); },
        update: () => { throw new Error('must not navigate the authorized source tab'); },
      },
      scripting: { executeScript: () => { throw new Error('routing must not execute anything on the source page'); } },
    },
  });
  assert.equal(typeof onClicked, 'function');
  onClicked(tab);
  return opened;
}

test('every supported source including framework.php opens the independent universal panel for that tab', () => {
  for (const url of ['https://manual.test/framework.php', 'http://manual.test:8443/framework.php?view=policy#section']) {
    assert.deepEqual(clickAction({ id: 42, url }), [extensionURL + 'panel.html?tab=42']);
  }
});

test('adocs.php retains the existing importer panel and does not forward source query values', () => {
  for (const url of ['https://manual.test/adocs.php', 'https://manual.test/adocs.php?index=9&dataID=api-menu-item50']) {
    assert.deepEqual(clickAction({ id: 7, url }), [extensionURL + 'panel.html?tab=7']);
  }
});

test('other pages and unavailable URLs retain the importer panel error flow', () => {
  for (const url of [undefined, '', 'not a URL', 'https://manual.test/login.php', 'https://manual.test/path/framework.php', 'https://manual.test/adocs.php?next=/framework.php', 'chrome://settings/framework.php']) {
    assert.deepEqual(clickAction({ id: 8, url }), [extensionURL + 'panel.html?tab=8']);
  }
});

test('an action without an actual source tab opens no page', () => {
  assert.deepEqual(clickAction({ url: 'https://manual.test/framework.php' }), []);
  assert.deepEqual(clickAction({ id: 0, url: 'https://manual.test/framework.php' }), []);
});
