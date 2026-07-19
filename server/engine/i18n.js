/**
 * Offline multilingual fallback layer.
 *
 * Composes a natural-language reply directly from the routing engine's
 * *structured* result (never from its English `appliedRules` strings, which
 * are for logging/debugging) so every supported language is generated from
 * the same data, not translated English text. This is what keeps the app
 * fully functional and demoable with zero API key: the OpenRouter client
 * (llmClient.js) only upgrades tone/naturalness on top of this.
 *
 * Distances are described qualitatively ("very close by") rather than with
 * a fabricated unit of measurement, since the venue's x/y grid is an
 * illustrative layout, not a calibrated real-world floor plan.
 */

/** @type {SupportedLanguage[]} */
export const SUPPORTED_LANGUAGES = ["en", "es", "fr", "pt", "ar"];

/** @type {Record<SupportedLanguage, FacilityLabels>} */
const FACILITY_LABELS = {
  en: { restroom: "accessible restroom", elevator: "elevator", medical: "medical point", quiet_room: "quiet room", info_desk: "guest services desk", concession: "concession stand" },
  es: { restroom: "baño accesible", elevator: "ascensor", medical: "punto médico", quiet_room: "sala tranquila", info_desk: "mostrador de atención", concession: "puesto de comida" },
  fr: { restroom: "toilettes accessibles", elevator: "ascenseur", medical: "poste médical", quiet_room: "salle calme", info_desk: "accueil visiteurs", concession: "stand de restauration" },
  pt: { restroom: "banheiro acessível", elevator: "elevador", medical: "posto médico", quiet_room: "sala tranquila", info_desk: "balcão de atendimento", concession: "banca de lanches" },
  ar: { restroom: "دورة مياه لذوي الاحتياجات الخاصة", elevator: "مصعد", medical: "نقطة طبية", quiet_room: "غرفة هادئة", info_desk: "مكتب خدمة الزوار", concession: "كشك مأكولات" },
};

/** @type {Record<SupportedLanguage, LocalizedStrings>} */
const T = {
  en: {
    distanceVeryClose: "very close by",
    distanceShort: "a short walk away",
    distanceFar: "a bit of a walk away",
    poiFound: "The nearest option for you is {name}, {distanceDesc}.",
    crowdWarning: " Heads up — that area is fairly busy right now (about {pct}% capacity).",
    alternativesIntro: " Other options nearby: {alts}.",
    poiNotFound: "I couldn't find an accessible {facility} matching your needs right now — please ask any staff member at the nearest guest services desk.",
    gateFound: "Head to {gate} to reach {section}.",
    gateOverride: " Note: {nearest} is closer, but isn't step-free, so I've routed you to {chosen} instead.",
    gateNotFound: "I need your seat section to plan a route to your seat — please select it above.",
  },
  es: {
    distanceVeryClose: "muy cerca",
    distanceShort: "a poca distancia caminando",
    distanceFar: "a cierta distancia caminando",
    poiFound: "La opción más cercana para ti es {name}, {distanceDesc}.",
    crowdWarning: " Aviso: esa zona está bastante concurrida ahora mismo (alrededor del {pct}% de capacidad).",
    alternativesIntro: " Otras opciones cercanas: {alts}.",
    poiNotFound: "No encontré un/a {facility} accesible que coincida con tus necesidades ahora mismo — por favor pregunta a cualquier miembro del personal en el mostrador de atención más cercano.",
    gateFound: "Dirígete a {gate} para llegar a {section}.",
    gateOverride: " Nota: {nearest} está más cerca, pero no tiene acceso sin escalones, así que te he dirigido a {chosen} en su lugar.",
    gateNotFound: "Necesito tu sección de asiento para planear una ruta — por favor selecciónala arriba.",
  },
  fr: {
    distanceVeryClose: "tout près",
    distanceShort: "à quelques pas",
    distanceFar: "à une certaine distance à pied",
    poiFound: "L'option la plus proche pour vous est {name}, {distanceDesc}.",
    crowdWarning: " Attention : cette zone est assez fréquentée en ce moment (environ {pct} % de capacité).",
    alternativesIntro: " Autres options à proximité : {alts}.",
    poiNotFound: "Je n'ai pas trouvé de {facility} accessible correspondant à vos besoins pour le moment — veuillez demander à un membre du personnel près de l'accueil visiteurs le plus proche.",
    gateFound: "Dirigez-vous vers {gate} pour rejoindre {section}.",
    gateOverride: " Remarque : {nearest} est plus proche, mais n'est pas accessible sans marches, je vous ai donc dirigé vers {chosen} à la place.",
    gateNotFound: "J'ai besoin de votre section de siège pour planifier un itinéraire — veuillez la sélectionner ci-dessus.",
  },
  pt: {
    distanceVeryClose: "bem perto",
    distanceShort: "a uma curta caminhada",
    distanceFar: "a uma caminhada um pouco mais longa",
    poiFound: "A opção mais próxima para você é {name}, {distanceDesc}.",
    crowdWarning: " Atenção: essa área está bastante movimentada agora (cerca de {pct}% da capacidade).",
    alternativesIntro: " Outras opções próximas: {alts}.",
    poiNotFound: "Não encontrei um(a) {facility} acessível que atenda às suas necessidades no momento — por favor, fale com qualquer funcionário no balcão de atendimento mais próximo.",
    gateFound: "Vá até {gate} para chegar a {section}.",
    gateOverride: " Nota: {nearest} fica mais perto, mas não tem acesso livre de degraus, então direcionei você para {chosen}.",
    gateNotFound: "Preciso da sua seção de assento para planejar uma rota — selecione-a acima.",
  },
  ar: {
    distanceVeryClose: "قريب جدًا",
    distanceShort: "على بعد مسافة قصيرة سيرًا على الأقدام",
    distanceFar: "على بعد مسافة أطول قليلًا سيرًا على الأقدام",
    poiFound: "أقرب خيار لك هو {name}، وهو {distanceDesc}.",
    crowdWarning: " تنبيه: هذه المنطقة مزدحمة حاليًا (حوالي {pct}% من السعة).",
    alternativesIntro: " خيارات أخرى قريبة: {alts}.",
    poiNotFound: "لم أجد {facility} مناسبًا لاحتياجاتك في الوقت الحالي — يرجى سؤال أي موظف عند أقرب مكتب لخدمة الزوار.",
    gateFound: "توجّه إلى {gate} للوصول إلى {section}.",
    gateOverride: " ملاحظة: {nearest} أقرب، لكنه غير خالٍ من الدرجات، لذا تم توجيهك إلى {chosen} بدلاً منه.",
    gateNotFound: "أحتاج إلى معرفة قسم مقعدك لتخطيط المسار — يرجى تحديده أعلاه.",
  },
};

