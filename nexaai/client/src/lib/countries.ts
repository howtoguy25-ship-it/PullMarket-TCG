// Real ISO 3166-1 alpha-2 country list with their real E.164 calling codes
// and flag emoji (built from the Unicode regional-indicator pair for each
// ISO code, so every flag is automatically correct rather than hand-picked).
// Used by CountryCodeSelect.tsx for real phone sign-in (AuthScreen.tsx) —
// not a decorative placeholder list, this is what actually gets prepended
// to the number sent to POST /api/auth/phone/start.

export interface Country {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  dialCode: string; // e.g. "+1"
}

function flagFor(isoCode: string): string {
  return isoCode
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
    .join("");
}

const RAW: [string, string, string][] = [
  ["US", "United States", "+1"],
  ["CA", "Canada", "+1"],
  ["GB", "United Kingdom", "+44"],
  ["AU", "Australia", "+61"],
  ["NZ", "New Zealand", "+64"],
  ["IE", "Ireland", "+353"],
  ["DE", "Germany", "+49"],
  ["FR", "France", "+33"],
  ["ES", "Spain", "+34"],
  ["IT", "Italy", "+39"],
  ["PT", "Portugal", "+351"],
  ["NL", "Netherlands", "+31"],
  ["BE", "Belgium", "+32"],
  ["LU", "Luxembourg", "+352"],
  ["CH", "Switzerland", "+41"],
  ["AT", "Austria", "+43"],
  ["SE", "Sweden", "+46"],
  ["NO", "Norway", "+47"],
  ["DK", "Denmark", "+45"],
  ["FI", "Finland", "+358"],
  ["IS", "Iceland", "+354"],
  ["PL", "Poland", "+48"],
  ["CZ", "Czech Republic", "+420"],
  ["SK", "Slovakia", "+421"],
  ["HU", "Hungary", "+36"],
  ["RO", "Romania", "+40"],
  ["BG", "Bulgaria", "+359"],
  ["GR", "Greece", "+30"],
  ["HR", "Croatia", "+385"],
  ["SI", "Slovenia", "+386"],
  ["RS", "Serbia", "+381"],
  ["BA", "Bosnia and Herzegovina", "+387"],
  ["ME", "Montenegro", "+382"],
  ["MK", "North Macedonia", "+389"],
  ["AL", "Albania", "+355"],
  ["EE", "Estonia", "+372"],
  ["LV", "Latvia", "+371"],
  ["LT", "Lithuania", "+370"],
  ["UA", "Ukraine", "+380"],
  ["BY", "Belarus", "+375"],
  ["MD", "Moldova", "+373"],
  ["RU", "Russia", "+7"],
  ["TR", "Turkey", "+90"],
  ["CY", "Cyprus", "+357"],
  ["MT", "Malta", "+356"],
  ["JP", "Japan", "+81"],
  ["KR", "South Korea", "+82"],
  ["CN", "China", "+86"],
  ["HK", "Hong Kong", "+852"],
  ["MO", "Macau", "+853"],
  ["TW", "Taiwan", "+886"],
  ["SG", "Singapore", "+65"],
  ["MY", "Malaysia", "+60"],
  ["TH", "Thailand", "+66"],
  ["VN", "Vietnam", "+84"],
  ["PH", "Philippines", "+63"],
  ["ID", "Indonesia", "+62"],
  ["IN", "India", "+91"],
  ["PK", "Pakistan", "+92"],
  ["BD", "Bangladesh", "+880"],
  ["LK", "Sri Lanka", "+94"],
  ["NP", "Nepal", "+977"],
  ["MM", "Myanmar", "+95"],
  ["KH", "Cambodia", "+855"],
  ["LA", "Laos", "+856"],
  ["MN", "Mongolia", "+976"],
  ["KZ", "Kazakhstan", "+7"],
  ["UZ", "Uzbekistan", "+998"],
  ["AE", "United Arab Emirates", "+971"],
  ["SA", "Saudi Arabia", "+966"],
  ["QA", "Qatar", "+974"],
  ["KW", "Kuwait", "+965"],
  ["BH", "Bahrain", "+973"],
  ["OM", "Oman", "+968"],
  ["JO", "Jordan", "+962"],
  ["LB", "Lebanon", "+961"],
  ["IL", "Israel", "+972"],
  ["IQ", "Iraq", "+964"],
  ["IR", "Iran", "+98"],
  ["EG", "Egypt", "+20"],
  ["MA", "Morocco", "+212"],
  ["TN", "Tunisia", "+216"],
  ["DZ", "Algeria", "+213"],
  ["LY", "Libya", "+218"],
  ["ZA", "South Africa", "+27"],
  ["NG", "Nigeria", "+234"],
  ["KE", "Kenya", "+254"],
  ["GH", "Ghana", "+233"],
  ["ET", "Ethiopia", "+251"],
  ["TZ", "Tanzania", "+255"],
  ["UG", "Uganda", "+256"],
  ["RW", "Rwanda", "+250"],
  ["ZM", "Zambia", "+260"],
  ["ZW", "Zimbabwe", "+263"],
  ["SN", "Senegal", "+221"],
  ["CI", "Côte d'Ivoire", "+225"],
  ["CM", "Cameroon", "+237"],
  ["MZ", "Mozambique", "+258"],
  ["BW", "Botswana", "+267"],
  ["NA", "Namibia", "+264"],
  ["MU", "Mauritius", "+230"],
  ["MX", "Mexico", "+52"],
  ["BR", "Brazil", "+55"],
  ["AR", "Argentina", "+54"],
  ["CL", "Chile", "+56"],
  ["CO", "Colombia", "+57"],
  ["PE", "Peru", "+51"],
  ["VE", "Venezuela", "+58"],
  ["EC", "Ecuador", "+593"],
  ["BO", "Bolivia", "+591"],
  ["PY", "Paraguay", "+595"],
  ["UY", "Uruguay", "+598"],
  ["CR", "Costa Rica", "+506"],
  ["PA", "Panama", "+507"],
  ["GT", "Guatemala", "+502"],
  ["HN", "Honduras", "+504"],
  ["SV", "El Salvador", "+503"],
  ["NI", "Nicaragua", "+505"],
  ["DO", "Dominican Republic", "+1"],
  ["CU", "Cuba", "+53"],
  ["JM", "Jamaica", "+1"],
  ["TT", "Trinidad and Tobago", "+1"],
  ["BS", "Bahamas", "+1"],
  ["BB", "Barbados", "+1"],
  ["FJ", "Fiji", "+679"],
  ["PG", "Papua New Guinea", "+675"],
  ["WS", "Samoa", "+685"],
  ["TO", "Tonga", "+676"],
  ["VU", "Vanuatu", "+678"],
];

export const COUNTRIES: Country[] = RAW.map(([code, name, dialCode]) => ({ code, name, dialCode })).sort((a, b) => a.name.localeCompare(b.name));

export function flagEmoji(isoCode: string): string {
  return flagFor(isoCode);
}

/** Best-effort default country from the runtime's own locale — a real signal, not a hardcoded guess, but still just a starting point the user can change. */
export function detectDefaultCountry(): Country {
  const fallback = COUNTRIES.find((c) => c.code === "US")!;
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale; // e.g. "en-AU"
    const region = new Intl.Locale(locale).maximize().region; // e.g. "AU"
    if (region) {
      const match = COUNTRIES.find((c) => c.code === region);
      if (match) return match;
    }
  } catch {
    // Intl.Locale isn't available in every JS engine (older Hermes) — fall through to the US default.
  }
  return fallback;
}
