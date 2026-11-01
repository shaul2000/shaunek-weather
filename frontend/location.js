const countryCodes = `
AW AF AO AI AX AL AD AE AR AM AS AQ TF AG AU AT AZ BI BE BJ BQ BF BD BG BH BS BA BL BY BZ BM BO BR BB BN BT BV BW CF CA CC CH CL CN CI CM CD CG CK CO KM CV CR CU CW CX KY CY CZ DE DJ DM DK DO DZ EC EG ER EH ES EE FI FJ FK FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HK HM VA HN HU IS IN ID IR IQ IE IM IL IT JM JP JE KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MK MG MW MY MV ML MT IM MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SZ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW
`;

const regionCodes = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`;
const allCountryCodes = [...new Set(`${countryCodes} ${regionCodes} US`.trim().split(/\s+/))].sort();
const englishCountryNames = new Intl.DisplayNames(['en'], { type: 'region' });

export function countryName(code) {
  if (!code) return '';
  return englishCountryNames.of(code) || code;
}

export function populateLocationFields(countrySelect, timezoneSelect, profile = {}) {
  countrySelect.replaceChildren(new Option('Select your country', ''));

  const countries = allCountryCodes
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const country of countries) {
    countrySelect.add(new Option(country.name, country.code));
  }
  countrySelect.value = profile.country || '';

  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const supportedTimezones = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : [localTimezone, 'UTC'];
  const timezones = [...new Set([...supportedTimezones, localTimezone, 'UTC'])].sort();

  timezoneSelect.replaceChildren(new Option('Select your time zone', ''));
  for (const timezone of timezones) {
    timezoneSelect.add(new Option(timezone.replaceAll('_', ' '), timezone));
  }
  timezoneSelect.value = profile.timezone || localTimezone;
}