/**
 * Fill `{token}` placeholders in a template string with values from `vars`.
 * @param {string} template
 * @param {Record<string, string | number>} vars
 * @returns {string}
 */
function format(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ""));
}

/**
 * Buckets a raw grid distance into a qualitative tier. Exported (not just
 * used internally) so llmClient.js can strip the raw number before it ever
 * reaches the model — a bare "distance: 1.4" has no unit, and an LLM asked
 * to phrase it will happily invent one ("140 meters"). Everything downstream
 * of this function only ever sees a qualitative tier, never the raw number.
 * @param {number} distanceValue
 * @returns {DistanceBucket}
 */
export function distanceBucket(distanceValue) {
  if (distanceValue < 3) return "veryClose";
  if (distanceValue < 10) return "short";
  return "far";
}

/**
 * Qualitative distance description, localized.
 * @param {LocalizedStrings} strings
 * @param {number} distanceValue
 * @returns {string}
 */
function describeDistance(strings, distanceValue) {
  const labelsByBucket = { veryClose: strings.distanceVeryClose, short: strings.distanceShort, far: strings.distanceFar };
  return labelsByBucket[distanceBucket(distanceValue)];
}

/**
 * Compose a fully offline, localized reply from a routingEngine.findRoute()
 * result. `language` falls back to English if unsupported.
 * @param {RouteResult} routeResult
 * @param {string} language
 * @returns {string}
 */
export function composeOfflineMessage(routeResult, language) {
  // Cast justified by the runtime check on the same line: SUPPORTED_LANGUAGES.includes()
  // (against the broader `string[]` view below) confirms the invariant before we rely on it.
  const isSupported = /** @type {string[]} */ (SUPPORTED_LANGUAGES).includes(language);
  const lang = /** @type {SupportedLanguage} */ (isSupported ? language : "en");
  const strings = T[lang];
  const labels = FACILITY_LABELS[lang];

  if (routeResult.intent === "seat") {
    if (!routeResult.chosen) return strings.gateNotFound;
    const gate = routeResult.chosen;
    let message = format(strings.gateFound, { gate: gate.name, section: gate.targetSection ?? "" });
    const overrideRule = routeResult.appliedRules.find((r) => r.includes("routed to"));
    if (overrideRule) {
      // Structured override detection: the engine only produces this specific
      // rule shape when it substituted a non-nearest, accessible gate.
      const nearestGate = routeResult.appliedRules
        .find((r) => r.includes("closest"))
        ?.split(" is geographically")[0];
      if (nearestGate) {
        message += format(strings.gateOverride, { nearest: nearestGate, chosen: gate.name });
      }
    }
    return message;
  }

  if (!routeResult.chosen) {
    // routeResult.intent is narrowed to PoiType | "unknown" here (the "seat"
    // case already returned above); FACILITY_LABELS only defines PoiType
    // keys, so an "unknown" intent falls through to the info_desk default.
    const facility = labels[/** @type {PoiType} */ (routeResult.intent)] || labels.info_desk;
    return format(strings.poiNotFound, { facility });
  }

  const poi = routeResult.chosen;
  // distance/crowdDensity are optional on RouteChosen in general (a "seat"
  // result has neither), but always present on a non-seat `chosen` — this
  // branch's own construction in routingEngine.js guarantees it. Defaulted
  // rather than asserted, so a future change that violates that invariant
  // degrades gracefully instead of throwing.
  const poiDistance = poi.distance ?? 0;
  const poiCrowdDensity = poi.crowdDensity ?? 0;

  let message = format(strings.poiFound, {
    name: poi.name,
    distanceDesc: describeDistance(strings, poiDistance),
  });

  if (poiCrowdDensity >= 0.7) {
    message += format(strings.crowdWarning, { pct: Math.round(poiCrowdDensity * 100) });
  }

  if (routeResult.alternatives.length > 0) {
    const altNames = routeResult.alternatives.map((a) => a.name).join(lang === "ar" ? "، " : ", ");
    message += format(strings.alternativesIntro, { alts: altNames });
  }

  return message;
}
