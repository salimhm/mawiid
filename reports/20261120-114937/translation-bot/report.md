# Translation bot test: 2026-11-20 11:58

9 sentences spoken by bots in fr-FR, en-US, ar-SA, read by one listener bot per language, through the real LiveKit server and AI worker. Scored against the FLEURS human references.

**Result: FAIL**: fr-FR: WER 56% > 50%; fr-FR→ar-SA: chrF 32.3 < 35; en-US→ar-SA: chrF 27.5 < 35

## Speech-to-text (what the worker heard)

| Spoken language | Sentences | Transcribed | WER (lower is better) |
|---|---|---|---|
| fr-FR | 3 | 3 | 56% |
| en-US | 3 | 3 | 36% |
| ar-SA | 3 | 3 | 41% |

## Translation (what each listener read)

Mean chrF over all directions: **37.6** (text-only reference on these sentences: 54).

| Direction | Sentences | Delivered | chrF | BLEU | Wrong language | Untranslated | Delay p50 / max |
|---|---|---|---|---|---|---|---|
| fr-FR→en-US | 3 | 3 | 38.1 | 12.8 | 0 | 0 | 7.56 s / 10.92 s |
| fr-FR→ar-SA | 3 | 3 | 32.3 | 7.5 | 0 | 0 | 7.56 s / 10.92 s |
| en-US→fr-FR | 3 | 3 | 46.2 | 22.9 | 0 | 0 | 4.89 s / 7.29 s |
| en-US→ar-SA | 3 | 3 | 27.5 | 4.7 | 0 | 0 | 4.89 s / 7.29 s |
| ar-SA→fr-FR | 3 | 3 | 35.7 | 13.3 | 0 | 0 | 6.52 s / 7.23 s |
| ar-SA→en-US | 3 | 3 | 45.8 | 14.7 | 0 | 0 | 6.52 s / 7.23 s |

## Every sentence

### fr-FR · FLEURS 1690
- **Said:** Nous sommes d'accord avec la déclaration de l'USOC (Comité olympique des États-Unis) selon laquelle les intérêts de nos athlètes et de nos clubs, ainsi que de leur sport, pourraient être mieux servis. Cela peut être fait en allant de l'avant et en procédant plutôt à des changements significatifs au sein de notre organisation, qu'à la révocation d'accréditation.
- **Heard:** Nous sommes d'accord avec la déclaration de l'USOC, comité olympique des Etats-Unis, selon laquelle les intérêts de nos aînés et de nos clubs ainsi que de leur sport pour ta tête-tête au mieux servi. Cela peut être fait en allant de l'avant et en procédant plutôt à des changements significatifs au sein de notre organisation qu'à la révocation d'accréditation. — WER 13%
- **en-US:** We agree with the statement of the USOC, the U.S. Olympic Committee, that the interests of our seniors and our clubs and their sport for your head-head at best served. This can be done by moving forward and making significant changes within our organization rather than revoking accreditation. — chrF 60, 10.9 s
  - reference: We agree with the USOC's statement that the interests of our athletes and clubs, and their sport, may be better served by moving forward with meaningful change within our organization, rather than decertification.
- **ar-SA:** نتفق مع بيان اللجنة الأولمبية الأمريكية، الذي يقول إن مصالح كبار السن والأندية ورياضة اللعبة التي يمارسونها تخدم على أفضل وجه. ويمكن تحقيق ذلك بالمضي قدما وإجراء تغييرات هامة داخل منظمتنا بدلا من سحب الاعتماد. — chrF 49, 10.9 s
  - reference: نتفق مع بيان اللجنة الأولمبية الأمريكية بأن مصالح الرياضيين والأندية، ورياضتهم، يمكن أن تُلبى بشكل أفضل من خلال المضي قدمًا في تغيير ذي مغزى داخل مؤسستنا، بدلًا من سحب التراخيص.

### fr-FR · FLEURS 1857
- **Said:** Il a ajouté qu’« on ne devrait cependant pas leur demander d’assumer des obligations qui dépassent leur stade de développement, leur responsabilité et leurs capacités. »
- **Heard:** Et leur capacité. — WER 96%
- **en-US:** And their capacity. — chrF 7, 6.3 s
  - reference: He added that "they should not, however, be asked to take on obligations that go beyond their development stage, responsibility and capabilities."
