/* ===========================================================================
 *  FlowMetrics - ESP32-S3 Firmware
 *  Engine Oil (FDC2214 capacitive sensor) + Brake Oil (UART from Arduino)
 *  with a small web dashboard served over a softAP.
 *
 *  Phase 2 (this file):
 *    - /api/data now returns the nested JSON shape the React frontend expects
 *      (brake_oil / engine_oil / coolant) instead of the flat shape it used
 *      to return, which caused every fluid card to render as ERROR.
 *    - HTTP_OPTIONS preflight is handled for /api/data so cross-origin
 *      browsers (and iOS Safari) do not silently drop the request.
 *    - The softAP IP used to be shown on LCD row 3 for operators with
 *      broken mDNS, but it has been removed from the LCD UI.
 *    - Button handling is rewritten as a non-blocking state machine that
 *      filters switch bounce, eliminating the bug where a single press was
 *      misread as a double-click and immediately cancelled the measurement.
 *
 *  Frontend contract: see fluid-tester/src/types/fluid.ts
 *    GET /api/data  ->  { brake_oil, engine_oil, coolant }
 *    brake_oil  : { moisture: string, status: string }
 *    engine_oil : { dielectric: number, water: "YES"|"NO", status: string }
 *    coolant    : { ph: number, status: string }
 * =========================================================================*/

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <LittleFS.h>

// --- UART Pins for Receiving Arduino Data ---
#define ARDUINO_RX_PIN 17
#define ARDUINO_TX_PIN -1

// FDC2214 Sensor I2C Pins (Bus 1 - Wire1)
#define FDC_SDA_PIN 8
#define FDC_SCL_PIN 9

// LCD I2C Pins (Bus 0 - Default Wire)
#define LCD_SDA_PIN 4
#define LCD_SCL_PIN 5

// Push Button Pin (Engine Oil Measurement) - Pin 14
#define BUTTON_PIN 14

#define FDC2214_ADDR 0x2A

#define REG_DATA_CH1            0x02
#define REG_RCOUNT_CH1          0x09
#define REG_SETTLECOUNT_CH1     0x11
#define REG_CLOCK_DIVIDERS_CH1  0x15
#define REG_DRIVE_CURRENT_CH1   0x1F
#define REG_MUX_CONFIG          0x1B
#define REG_CONFIG              0x1A

// ==== Raw -> pF Calibration Constants ====
const double refRaw  = 13352500.0;
const double refPF   = 3.7;
const double slope_a = -0.00001220703125;

// Number of samples for smoothing noise
const int NUM_SAMPLES = 20;

// Initialize LCD on default Wire (Address 0x27)
LiquidCrystal_I2C lcd(0x27, 20, 4);

// Web Server Credentials & Object
const char* ssid = "FluidTester_Network";
const char* password = "Password123";
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");  // Real-time WebSocket stream for the React app

// Control & Button Timing Variables
bool isMeasuringEngineOil = false;
bool isDisplayingBrakeOil = false;

bool lastButtonState = HIGH;
int clickCount = 0;
unsigned long lastClickTime = 0;
unsigned long lastMeasurementTime = 0;

const unsigned long doubleClickGap = 350;
const unsigned long measurementInterval = 1000;

// ==== Real-time WebSocket streaming tick ====
// We push a fresh JSON frame to every connected client this often, so the
// dashboard's "LIVE" pill animates and the data updates without polling.
const unsigned long streamTickMs = 500;
unsigned long lastStreamTick = 0;

// R3 (audit): application-level liveness frames. The browser staleness
// watchdog keys on these so it can tell "device alive, no change" apart
// from "socket silently dead".
const unsigned long heartbeatIntervalMs = 1000;
unsigned long lastHeartbeatTick = 0;

