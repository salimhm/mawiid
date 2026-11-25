# Translation bot test: 2026-11-25 15:48

15 sentences spoken by bots in fr-FR, en-US, ar-SA, read by one listener bot per language, through the real LiveKit server and AI worker. Scored against the FLEURS human references.

**Result: FAIL**: ar-SA→fr-FR: 2 translation(s) never arrived; ar-SA→en-US: 2 translation(s) never arrived

## Speech-to-text (what the worker heard)

| Spoken language | Sentences | Transcribed | WER (lower is better) |
|---|---|---|---|
| fr-FR | 5 | 5 | 27% |
| en-US | 5 | 5 | 12% |
| ar-SA | 5 | 5 | 28% |

## Translation (what each listener read)

Mean chrF over all directions: **47.7** (text-only reference on these sentences: 54).

| Direction | Sentences | Delivered | chrF | BLEU | Wrong language | Untranslated | Delay p50 / max |
|---|---|---|---|---|---|---|---|
| fr-FR→en-US | 5 | 5 | 54.1 | 19.9 | 0 | 0 | 3.79 s / 6.21 s |
| fr-FR→ar-SA | 5 | 5 | 48.1 | 8.1 | 0 | 0 | 3.79 s / 6.21 s |
| en-US→fr-FR | 5 | 5 | 56.9 | 29.5 | 0 | 0 | 3.49 s / 3.92 s |
| en-US→ar-SA | 5 | 5 | 39.8 | 9.6 | 0 | 0 | 3.49 s / 3.92 s |
| ar-SA→fr-FR | 5 | 3 | 42.2 | 7.6 | 0 | 0 | 4.8 s / 12.02 s |
| ar-SA→en-US | 5 | 3 | 45.1 | 9.9 | 0 | 0 | 4.8 s / 12.02 s |

## Every sentence

### fr-FR · FLEURS 1690
- **Said:** Nous sommes d'accord avec la déclaration de l'USOC (Comité olympique des États-Unis) selon laquelle les intérêts de nos athlètes et de nos clubs, ainsi que de leur sport, pourraient être mieux servis. Cela peut être fait en allant de l'avant et en procédant plutôt à des changements significatifs au sein de notre organisation, qu'à la révocation d'accréditation.
- **Heard:** Nous sommes d'accord avec la déclaration de l'USOC, comité olympique des États-Unis, selon laquelle les intérêts de nos athlètes et de nos clubs ainsi que de leur sport pour ta tête-tête au mieux servi. Cela peut être fait en allant de l'avant et en procédant plutôt à des changements significatifs au sein de notre organisation qu'à la révocation d'accréditation. — WER 10%
- **en-US:** We agree with the statement by the USOC, the United States Olympic Committee, that the interests of our athletes and our clubs and their sport for your head-to-head at best served. This can be done by moving forward and making significant changes within our organization rather than revoking accreditation. — chrF 64, 6.2 s
  - reference: We agree with the USOC's statement that the interests of our athletes and clubs, and their sport, may be better served by moving forward with meaningful change within our organization, rather than decertification.
- **ar-SA:** نتفق مع بيان اللجنة الأولمبية الأمريكية، الذي يقول بأن مصالح رياضيينا ونوادينا ورياضة لعبة الرأس إلى الرأس هي أفضل ما يمكن أن يخدم. ويمكن تحقيق ذلك بالمضي قدما وإجراء تغييرات هامة داخل منظمتنا بدلا من سحب الاعتماد. — chrF 51, 6.2 s
  - reference: نتفق مع بيان اللجنة الأولمبية الأمريكية بأن مصالح الرياضيين والأندية، ورياضتهم، يمكن أن تُلبى بشكل أفضل من خلال المضي قدمًا في تغيير ذي مغزى داخل مؤسستنا، بدلًا من سحب التراخيص.

### fr-FR · FLEURS 1857
- **Said:** Il a ajouté qu’« on ne devrait cependant pas leur demander d’assumer des obligations qui dépassent leur stade de développement, leur responsabilité et leurs capacités. »
- **Heard:** Il ajoutait qu'on ne devrait cependant pas leur demander d'assumer des obligations qui dépassent leur stade de développement, de responsabilité. Et leur capacité. — WER 19%
- **en-US:** He added that, however, they should not be asked to assume obligations that exceed their stage of development, of responsibility. And their capacity. — chrF 62, 3.8 s
  - reference: He added that "they should not, however, be asked to take on obligations that go beyond their development stage, responsibility and capabilities."
