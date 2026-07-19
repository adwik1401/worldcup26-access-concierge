/**
 * Ambient shared type declarations for the whole project (server + frontend).
 * No `export` keyword — these are global types, referenced directly in JSDoc
 * (e.g. `@param {Venue} venue`) from any .js file without an import, which
 * fits the project's no-build-step, plain-JS architecture. Picked up by
 * `tsc --noEmit` via tsconfig.json's `include`, purely for `checkJs` static
 * analysis — never emitted, never affects runtime.
 */

interface Gate {
  id: string;
  name: string;
  x: number;
  y: number;
  zone: string;
  stepFree: boolean;
}

interface VenueSection {
  id: string;
  name: string;
  level: string;
  x: number;
  y: number;
  zone: string;
  nearestGate: string;
  ring: "lower" | "upper";
  angleStart: number;
  angleEnd: number;
}

type PoiType = "restroom" | "elevator" | "medical" | "quiet_room" | "info_desk" | "concession";

interface PointOfInterest {
  id: string;
  type: PoiType;
  name: string;
  x: number;
  y: number;
  zone: string;
  stepFree: boolean;
  accessible: boolean;
  lowSensory: boolean;
}

interface Venue {
  venueName: string;
  venueNote: string;
  levels: string[];
  layoutNote?: string;
  gates: Gate[];
  sections: VenueSection[];
  pointsOfInterest: PointOfInterest[];
}

/** Zone id (e.g. "zone-a") -> crowd density in [0, 1]. */
interface CrowdZones {
  [zoneId: string]: number;
}

/** One entry in routingEngine.js's rankPOIs() result — a POI with its computed score/distance/density. */
interface RankedPoi {
  poi: PointOfInterest;
  score: number;
  distance: number;
  crowdDensity: number;
}

interface CrowdScenario {
  label: string;
  description: string;
  zones: CrowdZones;
}

/** Which accessibility needs the fan has stated, if any. */
interface AccessibilityProfile {
  mobility?: boolean;
  visualImpairment?: boolean;
  hearingImpairment?: boolean;
  sensorySensitivity?: boolean;
}

type RouteIntent = PoiType | "seat" | "unknown";

/** The routing engine's chosen POI or gate, annotated with distance/crowd info once ranked. */
interface RouteChosen {
  type: string;
  id?: string;
  name: string;
  x: number;
  y: number;
  zone?: string;
  stepFree?: boolean;
  accessible?: boolean;
  lowSensory?: boolean;
  distance?: number;
  crowdDensity?: number;
  /** Only present when intent is "seat" — the chosen result is a Gate, this is the fan's section name. */
  targetSection?: string;
}

/** The deterministic routing engine's full structured output (routingEngine.js's findRoute()). */
interface RouteResult {
  intent: RouteIntent;
  chosen: RouteChosen | null;
  alternatives: RouteChosen[];
  appliedRules: string[];
  crowdSnapshot: CrowdZones;
}

type ReplySource = "openrouter" | "offline" | "offline-fallback-error";

interface ConciergeReply {
  message: string;
  source: ReplySource;
}

type SupportedLanguage = "en" | "es" | "fr" | "pt" | "ar";

type DistanceBucket = "veryClose" | "short" | "far";

/** i18n.js's per-language phrase-template shape — every language must supply all of these. */
interface LocalizedStrings {
  distanceVeryClose: string;
  distanceShort: string;
  distanceFar: string;
  poiFound: string;
  crowdWarning: string;
  alternativesIntro: string;
  poiNotFound: string;
  gateFound: string;
  gateOverride: string;
  gateNotFound: string;
}

/** i18n.js's per-language facility-name labels, keyed by PoiType. */
type FacilityLabels = Record<PoiType, string>;

/** public/app.js's appendMessage() parameters — only role/text are required. */
interface AppendMessageArgs {
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  source?: ReplySource;
  appliedRules?: string[];
}

/** public/app.js's MARKER_ICON_PARTS — [SVG tag name, attributes] pairs per marker type. */
type IconPartsMap = Record<PoiType | "gate", Array<[string, Record<string, string | number>]>>;

/** A radius pair for one concentric ellipse ring boundary in the stadium-bowl map. */
interface EllipseRadius {
  rx: number;
  ry: number;
}