// Buffers for Web Server Data and Serial
String incomingArduinoData = "";
double webCapacitance = 0.0;
double webDielectric = 0.0;
String webEngineStatus = "N/A";
String webWaterStatus = "N/A";
// Phase 3: sub-metric globals. The chemistry sensors (TBN/TAN/Viscosity)
// are not wired in this hardware revision, so their globals stay at the
// "no reading" sentinel and the JSON emits them as `null` until the
// future firmware PR adds the parser.
double webTBN = NAN;        // TBN (Total Base Number), mg KOH/g
double webTAN = NAN;        // TAN (Total Acid Number), mg KOH/g
double webViscosity = NAN;  // Viscosity, % of new oil
// Capacitance (pF) is computed by the FDC2214 in the same loop as the
// dielectric. We gate it behind a "has the operator actually run a
// measurement?" flag so the value is never reported before they click
// Fetch. (Per product decision in Phase 3.)
bool   webEngineMeasurementTaken = false;
String webBrakeMoisture = "";        // empty until first valid UART line
String webBrakeResistance = "";      // empty until first valid UART line
String webBrakeStatus = "NO_DATA";   // universal NO_DATA until first valid UART line
bool   webBrakeDataReady = false;    // true once a real reading has been parsed

// ==== Function Declarations ====
void showReadyScreen();
void displayBrakeData(String data);
void readArduinoData();
void writeReg(byte reg, byte msb, byte lsb);
uint32_t readRaw_CH1();
String getOilStatus(double dielectricConstant);
String getWaterStatus(double dielectricConstant);
String normalizeStatusForFrontend(const String& raw);
String buildResultsJson();
void handleButton();
void addCorsHeaders(AsyncWebServerResponse *response);
void handleWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                   AwsEventType type, void *arg, uint8_t *data, size_t len);
void broadcastStreamTick();
String getBrakeStatusFromMoisture(const String& moisture);
String formatBrakeMoisture(const String& raw);

void setup() {
  Serial.begin(115200);
  delay(1500);

  // R5 (audit): enlarge the UART RX ring buffer so the ~400ms FDC2214
  // sampling window (~385 bytes at 9600 baud) cannot overflow the 256-byte
  // default. setRxBufferSize() must be called BEFORE begin(); on current
  // arduino-esp32 cores the 6th begin() parameter is timeout_ms, not the
  // buffer size, so the explicit setter is the correct API.
  Serial1.setRxBufferSize(1024);
  Serial1.begin(9600, SERIAL_8N1, ARDUINO_RX_PIN, ARDUINO_TX_PIN);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Wire.begin(LCD_SDA_PIN, LCD_SCL_PIN);
  lcd.init();
  lcd.backlight();
  showReadyScreen();

  Wire1.begin(FDC_SDA_PIN, FDC_SCL_PIN);
  writeReg(REG_CLOCK_DIVIDERS_CH1, 0x20, 0x01);
  writeReg(REG_DRIVE_CURRENT_CH1,  0xF8, 0x00);
  writeReg(REG_SETTLECOUNT_CH1,   0x00, 0x0A);
  writeReg(REG_RCOUNT_CH1,        0xFF, 0xFF);
  writeReg(REG_MUX_CONFIG,        0xC2, 0x0D);
  writeReg(REG_CONFIG,            0x54, 0x01);
  delay(200);

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS Mount Failed!");
  } else {
    Serial.println("LittleFS mounted successfully.");
  }

  WiFi.mode(WIFI_AP);
  WiFi.softAP(ssid, password);
  Serial.print("AP IP address: ");
  Serial.println(WiFi.softAPIP());

  if (MDNS.begin("fluidtester")) {
    Serial.println("mDNS started: http://fluidtester.local");
  }

  // 3.1. API Endpoint - CORS preflight (OPTIONS) for cross-origin browsers
  server.on("/api/data", HTTP_OPTIONS, [](AsyncWebServerRequest *request) {
    AsyncWebServerResponse *response = request->beginResponse(204);
    addCorsHeaders(response);
    request->send(response);
  });

  // 3.2. API Endpoint - the real GET handler
  server.on("/api/data", HTTP_GET, [](AsyncWebServerRequest *request) {
    AsyncWebServerResponse *response = request->beginResponse(
      200, "application/json", buildResultsJson()
    );
    addCorsHeaders(response);
    request->send(response);
  });

  // 3.3. Root URL
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(LittleFS, "/index.html", "text/html");
  });

  // 3.4. Static Files
  server.serveStatic("/", LittleFS, "/");

  // 3.5. WebSocket endpoint - real-time stream of fluid readings
  ws.onEvent(handleWsEvent);
  server.addHandler(&ws);
  server.begin();
  Serial.println("==================================================");
  Serial.println("  ENGINE OIL & AUTOMOTIVE TESTER READY           ");
  Serial.println("==================================================\n");
}