- **ar-SA:** وقدرتها. — chrF 4, 6.3 s
  - reference: وأضاف أنه "مع ذلك، لا ينبغي أن يُجبروا على تحمل التزامات تتجاوز مرحلة نموهم، ومسؤوليتهم وقدراتهم."

### fr-FR · FLEURS 1913
- **Said:** Le rugissement du tigre ne ressemble pas au rugissement ample du lion, mais plutôt à une phrase dont les mots seraient des cris et des grondements.
- **Heard:** Rougissement du tigre n'en ressemble pas rougissement en plus du riant mais plutôt à une phrase dans l'humour. Comment seraient les cris et les gondements ? — WER 58%
- **en-US:** Flushing of the tiger does not look like blushing in addition to laughing but rather like a phrase in humor. How would the screams and the gushing be? — chrF 26, 7.6 s
  - reference: The tiger's roar is not like the full-voiced roar of a lion, but more like a sentence of snarly, shouted words.
- **ar-SA:** "حمر الوجه النمر" لا يبدو مثل "حمر الوجه" بالإضافة إلى الضحك ولكنه يبدو مثل جملة في المزاح. كيف ستكون الصراخ والرقص ؟ — chrF 22, 7.6 s
  - reference: زئير النمر ليس كزئير الأسد كامل الصوت، لكنه أقرب إلى الصياح بكلمات غاضبة.

### en-US · FLEURS 1904
- **Said:** However, due to the slow communication channels, styles in the west could lag behind by 25 to 30 year.
- **Heard:** the West could lag behind by 25 to 30 years. — WER 53%
- **fr-FR:** L’Occident pourrait prendre un retard de 25 à 30 ans. — chrF 27, 3.4 s
  - reference: Cependant, en raison de la lenteur des moyens de communication, les modes occidentales pouvaient accuser un retard de 25 à 30 ans.
- **ar-SA:** وقد يتخلف الغرب عن الركب بما يتراوح بين 25 و 30 سنة. — chrF 17, 3.4 s
  - reference: وعلى الرغم من ذلك، فنظرا لبطء قنوات التواصل، قد تتأخر الأنماط في الغرب قدر ما يقارب 25 إلى 30 سنة.

### en-US · FLEURS 1675
- **Said:** All nouns, alongside the word Sie for you, always begin with a capital letter, even in the middle of a sentence.
- **Heard:** All nouns alongside the world say for you always begin with a capital letter. Even the middle of — WER 24%
- **fr-FR:** Tous les noms à côté du monde disent pour vous commencent toujours par une lettre majuscule. Même au milieu de — chrF 55, 7.3 s
  - reference: Tous les noms, suivis du mot Sie qui signifie vous, commencent toujours par une majuscule, même au milieu d’une phrase.
- **ar-SA:** كل الأسماء إلى جانب العالم يقول لك دائما تبدأ بحرف كبير. حتى في منتصف — chrF 39, 7.3 s
  - reference: جميع الأسماء، بالإضافة إلى كلمة Sie بالنسبة لك، تبدأ دائماً بحرف كبير، حتى في منتصف الجملة.

### en-US · FLEURS 1950
- **Said:** To the north and within easy reach is the romantic and fascinating town of Sintra and which was made famous to foreigners after a glowing account of its splendours recorded by Lord Byron.
- **Heard:** is a romantic and fascinating town of Centra and which was made famous to foreigners after a glowing account of its splendorous recorded by Lord Byron. — WER 30%
- **fr-FR:** C'est une ville romantique et fascinante de Centra et qui a été rendue célèbre aux étrangers après un récit radieux de sa splendeur enregistré par Lord Byron. — chrF 52, 4.9 s
  - reference: La ville romantique et fascinante de Sintra, située au nord, est facilement accessible et a été rendue célèbre auprès des étrangers par le récit éclatant de sa splendeur qu'en a fait Lord Byron.