- **ar-SA:** وأضاف أنه ينبغي ألا يُطلب منها، مع ذلك، أن تتحمل التزامات تتجاوز مرحلة نموها ومسؤوليتها. وقدرتها. — chrF 60, 3.8 s
  - reference: وأضاف أنه "مع ذلك، لا ينبغي أن يُجبروا على تحمل التزامات تتجاوز مرحلة نموهم، ومسؤوليتهم وقدراتهم."

### fr-FR · FLEURS 1913
- **Said:** Le rugissement du tigre ne ressemble pas au rugissement ample du lion, mais plutôt à une phrase dont les mots seraient des cris et des grondements.
- **Heard:** Regissement de tigre n'en ressemble pas au régissement en plus du riant, mais plutôt à une phrase dans les mots. Comment seraient les cris et les gondements ? — WER 54%
- **en-US:** Tiger regiment does not look like the regiment in addition to laughing, but rather a sentence in words. How would the screams and the gushing be? — chrF 31, 1.5 s
  - reference: The tiger's roar is not like the full-voiced roar of a lion, but more like a sentence of snarly, shouted words.
- **ar-SA:** لا يبدو أن كتائب النمر تشبه كتائب الضحك، ولكنها تشبه الجملة في الكلمات. كيف ستكون الصراخ والرقص ؟ — chrF 23, 1.5 s
  - reference: زئير النمر ليس كزئير الأسد كامل الصوت، لكنه أقرب إلى الصياح بكلمات غاضبة.

### fr-FR · FLEURS 2004
- **Said:** Le même mois, un autre avion de ligne a fait une sortie de piste à Mashhad et a heurté un mur, tuant ainsi dix-sept personnes.
- **Heard:** Le mémoire, un autre avion de ligne a fait une sortie de piste à Machade et heurtait un mur. Tu as ainsi 17 personnes. — WER 35%
- **en-US:** The memory, another airliner made a runway departure at Machade and hit a wall. You have 17 people. — chrF 36, 2.5 s
  - reference: The same month saw another airliner overrun a runway at Mashhad and strike a wall, killing seventeen.
- **ar-SA:** وفي المذكرة، خرجت طائرة تجارية أخرى من مدرج الطيران في مشادي واصطدمت بجدار. لذا لديك 17 شخصاً — chrF 34, 2.5 s
  - reference: أسفر احتياج طائرة ركاب أخرى مدرجاً في مشهد واصطدمت بجدار، وهو ما نتج عنه مقتل سبعة عشر شخصاً.

### fr-FR · FLEURS 1853
- **Said:** Giancarlo Fisichella a perdu le contrôle de sa voiture et a terminé la course peu après le démarrage.
- **Heard:** Jean-Carlo Fitella a perdu le contrôle de sa voiture et a terminé la course peu après le démarrage. — WER 17%
- **en-US:** Jean-Carlo Fitella lost control of his car and finished the race shortly after the start. — chrF 65, 4.1 s
  - reference: Giancarlo Fisichella lost control of his car and ended the race very soon after the start.
- **ar-SA:** فقد جان كارلو فيتيلا السيطرة على سيارته وانتهى السباق بعد وقت قصير من البداية. — chrF 66, 4.1 s
  - reference: فقد جيانكارلو فيشيلا السيطرة على سيارته، وأنهى السباق بعد وقتٍ قصير من بدايته.

### en-US · FLEURS 1904
- **Said:** However, due to the slow communication channels, styles in the west could lag behind by 25 to 30 year.
- **Heard:** However, due to the slow communication channel. The styles in the west could lag behind by 25 to 30 years. — WER 16%
- **fr-FR:** Cependant, en raison du canal de communication lent. Les styles de l'Ouest peuvent prendre du retard de 25 à 30 ans. — chrF 52, 3.9 s
  - reference: Cependant, en raison de la lenteur des moyens de communication, les modes occidentales pouvaient accuser un retard de 25 à 30 ans.
- **ar-SA:** ولكن بسبب بطء قناة الاتصال الأساليب في الغرب يمكن أن تتخلف عن الركب 25 إلى 30 سنة. — chrF 32, 3.9 s
  - reference: وعلى الرغم من ذلك، فنظرا لبطء قنوات التواصل، قد تتأخر الأنماط في الغرب قدر ما يقارب 25 إلى 30 سنة.

### en-US · FLEURS 1675
- **Said:** All nouns, alongside the word Sie for you, always begin with a capital letter, even in the middle of a sentence.
- **Heard:** All nows alongside the world's safe for you always begin with a capital letter. Even the middle of a sentence. — WER 24%
- **fr-FR:** Tous les nows à côté du monde sûr pour vous commencent toujours par une lettre majuscule. Même au milieu d'une phrase. — chrF 58, 2.9 s
  - reference: Tous les noms, suivis du mot Sie qui signifie vous, commencent toujours par une majuscule, même au milieu d’une phrase.