void loop() {
  readArduinoData();
  handleButton();

  if (isMeasuringEngineOil && (millis() - lastMeasurementTime >= measurementInterval)) {
    lastMeasurementTime = millis();

    double totalCapacitance = 0;
    int validSamples = 0;

    for (int i = 0; i < NUM_SAMPLES; i++) {
      uint32_t raw = readRaw_CH1();
      if (raw > 0) {
        double cap = refPF + slope_a * ((double)raw - refRaw);
        if (cap < 0.5) cap = 0.0;
        totalCapacitance += cap;
        validSamples++;
      }
      delay(20);
    }

    if (validSamples == 0) {
      Serial.println("[ERROR] FDC2214 I2C Read Failed!");
      lcd.setCursor(0, 0);
      lcd.print("Engine Oil Testing  ");
      lcd.setCursor(0, 1);
      lcd.print("SENSOR ERROR!       ");
      webEngineStatus = "ERROR";
      return;
    }

    double avgCapacitance = totalCapacitance / validSamples;
    double dielectricConstant = 1.0 + ((avgCapacitance - 3.65) / 0.875);
    if (dielectricConstant < 1.0) dielectricConstant = 1.0;

    String oilStatus = getOilStatus(dielectricConstant);
    String waterStatus = getWaterStatus(dielectricConstant);

    webCapacitance = avgCapacitance;
    webDielectric = dielectricConstant;
    webEngineStatus = oilStatus;
    webWaterStatus = waterStatus;
    // Phase 3: a valid sample was just taken, so it's now safe to
    // surface Capacitance on the wire. The value above (avgCapacitance)
    // will be formatted by buildResultsJson() with 2 decimals.
    webEngineMeasurementTaken = true;

    char lineBuf[21];
    lcd.setCursor(0, 0);
    lcd.print("Engine Oil Testing  ");

    char capStr[6], erStr[5];
    dtostrf(avgCapacitance, 5, 2, capStr);
    dtostrf(dielectricConstant, 4, 2, erStr);
    snprintf(lineBuf, sizeof(lineBuf), "Cap:%spF Er:%s  ", capStr, erStr);
    lcd.setCursor(0, 1);
    lcd.print(lineBuf);

    snprintf(lineBuf, sizeof(lineBuf), "Status:%-13s", oilStatus.c_str());
    lcd.setCursor(0, 2);
    lcd.print(lineBuf);

    snprintf(lineBuf, sizeof(lineBuf), "Water: %-13s", waterStatus.c_str());
    lcd.setCursor(0, 3);
    lcd.print(lineBuf);
  }

  // ==== Real-time WebSocket tick ====
  // Push a fresh snapshot to every connected client every streamTickMs.
  // We wrap the JSON in a `{kind:"snapshot", data:{...}}` envelope so
  // the React `useFluidStream` hook can pick it up uniformly.
  if (millis() - lastStreamTick >= streamTickMs) {
    lastStreamTick = millis();
    broadcastStreamTick();
  }

  // R3 (audit): periodic application-level heartbeat frame so a
  // connected browser can distinguish "device alive, nothing changed"
  // from "socket silently dead". The hook treats heartbeats as activity
  // and never renders them.
  if (millis() - lastHeartbeatTick >= heartbeatIntervalMs) {
    lastHeartbeatTick = millis();
    if (ws.count() > 0) {
      ws.textAll("{\"kind\":\"heartbeat\",\"ts\":" + String(millis()) + "}");
    }
  }
  // Trim dead clients so the broadcast list stays small.
  ws.cleanupClients();
}

// ==== CORS helper ====
void addCorsHeaders(AsyncWebServerResponse *response) {
  response->addHeader("Access-Control-Allow-Origin", "*");
  response->addHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response->addHeader("Access-Control-Allow-Headers", "Accept, Content-Type");
}

