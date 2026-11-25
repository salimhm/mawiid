# Translation bot test: 2026-11-25 15:07

15 sentences spoken by bots in fr-FR, en-US, ar-SA, read by one listener bot per language, through the real LiveKit server and AI worker. Scored against the FLEURS human references.

**Result: FAIL**: ar-SA: 1 sentence(s) without transcript; en-US→ar-SA: chrF 33.4 < 35; ar-SA→fr-FR: 1 translation(s) never arrived; ar-SA→en-US: 1 translation(s) never arrived

## Speech-to-text (what the worker heard)

| Spoken language | Sentences | Transcribed | WER (lower is better) |
|---|---|---|---|
| fr-FR | 5 | 5 | 27% |
| en-US | 5 | 5 | 31% |
| ar-SA | 5 | 4 | 37% |

## Translation (what each listener read)

Mean chrF over all directions: **44.1** (text-only reference on these sentences: 54).

| Direction | Sentences | Delivered | chrF | BLEU | Wrong language | Untranslated | Delay p50 / max |
|---|---|---|---|---|---|---|---|
| fr-FR→en-US | 5 | 5 | 54.7 | 22.6 | 0 | 0 | 4.74 s / 9.0 s |
| fr-FR→ar-SA | 5 | 5 | 47.4 | 5.3 | 0 | 0 | 4.74 s / 9.0 s |
| en-US→fr-FR | 5 | 5 | 48.2 | 25.3 | 0 | 0 | 4.19 s / 4.85 s |
| en-US→ar-SA | 5 | 5 | 33.4 | 9.5 | 0 | 0 | 4.19 s / 4.85 s |
| ar-SA→fr-FR | 5 | 4 | 38.6 | 10.3 | 0 | 0 | 6.06 s / 8.32 s |
| ar-SA→en-US | 5 | 4 | 42.0 | 18.0 | 0 | 0 | 6.06 s / 8.32 s |

## Every sentence

### fr-FR · FLEURS 1690
- **Said:** Nous sommes d'accord avec la déclaration de l'USOC (Comité olympique des États-Unis) selon laquelle les intérêts de nos athlètes et de nos clubs, ainsi que de leur sport, pourraient être mieux servis. Cela peut être fait en allant de l'avant et en procédant plutôt à des changements significatifs au sein de notre organisation, qu'à la révocation d'accréditation.
- **Heard:** Nous sommes d'accord avec la déclaration de l'USOCC, comité olympique des États-Unis, selon laquelle les intérêts de nos athlèques et de nos clubs, ainsi que de leur sport, pour cette tête au mieux servi. Cela peut être fait en allant de l'avant et en procédant plutôt à des changements significatifs au sein de notre organisation. Qu'est la révocation d'accréditation ? — WER 13%
- **en-US:** We agree with the statement by the USOCC, the United States Olympic Committee, that the interests of our athletes and clubs, and their sport, are best served by this head. This can be done by moving forward and rather making significant changes within our organization. What is accreditation revocation? — chrF 67, 3.3 s
  - reference: We agree with the USOC's statement that the interests of our athletes and clubs, and their sport, may be better served by moving forward with meaningful change within our organization, rather than decertification.
- **ar-SA:** أنا متأكدة 100% ونتفق مع بيان اللجنة الأولمبية الأمريكية، الذي يقول إن مصالح رياضيينا ونوادينا، فضلا عن رياضتهم، تخدم على أفضل وجه من خلال هذا القرار. ويمكن تحقيق ذلك بالمضي قدما وإجراء تغييرات ذات مغزى في منظمتنا. ما هو سحب الاعتماد؟ — chrF 48, 3.3 s
  - reference: نتفق مع بيان اللجنة الأولمبية الأمريكية بأن مصالح الرياضيين والأندية، ورياضتهم، يمكن أن تُلبى بشكل أفضل من خلال المضي قدمًا في تغيير ذي مغزى داخل مؤسستنا، بدلًا من سحب التراخيص.

### fr-FR · FLEURS 1857
- **Said:** Il a ajouté qu’« on ne devrait cependant pas leur demander d’assumer des obligations qui dépassent leur stade de développement, leur responsabilité et leurs capacités. »
- **Heard:** Il ajoutait qu'on ne devrait cependant pas leur demander d'assumer des obligations qui dépassent leur stade de développement, de responsabilité... et leur capacité. — WER 19%
- **en-US:** He added that, however, they should not be asked to assume obligations that exceed their stage of development, responsibility... and their capacity. — chrF 63, 9.0 s
  - reference: He added that "they should not, however, be asked to take on obligations that go beyond their development stage, responsibility and capabilities."