- **ar-SA:** كل ما يتعلق بالعالم الآمن لك دائماً يبدأ بحرف كبير حتى في منتصف الجملة — chrF 41, 2.9 s
  - reference: جميع الأسماء، بالإضافة إلى كلمة Sie بالنسبة لك، تبدأ دائماً بحرف كبير، حتى في منتصف الجملة.

### en-US · FLEURS 1950
- **Said:** To the north and within easy reach is the romantic and fascinating town of Sintra and which was made famous to foreigners after a glowing account of its splendours recorded by Lord Byron.
- **Heard:** To the north and within easy reach is a romantic and fascinating town of Cintra and which was made famous. To foreigners after a glowing account of its splinter is recorded by Lord Byron. — WER 12%
- **fr-FR:** Au nord et à proximité se trouve une ville romantique et fascinante de Cintra et qui a été rendu célèbre. Aux étrangers après un récit brillant de son éclat est enregistré par Lord Byron. — chrF 48, 3.9 s
  - reference: La ville romantique et fascinante de Sintra, située au nord, est facilement accessible et a été rendue célèbre auprès des étrangers par le récit éclatant de sa splendeur qu'en a fait Lord Byron.
- **ar-SA:** وفي الشمال، وفي متناول اليد، توجد مدينة سينترا الرومانسية والمدهشة التي أصبحت مشهورة. للأجانب بعد أن سجل اللورد بايرون تقريراً رائعاً عن شظاياها — chrF 36, 3.9 s
  - reference: تقع مدينة سنترا الرومانتيكية ذات الجمال الخلاب ناحية الشمال في مكان يسهل الوصول إليه، وهي المدينة التي ذاع صيتها وسط الأجانب بعد سرد اللورد بايرن المبهر لروائعها.

### en-US · FLEURS 1728
- **Said:** The cabbage juice changes color depending on how acidic or basic (alkaline) the chemical is.
- **Heard:** The cabbage juice changes color depending on how acidic, basic alkaline the chemical is. — WER 7%
- **fr-FR:** Le jus de chou change de couleur en fonction de l'acidité, de l'alcalinité basique du produit chimique. — chrF 76, 3.5 s
  - reference: Le jus de chou change de couleur en fonction de l’acidité ou de la basicité (alcalinité) du produit chimique.
- **ar-SA:** عصير الكرنب يتغير اللون اعتمادا على مدى حمضية، قاعدية القلوية الكيميائية. — chrF 52, 3.5 s
  - reference: يتغير لون عصير الملفوف اعتمادًا على مدى حمضية المادة الكيميائية أو قلويتها.

### en-US · FLEURS 1972
- **Said:** Many people don't think about them as dinosaurs because they have feathers and can fly.
- **Heard:** Many people don't think about them as dinosaurs because they have feathers and can fly. — WER 0%
- **fr-FR:** Beaucoup de gens ne pensent pas à eux comme des dinosaures parce qu'ils ont des plumes et peuvent voler. — chrF 59, 3.3 s
  - reference: Peu de gens les considèrent comme des dinosaures étant donne qu'ils ont des ailes et peuvent voler.
- **ar-SA:** الكثير من الناس لا يفكرون فيهم كديناصورات لأنهم لديهم ريش ويمكنهم الطيران. — chrF 45, 3.3 s
  - reference: لا يفكر العديد فيها باعتبارها ديناصورات لأن لديها ريشًا ويمكنها الطيران.

### ar-SA · FLEURS 1993
- **Said:** تشكلت في المحيط الأطلسي اليوم عاشر عاصفة مُسماة لموسم الأعاصير الأطلسية، العاصفة شبه الاستوائية جيري.
- **Heard:** تشكلت في المحيط الأطلسي اليوم عايش رعاصفة مسمى لموسى من الأعاصير الأطلسية العاصفة شبه — WER 47%
- **fr-FR:** Il s'est formé dans l'océan Atlantique aujourd'hui, une tempête appelée Moïse, une tempête de type cyclone atlantique. — chrF 40, 4.8 s
  - reference: La tempête subtropicale Jerry, 10ème tempête de la saison des ouragans à porter un nom, est apparue ce jour dans l'océan Atlantique.
