# -*- coding: utf-8 -*-
"""Text content for the Egypt book. Each page: slot image + copy + fact strip."""

TITLE = "EGYPT"
SUBTITLE = "Five Thousand Years on the Nile"
BYLINE = "A short illustrated history, from the first flood to the Grand Egyptian Museum"

PARTS = [
    dict(number="I", title="THE ANCIENT KINGDOM",
         span="c. 5000 BC – AD 394",
         blurb="Three thousand years of pharaohs is a longer stretch of time than "
               "separates Cleopatra from us. What follows are ten moments from it.",
         image="part1", fallback="djoser", motif="pyramid"),
    dict(number="II", title="THE MODERN NATION",
         span="1805 – 2025",
         blurb="A viceroy, a canal, a revolution, two wars and a museum: how the "
               "country on top of the ruins made itself.",
         image="part2", fallback="suez1869", motif="wave"),
]

PAGES = [
 # ───────────────────────────── PART I ─────────────────────────────
 dict(part=0, slot="nile", motif="wave",
   era="c. 5000 – 3100 BC", title="The Gift of the River",
   caption="Feluccas on the Nile at Aswan. The current runs north, the prevailing wind blows "
           "south: the river carried traffic both ways long before there were roads.",
   deck="Egypt is a thread of green drawn through a desert the size of a continent — and every "
        "inch of it was laid down by one river.",
   body=[
     "Herodotus called Egypt the gift of the river, and for once the tourist's cliché is literally "
     "true. Rain almost never falls on the Nile valley. What made the valley farmable was the "
     "flood: each summer, monsoon rain on the Ethiopian highlands sent the Blue Nile down in a "
     "surge that spread across the floodplain and left behind a layer of black silt.",
     "Egyptians named their country after that silt — Kemet, the black land — and set it against "
     "Deshret, the red land of desert on either side. The distinction was not poetic. Beyond the "
     "reach of the flood, nothing grew; within it, one of the most reliable harvests in the "
     "ancient world came up year after year.",
     "Farming villages appear along the valley and in the Fayum from around 5000 BC, and by the "
     "Naqada period their potters, coppersmiths and boatbuilders were trading the length of the "
     "river. The Nile was a highway with a rare property: its current flows north while the "
     "prevailing wind blows south, so a boat could drift down and sail back up. A single valley "
     "could be governed as one place.",
     "It could also be measured. Nilometers cut into the rock at Elephantine let officials read "
     "the height of the coming flood and set the year's taxes against it. Too low meant famine; "
     "too high meant washed-out villages. Out of that arithmetic — surplus grain, a calendar of "
     "three seasons, scribes to record both — grew the machinery of a state.",
   ],
   facts=[("6,650 km", "length of the Nile"), ("3%", "of Egypt that is farmland"),
          ("3 seasons", "flood, growth, harvest")]),

 dict(part=0, slot="narmer", motif="star",
   era="c. 3100 BC", title="Two Lands, One Crown",
   caption="The Narmer Palette, found at Hierakonpolis in 1898. The king, wearing the white crown "
           "of Upper Egypt, strikes down an enemy — the oldest royal image we can read.",
   deck="The first thing Egypt recorded about itself was a conquest, carved on a slab used for "
        "grinding eye paint.",
   body=[
     "On one face of a shield-shaped stone palette a king in the tall white crown of the south "
     "raises a mace over a kneeling captive. Turn it over and the same king, now in the flat red "
     "crown of the northern Delta, walks in procession past rows of beheaded enemies. Small signs "
     "beside his head spell out a name: Narmer.",
     "Egyptologists once read the palette as a snapshot of the day Upper and Lower Egypt became "
     "one country. The truth is slower and more interesting. Unification looks to have taken "
     "generations of pressure from the southern towns — Hierakonpolis, Naqada, Abydos — before a "
     "single dynasty held the whole valley. What the palette records is not the event but the "
     "idea: one man, two crowns, a country defined by the joining of its halves.",
     "That idea outlived every dynasty that used it. For the next three millennia the pharaoh was "
     "Lord of the Two Lands, and coronation meant putting on both crowns. A new capital, Memphis, "
     "was planted at the hinge between them where the valley opens into the Delta.",
     "The palette also carries some of the earliest hieroglyphs — writing that begins, as it so "
     "often does, in the service of accounting and royal propaganda rather than literature.",
   ],
   facts=[("64 cm", "height of the palette"), ("c. 3200 BC", "first hieroglyphs"),
          ("30", "dynasties to come")]),

 dict(part=0, slot="djoser", motif="pyramid",
   era="c. 2670 BC", title="The First Pyramid",
   caption="The Step Pyramid of Djoser at Saqqara, the oldest large stone building in the world, "
           "restored and reopened to visitors in 2020.",
   deck="Before Djoser, kings were buried under flat mud-brick benches. His architect stacked six "
        "of them in stone and invented monumental architecture.",
   body=[
     "The Step Pyramid began as a mastaba — the low rectangular tomb standard for the first two "
     "dynasties — and then kept growing. Six diminishing stages went up over the original block "
     "until the structure stood some 62 metres above the Saqqara plateau, visible from the "
     "capital at Memphis.",
     "Its architect is the first in history whose name survives: Imhotep, also Djoser's vizier "
     "and high priest. Two thousand years later Egyptians were worshipping him as a god of "
     "healing, and the Greeks identified him with Asclepius — an unusual career for a civil "
     "servant.",
     "What made the leap possible was a change of material. Imhotep's masons cut limestone into "
     "small blocks about the size of the mud bricks they replaced, so existing building habits "
     "still worked. Around the pyramid they laid out a walled enclosure of some fifteen hectares "
     "filled with dummy buildings: shrines with no interiors, doors carved permanently open, a "
     "stone stage-set where the dead king could run his jubilee festival forever.",
     "Everything that follows at Meidum, Dahshur and Giza is an argument with this building — how "
     "to make the steps smooth, how to make it bigger, how to make it last.",
   ],
   facts=[("62 m", "original height"), ("15 ha", "walled enclosure"),
          ("Imhotep", "first named architect")]),

 dict(part=0, slot="khufu", motif="pyramid",
   era="c. 2560 BC", title="The Great Pyramid",
   caption="The pyramid of Khufu at Giza. It was the tallest structure built by humans for "
           "roughly 3,800 years.",
   deck="Two and a half million blocks, laid to a tolerance modern surveyors respect — and we "
        "finally know who moved them, because one of the foremen kept a diary.",
   body=[
     "Khufu's pyramid rose 146.6 metres, covered thirteen acres, and was set out with its sides "
     "aligned to true north within a fifteenth of a degree. The base is level to a few "
     "centimetres across more than five hectares. Whatever else the Fourth Dynasty had, it had "
     "surveying.",
     "For centuries the labour behind it was imagined as mass slavery, an image owed more to "
     "Hollywood and the Book of Exodus than to evidence. Excavation of the workers' town south of "
     "the plateau found bakeries, breweries, cattle bones and a cemetery of workers buried with "
     "care near the king they built for — the profile of a paid, rotating workforce, not a "
     "chain gang.",
     "In 2013 the argument was settled by paperwork. At Wadi al-Jarf on the Red Sea, "
     "archaeologists found the oldest inscribed papyri yet known, including the logbook of an "
     "inspector named Merer. It records his crew ferrying fine limestone from the Tura quarries "
     "to Giza, trip by trip, in the twenty-seventh year of Khufu's reign.",
     "The king himself is nearly invisible. The only certain likeness of the man who built the "
     "largest tomb on earth is an ivory figurine three inches high.",
   ],
   facts=[("146.6 m", "original height"), ("2.3 million", "blocks of stone"),
          ("7.5 cm", "his only certain portrait")]),

 dict(part=0, slot="hatshepsut", motif="column",
   era="c. 1479 – 1458 BC", title="The Woman Who Was King",
   caption="The terraced mortuary temple of Hatshepsut at Deir el-Bahari, cut into the cliffs "
           "opposite Luxor.",
   deck="She began as regent for a stepson too young to rule, and ended with the full titulary of "
        "a pharaoh — beard included.",
   body=[
     "Hatshepsut took power as regent for the child Thutmose III and within a few years had "
     "assumed the complete royal titulary. Egyptian art had no vocabulary for a female king, so "
     "her sculptors used the existing one: she appears in the kilt, the headcloth and the "
     "ceremonial false beard, while the inscriptions beside her keep the feminine endings.",
     "Her reign is notable for what it did not do. There is little campaigning; instead there is "
     "trade. The temple walls at Deir el-Bahari carry a detailed record of a naval expedition to "
     "Punt, on the Red Sea coast, returning with ebony, ivory, gold, myrrh and living incense "
     "trees with their root-balls wrapped for the voyage — an early picture of a supply chain.",
     "The temple itself, laid out by her steward Senenmut against the cliffs at Deir el-Bahari, "
     "is the most modern-looking building to survive from the ancient world: three colonnaded "
     "terraces answering the horizontal strata of the rock behind them.",
     "Late in Thutmose III's own reign her images were chiselled out and her name left off the "
     "king lists. The erasure came decades after her death, which argues for dynastic "
     "housekeeping — securing his own line of succession — rather than a grudge.",
   ],
   facts=[("~22 years", "on the throne"), ("Punt", "the great trading voyage"),
          ("3 terraces", "at Deir el-Bahari")]),

 dict(part=0, slot="akhenaten", motif="sun",
   era="c. 1353 – 1336 BC", title="The Heretic and the Queen",
   caption="The painted bust of Nefertiti, found at Amarna in 1912 in the workshop of the "
           "sculptor Thutmose, now in Berlin.",
   deck="One king tried to replace the gods of Egypt with a single disc of light. It lasted "
        "about seventeen years.",
   body=[
     "Amenhotep IV changed his name to Akhenaten, closed the temples of Amun, and moved the court "
     "to a virgin site in the desert that he called Akhetaten — the Horizon of the Aten. The Aten "
     "was the sun's disc itself, shown as a circle with rays ending in small hands, and its only "
     "authorised interpreter was the king.",
     "Art changed with the theology. The rigid ideal of earlier reigns gave way to elongated "
     "skulls, heavy hips and slack bellies, and to domestic scenes with no precedent: the royal "
     "couple with daughters on their laps, eating, kissing, mourning a dead child.",
     "The archive found at the site — the Amarna letters, written in Akkadian on clay — shows the "
     "other side of the experiment. Vassals in Canaan and Syria write again and again for troops "
     "that do not come while Egypt's northern position quietly erodes.",
     "Within a few years of his death the court was back at Thebes, the old gods were restored, "
     "and Akhenaten had been struck from the official king lists as 'the enemy'. He survived only "
     "because his abandoned capital was never built over — and because a German expedition "
     "opened a sculptor's studio there in 1912 and found his wife's face on a shelf.",
   ],
   facts=[("17 years", "of the Aten"), ("1912", "Nefertiti bust found"),
          ("382", "Amarna letters known")]),

 dict(part=0, slot="tutankhamun", motif="star",
   era="c. 1332 – 1323 BC", title="The Boy King",
   caption="The gold funerary mask of Tutankhamun, inlaid with lapis lazuli, carnelian and "
           "coloured glass, on display in Cairo.",
   deck="He was a minor pharaoh who died before he was twenty. He matters because of what did "
        "not happen to his tomb.",
   body=[
     "Tutankhaten came to the throne as a child in the wreckage of his father's revolution. Under "
     "the guidance of the old court he changed his name to Tutankhamun, restored the temples of "
     "Amun and left a stela describing the country he had inherited as one whose gods had turned "
     "their backs on it.",
     "He ruled for about nine years and died around the age of nineteen. Examination of the body "
     "and of DNA from related mummies points to a frail young man — a club foot, malaria, a "
     "badly broken leg — rather than the murder plot of popular legend, though the evidence "
     "remains argued over.",
     "His burial was hurried. The tomb, KV62, is small and oddly proportioned for a king, its "
     "walls painted in haste. That modesty saved it: within a couple of generations the entrance "
     "was buried under the spoil heaps of a grander tomb next door and the robbers who emptied "
     "every other royal burial in the valley never found it.",
     "So the only pharaoh's grave to survive nearly intact belongs to the one nobody thought "
     "important — 5,398 objects, from chariots and folding beds to a mask of eleven kilograms of "
     "gold. What the world pictures when it pictures Egypt is largely the contents of a "
     "second-rank funeral.",
   ],
   facts=[("~19", "age at death"), ("5,398", "objects in the tomb"),
          ("10.2 kg", "gold in the mask")]),

 dict(part=0, slot="ramesses", motif="column",
   era="c. 1279 – 1213 BC", title="The Builder and the Battle",
   caption="The Great Temple at Abu Simbel, cut into the cliff and guarded by four seated "
           "colossi of Ramesses II, each about twenty metres high.",
   deck="Ramesses II reigned for sixty-six years, fought the ancient world's most famous draw, "
        "and then signed the first peace treaty we can still read.",
   body=[
     "In 1274 BC, at Kadesh on the Orontes, Ramesses walked into a Hittite ambush with his army "
     "strung out on the march. By his own account, carved across half the temples of Egypt, he "
     "rallied alone and broke the enemy. The Hittite records claim the field. Modern reading of "
     "both makes it a bloody stalemate that left the frontier roughly where it started.",
     "What followed is the more remarkable document. About sixteen years later Egypt and Hatti "
     "agreed terms — mutual defence, non-aggression, the return of fugitives — and both copies "
     "survive, one in Egyptian on a temple wall at Karnak, one in Akkadian on clay from the "
     "Hittite capital. It is the earliest international peace treaty whose text we have from both "
     "sides. A replica hangs at the United Nations.",
     "The rest of the reign was construction on an industrial scale: the Ramesseum, additions at "
     "Karnak and Luxor, a new Delta capital, and the two rock-cut temples at Abu Simbel, aligned "
     "so that twice a year the rising sun reaches the statues in the innermost sanctuary.",
     "Those temples were sawn into more than a thousand blocks in the 1960s and rebuilt sixty-five "
     "metres higher to keep them above the rising water of the Aswan reservoir.",
   ],
   facts=[("66 years", "on the throne"), ("1274 BC", "the battle of Kadesh"),
          ("1,036", "blocks Abu Simbel was cut into")]),

 dict(part=0, slot="cleopatra", motif="star",
   era="51 – 30 BC", title="The Last Pharaoh",
   caption="Ptolemaic and Roman-era relief carving at Dendera, where the temple of Hathor "
           "preserves images of Cleopatra VII and her son Caesarion.",
   deck="She was Greek, she was the first of her dynasty to bother learning Egyptian, and she was "
        "the last person to rule Egypt as an independent state for nearly two thousand years.",
   body=[
     "Alexander took Egypt from the Persians in 332 BC; on his death his general Ptolemy kept it. "
     "For three centuries the Ptolemies ruled from Alexandria as pharaohs on temple walls and "
     "Macedonian kings everywhere else, speaking Greek, marrying their siblings and funding the "
     "Library.",
     "Cleopatra VII inherited a kingdom that was already, in practice, a Roman client. Her "
     "response was to attach herself to whichever Roman was winning — Julius Caesar, and after "
     "his murder Mark Antony — and to trade Egypt's grain and money for a share of the outcome.",
     "It failed at Actium in 31 BC. Antony and Cleopatra lost the fleet, then Alexandria, then "
     "their lives; her son by Caesar was killed on Octavian's orders. Egypt became not a province "
     "like other provinces but the personal estate of the emperor, and its wheat fed Rome.",
     "The old religion outlasted the last pharaoh by four centuries. The final dated hieroglyphic "
     "inscription was cut at Philae in AD 394, and the last demotic a generation later. The "
     "language itself did not die: written in Greek letters, it became Coptic, and is still sung "
     "in Egyptian churches.",
   ],
   facts=[("332 BC", "Alexander arrives"), ("31 BC", "the battle of Actium"),
          ("AD 394", "last hieroglyphs cut")]),

 dict(part=0, slot="hunefer", motif="sun",
   era="the written record", title="Words of the God",
   caption="From the Book of the Dead of Hunefer, c. 1275 BC: the heart of the dead man is "
           "weighed against the feather of truth while Thoth records the verdict.",
   deck="For three and a half thousand years Egypt wrote everything down. Then, for fourteen "
        "hundred, nobody could read it.",
   body=[
     "Hieroglyphs are not picture-writing in the sense usually meant. The signs work as sounds, as "
     "whole words, and as silent markers that tell you which kind of word you are looking at — a "
     "system flexible enough to handle poetry, contracts, medical texts and shopping lists.",
     "Three scripts ran in parallel: monumental hieroglyphs for stone, cursive hieratic for "
     "papyrus, and from about 650 BC the faster demotic for daily business. When Egypt turned "
     "Christian and then Muslim the scripts fell out of use, and the meaning was lost so "
     "thoroughly that medieval scholars read the signs as mystical symbols.",
     "The key came out of the ground at Rosetta in 1799 during Napoleon's occupation: one decree, "
     "three scripts, the Greek version readable. Jean-François Champollion announced the "
     "decipherment in 1822, working from the Rosetta Stone and from Coptic, the descendant "
     "language still in liturgical use.",
     "What the texts gave back was an interior life. The Book of the Dead is a working manual for "
     "getting through the underworld, and its central scene is a courtroom: the heart weighed "
     "against the feather of Maat, order and truth. Balance, and you pass. Fail, and the monster "
     "waiting beside the scales eats you, and you simply stop existing.",
   ],
   facts=[("c. 3200 BC", "writing begins"), ("1799", "Rosetta Stone found"),
          ("1822", "Champollion reads it")]),

 # ───────────────────────────── PART II ─────────────────────────────
 dict(part=1, slot="muhammadali", motif="star",
   era="1805 – 1848", title="The Pasha Who Made a State",
   caption="Muhammad Ali Pasha, painted by Auguste Couder in 1841. An Ottoman officer from "
           "Kavala, he founded the dynasty that ruled Egypt until 1952.",
   deck="Napoleon's invasion lasted three years and changed nothing. The Albanian sergeant who "
        "filled the vacuum afterwards changed everything.",
   body=[
     "The French occupation of 1798–1801 broke the old order in Egypt without replacing it. Into "
     "the wreckage stepped Muhammad Ali, commander of an Albanian contingent in the Ottoman "
     "force sent to restore order, who by 1805 had manoeuvred the notables of Cairo into naming "
     "him governor. In 1811 he removed the last of his rivals by inviting the Mamluk beys to a "
     "banquet in the Citadel and having them shot on the way out.",
     "What he built afterwards was recognisably a modern state, assembled with a ruthlessness "
     "that its subjects paid for. Peasants were conscripted into a standing army drilled on the "
     "French model. Long-staple cotton was introduced and the whole crop bought and sold by the "
     "government at prices it set. Canals were dug, a barrage begun, schools of medicine and "
     "engineering opened, and a state press at Bulaq printed textbooks in Arabic.",
     "He very nearly took the Ottoman Empire with it. His armies held Syria and were marching on "
     "Istanbul when the European powers intervened in 1840 and forced him back — in exchange for "
     "hereditary rule of Egypt for his family.",
     "That bargain shaped the next century: an Egypt nominally Ottoman, practically independent, "
     "and increasingly financed by European banks.",
   ],
   facts=[("1805", "seizes power"), ("1811", "the Citadel massacre"),
          ("147 years", "his dynasty lasted")]),

 dict(part=1, slot="suez1869", motif="wave",
   era="1869", title="A Ditch Between Two Seas",
   caption="The inauguration of the Suez Canal, 17 November 1869. A procession of ships led by "
           "the French imperial yacht sailed from Port Said to Ismailia.",
   deck="The canal cut 7,000 kilometres off the voyage from London to Bombay. It also cost Egypt "
        "its independence.",
   body=[
     "Ferdinand de Lesseps got his concession from the viceroy Said in 1854 and broke ground in "
     "1859. The first years of digging were done by corvée — forced labour levied from the "
     "villages, tens of thousands of men at a time, working the sand by hand. Deaths ran high "
     "enough that international pressure eventually pushed the company towards machines.",
     "The opening on 17 November 1869 was staged as a global event: the Empress Eugénie at the "
     "head of the procession, guests shipped in from every European capital, an opera house built "
     "in Cairo for the occasion. Verdi's Aida, commissioned around it, arrived late and premiered "
     "there in 1871.",
     "Egypt had borrowed enormously for the canal and for the modernisation around it, on terms "
     "that were punitive from the start. By 1875 the khedive Ismail was insolvent and sold "
     "Egypt's shares in the canal company to the British government. Debt commissioners followed, "
     "then a nationalist revolt, then in 1882 a British fleet at Alexandria and an occupation "
     "that would last, in one form or another, for seventy-four years.",
     "The waterway itself did exactly what was promised. Roughly a tenth of world seaborne trade "
     "still passes through it.",
   ],
   facts=[("164 km", "original length"), ("1875", "shares sold to Britain"),
          ("~10%", "of world trade today")]),

 dict(part=1, slot="carter1922", motif="star",
   era="1922", title="Wonderful Things",
   caption="Howard Carter and his assistant Arthur Callender at work in the tomb of Tutankhamun, "
           "photographed by Harry Burton during the clearance.",
   deck="Egypt got its nominal independence and its most famous tomb in the same year, and the "
        "two facts turned out to be connected.",
   body=[
     "By 1922 Howard Carter had been digging in the Valley of the Kings for years with nothing to "
     "show, and his patron Lord Carnarvon had agreed to fund one final season. On 4 November a "
     "water boy clearing sand near the tomb of Ramesses VI uncovered a cut step. Sixteen steps "
     "and a sealed door later, on 26 November, Carter made a hole, held a candle to it, and was "
     "asked whether he could see anything. 'Yes,' he said. 'Wonderful things.'",
     "Clearing the four small rooms took ten years and a discipline unusual for the period: every "
     "object was photographed in place by Harry Burton, catalogued, and conserved before it moved.",
     "The find landed in the middle of a political argument. Britain had declared Egypt formally "
     "independent on 28 February 1922 while keeping control of defence, foreign policy and the "
     "Sudan. Carnarvon's attempt to sell exclusive coverage to The Times, and the assumption that "
     "the finds would be split with London, ran straight into a nationalist press that treated "
     "the tomb as Egyptian property.",
     "It stayed. The whole collection remained in Egypt, and a generation of Egyptian politicians "
     "and artists took up the pharaonic past as national inheritance rather than tourist curiosity.",
   ],
   facts=[("4 Nov 1922", "the step found"), ("10 years", "to clear the tomb"),
          ("28 Feb 1922", "nominal independence")]),

 dict(part=1, slot="revolution1952", motif="star",
   era="1952 – 1954", title="The Officers",
   caption="Muhammad Naguib, the public face of the Free Officers, with Gamal Abdel Nasser, who "
           "organised the movement and later replaced him.",
   deck="A conspiracy of junior officers took Cairo in a night, and the monarchy was on a boat "
        "within three days.",
   body=[
     "The defeat of 1948 in Palestine, an economy still run for the benefit of foreign "
     "bondholders and a court widely seen as a British appendage produced, among mid-ranking "
     "officers, the Free Officers movement. On the night of 22–23 July 1952 they seized army "
     "headquarters, the broadcasting station and the telephone exchange, and announced the change "
     "over the radio at dawn.",
     "King Farouk abdicated on 26 July and sailed from Alexandria on the royal yacht. There was "
     "almost no bloodshed. General Muhammad Naguib, senior and respectable, was given the front "
     "of the movement; Gamal Abdel Nasser, who had built it, stayed behind him for two years.",
     "The first substantive act was land reform in September 1952, capping individual holdings at "
     "two hundred feddans and breaking the political power of the great estates. The monarchy was "
     "abolished and a republic declared on 18 June 1953.",
     "By 1954 the two men at the top had diverged — Naguib favouring a return to parliamentary "
     "politics, Nasser and the Revolutionary Command Council against it. Nasser won, Naguib was "
     "placed under house arrest, and Egypt acquired the pattern of rule by an officer-president "
     "that it has broken only briefly since.",
   ],
   facts=[("23 July 1952", "the coup"), ("26 July", "Farouk abdicates"),
          ("18 June 1953", "republic declared")]),

 dict(part=1, slot="nasser", motif="star",
   era="1956 – 1970", title="Nasser",
   caption="Gamal Abdel Nasser in 1962. Nationalising the Suez Canal Company made him, for a "
           "decade, the most popular politician in the Arab world.",
   deck="He lost the battle for the canal and won the argument — which set the pattern, good and "
        "bad, for everything that followed.",
   body=[
     "When Washington and London withdrew their offer to finance the Aswan High Dam, Nasser "
     "answered on 26 July 1956 with a speech in Alexandria announcing the nationalisation of the "
     "Suez Canal Company. Its revenues, he said, would build the dam instead.",
     "Britain and France, with Israel, invaded in October under a pretext agreed in advance. "
     "Militarily it worked; politically it collapsed. The United States, unwilling to be "
     "associated with a colonial adventure, applied financial pressure on the pound; the Soviet "
     "Union threatened worse. The invaders withdrew, and a defeat in the field became the "
     "founding victory of Arab nationalism.",
     "For ten years Nasser was the voice of that project — non-alignment, Arab unity, land "
     "reform, free schooling and a vast public sector. Egypt and Syria briefly merged as the "
     "United Arab Republic between 1958 and 1961. Radio carried his speeches across every border "
     "in the region.",
     "It ended in six days in June 1967, when Israel destroyed the Egyptian air force on the "
     "ground and took the whole of Sinai. Nasser offered to resign, was kept in place by crowds "
     "in the street, and died of a heart attack in September 1970 at fifty-two. Millions followed "
     "the coffin.",
   ],
   facts=[("26 July 1956", "the canal nationalised"), ("1958–61", "the United Arab Republic"),
          ("1967", "Sinai lost in six days")]),

 dict(part=1, slot="aswan", motif="wave",
   era="1960 – 1970", title="The Dam",
   caption="The Aswan High Dam. Behind it, Lake Nasser stretches more than five hundred "
           "kilometres upstream and across the Sudanese border.",
   deck="Egypt ended the annual flood that had made it. The bargain was electricity and "
        "certainty, paid for in silt, salt and displaced villages.",
   body=[
     "The High Dam is a rockfill embankment 111 metres high and nearly four kilometres long, "
     "built between 1960 and 1970 with Soviet money and engineers after the Western offer was "
     "withdrawn. Behind it lies Lake Nasser, one of the largest artificial lakes in the world.",
     "The gains were real and immediate. The flood no longer arrived as a gamble; water could be "
     "released on demand, allowing two or three crops a year instead of one. The turbines at one "
     "point supplied about half the country's electricity. When drought struck the Sahel in the "
     "1980s, Egypt drew on the reservoir and avoided famine.",
     "The costs are structural. The silt that renewed the fields for five thousand years now "
     "settles behind the dam, so Egyptian farming runs on imported fertiliser and the Delta "
     "coastline, no longer fed with sediment, is eroding into the sea. Salinity has risen. "
     "Waterborne disease spread with year-round irrigation.",
     "And the reservoir drowned Nubia. More than a hundred thousand Nubians were moved to new "
     "settlements far from the river, and their villages, cemeteries and history went under the "
     "water. The temples were saved — Abu Simbel and Philae were cut apart and rebuilt on higher "
     "ground in a UNESCO campaign that invented modern international heritage rescue. The people "
     "were not offered the same engineering.",
   ],
   facts=[("111 m", "dam height"), ("5,250 km²", "Lake Nasser"),
          ("100,000+", "Nubians displaced")]),

 dict(part=1, slot="war1973", motif="wave",
   era="6 October 1973", title="The Crossing",
   caption="Egyptian forces crossing the Suez Canal on pontoon bridges in the opening hours of "
           "the October War.",
   deck="High-pressure water hoses opened the Israeli sand wall in a few hours. That engineering "
        "trick is the reason there was a peace treaty six years later.",
   body=[
     "The Bar-Lev Line was a rampart of sand along the east bank of the canal, high enough that "
     "any assault would have to be preceded by days of visible engineering work. Egyptian "
     "planners solved it with fire pumps: jets of canal water cut breaches through the sand in "
     "hours rather than days.",
     "At two in the afternoon on 6 October 1973 — Yom Kippur, and during Ramadan — artillery "
     "opened and the first waves went across in rubber boats. Within about a day some 80,000 "
     "troops were on the east bank, under an umbrella of Soviet surface-to-air missiles that kept "
     "the Israeli air force at a distance and gave the infantry anti-tank missiles that "
     "surprised the armour sent against them.",
     "The war did not stay won. When Egyptian forces advanced beyond the missile cover in mid "
     "October they were badly mauled, and an Israeli counter-crossing at the Deversoir gap "
     "encircled the Third Army on the west bank before the ceasefire of 25 October.",
     "The military ledger was ambiguous; the political one was not. Egypt had planned and "
     "executed a modern combined-arms operation, and the assumption that the 1967 lines were "
     "permanent was broken. Sadat had the standing at home to do what came next.",
   ],
   facts=[("14:05", "H-hour, 6 October"), ("~80,000", "troops across in a day"),
          ("25 Oct", "ceasefire")]),

 dict(part=1, slot="campdavid", motif="star",
   era="1977 – 1981", title="The Handshake",
   caption="Anwar Sadat, Jimmy Carter and Menachem Begin during the negotiations at Camp David in "
           "September 1978.",
   deck="Sadat flew to Jerusalem, spoke to the Knesset, got Sinai back — and was shot on the "
        "anniversary of his own war.",
   body=[
     "In November 1977 Sadat announced that he would go to Israel in person, and did: a plane "
     "into Ben Gurion airport, a speech to the Knesset, an audience of astonished Arab "
     "governments. It broke a taboo that had held for thirty years.",
     "The negotiations that followed nearly failed. Jimmy Carter kept Sadat and Menachem Begin at "
     "Camp David for thirteen days in September 1978, shuttling between cabins because the two "
     "men could barely be in a room together, and produced two framework agreements signed on 17 "
     "September. The peace treaty followed on 26 March 1979 — the first between Israel and an "
     "Arab state.",
     "Egypt recovered the whole of Sinai, completed by 1982. Sadat and Begin shared the Nobel "
     "Peace Prize. The second framework, on Palestinian autonomy, was never implemented, and that "
     "omission defined the reaction: Egypt was expelled from the Arab League and the League's "
     "headquarters moved out of Cairo for a decade.",
     "On 6 October 1981, at the parade marking the crossing, soldiers from an Islamist cell in "
     "the army opened fire on the reviewing stand and killed him. His vice-president, Hosni "
     "Mubarak, took over and stayed for thirty years.",
   ],
   facts=[("13 days", "at Camp David"), ("26 Mar 1979", "treaty signed"),
          ("1982", "Sinai fully returned")]),

 dict(part=1, slot="tahrir2011", motif="star",
   era="2011", title="Eighteen Days",
   caption="Tahrir Square, central Cairo, filled with demonstrators in February 2011 during the "
           "final week of the protests against Hosni Mubarak.",
   deck="A protest called for Police Day became the largest gathering in modern Egyptian history "
        "— and then the hard part began.",
   body=[
     "The call went out for 25 January 2011, the national holiday honouring the police, and the "
     "turnout was far beyond what the organisers expected. Within days Tahrir Square was "
     "permanently occupied, with field clinics, checkpoints run by volunteers and nightly crowds "
     "in the hundreds of thousands.",
     "The government cut the country off the internet on 28 January, which did not work: protests "
     "spread to Alexandria, Suez and the Delta. On 2 February riders on horses and camels charged "
     "the square in what became known as the Battle of the Camel. The army, deployed but "
     "declining to fire on the crowds, was the decisive variable.",
     "On 11 February, after eighteen days, the vice-president announced that Hosni Mubarak had "
     "stepped down after thirty years, and power passed to the Supreme Council of the Armed "
     "Forces.",
     "What followed satisfied few of the people in the square. A parliamentary election, then "
     "Mohamed Morsi of the Muslim Brotherhood elected president in 2012; mass protests against "
     "him a year later; his removal by the military in July 2013 and a violent dispersal of the "
     "sit-ins that followed; and from 2014 the presidency of Abdel Fattah el-Sisi under a new "
     "constitution. The eighteen days remain the reference point everyone in the argument still "
     "uses.",
   ],
   facts=[("25 Jan 2011", "first day"), ("18 days", "to Mubarak's resignation"),
          ("30 years", "he had ruled")]),

 dict(part=1, slot="gem2025", motif="pyramid",
   era="2025", title="The House of the Pharaohs",
   caption="The Grand Egyptian Museum at Giza, two kilometres from the pyramids, which opened in "
           "full on 1 November 2025.",
   deck="Twenty years, half a million square metres and a billion dollars later, Tutankhamun's "
        "burial is shown whole for the first time since it was buried.",
   body=[
     "The Grand Egyptian Museum sits on the desert edge at Giza with the pyramids framed through "
     "the glass of its north wall. The design, chosen in an international competition won by the "
     "Dublin practice Heneghan Peng, folds the building into the escarpment so that the monuments "
     "outside remain the tallest thing in view.",
     "A colossus of Ramesses II stands in the atrium, moved across Cairo from the railway square "
     "where it had stood for half a century. From there a grand staircase climbs six storeys past "
     "royal statuary towards a window on the plateau — a walk arranged so that the visitor "
     "arrives at the real pyramids after four thousand years of preparation.",
     "The centrepiece is the Tutankhamun collection, all of it: more than five thousand objects "
     "from KV62 displayed together for the first time since Carter's team lifted them out. The "
     "old Egyptian Museum in Tahrir, opened in 1902 and long past capacity, keeps its own "
     "collection and hands over the crowds.",
     "It is a fitting place to stop. The country that has spent two centuries excavating, "
     "arguing over and repatriating its own past has built the largest museum in the world "
     "devoted to a single civilisation — within sight of the tomb that started it.",
   ],
   facts=[("~500,000 m²", "site area"), ("1 Nov 2025", "full opening"),
          ("5,000+", "Tutankhamun objects")]),
]