- **ar-SA:** وأضاف أنه لا ينبغي أن يُطلب منهم، مع ذلك، أن يتحملوا التزامات تتجاوز مرحلة نموهم ومسؤوليتهم ... )ب( مدى توفر الموارد والقدرات. — chrF 64, 9.0 s
  - reference: وأضاف أنه "مع ذلك، لا ينبغي أن يُجبروا على تحمل التزامات تتجاوز مرحلة نموهم، ومسؤوليتهم وقدراتهم."

### fr-FR · FLEURS 1913
- **Said:** Le rugissement du tigre ne ressemble pas au rugissement ample du lion, mais plutôt à une phrase dont les mots seraient des cris et des grondements.
- **Heard:** Rougissement du tigre ne ressemble pas aux rougissements en plus du riant, mais plutôt à une phrase dans l'hum... Comment seraient des cris et des grandements ? — WER 46%
- **en-US:** Flushing the tiger does not look like blushing in addition to laughing, but rather a phrase in the mood... How would screaming and shouting be? — chrF 25, 4.3 s
  - reference: The tiger's roar is not like the full-voiced roar of a lion, but more like a sentence of snarly, shouted words.
- **ar-SA:** "حمر الوجه النمر" لا يبدو مثل "حمر الوجه" بالإضافة إلى الضحك، ولكنه يبدو مثل جملة في المزاج... ماذا عن الصراخ والغناء ؟ — chrF 21, 4.3 s
  - reference: زئير النمر ليس كزئير الأسد كامل الصوت، لكنه أقرب إلى الصياح بكلمات غاضبة.

### fr-FR · FLEURS 2004
- **Said:** Le même mois, un autre avion de ligne a fait une sortie de piste à Mashhad et a heurté un mur, tuant ainsi dix-sept personnes.
- **Heard:** Le mémoire, un autre avion de ligne, a fait une sortie de piste à Machade et heurtait un mur. Tu es en ainsi 17 personnes. — WER 38%
- **en-US:** The memory, another airliner, made a runway departure at Machade and was hitting a wall. You are in this way 17 people. — chrF 38, 5.0 s
  - reference: The same month saw another airliner overrun a runway at Mashhad and strike a wall, killing seventeen.
- **ar-SA:** أما الطائرة المذكورة، وهي طائرة تجارية أخرى، فقد خرجت من مدرج الطيران في مشادي واصطدمت بجدار. أنت 17 شخصاً — chrF 34, 5.0 s
  - reference: أسفر احتياج طائرة ركاب أخرى مدرجاً في مشهد واصطدمت بجدار، وهو ما نتج عنه مقتل سبعة عشر شخصاً.

### fr-FR · FLEURS 1853
- **Said:** Giancarlo Fisichella a perdu le contrôle de sa voiture et a terminé la course peu après le démarrage.
- **Heard:** Jean-Carlo Fitella a perdu le contrôle de sa voiture et a terminé la course peu après le démarrage. — WER 17%
- **en-US:** Jean-Carlo Fitella lost control of his car and finished the race shortly after the start. — chrF 65, 4.7 s
  - reference: Giancarlo Fisichella lost control of his car and ended the race very soon after the start.
- **ar-SA:** فقد جان كارلو فيتيلا السيطرة على سيارته وانتهى السباق بعد وقت قصير من البداية. — chrF 66, 4.7 s
  - reference: فقد جيانكارلو فيشيلا السيطرة على سيارته، وأنهى السباق بعد وقتٍ قصير من بدايته.

### en-US · FLEURS 1904
- **Said:** However, due to the slow communication channels, styles in the west could lag behind by 25 to 30 year.
- **Heard:** the west could lag behind by 25 to 30 years. — WER 53%
- **fr-FR:** L'Occident pourrait prendre du retard de 25 à 30 ans. — chrF 25, 2.8 s
  - reference: Cependant, en raison de la lenteur des moyens de communication, les modes occidentales pouvaient accuser un retard de 25 à 30 ans.
- **ar-SA:** الغرب قد يتخلف 25 إلى 30 سنة — chrF 20, 2.8 s
  - reference: وعلى الرغم من ذلك، فنظرا لبطء قنوات التواصل، قد تتأخر الأنماط في الغرب قدر ما يقارب 25 إلى 30 سنة.

### en-US · FLEURS 1675
- **Said:** All nouns, alongside the word Sie for you, always begin with a capital letter, even in the middle of a sentence.
- **Heard:** All nouns alongside the world's say for you always begin with a capital letter, even the middle of the sentence — WER 24%
- **fr-FR:** Tous les noms à côté du monde disent pour vous commencent toujours par une lettre majuscule, même au milieu de la phrase — chrF 61, 4.5 s
  - reference: Tous les noms, suivis du mot Sie qui signifie vous, commencent toujours par une majuscule, même au milieu d’une phrase.
- **ar-SA:** كل الأسماء إلى جانب العالم يقول لك دائما تبدأ بحرف كبير، حتى في منتصف الجملة — chrF 51, 4.5 s
  - reference: جميع الأسماء، بالإضافة إلى كلمة Sie بالنسبة لك، تبدأ دائماً بحرف كبير، حتى في منتصف الجملة.

### en-US · FLEURS 1950
- **Said:** To the north and within easy reach is the romantic and fascinating town of Sintra and which was made famous to foreigners after a glowing account of its splendours recorded by Lord Byron.
- **Heard:** is a romantic and fascinating account of its splendorous recorded by Lord Byron. — WER 67%
- **fr-FR:** Le roman de Lord Byron est un récit romantique et fascinant de sa splendeur. — chrF 32, 4.2 s
  - reference: La ville romantique et fascinante de Sintra, située au nord, est facilement accessible et a été rendue célèbre auprès des étrangers par le récit éclatant de sa splendeur qu'en a fait Lord Byron.
- **ar-SA:** (إنها رواية رومانسية ومبهجة عن عظمتها مسجلة من قبل اللورد بايرون. — chrF 16, 4.2 s
  - reference: تقع مدينة سنترا الرومانتيكية ذات الجمال الخلاب ناحية الشمال في مكان يسهل الوصول إليه، وهي المدينة التي ذاع صيتها وسط الأجانب بعد سرد اللورد بايرن المبهر لروائعها.

### en-US · FLEURS 1728
- **Said:** The cabbage juice changes color depending on how acidic or basic (alkaline) the chemical is.
- **Heard:** The cabbage juice changes color depending on how acidic, basic alkaline the chemical is. — WER 7%
- **fr-FR:** Le jus de chou change de couleur en fonction de l'acidité, de l'alcalinité basique du produit chimique. — chrF 76, 4.8 s
  - reference: Le jus de chou change de couleur en fonction de l’acidité ou de la basicité (alcalinité) du produit chimique.
- **ar-SA:** عصير الكرنب يتغير اللون اعتمادا على مدى حمضية، قاعدية القلوية الكيميائية. — chrF 52, 4.8 s
  - reference: يتغير لون عصير الملفوف اعتمادًا على مدى حمضية المادة الكيميائية أو قلويتها.

### en-US · FLEURS 1972
- **Said:** Many people don't think about them as dinosaurs because they have feathers and can fly.
- **Heard:** People don't think about them as dinosaurs because they have feathers and can fly. — WER 6%
- **fr-FR:** Les gens ne pensent pas à eux comme des dinosaures parce qu'ils ont des plumes et peuvent voler. — chrF 57, 3.2 s
  - reference: Peu de gens les considèrent comme des dinosaures étant donne qu'ils ont des ailes et peuvent voler.
- **ar-SA:** الناس لا يفكرون فيهم كديناصورات لأنهم لديهم ريش ويمكنهم الطيران — chrF 44, 3.2 s
  - reference: لا يفكر العديد فيها باعتبارها ديناصورات لأن لديها ريشًا ويمكنها الطيران.

### ar-SA · FLEURS 1993
- **Said:** تشكلت في المحيط الأطلسي اليوم عاشر عاصفة مُسماة لموسم الأعاصير الأطلسية، العاصفة شبه الاستوائية جيري.
- **Heard:** تشكلت في المحيط الأطلسي اليوم عايش رعاصفة مسمى لموسى من الأعاصر الأطلسية العاصفة — WER 60%
- **fr-FR:** Il s'est formé dans l'Atlantique aujourd'hui , et il a vécu une tempête appelée Moïse , de l'époque des tempêtes atlantiques . — chrF 33, 8.3 s
  - reference: La tempête subtropicale Jerry, 10ème tempête de la saison des ouragans à porter un nom, est apparue ce jour dans l'océan Atlantique.
- **en-US:** Formed in the Atlantic today, a storm named Moses lived in the Atlantic storm era. — chrF 40, 8.3 s
  - reference: The tenth named storm of the Atlantic Hurricane season, Subtropical Storm Jerry, formed in the Atlantic Ocean today.

### ar-SA · FLEURS 1730
- **Said:** تغادر الحافلات المحطة الداخلية بين المناطق (عبر النهر) في خلال اليوم على الرغم من أن معظمها وخاصة المتجهة منها إلى الشرق وجاكار/بومثانج تغادر بين 06:30 و 07:30.
- **Heard:** تغدر بحافلات المحطة الدخلية بين المنوطق عبر النهر في خلال اليوم على الرغم من أن نمع عظمها وخاصات المتجه منها إلى الشرق وجكارا بومثانج تغيد ربينا ستة وتلاتي 37 — WER 53%
- **fr-FR:** Elles prennent les bus de la gare d'entrée entre les deux quartiers de l'autre côté de la rivière pendant la journée , même si nous sommes en pleine nuit . — chrF 27, 0.3 s
  - reference: Les bus partent de la gare routière interdistricts (située sur l'autre rive) tout au long de la journée, mais la plupart, tout particulièrement ceux qui desservent l'est et Jakar/Bumthang, partent entre 6 h 30 et 7 h 30 du matin.
- **en-US:** They run the bus between the mainland and the river during the day, even though we're shining. — chrF 22, 0.3 s
  - reference: Buses depart the inter-district bus station (across the river) throughout the day, though most, especially those heading to the east and Jakar/Bumthang leave between 06:30 and 07:30.

### ar-SA · FLEURS 1942
- **Said:** نصنع بيوتنا وملابسنا من النباتات . معظم الطعام الذي نتناوله من النباتات كذلك. بدون النباتات، لا يمكن للحيوانات البقاء.
- **Heard:** نعب يوتنا وملابسنا من النباتات مرزم الطعام الذي نتناوله من النباتات كذلك بدون النباتات لا يمكن للحيوانات البقاء — WER 17%
- **fr-FR:** 1.1.10.1.2.1.3.1.4.1.5.1.6.1.7.1.8.1.9.1.0.10-10.2.2.3.2.4.2.8.2.9.2.6.3.3. Nous fabriquons nos vêtements et nos chaussures à partir de plantes , et nous mangeons des plantes . Sans plantes , les animaux ne peuvent pas survivre . — chrF 56, 6.5 s
  - reference: Nous fabriquons nos maisons et nos vêtements à base de plantes. La plupart des aliments que nous mangeons sont des plantes. Sans les plantes, les animaux ne survivraient pas.
- **en-US:** The bones and the parts of the body that are facing east, Jakara, Bumthang, Tegid, Rabina, Six and Thirty-seven. We make our blankets and clothes from plants , and the food we eat is made from plants . Without plants, animals cannot survive. — chrF 58, 6.5 s
  - reference: We make our houses from plants and make clothes from plants. Most foods that we eat are plants. Without plants, animals could not survive.

### ar-SA · FLEURS 1740
- **Said:** إن عرض الصوت والضوء الهرمي واحد من أمتع الأشياء الموجودة بالمنطقة للأطفال.
- **Heard:** إن عرض الصوت والضوء الهرمي واحد من أمتع الأشياء الموجودة بالمنتقى للأشياء — WER 17%
- **fr-FR:** La projection de son et de lumière pyramidale est l'une des choses les plus amusantes du Musée des objets . — chrF 38, 5.6 s
  - reference: Le spectacle son et lumière à la pyramide constitue l'une des attractions les plus intéressantes de la région pour les enfants.
- **en-US:** The sound and light pyramid is one of the most enjoyable things in the Selected Objects . — chrF 53, 5.6 s
  - reference: The pyramid sound and light show is one of the most interesting things in the area for kids.

### ar-SA · FLEURS 1771
- **Said:** تذكر أنه على الرغم من أن الموسيقى في المنصات الرئيسية قد تكون انتهت، إلا أن هناك أقسام من المهرجان قد تستمر في تشغيل الموسيقى حتى وقت متأخر من الليل.
- **Heard:** (nothing)
- **fr-FR:** (nothing arrived)
  - reference: N'oubliez pas que même si les spectacles musicaux sont terminés sur les scènes principales, d'autres spectacles musicaux peuvent se poursuivre jusqu'à tard dans la nuit sur d'autres sites du festival.
- **en-US:** (nothing arrived)
  - reference: Remember that even though music on the main stages may have finished, there may be sections of the festival that will keep playing music until late into the night.
