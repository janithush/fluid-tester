# FlowMetrics - Automotive Fluid Diagnostic Station

Dual-probe, offline-first fluid quality analyzer for automotive workshops: an ESP32-S3 drives an FDC2214 capacitive engine-oil probe and a UART-linked Arduino brake-fluid moisture probe, broadcasts live telemetry over WebSocket, and hosts the entire diagnostic dashboard from flash (LittleFS) on its own SoftAP - no internet, no cloud, no external dependencies.

```
 [ Arduino (brake probe) ]        [ FDC2214 (engine probe) ]
    │ UART 9600 8N1                 │ I2C Wire1 (SDA 8 / SCL 9)
    ▼                               ▼
 ┌───────────────────────  ESP32-S3  ───────────────────────┐
 │  calibrates pF → dielectric · parses UART grammar        │
 │  AsyncWebServer (LittleFS)  +  /ws WebSocket stream      │
 │  SoftAP "FluidTester_Network" @ 192.168.4.1 (+ mDNS)     │
 │  20x4 I2C LCD (status headless) · physical trigger btn   │
 └──────────────────────────────────────────────────────────┘
        │ served from LittleFS flash          │ WS frames
        ▼                                     ▼
   tablet / phone @ http://192.168.4.1      500 ms snapshots
   (React dashboard)                        + 1 s heartbeats
```

## Repository Architecture

```
fluid-tester/
├── firmware/esp32/main.ino      ESP32-S3 firmware: sensor drivers, UART parser,
│                                JSON wire contract, WS broadcast, SoftAP + LittleFS
├── web/                         React 18 · Vite 5 · TypeScript · Tailwind · Vitest
│   ├── src/lib/                 Pure core: results mapper, fluid profiles, exports,
│   │                            IndexedDB history, form validation, PDF pipeline
│   ├── src/hooks/               useFluidStream - live socket state machine
│   │                            (connect/reconnect backoff, staleness watchdog)
│   ├── src/components/          Vehicle form, fluid cards, profile selector,
│   │                            history strip (SVG sparklines), print bar
│   └── src/test/                14 suites / 170 tests incl. firmware contract
│                                replicas and full-<App/> integration suites
├── tools/mock_esp32.cjs         Zero-dependency Node.js ESP32 simulator
│                                (serves web/dist + /ws - dev without hardware)
├── INDUSTRY_FEATURE_ROADMAP.md  Feature discovery & phased implementation plan
├── FULL_SYSTEM_AUDIT_REPORT.md  Line-level cross-audit (revisions 1-3)
└── .github/workflows/ci.yml     CI: lint + tests + build (working-directory: web)
```

**Bundle discipline (LittleFS/SoftAP constraint):** the core app JS is ~97.7 kB raw / **~29.5 kB gzip** and the React vendor chunk ~45.6 kB gzip - roughly half the 120 kB gzip core budget. The PDF generator is lazily split into its own chunk (`pdf-*.js`, 398.7 kB raw) and only fetched when an operator clicks *Generate Report*. Zero chart libraries; every visualization is hand-rolled SVG.

## Wire Contract (single source of truth)

`GET /api/data` and every `{kind:"snapshot"}` WS frame carry the nested JSON shape:

```
brake_oil  : { moisture: string | null, status, resistance: planned }
engine_oil : { dielectric, capacitance, water: "YES"|"NO"|null,
               tbn, tan, viscosity, status }     // all gated on a real measurement
coolant    : { ph: null, status: "NO_DATA" }     // pH sensor not wired in this revision
```

Semantics enforced by contract tests (`web/src/test/esp32-*-contract.test.ts`, `esp32-engine-firmware.test.ts`):

- **`null` means "not measured".** The mapper renders `null` as the honest "No measurement yet" `NO_DATA` card - never a fabricated `0.00`.
- UART grammar accepted by the firmware: `RESULT,<m>,<r>,<status>` CSV, `Moisture: 1% | Status: NORMAL` pipe, multi-line prefixes, with `Status:`-label stripping and a moisture-derived fallback (`getBrakeStatusFromMoisture`) when a line carries no status.
- LCD human statuses (`EXCELLENT`, `GOOD/SVC DUE`, `WATER DETECT`, `EMPTY TUBE/ERR`) flow through verbatim (`rawStatus`) into closed-enum safety colors on the web.

