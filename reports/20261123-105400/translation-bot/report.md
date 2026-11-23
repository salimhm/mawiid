# Translation bot test: 2026-11-23 10:59

9 sentences spoken by bots in fr-FR, en-US, ar-SA, read by one listener bot per language, through the real LiveKit server and AI worker. Scored against the FLEURS human references.

**Result: FAIL**: en-US→ar-SA: chrF 27.6 < 35

## Speech-to-text (what the worker heard)

| Spoken language | Sentences | Transcribed | WER (lower is better) |
|---|---|---|---|
| fr-FR | 3 | 3 | 26% |
| en-US | 3 | 3 | 36% |
| ar-SA | 3 | 3 | 40% |

## Translation (what each listener read)

Mean chrF over all directions: **44.5** (text-only reference on these sentences: 54).

| Direction | Sentences | Delivered | chrF | BLEU | Wrong language | Untranslated | Delay p50 / max |
|---|---|---|---|---|---|---|---|
| fr-FR→en-US | 3 | 3 | 56.9 | 23.9 | 0 | 0 | 4.57 s / 5.95 s |
| fr-FR→ar-SA | 3 | 3 | 47.7 | 9.4 | 0 | 0 | 4.57 s / 5.95 s |
| en-US→fr-FR | 3 | 3 | 41.7 | 17.5 | 0 | 0 | 3.08 s / 3.26 s |
| en-US→ar-SA | 3 | 3 | 27.6 | 7.9 | 0 | 0 | 3.08 s / 3.26 s |
| ar-SA→fr-FR | 3 | 3 | 43.8 | 19.8 | 0 | 0 | 4.96 s / 5.56 s |
| ar-SA→en-US | 3 | 3 | 49.2 | 16.3 | 0 | 0 | 4.96 s / 5.56 s |

## Every sentence

### fr-FR · FLEURS 1690
- **Said:** Nous sommes d'accord avec la déclaration de l'USOC (Comité olympique des États-Unis) selon laquelle les intérêts de nos athlètes et de nos clubs, ainsi que de leur sport, pourraient être mieux servis. Cela peut être fait en allant de l'avant et en procédant plutôt à des changements significatifs au sein de notre organisation, qu'à la révocation d'accréditation.
- **Heard:** Nous sommes d'accord avec la déclaration de l'USOC, comité olympique des États-Unis, selon laquelle les intérêts de nos athlètes et de nos clubs ainsi que de leur sport pour ta tête-tête au mieux servi. Cela peut être fait en allant de l'avant et en procédant plutôt à des changements significatifs au sein de notre organisation qu'à la révocation d'accréditation. — WER 10%
- **en-US:** We agree with the statement by the USOC, the United States Olympic Committee, that the interests of our athletes and our clubs and their sport for your head-to-head at best served. This can be done by moving forward and making significant changes within our organization rather than revoking accreditation. — chrF 64, 6.0 s
  - reference: We agree with the USOC's statement that the interests of our athletes and clubs, and their sport, may be better served by moving forward with meaningful change within our organization, rather than decertification.
- **ar-SA:** نتفق مع بيان اللجنة الأولمبية الأمريكية، الذي يقول بأن مصالح رياضيينا ونوادينا ورياضة لعبة الرأس إلى الرأس هي أفضل ما يمكن أن يخدم. ويمكن تحقيق ذلك بالمضي قدما وإجراء تغييرات هامة داخل منظمتنا بدلا من سحب الاعتماد. — chrF 51, 6.0 s
  - reference: نتفق مع بيان اللجنة الأولمبية الأمريكية بأن مصالح الرياضيين والأندية، ورياضتهم، يمكن أن تُلبى بشكل أفضل من خلال المضي قدمًا في تغيير ذي مغزى داخل مؤسستنا، بدلًا من سحب التراخيص.

### fr-FR · FLEURS 1857
- **Said:** Il a ajouté qu’« on ne devrait cependant pas leur demander d’assumer des obligations qui dépassent leur stade de développement, leur responsabilité et leurs capacités. »
- **Heard:** Il ajoutait qu'on ne devrait cependant pas leur demander d'assumer des obligations qui dépassent leur stade de développement, de responsabilité, et leur capacité. — WER 19%
- **en-US:** He added that they should not, however, be asked to assume obligations that exceed their stage of development, responsibility, and capacity. — chrF 68, 4.6 s
  - reference: He added that "they should not, however, be asked to take on obligations that go beyond their development stage, responsibility and capabilities."
