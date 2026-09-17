# Developing ManualDock

ManualDock runs locally as a Chrome Manifest V3 extension. Its runtime has no Node.js, CDN, remote service, or model dependency. Development uses Node.js 22, Python 3, and an isolated Playwright Chromium profile.

## Components

`profiles.js` validates declarative calibration rules and task identities. `manual-adapters.js` discovers contents and proves that navigation reached a chapter. `browser-io.js` coordinates the authorized source tab; `capture.js` extracts and cleans article content. `engine.js` processes the queue, `task-store.js` saves checkpoints, and `recovery.js` with `auto-retry.js` controls retry classification and timing. Saved schema and adapter identifiers remain stable so updates can reuse existing profiles and progress.

`navigation-discovery.js` finds candidates in the current management page. `navigation-rotation.js` validates targets and runs a separately started navigation sequence. The default is off. No component may infer that documentation examples or arbitrary configuration buttons are navigation.

`openapi.js` parses specifications using the local YAML bundle. `core.js` supplies shared export formats. The extension deliberately keeps API documentation import separate from executing API operations.

## Run checks and package

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
npm run test:openapi:browser
python3 scripts/package_release.py
```

`npm run build:openapi` rebuilds the local YAML parser after a dependency change; retain its license. Browser checks grant localhost access only to a temporary extension copy. They never use a personal browser profile or a real device session.

The packaging script selects runtime files explicitly, synchronizes the companion Skill's assets, checks for local paths and private device addresses, and writes `manualdock-v0.2.0.zip`. Installing the Skill does not install the Chrome extension. A development workspace containing private evidence can use `python3 scripts/prepare_public.py` to produce a separate public source directory from a reviewed allowlist. The script does not initialize Git or publish anything.

The public source deliberately omits obsolete standalone controllers and tests tied to private device snapshots. Generic capture, directory, recovery, navigation, archive, specification, and browser checks remain available. Review [validation boundaries](validation.md) before interpreting a green run as support for an unfamiliar device.

测试也可设置 `MANUALDOCK_CHROMIUM_EXECUTABLE` 指向已安装的测试用 Chromium。测试始终创建隔离的临时浏览器资料目录，不复用日常 Chrome 登录状态；未设置时使用 Playwright 默认浏览器。