## Engine Oil Calibration & GPIO 14 Controls

### FDC2214 calibration (post-wire assembly)

| Parameter | Value |
| --- | --- |
| `refRaw` | `13,335,538.0` counts |
| `refPF` / `emptyPF` | `11.8 pF` |
| `slope_a` | `-1.220703125e-5 pF/count` |
| `pfPerEr` | `0.875 pF` per `1.0 Er` |
| `REG_SETTLECOUNT_CH1` | `0x64` (100 counts) |

The firmware converts each 28-bit raw reading to capacitance and then to dielectric constant:

```text
cap = refPF + slope_a * (raw - refRaw)
Er  = 1.0 + ((avgCapacitance - emptyPF) / pfPerEr)
```

`emptyPF` is defined as `refPF`, so an empty tube reads as `Er = 1.0` at the calibrated raw baseline. The 20-sample average retains the `avgCapacitance < 0.5 -> 0.0` and `Er < 1.0 -> 1.0` sanity clamps.

### Button wiring and operation

- **Wiring:** momentary push button between GPIO 14 and GND. Active-LOW with the ESP32-S3 internal `INPUT_PULLUP` enabled; no external resistors.
- **Single click:** arms continuous engine-oil measurement, sampling every 1000 ms.
- **Double click:** stops the measurement loop immediately.
- **Responsiveness:** the 20-sample acquisition loop services `handleButton()` every 2 ms, so a double-click STOP is not swallowed.
- **Telemetry freeze:** STOP preserves the last valid LCD and web readings until the next measurement session starts.
- **Fault handling:** if the I2C/FDC2214 path returns zero valid samples, the engine-oil status is reported as `EMPTY TUBE/ERR`.

## Architectural Remediation (solved defects)

| ID | Defect | Resolution |
| --- | --- | --- |
| R1 | **Data truthfulness** - firmware fabricated `dielectric: 0.00`, `capacitance: 0.00`, `water: "NO"` before any measurement | All engine fields gated behind `webEngineMeasurementTaken`; the wire emits `null` (honest `NO_DATA`) until the operator triggers a real sampling cycle |
| R2 | **Brake parser corruption** - pipe-format frames stored `"Status: NORMAL"` (label included) as the status, collapsing to `UNKNOWN` on the web | Leading `Status:`/`status:` label stripped; empty status halves derive the grade from the moisture percentage |
| R5 | **Serial starvation** - the ~400 ms FDC2214 sampling window could overflow the default 256-byte UART RX ring buffer | `Serial1.setRxBufferSize(1024)` set explicitly *before* `begin()` (API-correct for arduino-esp32 cores) |
| R3 | **Zero end-to-end liveness** - a silently dead socket froze the UI under "Signal Live" forever | Firmware emits 1 s `{kind:"heartbeat", ts}` frames; the browser watchdog marks the feed amber **Signal Stale** after 15 s of silence |
| R13 | **Hardcoded host** - `fluidtester.local` broke every non-mDNS client, including plain `192.168.4.1` | WS/HTTP base derived from `window.location` (SoftAP IP, mDNS or any LAN IP all work) |
| R11 | **Empty status labels shipped on the wire** | CSV / pipe / multi-line branches derive a status locally instead of emitting `""` |
| UI | **Stream stop wedged the state machine** (`stop()` never landed on `idle`), **infinite render loop** from a per-render validation object in the vehicle form, **double-dial of the socket**, **double-click PDF spam** | `stop()` → `status:'idle'` with frozen data retained + "Resume Reading"; validation memoized; connect guard; `isGenerating` guard around `generateReport` |
| Regex | **Plate contract too strict** - `WP-CAB-1234` / `CAB 1234` rejected | `VEHICLE_NUMBER_REGEX = /^[A-Za-z0-9 -]{3,15}$/`, uppercase-normalized on input, PDF filename-safe |

## Industry-Grade Features (Tier 1)

### F1 - Fluid Threshold Profiles
Workshops quote fluid condition against a spec sheet, not an absolute scale. The dashboard carries seeded profiles - **Brake:** DOT 3 (warn ≥2%, crit ≥3%), DOT 4, DOT 5.1 (warn ≥3%, crit ≥4%); **Engine:** Mineral 20W-50 (baseline Er 2.15), Semi-Synthetic 10W-40 (2.25), Full Synthetic 5W-30 (2.35). A pure evaluator re-grades the raw readings per selected profile and renders an advisory badge next to the device's own LCD-derived status pill - the firmware contract stays untouched, and an absolute Er ≥ 2.80 water-intrusion limit overrides all baselines.