// ==== WebSocket event handler ====
// On a new client we immediately push a snapshot so the UI gets a
// frame without waiting for the next tick. Pings/pongs are handled by
// the library automatically.
void handleWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                   AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    Serial.printf("[WS] client #%u connected from %s\n",
                  client->id(), client->remoteIP().toString().c_str());
    // Send a snapshot immediately so the UI doesn't have to wait for
    // the next tick to display something.
    String payload = "{\"kind\":\"snapshot\",\"data\":" + buildResultsJson() + "}";
    client->text(payload);
  } else if (type == WS_EVT_DISCONNECT) {
    Serial.printf("[WS] client #%u disconnected\n", client->id());
  } else if (type == WS_EVT_ERROR) {
    Serial.printf("[WS] client #%u error: %s\n", client->id(),
                  (char*)data);
  } else if (type == WS_EVT_PONG) {
    // no-op
  } else if (type == WS_EVT_DATA) {
    AwsFrameInfo *info = (AwsFrameInfo*)arg;
    if (info->final && info->index == 0 && info->len == len) {
      // The React app doesn't currently send commands, but we log
      // anything it sends for debugging.
      String msg = "";
      for (size_t i = 0; i < len; i++) msg += (char)data[i];
      Serial.printf("[WS] msg from #%u: %s\n", client->id(), msg.c_str());
    }
  }
}

// ==== Broadcast a fresh snapshot to all connected WS clients ====
void broadcastStreamTick() {
  if (ws.count() == 0) return;  // nobody listening
  String payload = "{\"kind\":\"snapshot\",\"data\":" + buildResultsJson() + "}";
  ws.textAll(payload);
}

// ==== Build the JSON payload the React frontend expects ====
// Universal NO_DATA: if the brake Arduino UART has not yet produced a
// valid reading, we emit `null` moisture + `NO_DATA` status. The same is
// done for coolant (no pH sensor wired in this hardware revision). The
// React mapper renders these as "No measurement yet" with a NO DATA pill
// instead of inventing a fake value.
String buildResultsJson() {
  String brakeStatus  = normalizeStatusForFrontend(webBrakeStatus);
  String engineStatus = normalizeStatusForFrontend(webEngineStatus);
  String waterFlag    = (webWaterStatus.indexOf("YES") >= 0) ? "YES" : "NO";

  // Brake: when no UART line has been parsed, send null + NO_DATA.
  // When the line is just a header like "Testing..." we still keep the
  // NO_DATA state so the card doesn't pretend to have a measurement.
  String brakeMoistureJson = (webBrakeDataReady && webBrakeMoisture.length() > 0)
      ? "\"" + webBrakeMoisture + "\""
      : "null";
  String brakeStatusJson = webBrakeDataReady
      ? "\"" + brakeStatus + "\""
      : "\"NO_DATA\"";

  String j = "{";
  j += "\"brake_oil\":{\"moisture\":" + brakeMoistureJson +
       ",\"status\":" + brakeStatusJson + "},";
  // Engine oil: Phase 3 added four new sub-metric fields.
  //   - dielectric / capacitance / water: all three are gated on
  //     webEngineMeasurementTaken (R1) so the wire never carries the
  //     fabricated 0.00 / "NO" values that showReadyScreen() leaves in
  //     the globals; the frontend renders null as honest "no reading".
  //   - tbn / tan / viscosity: chemistry sensors not wired in this
  //     hardware revision. We emit `null` to establish the JSON
  //     contract; the future sensor PR will simply replace the
  //     `null` literal with `String(webTBN, 2)` etc.
  //   - The field order is pinned by esp32-engine-firmware.test.ts
  //     so don't reorder without updating the test.
  String dielectricJson = webEngineMeasurementTaken
      ? String(webDielectric, 2)
      : "null";
  String capacitanceJson = webEngineMeasurementTaken
      ? String(webCapacitance, 2)
      : "null";
  String waterJson = webEngineMeasurementTaken
      ? ("\"" + waterFlag + "\"")
      : "null";
  j += "\"engine_oil\":{"
       "\"dielectric\":" + dielectricJson +
       ",\"capacitance\":" + capacitanceJson +
       ",\"water\":" + waterJson +
       ",\"tbn\":null"
       ",\"tan\":null"
       ",\"viscosity\":null"
       ",\"status\":\"" + engineStatus + "\"},";
  // Coolant: pH sensor is not wired in this hardware revision. Send
  // null + NO_DATA so the UI shows "No measurement yet".
  j += "\"coolant\":{\"ph\":null,\"status\":\"NO_DATA\"}";
  j += "}";
  return j;
}

