// src/utils/nflPlayerSlugs.js
//
// NFL player pages (concept, see ./nflPlayerPages.js): each slug's ESPN
// athlete id, and where his draft side comes from — historicalId (drafted
// before the site) or playerId (had a We-Draft prospect page); neither for
// one we have no draft profile of (undrafted, mostly), whose slug ends in
// his ESPN id. Hand-entered while this is a concept.
// No imports, so App.js can route on it without pulling in Firestore.
export const NFL_PLAYER_PAGES = {
  "sam-darnold-2018-qb": { espnId: "3912547", historicalId: "row_1807" },
  "emmett-johnson-2026-rb": { espnId: "4832955", playerId: "row_390" },
  // New York Jets
  "braelon-allen-2024-rb": { espnId: "4685247", historicalId: "row_392" },
  "brant-banks-4426623": { espnId: "4426623" }, // Brant Banks, no draft profile
  "andrew-beck-3125107": { espnId: "3125107" }, // Andrew Beck, no draft profile
  "omar-cooper-jr-2026-wr": { espnId: "4723820", playerId: "row_392" },
  "isaiah-davis-2024-rb": { espnId: "4695404", historicalId: "row_431" },
  "olu-fashanu-2024-ol": { espnId: "4431809", historicalId: "row_269" },
  "breece-hall-2022-rb": { espnId: "4427366", historicalId: "row_810" },
  "cade-klubnik-2026-qb": { espnId: "4685413", playerId: "row_11" },
  "kohl-levao-4373951": { espnId: "4373951" }, // Kohl Levao, no draft profile
  "will-levis-2023-qb": { espnId: "4361418", historicalId: "row_548" },
  "malik-mcclain-4682509": { espnId: "4682509" }, // Malik McClain, no draft profile
  "armand-membou-2025-ol": { espnId: "4789907", historicalId: "row_8" },
  "jordan-meredith-4076803": { espnId: "4076803" }, // Jordan Meredith, no draft profile
  "adonai-mitchell-2024-wr": { espnId: "4597500", historicalId: "row_310" },
  "max-mitchell-2022-ol": { espnId: "4373656", historicalId: "row_885" },
  "josh-myers-2021-ol": { espnId: "4242000", historicalId: "row_1098" },
  "kene-nwangwu-2021-rb": { espnId: "4035537", historicalId: "row_1155" },
  "chukwuma-okorafor-2018-ol": { espnId: "3129473", historicalId: "row_1896" },
  "dylan-parham-2022-ol": { espnId: "4243375", historicalId: "row_864" },
  "jeremy-ruckert-2022-te": { espnId: "4361372", historicalId: "row_875" },
  "kenyon-sadiq-2026-te": { espnId: "5083315", playerId: "row_68" },
  "sterling-shepard-2016-wr": { espnId: "2976592", historicalId: "row_2353" },
  "geno-smith-2013-qb": { espnId: "15864", historicalId: "row_3117" },
  "mason-taylor-2025-te": { espnId: "4808766", historicalId: "row_43" },
  "joe-tippmann-2023-ol": { espnId: "4428681", historicalId: "row_558" },
  "isaiah-williams-4569371": { espnId: "4569371" }, // Isaiah Williams, no draft profile
  "garrett-wilson-2022-wr": { espnId: "4569618", historicalId: "row_784" },
  "jelani-woods-2022-te": { espnId: "4241410", historicalId: "row_847" },
  "david-bailey-2026-edge": { espnId: "4685248", playerId: "row_125" },
  "quinton-bell-2019-edge": { espnId: "3933407", historicalId: "row_1780" },
  "dane-belton-2022-db": { espnId: "4426686", historicalId: "row_888" },
  "jowon-briggs-2024-dl": { espnId: "4426676", historicalId: "row_501" },
  "jarvis-brownlee-jr-2024-db": { espnId: "4426817", historicalId: "row_404" },
  "andre-cisco-2021-db": { espnId: "4361939", historicalId: "row_1101" },
  "demario-davis-2012-lb": { espnId: "14958", historicalId: "row_3409" },
  "kingsley-enagbare-2022-edge": { espnId: "4362840", historicalId: "row_953" },
  "minkah-fitzpatrick-2018-db": { espnId: "3925345", historicalId: "row_1815" },
  "jack-heflin-4039485": { espnId: "4039485" }, // Jack Heflin, no draft profile
  "darrell-jackson-jr-2026-dl": { espnId: "4612836", playerId: "row_115" },
  "jaden-keller-4700756": { espnId: "4700756" }, // Jaden Keller, no draft profile
  "nate-lynn-4574142": { espnId: "4574142" }, // Nate Lynn, no draft profile
  "kiko-mauigoa-4700136": { espnId: "4700136" }, // Kiko Mauigoa, no draft profile
  "will-mcdonald-iv-2023-edge": { espnId: "4361767", historicalId: "row_530" },
  "malachi-moore-2025-db": { espnId: "4692024", historicalId: "row_131" },
  "joseph-ossai-2021-edge": { espnId: "4362094", historicalId: "row_1105" },
  "payton-page-4431582": { espnId: "4431582" }, // Payton Page, no draft profile
  "harrison-phillips-2018-dl": { espnId: "3117255", historicalId: "row_1900" },
  "dangelo-ponds-2026-db": { espnId: "5118340", playerId: "row_159" },
  "troy-reeder-3116177": { espnId: "3116177" }, // Troy Reeder, no draft profile
  "jamien-sherwood-2021-db": { espnId: "4361331", historicalId: "row_1182" },
  "brandon-stephens-2021-db": { espnId: "4035824", historicalId: "row_1140" },
  "qwantez-stiggers-2024-db": { espnId: "5208977", historicalId: "row_434" },
  "azareyeh-thomas-2025-db": { espnId: "4685596", historicalId: "row_74" },
  "trevin-wallace-2024-lb": { espnId: "4683815", historicalId: "row_330" },
  "nahshon-wright-2021-db": { espnId: "4570470", historicalId: "row_1135" },
  "thomas-hennessy-2983155": { espnId: "2983155" }, // Thomas Hennessy, no draft profile
  "austin-mcnamara-4427982": { espnId: "4427982" }, // Austin McNamara, no draft profile
  "jason-sanders-2018-k": { espnId: "3124679", historicalId: "row_2033" },
  "tyler-baron-2025-edge": { espnId: "4692555", historicalId: "row_177" },
  "tre-brown-2021-db": { espnId: "4241373", historicalId: "row_1173" },
  "anez-cooper-2026-ol": { espnId: "4905597", playerId: "row_688" },
  "kingsley-jonathan-4240405": { espnId: "4240405" }, // Kingsley Jonathan, no draft profile
  "caullin-lacy-2026-wr": { espnId: "4430185", playerId: "row_327" },
  "marcelino-mccrary-ball-4045299": { espnId: "4045299" }, // Marcelino McCrary-Ball, no draft profile
  "braiden-mcgregor-4429005": { espnId: "4429005" }, // Braiden McGregor, no draft profile
  "david-onyemata-2016-dl": { espnId: "4002046", historicalId: "row_2433" },
  "tim-patrick-3134353": { espnId: "3134353" }, // Tim Patrick, no draft profile
  "vj-payne-2026-db": { espnId: "4837388", playerId: "row_307" },
  "arian-smith-2025-wr": { espnId: "4429105", historicalId: "row_111" },
  "tvondre-sweat-2024-dl": { espnId: "4428617", historicalId: "row_296" },
  "chip-trayanum-2026-rb": { espnId: "4430893", playerId: "row_461" },
  "mory-bamba-5092196": { espnId: "5092196" }, // Mory Bamba, no draft profile
  "jordan-clark-4429411": { espnId: "4429411" }, // Jordan Clark, no draft profile
  "nick-dawkins-4431060": { espnId: "4431060" }, // Nick Dawkins, no draft profile
  "paschal-ekeji-5279356": { espnId: "5279356" }, // Paschal Ekeji, no draft profile
  "cody-hardy-5086529": { espnId: "5086529" }, // Cody Hardy, no draft profile
  "al-jay-henderson-4599158": { espnId: "4599158" }, // Al-Jay Henderson, no draft profile
  "isaiahh-loudermilk-2021-dl": { espnId: "4035798", historicalId: "row_1192" },
  "amari-mcneill-4708859": { espnId: "4708859" }, // Amari McNeill, no draft profile
  "jimmy-morrissey-2021-ol": { espnId: "4046165", historicalId: "row_1266" },
  "jamaal-pritchett-4892576": { espnId: "4892576" }, // Jamaal Pritchett, no draft profile
  "nathan-voorhis-2026-dl": { espnId: "4880093", playerId: "row_619" },
  "samuel-womack-2022-db": { espnId: "4280416", historicalId: "row_946" },
};

// ESPN athlete id → his page's slug, for linking rosters to these pages.
export const NFL_SLUG_BY_ESPN = Object.fromEntries(Object.entries(NFL_PLAYER_PAGES).map(([slug, cfg]) => [cfg.espnId, slug]));