- **ar-SA:** وأضاف أنه ينبغي ألا يُطلب منها، مع ذلك، أن تتحمل التزامات تتجاوز مرحلة نموها ومسؤوليتها وقدرتها. — chrF 60, 4.6 s
  - reference: وأضاف أنه "مع ذلك، لا ينبغي أن يُجبروا على تحمل التزامات تتجاوز مرحلة نموهم، ومسؤوليتهم وقدراتهم."

### fr-FR · FLEURS 1913
- **Said:** Le rugissement du tigre ne ressemble pas au rugissement ample du lion, mais plutôt à une phrase dont les mots seraient des cris et des grondements.
- **Heard:** Régissement du tigre ne ressemble pas aux régissements en plus des liants, mais plutôt à une phrase dans les mots. Comment seraient les cris et les grandements ? — WER 50%
- **en-US:** Tiger regiment does not look like regiments in addition to binders, but rather a sentence in words. How would the screams and the greatness be? — chrF 29, 1.5 s
  - reference: The tiger's roar is not like the full-voiced roar of a lion, but more like a sentence of snarly, shouted words.
- **ar-SA:** لا يبدو أن كتيبة النمر تشبه كتيبة بالإضافة إلى الملصقات، ولكنها تبدو أكثر مثل جملة في الكلمات. كيف ستكون الصرخات والغناء ؟ — chrF 24, 1.5 s
  - reference: زئير النمر ليس كزئير الأسد كامل الصوت، لكنه أقرب إلى الصياح بكلمات غاضبة.

### en-US · FLEURS 1904
- **Said:** However, due to the slow communication channels, styles in the west could lag behind by 25 to 30 year.
- **Heard:** due to the slow communication check. The styles in the west could lag behind by 25 to 30 years. — WER 21%
- **fr-FR:** En raison de la lenteur de la vérification de communication. Les styles de l'Ouest peuvent prendre du retard de 25 à 30 ans. — chrF 50, 3.1 s
  - reference: Cependant, en raison de la lenteur des moyens de communication, les modes occidentales pouvaient accuser un retard de 25 à 30 ans.
- **ar-SA:** بسبب بطء الاتصالات الأساليب في الغرب يمكن أن تتخلف عن الركب 25 إلى 30 سنة. — chrF 30, 3.1 s
  - reference: وعلى الرغم من ذلك، فنظرا لبطء قنوات التواصل، قد تتأخر الأنماط في الغرب قدر ما يقارب 25 إلى 30 سنة.

### en-US · FLEURS 1675
- **Said:** All nouns, alongside the word Sie for you, always begin with a capital letter, even in the middle of a sentence.
- **Heard:** All nouns alongside the world say for you always begin with a capital letter. Even the middle of the sentence. — WER 19%
- **fr-FR:** Tous les noms à côté du monde disent pour vous commencent toujours par une lettre majuscule. Même au milieu de la phrase. — chrF 58, 2.5 s
  - reference: Tous les noms, suivis du mot Sie qui signifie vous, commencent toujours par une majuscule, même au milieu d’une phrase.
- **ar-SA:** كل الأسماء إلى جانب العالم يقول لك دائما تبدأ بحرف كبير. حتى منتصف الجملة — chrF 41, 2.5 s
  - reference: جميع الأسماء، بالإضافة إلى كلمة Sie بالنسبة لك، تبدأ دائماً بحرف كبير، حتى في منتصف الجملة.

### en-US · FLEURS 1950
- **Said:** To the north and within easy reach is the romantic and fascinating town of Sintra and which was made famous to foreigners after a glowing account of its splendours recorded by Lord Byron.
- **Heard:** The foreigners after a glowing account of its splinter is recorded by Lord Byron. — WER 67%
- **fr-FR:** Les étrangers après un compte rendu brillant de son éclat est enregistré par Lord Byron. — chrF 24, 3.3 s
  - reference: La ville romantique et fascinante de Sintra, située au nord, est facilement accessible et a été rendue célèbre auprès des étrangers par le récit éclatant de sa splendeur qu'en a fait Lord Byron.
