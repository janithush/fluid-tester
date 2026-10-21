# FULL_SYSTEM_AUDIT_REPORT.md

**System:** FlowMetrics - Fluid Tester (ESP32-S3 `main.ino` + brake-fluid Arduino over UART + React/Vite web dashboard)
**Audit date:** 2026-10-21 (revision 2: firmware now in scope, cross-audit replaces the prior "audit gaps")
**Auditor mode:** Auditor + workspace organizer. **No source logic was modified, fixed, refactored, or committed.** The only changes in this run are (a) workspace restructuring and (b) this report.
**Workspace:** `/home/janithx/projects/fluid-tester` - git state intentionally left dirty/unstaged.

---

## 0. Executive Summary

With the real firmware now available, this revision replaces every previous "unverifiable gap" with line-level cross-audited evidence. The end-to-end pipeline is **architecturally sound** (softAP + LittleFS-hosted SPA + AsyncWebSocket snapshots + strict frontend mapper), but the cross-audit surfaced:

- **1 CRITICAL data-truthfulness defect**: the firmware *fabricates live-looking engine-oil values* (`dielectric: 0.00`, `water: "NO"`, status `UNKNOWN`) whenever no measurement exists - the dashboard therefore never shows the contractually mandated `NO_DATA` state for engine oil, and displays a fake `Dielectric 0.00` while the LCD shows "Ready!". This is a direct LCD-vs-web data discrepancy and a safety-relevant false reading.
- **1 CRITICAL wire-contract bug in the brake parser**: single-line UART frames (`Moisture: 1% | Status: NORMAL`) store the *entire labeled remainder* (`"Status: NORMAL"`) as the status, which the firmware's own normalizer maps to `UNKNOWN` - LCD correct, web wrong, 100% reproducible from the code.
- **Confirmed HIGH: zero end-to-end liveness mechanism.** The firmware sends only `{kind:"snapshot"}` frames - never the `heartbeat` or per-fluid delta frames that `types/fluid.ts:72-77` declares - and the browser discards heartbeats anyway. A silently dead socket freezes the dashboard under a "Signal Live" pill forever.
- **Confirmed HIGH: address contract mismatch** - hardcoded `fluidtester.local` in the web app vs `WiFi.softAP()` (`192.168.4.1`) + mDNS `fluidtester` in firmware. IP-based access (the only guaranteed address) breaks both WS and HTTP unless mDNS resolves.
- **Confirmed HIGH: a 400 ms blocking sampling window inside `loop()`** (`20 x delay(20)`) starves the UART reader (buffer overflow risk at 9600 baud), delays button polling (missed short presses), and stalls the WS tick.
- **The PDF generator is isolated and untouched** (Section 9).

---

## 1. Workspace Restructuring Log (this run's only mutation)

```
fluid-tester/
├── FULL_SYSTEM_AUDIT_REPORT.md     (root, as required - this file)
├── .git/                           (untouched, nothing staged)
├── .gitignore                      (root, untouched - patterns still apply recursively)
├── .github/                        (root, untouched - GitHub requires this path; see M9)
│   └── workflows/ci.yml
├── firmware/
│   └── esp32/
│       └── main.ino                (NEW - verbatim copy of the provided firmware, 706 lines)
├── tools/                          (NEW - empty; `count_braces.py` does NOT exist in the workspace,
│                                    verified by find - nothing to move)
└── web/
    ├── index.html, package.json, package-lock.json, pnpm-lock.yaml, pnpm-workspace.yaml
    ├── vite.config.ts, vitest.config.ts, tsconfig{,.app,.node}.json (+ .tsbuildinfo)
    ├── eslint.config.js, postcss.config.js, tailwind.config.js
    ├── src/ (full React app)
    └── test-output.txt, test-clean.txt, showcase-result.txt  (test evidence artifacts)
```