### F4 - Offline Vehicle History & SVG Wear Trends
Every completed session (stream STOP with frozen data) is persisted once into browser-native **IndexedDB** (`flowmetrics_db` → `runs`, indexed on `vehicleNumber` + `createdAt`) with the verbatim wire snapshot, mapped cards, km reading and profile linkage. Typing a plate surfaces past runs (trimmed, case-insensitive) with per-fluid verdict chips and a **full-width responsive SVG sparkline** (dot markers, km-proportional X axis, `preserveAspectRatio="none"`, zero chart libraries) tracking dielectric and moisture progression across odometer intervals. A fresh save bumps a refresh key so the trend updates instantly.

### F5 - Multi-Format Session Exports
Alongside the customer PDF, frozen sessions export in one click to **`Export CSV`** (9-column fleet-spreadsheet row per fluid with RFC 4180 escaping) and **`Export JSON`** (timestamped raw payload), both enabled whenever a completed measurement exists.

### F2/F3/F6/F7/F8 (roadmapped)
Air-calibration wizard with NVS persistence, sensor noise index (std-dev of the existing 20-sample loop), technician checklist in the PDF, PWA install manifest, device vitals and brake resistance on the wire - specified and phased in `INDUSTRY_FEATURE_ROADMAP.md`.

## Getting Started

### Test without hardware (simulator first)

```bash
cd web
npm install              # npm ci is currently out of sync with the lock file; use install
npm run build            # produces web/dist (the simulator serves this)

cd ..
node tools/mock_esp32.cjs
# → http://localhost:4173  (mock snapshot stream on /ws, no physical ESP32 needed)
```

The simulator is a single-file, zero-dependency Node server that serves the built dashboard and replays the firmware wire contract over `/ws`. If scripts were blocked by npm's default policy, run `node node_modules/esbuild/install.js` once.

### Run the test suite

```bash
cd web
npm test -- --run        # 14 suites / 170 tests - contract tests pin the JSON field order
npm run lint
npm run build
```

### Deploy to physical hardware

1. Flash the firmware: open `firmware/esp32/main.ino` in the Arduino IDE with the ESP32-S3 board package; required libraries: `ESPAsyncWebServer`, `AsyncTCP`, `LiquidCrystal_I2C` (plus bundled `WiFi`, `LittleFS`).
2. Build and upload the frontend to flash: `cd web && npm install && npm run build`, then upload `web/dist/` contents to the LittleFS partition (via `pio run -t uploadfs` or the Arduino IDE LittleFS upload tool) so the device serves `/index.html` and hashed assets.
3. Connect any device to the SoftAP (`FluidTester_Network`) and open `http://192.168.4.1` - mDNS (`fluidtester.local`) also resolves where supported.
4. Hardware map: FDC2214 on Wire1 (SDA GPIO 8 / SCL GPIO 9, addr `0x2A`), brake Arduino on `Serial1` RX GPIO 17 @ 9600 8N1, LCD on Wire0 (GPIO 4/5, addr `0x27`), engine-oil momentary button between GPIO 14 and GND (active-LOW, internal pull-up, no external resistors).

## Engineering Discipline

- **Contract-first:** firmware JSON field order is pinned by tests; additive wire fields are design-reviewed against the pinned prefix.
- **Protected PDF pipeline:** `pdf-report.ts` + the `manualChunks` isolation are composition-locked - features extend it via optional parameters only, with the existing PDF tests as the regression gate.
- **Honest data everywhere:** `noData` / `hasError` are first-class states on wire, cards, exports and history records; nothing is ever substituted with a plausible-looking placeholder value.
- **CI:** lint + full suite + production build on every push, executed inside `web/`.

## Documentation Map

- `FULL_SYSTEM_AUDIT_REPORT.md` - full line-level audit (revisions 1-3), defect matrix and closure evidence.
- `INDUSTRY_FEATURE_ROADMAP.md` - Tier 1-3 feature discovery, bundle-budget ledger and phased plan.