- **ar-SA:** الأجانب بعد أن سجل اللورد بايرون تقريراً متوهجاً عن شظيته. — chrF 18, 3.3 s
  - reference: تقع مدينة سنترا الرومانتيكية ذات الجمال الخلاب ناحية الشمال في مكان يسهل الوصول إليه، وهي المدينة التي ذاع صيتها وسط الأجانب بعد سرد اللورد بايرن المبهر لروائعها.

### ar-SA · FLEURS 1993
- **Said:** تشكلت في المحيط الأطلسي اليوم عاشر عاصفة مُسماة لموسم الأعاصير الأطلسية، العاصفة شبه الاستوائية جيري.
- **Heard:** تشكلت في المحيط الأطلسي اليوم عايش رعاصفة مسمى لموسى من الأعاصر الأطلسية العاصفة — WER 60%
- **fr-FR:** Il s'est formé dans l'Atlantique aujourd'hui , et il a vécu une tempête appelée Moïse , de l'époque des tempêtes atlantiques . — chrF 33, 5.6 s
  - reference: La tempête subtropicale Jerry, 10ème tempête de la saison des ouragans à porter un nom, est apparue ce jour dans l'océan Atlantique.
- **en-US:** Formed in the Atlantic today, a storm named Moses lived in the Atlantic storm era. — chrF 40, 5.6 s
  - reference: The tenth named storm of the Atlantic Hurricane season, Subtropical Storm Jerry, formed in the Atlantic Ocean today.

### ar-SA · FLEURS 1730
- **Said:** تغادر الحافلات المحطة الداخلية بين المناطق (عبر النهر) في خلال اليوم على الرغم من أن معظمها وخاصة المتجهة منها إلى الشرق وجاكار/بومثانج تغادر بين 06:30 و 07:30.
- **Heard:** تغادر بحافلات المحطة الدخلية بين المنوطق عبر النهر في خلال اليوم على الرغم من أن نمع نظامها وخاصات المتجه منها إلى الشرق وجكارا بومثانج تغير بينى 6-3 37 — WER 50%
- **fr-FR:** Les bus partent de la gare d'entrée entre les deux zones de l'autre côté de la rivière pendant la journée , même si nous sommes en pleine nuit . et en particulier celles qui se dirigent vers l'est 6 − 3 33 — chrF 36, 4.7 s
  - reference: Les bus partent de la gare routière interdistricts (située sur l'autre rive) tout au long de la journée, mais la plupart, tout particulièrement ceux qui desservent l'est et Jakar/Bumthang, partent entre 6 h 30 et 7 h 30 du matin.
- **en-US:** Buses leave the entrance station between the districts across the river during the day even though we're glowing. and particularly the eastward flowing Jakara Bumthang 6 - 3 32 — chrF 42, 4.7 s
  - reference: Buses depart the inter-district bus station (across the river) throughout the day, though most, especially those heading to the east and Jakar/Bumthang leave between 06:30 and 07:30.

### ar-SA · FLEURS 1942
- **Said:** نصنع بيوتنا وملابسنا من النباتات . معظم الطعام الذي نتناوله من النباتات كذلك. بدون النباتات، لا يمكن للحيوانات البقاء.
- **Heard:** نسع بيوتنا وملابسنا من النباتات مرزم الطعام الذي نتناوله من النباتات كذلك بدون النباتات لا يمكن للحيوانات البقاء — WER 11%
- **fr-FR:** Nous fabriquons nos maisons et nos vêtements à partir de plantes , et nous fabriquons notre nourriture à partir de plantes . Sans plantes , les animaux ne peuvent pas survivre . — chrF 61, 5.0 s
  - reference: Nous fabriquons nos maisons et nos vêtements à base de plantes. La plupart des aliments que nous mangeons sont des plantes. Sans les plantes, les animaux ne survivraient pas.
- **en-US:** We make our houses and clothes from plants , and the food we eat is made from plants . Without plants, animals cannot survive. — chrF 67, 5.0 s
  - reference: We make our houses from plants and make clothes from plants. Most foods that we eat are plants. Without plants, animals could not survive.