Notes:
- `count_braces.py` was **not present** anywhere in the workspace pre-move; `tools/` was created per spec and left empty.
- `.github/` was deliberately **not** moved into `web/`: GitHub Actions only reads `.github/` at the repository root. However, `ci.yml` currently runs `npm ci` / `npm run lint` / `npm test` / `npm build` **at the repo root**, and `package.json` now lives in `web/` - **CI is broken by this restructure** until its steps gain `working-directory: web` (flagged as M9; not fixable under this run's zero-edit guardrail).
- `vite.config.ts` / `vitest.config.ts` / `tsconfig*` use relative paths (`./src`), so the app remains self-contained inside `web/`.
- `git status` was checked before this run: restructure changes are working-tree only; **nothing staged, nothing committed**.

---

## 2. End-to-End Data Pipeline Architecture (now fully traceable)

```
 [Brake-fluid Arduino]
   │ UART 9600 8N1 → ESP32 GPIO17 RX (main.ino:137-138), TX disabled (pin -1)
   │ line grammar accepted by firmware readArduinoData() (main.ino:450-503):
   │   "RESULT,<moisture>,<resistance>,<status>"   (CSV, displayBrakeData branch 1)
   │   "Moisture: 1% | Status: NORMAL"             (single-line pipe, branch 2)
   │   "Moisture: …"/"Resist: …"/"Status: …"       (multi-line, branch 3)
   │   "Testing in progress..."                    (header, branch 0)
   │   "CANCEL"/"STOP"                             (operator stop)
   ▼
 ESP32-S3 globals: webBrakeMoisture/Resistance/Status + webBrakeDataReady (111-114)
 FDC2214 (I2C Wire1, 0x2A, pins 8/9) → readRaw_CH1() (669-692) → 20-sample average
   → capacitance/dielectric (main.ino:211-248) → webCapacitance/webDielectric/
     webEngineStatus/webWaterStatus/webEngineMeasurementTaken
 Coolant: NOT wired - hardcoded null + NO_DATA (main.ino:375-377)
        ▼
 buildResultsJson() (334-379) — hand-built JSON string, pinned field order
        ├─▶ HTTP GET /api/data       (main.ino:176-186, CORS preflight 169-175)
        │      served as "application/json", ACAO "*" (addCorsHeaders 283-289)
        └─▶ AsyncWebSocket "/ws"     (main.ino:73, handler 195-196)
              WS_EVT_CONNECT → immediate snapshot (295-302)
              loop() tick every 500 ms → broadcastStreamTick() (271-277, 322-326)
              ONLY frame kind ever emitted: {kind:"snapshot", data:{...}}
        │
        ▼ Browser (SPA served by the ESP32 itself from LittleFS, "/" → /index.html, 187-192)
 useFluidStream.ts:65  new WebSocket('ws://fluidtester.local/ws')   ← hardcoded host (C4)
        ws.onmessage → JSON.parse → applyFrame() (92-145)
        ▼ mapAllResults (results-mapper.ts:218-226) ▼ FluidResultCard (fluid-card.tsx:22)
        ▼ DOM cards + status pills
        ▼ PDF path (protected, decoupled): App.tsx:67-86 → pdf-report.ts → jsPDF chunk

 LCD path (parallel, out of web band): displayBrakeData()/engine-oil rows (main.ino:507-612, 250-260)
   + showReadyScreen() (639-658) — uses RAW human strings ("EXCELLENT", "GOOD/SVC DUE",
   "WATER DETECT", "NORMAL") with no web normalization.
```

**Structural observations:**
- There is **no delta/heartbeat emission and no change detection** on the wire - every tick ships a full snapshot even when nothing changed (322-326). The web's delta-merge branches (`useFluidStream.ts:101-140`) and heartbeat logic (:93) are dead code in this deployment.
- The dashboard is single-transport: `App.tsx` never calls `fetchFluidResults()` (`api.ts` is exercised only by tests) - the HTTP `/api/data` route is effectively a manual/health endpoint.

---

## 3. Cross-Layer Mismatch Matrix (firmware ⇄ web)

| # | Contract element | Firmware (main.ino) | Web | Verdict | Consequence |
|---|---|---|---|---|---|
| X1 | WS path `/ws` | `main.ino:73` | `useFluidStream.ts:65` | **MATCH** | - |
| X2 | WS host | softAP (`main.ino:162`, default 192.168.4.1) + `MDNS.begin("fluidtester")` (:166) | hardcoded `ws://fluidtester.local/ws` (:65), `http://fluidtester.local/api/data` (`api.ts:19`) | **MISMATCH - HIGH (C4)** | If the operator browses via `192.168.4.1` (softAP fallback IP printed at :164) or via any LAN alias, the hardcoded `.local` name must resolve; on Android hotspots/many APs mDNS is unreliable → dashboard never connects while LCD works. Scheme locked to `ws://`/`http://` (fine on softAP http, fatal under any https host). |
| X3 | WS frame kinds | **only** `{kind:"snapshot"}` ever sent (`main.ino:300, 324`) | `WsFrame` union declares `snapshot`/`brake_oil`/`engine_oil`/`coolant`/`heartbeat` (`types/fluid.ts:72-77`) | **MISMATCH - HIGH (C3)** | Delta/heartbeat branches in the hook are dead code; no liveness signal exists in either direction. Silent socket death ⇒ frozen table under "Signal Live" (App.tsx:143-147). |
| X4 | Snapshot envelope `{kind,data}` | `main.ino:300, 324` | `useFluidStream.ts:99-100` | **MATCH** | Immediate connect snapshot satisfies the "first frame is a snapshot" expectation; the previous provisional H4 (no leading-snapshot timeout) is **downgraded to LOW**. |
| X5 | `brake_oil.moisture: string` | `main.ino:342-345` - quoted `"1%"` | `results-mapper.ts:53-87` expects string | **MATCH** | - |
| X6 | `brake_oil.status` (multi-line path) | colon-stripped: `main.ino:588-599` → `"NORMAL"` → normalized `"GOOD"` | `ALLOWED_STATUSES` includes GOOD/NORMAL (`results-mapper.ts:36-45`) | **PARTIAL** | Value flows, but the *label the operator sees changes*: LCD shows `NORMAL`, web shows `GOOD` (status-colors.ts:97-98 maps both to green). Cosmetic drift. |
| X7 | `brake_oil.status` (single-line pipe path) | `main.ino:568`: `webBrakeStatus = statusPart` where `statusPart` = `"Status: NORMAL"` (label never stripped, unlike moisture at :567) | `normalizeStatusForFrontend("Status: NORMAL")` (main.ino:381-398) → no exact match, uppercase `"STATUS: NORMAL"` ≠ `GOOD`/`NORMAL` → **`"UNKNOWN"`** | **MISMATCH - CRITICAL (C2)** | Web shows gray `UNKNOWN` while LCD prints `Status: NORMAL` (:565). 100% reproducible; this is the flagship LCD-vs-web discrepancy. |
| X8 | Out-of-enum LCD statuses (`EXCELLENT`, `GOOD/SVC DUE`, `WATER DETECT`, `EMPTY TUBE/ERR`) | normalize passthrough returns them unchanged (`main.ino:383-388`); getOilStatus emits them (:694-701) | `safeStatus` whitelist (`results-mapper.ts:47-51`) → not in enum → `UNKNOWN` (gray pill, console.warn via status-colors.ts:111-115) | **MISMATCH - MEDIUM (C7)** | Every engine-oil reading except CRITICAL/ERROR renders as gray `UNKNOWN` on the web; LCD shows the specific grade. Information downgraded, not corrupted. |
| X9 | `engine_oil.dielectric` before first measurement | `showReadyScreen()` resets `webDielectric = 0.0` (`main.ino:649`); `buildResultsJson` emits `String(webDielectric, 2)` **unconditionally** (`main.ino:366`) | types/fluid.ts:25-27 documents "`null` when sensor has not yet reported"; mapper treats `0` as a live number → `noData=false`, `hasError=false` | **MISMATCH - CRITICAL (C1)** | Web renders **"Dielectric 0.00"** as a live reading before any measurement; LCD shows "Ready!". Asymmetric with capacitance, which IS gated (`main.ino:362-363` + `webEngineMeasurementTaken`). |
| X10 | `engine_oil.water` before first measurement | `webWaterStatus = "N/A"` (:98, :650) → `waterFlag = indexOf("YES")>=0 ? "YES" : "NO"` (:337) → `"NO"` | types/fluid.ts:34-35: "null when no dielectric reading exists yet"; mapper prints `Water: NO` whenever dielectric ≠ null (:157-159) | **MISMATCH - CRITICAL (C1)** | Fabricated `"Water: NO"` on the wire - a *safety* claim (no water in oil) issued with no measurement. LCD shows `N/A`. |
| X11 | `engine_oil.capacitance` gating | `webEngineMeasurementTaken` gate (`main.ino:110, 248, 362-363`); reset in showReadyScreen (:652) | mapper renders `Capacitance: N/A` when null | **MATCH** (correct design, verified) | - |
| X12 | `tbn`/`tan`/`viscosity` = literal null | `main.ino:370-372` | mapper renders N/A; field order pinned by `web/src/test/esp32-engine-firmware.test.ts:124-147` | **MATCH** (contract verified end-to-end) | - |
| X13 | `coolant` = `{ph:null, status:"NO_DATA"}` | `main.ino:375-377` | mapper default + `mapCoolant` (`results-mapper.ts:31-34, 184-216`) | **MATCH** (verified) | - |
| X14 | Brake `NO_DATA` before first UART line | `main.ino:113, 344-349` → `"moisture":null,"status":"NO_DATA"` | mapper `mapBrakeOil` noData branch (:53-59) | **MATCH** (verified) | - |
| X15 | HTTP `/api/data` CORS | OPTIONS preflight 204 + ACAO `*` (`main.ino:169-175, 283-289`) | `api.ts:26-28` sends `Accept` only | **MATCH** (prev provisional M2 downgraded to LOW) | Remaining gap: WS has **no Origin check** and the AP password is public knowledge (`Password123`, :71) - any co-joined device can read all telemetry (C8). |
| X16 | WS frame for unknown `kind` | never happens (snapshot only) | `applyFrame` `default: return prev` silently (`useFluidStream.ts:141-142`) | **MISMATCH - LOW (C11)** | Future firmware contract drift will fail *silently*; no warning logged. |
| X17 | Client→device WS commands | firmware logs any received text (`main.ino:313-321`) | hook never calls `ws.send()` | **MATCH (inert)** | Logging path allocates a String per char (:319) - minor heap churn (C10). |
| X18 | Brake status provenance | CSV branch trusts Arduino status verbatim (`main.ino:548`); local derivation helper exists but unused | mapper trusts firmware | **NOTE (C10b)** | `getBrakeStatusFromMoisture()` (declared :131, defined :625-639) is **orphaned - never called**. If intended as a cross-check, it is missing. |

---

## 4. Firmware-Internal Findings (now auditable)

### C1 (CRITICAL) - Fabricated engine-oil values on the wire before any measurement
**Where:** `firmware/esp32/main.ino:337` (waterFlag), `:366` (dielectric), `:643-658` (showReadyScreen resets), `:97-98` (initial `"N/A"` values).
**Trace:** fresh boot → `setup()` → `showReadyScreen()` sets `webDielectric=0.0`, `webEngineStatus="N/A"`, `webWaterStatus="N/A"` → browser connects → snapshot with `"dielectric":0.00,"water":"NO","status":"UNKNOWN"`.
**Frontend behavior (verified in code):** `mapEngineOil` sees dielectric `0` (a number) → `noData=false` (`web/src/lib/results-mapper.ts:125-130`), `hasError=false` (:135-139), status `UNKNOWN` (:141-145); renders primary metric **"Dielectric 0.00"** (:170-176) and sub-metric **"Water: NO"** (:157-159). The `NO_DATA` engine contract (types/fluid.ts:26, 34) is violated by the firmware's own hand-built JSON.
**Why CRITICAL:** water-in-oil is a safety claim; `"Water":"NO"` is emitted with zero sensor input, contradicting both the LCD and the type contract. It also defeats the deliberate NO_DATA product design implemented everywhere else (brake/coolant).
**Fix direction (for human review, not applied):** gate `dielectric` and `water` behind the same `webEngineMeasurementTaken` flag already used for `capacitance`; emit `"dielectric":null` / `"water":null` until true. The mapper already handles nulls correctly (results-mapper.ts:170-176 renders "N/A"; noData rule :125-130 then correctly fires).

### C2 (CRITICAL) - Pipe-format brake lines leak the `Status:` label into the status field
**Where:** `main.ino:556-568`. `statusPart = data.substring(pipeIndex + 1)` → for `Moisture: 1% | Status: NORMAL`, `statusPart = "Status: NORMAL"`; `:568` stores it verbatim. `buildResultsJson:335` runs it through `normalizeStatusForFrontend` (:381-398), which has no handler for a *labeled* status → falls through to `return "UNKNOWN"` (:397).
**Web behavior:** `safeStatus("UNKNOWN")` → UNKNOWN gray pill. Meanwhile the LCD prints the raw string at :565 and looks right.
**Note:** the multi-line branch (:588-599) strips the colon correctly, so only the single-line frame format is affected - which is precisely the historical format named in `web/src/test/esp32-contract.test.ts:167-172` (the "Status:" leak regression class).
**Fix direction:** in the pipe branch, strip a leading `Status:` label (same colon-strip as `formatBrakeMoisture`), or have `normalizeStatusForFrontend` strip a `^[A-Za-z]+:` prefix before matching.

### C3 (HIGH) - No heartbeat frames, no deltas, no liveness - end to end
**Where:** `main.ino:271-277` (only snapshot kind), `:300`, `:324`; `web/src/hooks/useFluidStream.ts:92-93` (heartbeat discarded), `:101-140` (dead delta branches); `web/src/App.tsx:143-152` (renders "Signal Live" purely from socket-open state).
**Mechanism:** neither side detects a half-open TCP connection. The firmware comment "Pings/pongs are handled by the library automatically" (:291) is **not implemented in code** - no `client->ping()`, no periodic heartbeat frame exists in the source. The web hook's only recovery trigger is a `close` event (`useFluidStream.ts:200-219`).
**Symptom match:** dashboard values freeze while LCD keeps updating - now confirmed as a *two-sided absence*, not a browser-side guess.
**Fix direction:** (a) firmware: emit `{kind:"heartbeat",ts:millis()}` every 1-2 s (even when `ws.count()==0` no-op is fine) or call `client->ping()`; (b) web: update `lastActivityTs` on *any* frame including heartbeats, add a 15 s staleness timer surfacing a distinct "STALE" header state (the existing `lastUpdateMs` (:262) is already 80% of this).

### C4 (HIGH) - Address contract: hardcoded `.local` vs softAP IP reality
**Where:** `main.ino:162-166` (softAP + mDNS), `web/src/hooks/useFluidStream.ts:65`, `web/src/lib/api.ts:19`.
**Failure conditions:** (1) browsing via `http://192.168.4.1` (only guaranteed address; mDNS down/unsupported by host OS - notably Android hotspot clients) → both WS and HTTP target an unreachable/different host; (2) any https-served deployment → mixed-content block, silently mapped to `DeviceDisconnectedError` (`useFluidStream.ts:170-177`, `api.ts:29-31`).
**Fix direction:** derive both URLs from `window.location` (device serves the app itself, `main.ino:187-192`); keep parameters as overrides only.

### C5 (HIGH) - 400 ms blocking sampling window starves UART, buttons, and WS tick
**Where:** `main.ino:211-226` (`for … NUM_SAMPLES { readRaw_CH1(); delay(20); }` = ≥400 ms), inside `loop()` (203) which also owns `readArduinoData()` (:450) and `handleButton()` (:398); tick at :274-277.
**Quantified:** UART 9600 8N1 ≈ 960 B/s ⇒ ~385 bytes accumulate during one window; ESP32 HardwareSerial default RX ring buffer = 256 bytes ⇒ **overflow** when the Arduino streams through a sample window ⇒ truncated/corrupted lines (parsed as garbage → LCD fallback row, `main.ino:490-496`) or lost `RESULT,` frames. A button press that starts and ends inside the window (short press < 400 ms) is **missed entirely** (single `digitalRead` per loop pass, :410). The WS tick can be delayed by up to ~400 ms → visible dashboard stutter each measurement second.
**Fix direction:** replace `delay(20)` with a millis()-spaced state machine (sample-once-per-loop-pass), or move sampling into a FreeRTOS task with a mutex-protected result handoff; alternatively raise `Serial1.begin(..., rxBufferSize)` (e.g. 1024) as a stopgap.

### C6 (MEDIUM) - Unbounded UART accumulator String + per-char concatenation
**Where:** `main.ino:94` (`String incomingArduinoData`), `:501` (`incomingArduinoData += inChar`), `:499` (cleared only on `\n`).
**Mechanism:** any stream containing no `\n` (runaway Arduino output, binary noise, line-length bug) grows the String unbounded → heap exhaustion/OOM on a device also running AsyncTCP + LittleFS. Per-char `String +=` reallocs also fragment the heap.
**Fix direction:** cap length (e.g. `if (incomingArduinoData.length() > 128) → discard`), or use a fixed `char buf[128]` + index.

### C7 (MEDIUM) - Out-of-enum passthrough + label rename (LCD ⇄ web drift, structural)
**Where:** `main.ino:383-397` passthrough + `GOOD`/`NORMAL` merge; `web/src/lib/results-mapper.ts:36-51` whitelist.
**Verified mapping outcomes:**
| LCD / UART status | Wire value after normalize | Web pill | Problem |
|---|---|---|---|
| EXCELLENT | EXCELLENT | UNKNOWN (gray) | Grade hidden |
| GOOD/SVC DUE | GOOD/SVC DUE | UNKNOWN (gray) | Grade hidden |
| WATER DETECT | WATER DETECT | UNKNOWN (gray) | Safety info hidden |
| EMPTY TUBE/ERR | EMPTY TUBE/ERR | UNKNOWN (gray) | Error hidden |
| NORMAL | GOOD | GOOD (green) | Label renamed vs LCD |
| CRITICAL | CRITICAL | CRITICAL (red) | OK |
| ERROR | ERROR | ERROR (gray) | OK (matches) |
**Fix direction:** either extend `ALLOWED_STATUSES`/`getStatusVisual` with the five real strings (colors unchanged) or emit enum values over the wire and keep raw strings for the LCD only. The current two-sided design guarantees the web can never echo the LCD.

### C8 (MEDIUM, security) - Hardcoded AP credentials + open WS/HTTP
**Where:** `main.ino:70-71` (`FluidTester_Network` / `Password123` in source - will land in git history once the file is committed), `main.ino:169-189` (ACAO `*`, no auth), `:73` (WS without origin checks).
**Impact:** anyone within radio range can join the AP and read all fluid data; not secrets-hygienic (the sibling project's `secrets.h` pattern is the established convention). Acceptable risk if the device is an offline bench tool; not acceptable if the AP ever bridges to a LAN.
**Fix direction:** move credentials to an untracked `secrets.h`, rotate the default password.

### C9 (MEDIUM) - No framing integrity on the UART link
**Where:** `main.ino:450-503` - newline-delimited text only: no length cap, no checksum/CRC, loose matching (`startsWith` × 6 + `indexOf('|')` + case-sensitive `indexOf("testing")` at :482). Combined with C5 (overflow truncation), corrupted fragments are rendered to the LCD (:490-496) rather than discarded.
**Fix direction:** adopt the already-reserved `RESULT,` CSV frame as the *only* machine format, add a checksum field, and require strict grammar for web-visible updates (debug text must never mutate state).

### C10 (LOW)
- **`getBrakeStatusFromMoisture()` is orphaned** - declared `main.ino:131`, defined :625-639, zero call sites (verified by grep). Dead code; either wire it as the status cross-check or delete.
- **`WS_EVT_ERROR` prints `(char*)data` without null-termination** (`main.ino:304-306`) - garbage/crash risk on error frames.
- **`WS_EVT_DATA` accumulates a `String` per char** (`main.ino:317-321`) - heap churn for logging only.
- **LCD fallback artifacts** - unrecognized UART lines print to row 1 without `lcd.clear()` (:490-496), leaving stale text overlapping other screens; matches "LCD-only" oddities.
- **No change detection** - full snapshot per tick per client even when idle (`:322-326`); trivial bandwidth, but `ws.textAll` silently drops frames when a client's queue overflows - the browser cannot distinguish "no change" from "dropped frame" (moot once C3's liveness lands).
- **`jsonReady` reset on stop** - double-click cancel (`main.ino:245-253` → `showReadyScreen()` :639) wipes all web-visible data and, per C1, immediately re-broadcasts fabricated `Dielectric 0.00` - the freeze/fabricate cycle an operator sees as "web forgot the last result".

### Web-side updates in light of the real firmware (downgrades/promotions from revision 1)
| Rev-1 finding | New verdict with firmware in hand |
|---|---|
| H4 (no leading-snapshot timeout) | **Downgraded to LOW** - `WS_EVT_CONNECT` pushes an immediate snapshot (`main.ino:295-302`); only C5's tick gaps (≤~900 ms) ever delay frames. |
| M3/M3b (delta synthesis/reconnect merge) | **Downgraded to LOW (dead code)** - firmware never sends deltas or reuses state across reconnects; each connect gets a fresh snapshot. Recommend deleting or clearly marking the delta branches as future-protocol support. |
| M2 (CORS) | **Downgraded to LOW** - OPTIONS + ACAO `*` implemented (`main.ino:169-189`); residual items moved to C8. |
| M1 (no fetch timeout) | **Unchanged LOW** - `fetchFluidResults` unused by the live UI (WebSocket-only path in App.tsx). |
| M4 (status enum) | **Confirmed and expanded** - now cross-audited as C7 + X7. |
| H1/H2/H3 (address, liveness, reconnect) | **Confirmed at HIGH** - now C4, C3, plus reconnect-loop severity unchanged (`useFluidStream.ts:67, 206-218`: default `Infinity`, no backoff; now additionally justified by C8's open AP - a forgotten tab reconnect-storms forever after the device powers off). |

---

## 5. Prioritized Remediation Matrix (for human review - none applied)

| ID | Sev | Firmware file:line | Web file:line | Root cause (one line) | Step-by-step recommendation |
|---|---|---|---|---|---|
| R1 | **CRITICAL** | main.ino:337, 366, 643-658 | results-mapper.ts:125-176 | Engine oil emits fabricated `dielectric:0.00`/`water:"NO"` pre-measurement | 1. In `buildResultsJson`, emit `"dielectric":null` and `"water":null` when `!webEngineMeasurementTaken`. 2. Keep `capacitance` gating as-is. 3. Mapper already handles null → no code change strictly required; add a contract test pinning `dielectric:null` pre-measurement to `esp32-contract.test.ts`. |
| R2 | **CRITICAL** | main.ino:556-568, 381-398 | results-mapper.ts:47-51 | `Status:` label leaks into webBrakeStatus via pipe path → UNKNOWN | 1. In `displayBrakeData` pipe branch, apply a colon-strip to `statusPart` (mirror of `formatBrakeMoisture`). 2. Add firmware-side unit check in the contract test suite. 3. Optional: make `normalizeStatusForFrontend` strip a `^[A-Za-z]+:\s*` prefix before matching. |
| R3 | **HIGH** | main.ino:271-277, 295-302 | useFluidStream.ts:92-93, App.tsx:143-152 | No liveness frames anywhere | 1. Firmware: add `{kind:"heartbeat",ts:millis()}` every 1-2 s in `broadcastStreamTick` (or `client->ping()`). 2. Web: track `lastActivityTs` on all frames; add 15 s staleness timer → distinct "STALE" header state. 3. Wire `lastUpdateMs` (already returned, hook :262) into `App`. |
| R4 | **HIGH** | main.ino:162-166 | useFluidStream.ts:65, api.ts:19 | Hardcoded `.local` host vs softAP IP access | 1. Web: default URLs to `(location.protocol==='https:'?'wss':'ws') + '://' + location.host + '/ws'`. 2. Keep params as overrides. 3. Firmware: LCD softAP-IP display was removed for cleanliness; consider re-adding a one-line hint on the ready screen while mDNS adoption is incomplete (product decision). |
| R5 | **HIGH** | main.ino:211-226, 138 | - | 400 ms blocking window starves UART/buttons/WS | 1. Refactor sampling to a millis()-driven per-pass state machine (one `readRaw_CH1` per loop pass). 2. Or FreeRTOS task + mutex handoff. 3. Stopgap: `Serial1.begin(9600, SERIAL_8N1, RX, -1, 1024)` to enlarge the RX ring buffer. |
| R6 | **MEDIUM** | main.ino:94, 501 | - | Unbounded UART String accumulator | 1. Hard cap (discard > 128 chars), or fixed char buffer. 2. Add `\r` handling parity check. |
| R7 | **MEDIUM** | main.ino:383-397 | results-mapper.ts:36-51, status-colors.ts:91-117 | Out-of-enum statuses → UNKNOWN; NORMAL→GOOD rename | 1. Decide the owner: either web enum absorbs the five LCD strings (results-mapper + status-colors tables + tests), or firmware emits enum values and keeps raw strings LCD-only. 2. Update `esp32-contract.test.ts:75-100` to the chosen contract. |
| R8 | **MEDIUM** | main.ino:334-379, 300, 324 | - | String-concat JSON churn every 500 ms + per connect | 1. Prefer a stack `char buf[384]` + `snprintf`, or ArduinoJson with a reused document. 2. Add change detection: skip `textAll` when payload equals last payload. |
| R9 | **MEDIUM** | main.ino:70-71, 169-189, 73 | - | Hardcoded AP creds; open CORS/WS | 1. `secrets.h` (gitignored) + `secrets.h.example`, mirroring the sibling project pattern. 2. Rotate the password. 3. Optional WS Origin allow-list. |
| R10 | **MEDIUM** | main.ino:450-503 | - | No UART framing/checksum/strictness | 1. Standardize on `RESULT,` CSV + checksum. 2. Never render unrecognized lines from web-visible state (log only). 3. Strict-grammar gate before `webBrakeDataReady = true`. |
| R11 | **LOW** | main.ino:131, 625-639 | - | Orphaned `getBrakeStatusFromMoisture()` | Wire it in as a status cross-check for frames lacking a status field, or delete with the declaration. |
| R12 | **LOW** | main.ino:304-306, 317-321, 490-496 | - | WS error print, per-char String, LCD fallback artifacts | Null-terminate/bounds-check error prints; log-only, no String; `lcd.clear()` before fallback prints. |
| R13 | **LOW** | - | useFluidStream.ts:67, 206-218 | Infinite unjittered reconnect default | Cap attempts (e.g. 8), backoff + jitter; surface attempt count. (Unchanged from rev 1; now reinforced by C8.) |
| R14 | **LOW** | - | useFluidStream.ts:141-142, 101-140 | Unknown frame kinds silent; dead delta branches | Warn-log unknown kinds; mark/delete delta branches pending a real delta protocol. |
| R15 | **LOW** | .github/workflows/ci.yml | web/package.json | CI steps run at repo root; package.json now in `web/` | Add `working-directory: web` (or `defaults.run.working-directory`) to the job; leave the checkout as-is. Not applied in this run per guardrails. |
| R16 | **LOW** | - | web/src/lib/api.ts:21-31 | Fetch path unused by live UI, no timeout | Add `AbortSignal.timeout(5_000)` default for future reuse. |

---

## 6. Verified-Consistent Contracts (evidence the pipeline is otherwise sound)

- `GET /api/data` path, method, nested `{brake_oil, engine_oil, coolant}` shape - matches `api.ts` + `results-mapper.ts` round-trip (contract tests `web/src/test/esp32-contract.test.ts:32-73` pin the exact nested shape produced by `buildResultsJson`).
- Field order `dielectric, capacitance, water, tbn, tan, viscosity, status` - matches the pinned test (`esp32-engine-firmware.test.ts:124-147`), so the hand-built JSON is order-stable.
- Engine `capacitance` gating (`webEngineMeasurementTaken`) - firmware (`main.ino:110, 248, 362-363`) ↔ web N/A rendering ↔ tests. Consistent.
- Coolant `null + NO_DATA` and brake pre-first-line `null + NO_DATA` - consistent both sides.
- `NORMAL`-leak regression tripwires (esp32-contract.test.ts:163-191) still guard the mapper.
- Immediate snapshot on WS connect - satisfies the hook's expectations.
- CORS preflight for cross-origin browsers - implemented (HTTP only).

---

## 7. Timing Analysis Summary (quantified)

| Interval | Source | Effect when violated |
|---|---|---|
| 400 ms | `main.ino:213-222` (20 × delay(20)) | UART buffer overflow window (~385 B vs 256 B ring), missed button presses, WS tick gaps → dashboard stutter |
| 500 ms | `streamTickMs` (:90, :274-277) | full-snapshot cadence; gaps up to ~900 ms during measurement |
| 1000 ms | `measurementInterval` (:85) | per-cycle blocking budget (400 ms = 40% duty while measuring) |
| 350 ms | `doubleClickWin` (:84, :424) | double-click cancel window; harmless by itself |
| 9600 baud | `Serial1.begin` (:138) | ~1 byte/ms sustained; the binding constraint in the C5 math |

---

## 8. Root-Cause Mapping to Observed Symptoms (final, all code-grounded)

| Symptom | Root cause(s) | Evidence |
|---|---|---|
| Web shows fabricated / stale engine values vs LCD "Ready!" | C1 (dielectric 0.00 + Water NO on wire) | main.ino:337, 366, 649; results-mapper.ts:125-176 |
| Web shows UNKNOWN where LCD shows a real grade | C2 (Status: label leak) + C7 (out-of-enum passthrough + whitelist) | main.ino:568, 383-397; results-mapper.ts:47-51 |
| Dashboard freezes while LCD keeps running | C3 (no heartbeat either side) | main.ino:271-277; useFluidStream.ts:92-93, 200-219 |
| Dashboard only works via `fluidtester.local`, fails via IP/hotspot | C4 (hardcoded host vs softAP+mDNS) | main.ino:162-166; useFluidStream.ts:65; api.ts:19 |
| Intermittent UART garbage / dropped brake lines during engine test | C5 (400 ms starvation) + C9 (no framing integrity) | main.ino:211-226, 138, 450-503 |
| Web "forgets" last result after double-click stop | C10b (showReadyScreen reset → immediate fabricated re-broadcast) | main.ino:245-253, 639-658 |
| UI stays "Acquiring" briefly, stutters each measurement second | C5 WS-tick delay (downgraded from rev-1 H4) | main.ino:274-277 |

---

## 9. Protected Zone: PDF Generation (unchanged and verified decoupled)

- `web/src/lib/pdf-report.ts` - `generateReport` (:59-158), `formatMetricForPdf` (:42-49), `didParseCell` styling (:104-143), emoji exclusion (:56-58): **untouched by all R-items above**. R16/R9 do not touch the report pipeline.
- `web/src/lib/html2canvas-stub.ts` - intentional bundle-slimming stub; keep.
- `web/vite.config.ts` `manualChunks` (`react`, `pdf`) - keep for the LittleFS deployment (`main.ino:187-192` serves this exact bundle).
- Regression fences kept green in rev 1 remain the protection: `web/src/test/pdf-report.test.ts` (14 cases), `web/src/test/engine-oil-pdf.test.ts` (9 cases).

---

## 10. Verification Commands (read-only, this run)

- `find` - confirmed 55 pre-move files; no `count_braces.py`; no other firmware on disk besides `firmware/esp32/main.ino` (added this run).
- `mv`/`mkdir` executed with plain filesystem operations - `git status` shows unstaged relocations and one untracked firmware file + report; **nothing staged or committed** (guardrail honored).
- `grep` line-number anchors collected from both sides post-move (Sections 2-5 all cite post-restructure paths).