// ==== Map LCD status strings to the closed enum the frontend uses ====
String normalizeStatusForFrontend(const String& raw) {
  if (raw == "EXCELLENT")      return "EXCELLENT";
  if (raw == "GOOD/SVC DUE")   return "GOOD/SVC DUE";
  if (raw == "CRITICAL")       return "CRITICAL";
  if (raw == "WATER DETECT")   return "WATER DETECT";
  if (raw == "EMPTY TUBE/ERR") return "EMPTY TUBE/ERR";
  if (raw == "ERROR")          return "ERROR";
  if (raw == "N/A" || raw == "") return "UNKNOWN";
  String up = raw;
  up.toUpperCase();
  if (up == "GOOD" || up == "NORMAL")   return "GOOD";
  if (up == "WARNING" || up == "BAD")   return "WARNING";
  if (up == "CRITICAL")                 return "CRITICAL";
  return "UNKNOWN";
}

// ==== Non-blocking, debounced button handler ====
void handleButton() {
  static const unsigned long debounceDelay  = 50;
  static const unsigned long doubleClickWin = 350;

  static bool          stableState           = HIGH;
  static bool          lastStableState       = HIGH;
  static unsigned long lastDebounceTime      = 0;
  static unsigned long firstPressTime        = 0;
  static bool          waitingForSecondPress = false;

  bool reading = digitalRead(BUTTON_PIN);

  if (reading != stableState) {
    lastDebounceTime = millis();
  }

  if ((millis() - lastDebounceTime) > debounceDelay) {
    if (reading != stableState) {
      stableState = reading;

      if (stableState == LOW && lastStableState == HIGH) {
        if (!waitingForSecondPress) {
          firstPressTime        = millis();
          waitingForSecondPress = true;
        } else {
          waitingForSecondPress = false;
          isMeasuringEngineOil  = false;
          isDisplayingBrakeOil  = false;
          clickCount            = 0;
          Serial.println("\n[SYSTEM] Engine oil measuring STOPPED (double-click)");
          showReadyScreen();
        }
      }
      lastStableState = stableState;
    }
  }

  if (waitingForSecondPress &&
      (millis() - firstPressTime) > doubleClickWin) {
    waitingForSecondPress = false;
    if (!isMeasuringEngineOil) {
      isMeasuringEngineOil  = true;
      isDisplayingBrakeOil  = false;
      lastMeasurementTime   = 0;
      clickCount            = 0;
      Serial.println("\n[SYSTEM] Engine oil measuring STARTED (single-click)");
      lcd.clear();
    }
  }
}

// ==== Receive & Display Arduino Data ====
void readArduinoData() {
  while (Serial1.available() > 0) {
    char inChar = (char)Serial1.read();

    if (inChar == '\n') {
      incomingArduinoData.trim();

      if (incomingArduinoData.length() > 0) {
        Serial.print("\n[ARDUINO DATA RECEIVED]: ");
        Serial.println(incomingArduinoData);

        if (incomingArduinoData == "CANCEL" || incomingArduinoData == "STOP") {
          // Explicit operator request: stop everything and go back to
          // the ready screen.
          isMeasuringEngineOil = false;
          isDisplayingBrakeOil = false;
          showReadyScreen();
        }
        else if (incomingArduinoData.startsWith("Moisture:") ||
                 incomingArduinoData.startsWith("moisture:") ||
                 incomingArduinoData.startsWith("Resist:")   ||
                 incomingArduinoData.startsWith("resist:")   ||
                 incomingArduinoData.startsWith("Status:")   ||
                 incomingArduinoData.startsWith("status:")   ||
                 incomingArduinoData.startsWith("RESULT,")   ||
                 incomingArduinoData.indexOf('|') != -1) {
          // A real brake reading. Don't reset isMeasuringEngineOil —
          // the operator may have an engine test running and the
          // Arduino is just streaming a passive reading.
          isDisplayingBrakeOil = true;
          displayBrakeData(incomingArduinoData);
        }
        else if (incomingArduinoData.indexOf("testing") != -1) {
          // "Testing in progress..." header from the Arduino.
          isDisplayingBrakeOil = true;
          displayBrakeData(incomingArduinoData);
        }
        else {
          // Unrecognized line: log it on the LCD but do NOT touch
          // isMeasuringEngineOil. This prevents a stray debug string
          // from cancelling an active engine-oil measurement.
          lcd.setCursor(0, 1);
          if (incomingArduinoData.length() > 20) {
            lcd.print(incomingArduinoData.substring(0, 20));
          } else {
            lcd.print(incomingArduinoData);
          }
        }
      }
      incomingArduinoData = "";
    } else {
      incomingArduinoData += inChar;
    }
  }
}