- **ar-SA:** مدينة سينترا رومانسية ورائعة و التي اشتهرت لدى الأجانب بعد رواية رائعة عن عظمتها سجلها اللورد بايرون — chrF 27, 4.9 s
  - reference: تقع مدينة سنترا الرومانتيكية ذات الجمال الخلاب ناحية الشمال في مكان يسهل الوصول إليه، وهي المدينة التي ذاع صيتها وسط الأجانب بعد سرد اللورد بايرن المبهر لروائعها.

### ar-SA · FLEURS 1993
- **Said:** تشكلت في المحيط الأطلسي اليوم عاشر عاصفة مُسماة لموسم الأعاصير الأطلسية، العاصفة شبه الاستوائية جيري.
- **Heard:** تشكلت في المحيط الأطلسي اليوم عشر عاصفة مسمى لموسى من الأعاصر الأطلسية العاصفة — WER 53%
- **fr-FR:** Dix tempêtes Moses de l'époque des tempêtes atlantiques se sont formées dans l'Atlantique aujourd'hui . — chrF 32, 7.2 s
  - reference: La tempête subtropicale Jerry, 10ème tempête de la saison des ouragans à porter un nom, est apparue ce jour dans l'océan Atlantique.
- **en-US:** Ten storms named Moses have formed in the Atlantic today. — chrF 31, 7.2 s
  - reference: The tenth named storm of the Atlantic Hurricane season, Subtropical Storm Jerry, formed in the Atlantic Ocean today.

### ar-SA · FLEURS 1730
- **Said:** تغادر الحافلات المحطة الداخلية بين المناطق (عبر النهر) في خلال اليوم على الرغم من أن معظمها وخاصة المتجهة منها إلى الشرق وجاكار/بومثانج تغادر بين 06:30 و 07:30.
- **Heard:** تغادر بحافلات المحطة الدخلية بين المنوطق عبر النهر في خلال اليوم على الرغم من أن عظمها وخاصات المتجه منها إلى الشرق وجكارا بومثانج تغيد ربينا ستة وتلتي 37 — WER 47%
- **fr-FR:** Les bus partent de la gare d'entrée entre les zones de traversée pendant la journée, bien que 10. 10 h 30-11 h 30 : 11 h 30-13 h 30 : 13 h 30-15 h 30 — chrF 24, 6.5 s
  - reference: Les bus partent de la gare routière interdistricts (située sur l'autre rive) tout au long de la journée, mais la plupart, tout particulièrement ceux qui desservent l'est et Jakar/Bumthang, partent entre 6 h 30 et 7 h 30 du matin.
- **en-US:** Buses leave the entrance station between the districts across the river during the day, although The skeleton and the parts of it heading east, Jakara, Bumthang, Tegid, Rabina, Six and Telte 37. — chrF 44, 6.5 s
  - reference: Buses depart the inter-district bus station (across the river) throughout the day, though most, especially those heading to the east and Jakar/Bumthang leave between 06:30 and 07:30.

### ar-SA · FLEURS 1942
- **Said:** نصنع بيوتنا وملابسنا من النباتات . معظم الطعام الذي نتناوله من النباتات كذلك. بدون النباتات، لا يمكن للحيوانات البقاء.
- **Heard:** نعب يوتنا وملابسنا من النباتات مرزم الطعام الذي نتناوله من النباتات كذا بدون النباتات لا يمكن للحيوانات البقاء — WER 22%
- **fr-FR:** Nous fabriquons nos vêtements et nos chaussures à partir de plantes , nous fabriquons notre nourriture à partir de plantes , etc. Sans plantes , les animaux ne peuvent pas survivre . — chrF 53, 5.4 s
  - reference: Nous fabriquons nos maisons et nos vêtements à base de plantes. La plupart des aliments que nous mangeons sont des plantes. Sans les plantes, les animaux ne survivraient pas.
- **en-US:** We make our blankets and clothes from plants , we make our food from plants , and so on . Without plants, animals cannot survive. — chrF 60, 5.4 s
  - reference: We make our houses from plants and make clothes from plants. Most foods that we eat are plants. Without plants, animals could not survive.