- **en-US:** Formed in the Atlantic today, a storm named Moses lived out of the Atlantic hurricanes, the semi-storms. — chrF 48, 4.8 s
  - reference: The tenth named storm of the Atlantic Hurricane season, Subtropical Storm Jerry, formed in the Atlantic Ocean today.

### ar-SA · FLEURS 1730
- **Said:** تغادر الحافلات المحطة الداخلية بين المناطق (عبر النهر) في خلال اليوم على الرغم من أن معظمها وخاصة المتجهة منها إلى الشرق وجاكار/بومثانج تغادر بين 06:30 و 07:30.
- **Heard:** تغدر بحافلات المحطة الدخلية بين المنوطق عبر النهر في خلال اليوم على الرغم من أنمار وعظمها وخاصات المتجه منها إلى الشرق وجكارا بومثانج تغادر بينا ستة وتلاتية — WER 50%
- **fr-FR:** (nothing arrived)
  - reference: Les bus partent de la gare routière interdistricts (située sur l'autre rive) tout au long de la journée, mais la plupart, tout particulièrement ceux qui desservent l'est et Jakar/Bumthang, partent entre 6 h 30 et 7 h 30 du matin.
- **en-US:** (nothing arrived)
  - reference: Buses depart the inter-district bus station (across the river) throughout the day, though most, especially those heading to the east and Jakar/Bumthang leave between 06:30 and 07:30.

### ar-SA · FLEURS 1942
- **Said:** نصنع بيوتنا وملابسنا من النباتات . معظم الطعام الذي نتناوله من النباتات كذلك. بدون النباتات، لا يمكن للحيوانات البقاء.
- **Heard:** نعب يوتنا وملابسنا من النباتات مرزم الطعام الذي نتناوله من النباتات كذلك بدون النبتات لا يمكن للحيوانات البقاء — WER 22%
- **fr-FR:** Les bus de la gare de l'entrée de la région traversent le fleuve pendant la journée , même si Anmar et ses os , et surtout ceux qui vont vers l'est , Jakara et Bumthang , quittent entre nous six et trente fois plus de plantes que nous ne mangeons , et nos vêtements sont faits de plantes , et notre nourriture est faite de plantes , et sans plantes , les animaux ne peuvent pas survivre . — chrF 45, 12.0 s
  - reference: Nous fabriquons nos maisons et nos vêtements à base de plantes. La plupart des aliments que nous mangeons sont des plantes. Sans les plantes, les animaux ne survivraient pas.
- **en-US:** It's a bus that runs between the entrance station and the area across the river during the day , despite the Anmar and its bones , and especially the one going east from Jakara Bumthang , leaving between us six and thirty feet of junk , our clothes made of plants , our food made of plants , and without plants , animals can't survive . — chrF 39, 12.0 s
  - reference: We make our houses from plants and make clothes from plants. Most foods that we eat are plants. Without plants, animals could not survive.

### ar-SA · FLEURS 1740
- **Said:** إن عرض الصوت والضوء الهرمي واحد من أمتع الأشياء الموجودة بالمنطقة للأطفال.
- **Heard:** إن عرض الصوت والضوء الهرمي واحد من أمتع الأشياء الموجودة بالمنتقى للأطفال — WER 8%
- **fr-FR:** La pyramide sonore et lumineuse est l'une des choses les plus amusantes du musée pour enfants . — chrF 39, 4.4 s
  - reference: Le spectacle son et lumière à la pyramide constitue l'une des attractions les plus intéressantes de la région pour les enfants.
- **en-US:** The sound and light pyramid is one of the most enjoyable things in the children's museum . — chrF 53, 4.4 s
  - reference: The pyramid sound and light show is one of the most interesting things in the area for kids.

### ar-SA · FLEURS 1771
- **Said:** تذكر أنه على الرغم من أن الموسيقى في المنصات الرئيسية قد تكون انتهت، إلا أن هناك أقسام من المهرجان قد تستمر في تشغيل الموسيقى حتى وقت متأخر من الليل.
- **Heard:** تذكر أنه على الرغم من أن الموسيقى في المنصات الرئيسية قد تكون انتهت إلا أن هناك أقسام من المهرجين قد تستمر في تشغيل الموسيقى حتى وقت متأخر — WER 10%
- **fr-FR:** (nothing arrived)
  - reference: N'oubliez pas que même si les spectacles musicaux sont terminés sur les scènes principales, d'autres spectacles musicaux peuvent se poursuivre jusqu'à tard dans la nuit sur d'autres sites du festival.
- **en-US:** (nothing arrived)
  - reference: Remember that even though music on the main stages may have finished, there may be sections of the festival that will keep playing music until late into the night.