// ==== Multi-Format Display Handler for Brake Data ====
void displayBrakeData(String data) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Brake Oil Measure   ");

  // --- 0. "Testing in progress..." header line ---
  if (data.indexOf("testing") != -1) {
    lcd.setCursor(0, 1);
    lcd.print("Testing in progress ");
    lcd.setCursor(0, 2);
    lcd.print("Please wait 30s...  ");
    webBrakeDataReady  = false;
    webBrakeMoisture  = "";
    webBrakeResistance = "";
    webBrakeStatus    = "NO_DATA";
    return;
  }

  // --- 1. "RESULT,<moisture>,<resistance>,<status>" CSV ---
  if (data.startsWith("RESULT,")) {
    int firstComma  = data.indexOf(',');
    int secondComma = data.indexOf(',', firstComma + 1);
    int thirdComma  = data.indexOf(',', secondComma + 1);

    if (firstComma != -1 && secondComma != -1 && thirdComma != -1) {
      String moisture    = data.substring(firstComma + 1, secondComma);
      String resistance  = data.substring(secondComma + 1, thirdComma);
      String status      = data.substring(thirdComma + 1);
      status.trim();
      // R11: if the CSV carried no explicit status, derive one locally
      // from the moisture percentage instead of shipping an empty label.
      if (status.length() == 0) {
        status = getBrakeStatusFromMoisture(moisture);
      }

      lcd.setCursor(0, 1);
      lcd.print("Resist: ");
      lcd.print(resistance);
      lcd.setCursor(0, 2);
      lcd.print("Moisture: ");
      lcd.print(moisture);
      lcd.setCursor(0, 3);
      lcd.print("Status: ");
      lcd.print(status);

      webBrakeMoisture    = formatBrakeMoisture(moisture);
      webBrakeResistance  = resistance;
      webBrakeStatus      = status;
      webBrakeDataReady   = true;
    }
    return;
  }

  // --- 2. Single-line "Moisture: 1% | Status: NORMAL" ---
  if (data.indexOf('|') != -1) {
    int pipeIndex = data.indexOf('|');
    String moisturePart = data.substring(0, pipeIndex);
    String statusPart   = data.substring(pipeIndex + 1);
    moisturePart.trim();
    statusPart.trim();

    lcd.setCursor(0, 1);
    lcd.print(moisturePart);
    lcd.setCursor(0, 2);
    lcd.print(statusPart);

    // R2: strip a leading "Status:"/"status:" label so webBrakeStatus
    // holds the bare value ("NORMAL"), mirroring formatBrakeMoisture().
    // Without this, normalizeStatusForFrontend() maps the labeled
    // string to UNKNOWN on the web while the LCD shows the real status.
    if (statusPart.startsWith("Status:") || statusPart.startsWith("status:")) {
      statusPart = statusPart.substring(statusPart.indexOf(':') + 1);
      statusPart.trim();
    }
    // R11: a pipe line with no status half at all still yields a real
    // reading; derive the status locally from the moisture percentage.
    if (statusPart.length() == 0) {
      statusPart = getBrakeStatusFromMoisture(moisturePart);
    }

    webBrakeMoisture    = formatBrakeMoisture(moisturePart);
    webBrakeStatus      = statusPart;
    webBrakeResistance  = "N/A";
    webBrakeDataReady   = true;
    return;
  }

  // --- 3. Multi-line prefix lines (each arrives separately) ---
  if (data.startsWith("Moisture:") || data.startsWith("moisture:")) {
    String moisture = data.substring(data.indexOf(':') + 1);
    moisture.trim();
    webBrakeMoisture  = formatBrakeMoisture(moisture);
    // R11: a moisture line with no companion Status line still yields a
    // real reading; derive the status locally rather than leaving the
    // universal NO_DATA sentinel on the wire.
    if (webBrakeStatus == "NO_DATA" || webBrakeStatus.length() == 0) {
      webBrakeStatus = getBrakeStatusFromMoisture(moisture);
    }
    webBrakeDataReady = true;
    lcd.setCursor(0, 2);
    lcd.print("Moisture: ");
    lcd.print(moisture);
    return;
  }
  if (data.startsWith("Resist:") || data.startsWith("resist:")) {
    String resistance = data.substring(data.indexOf(':') + 1);
    resistance.trim();
    webBrakeResistance = resistance;
    lcd.setCursor(0, 1);
    lcd.print("Resist: ");
    lcd.print(resistance);
    return;
  }
  if (data.startsWith("Status:") || data.startsWith("status:")) {
    String status = data.substring(data.indexOf(':') + 1);
    status.trim();
    webBrakeStatus   = status;
    webBrakeDataReady = true;
    lcd.setCursor(0, 3);
    lcd.print("Status: ");
    lcd.print(status);
    return;
  }

  // --- 4. Fallback: just print the line, do NOT touch the JSON status ---
  lcd.setCursor(0, 1);
  if (data.length() > 20) {
    lcd.print(data.substring(0, 20));
  } else {
    lcd.print(data);
  }
}

// ==== Helpers for the brake parser ====
String formatBrakeMoisture(const String& raw) {
  String s = raw;
  s.trim();
  int colon = s.indexOf(':');
  if (colon != -1) {
    s = s.substring(colon + 1);
    s.trim();
  }
  return s;
}

String getBrakeStatusFromMoisture(const String& moisture) {
  int i = 0;
  while (i < moisture.length() && (moisture[i] < '0' || moisture[i] > '9')) i++;
  int start = i;
  while (i < moisture.length() && moisture[i] >= '0' && moisture[i] <= '9') i++;
  if (i == start) return "NORMAL";
  int pct = moisture.substring(start, i).toInt();
  if (pct >= 5)   return "CRITICAL";
  if (pct >= 3)   return "WARNING";
  if (pct >= 1)   return "NORMAL";
  return "GOOD";
}

// ==== Main Ready Screen Display ====
void showReadyScreen() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("  Automotive Fluid  ");
  lcd.setCursor(0, 1);
  lcd.print("  Testing Machine   ");
  lcd.setCursor(0, 2);
  lcd.print("       Ready!       ");

  webCapacitance = 0.0;
  webDielectric = 0.0;
  webEngineStatus = "N/A";
  webWaterStatus = "N/A";
  webEngineMeasurementTaken = false;
  webBrakeMoisture   = "";
  webBrakeResistance = "";
  webBrakeStatus     = "NO_DATA";
  webBrakeDataReady  = false;
}

// ==== Register Write Routing via Wire1 ====
void writeReg(byte reg, byte msb, byte lsb) {
  Wire1.beginTransmission(FDC2214_ADDR);
  Wire1.write(reg);
  Wire1.write(msb);
  Wire1.write(lsb);
  Wire1.endTransmission();
}

// ==== 2-Step 28-bit Raw Register Reader via Wire1 ====
uint32_t readRaw_CH1() {
  Wire1.beginTransmission(FDC2214_ADDR);
  Wire1.write(0x02);
  Wire1.endTransmission(false);

  if (Wire1.requestFrom((uint16_t)FDC2214_ADDR, (uint8_t)2) != 2) return 0;
  byte msb0 = Wire1.read();
  byte msb1 = Wire1.read();

  Wire1.beginTransmission(FDC2214_ADDR);
  Wire1.write(0x03);
  Wire1.endTransmission(false);

  if (Wire1.requestFrom((uint16_t)FDC2214_ADDR, (uint8_t)2) != 2) return 0;
  byte lsb0 = Wire1.read();
  byte lsb1 = Wire1.read();

  uint16_t msbReg = ((uint16_t)msb0 << 8) | msb1;
  uint16_t lsbReg = ((uint16_t)lsb0 << 8) | lsb1;

  uint32_t rawData = ((uint32_t)(msbReg & 0x0FFF) << 16) | lsbReg;
  return rawData;
}

// ==== Condition Status Logic (LCD-level, human readable) ====
String getOilStatus(double dielectricConstant) {
  if (dielectricConstant < 1.50) return "EMPTY TUBE/ERR";
  else if (dielectricConstant < 2.25) return "EXCELLENT";
  else if (dielectricConstant < 2.30) return "GOOD/SVC DUE";
  else if (dielectricConstant < 2.80) return "CRITICAL";
  else return "WATER DETECT";
}

// ==== Water Detection Status ====
String getWaterStatus(double dielectricConstant) {
  if (dielectricConstant >= 2.80) return "YES (DANGER)";
  else return "NO";
}
