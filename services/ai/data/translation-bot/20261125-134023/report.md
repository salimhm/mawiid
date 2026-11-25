# Translation bot test: 2026-11-25 13:46

15 sentences spoken by bots in fr-FR, en-US, ar-SA, read by one listener bot per language, through the real LiveKit server and AI worker. Scored against the FLEURS human references.

**Result: FAIL**: en-US: 1 sentence(s) without transcript; en-US→fr-FR: 1 translation(s) never arrived; en-US→ar-SA: 1 translation(s) never arrived

## Speech-to-text (what the worker heard)

| Spoken language | Sentences | Transcribed | WER (lower is better) |
|---|---|---|---|
| fr-FR | 5 | 5 | 26% |
| en-US | 5 | 4 | 20% |
| ar-SA | 5 | 5 | 41% |

## Translation (what each listener read)

Mean chrF over all directions: **47.7** (text-only reference on these sentences: 54).

| Direction | Sentences | Delivered | chrF | BLEU | Wrong language | Untranslated | Delay p50 / max |
|---|---|---|---|---|---|---|---|
| fr-FR→en-US | 5 | 5 | 55.5 | 24.5 | 0 | 0 | 5.75 s / 7.99 s |
| fr-FR→ar-SA | 5 | 5 | 48.1 | 6.5 | 0 | 0 | 5.75 s / 7.99 s |
| en-US→fr-FR | 5 | 4 | 56.0 | 35.8 | 0 | 0 | 3.54 s / 5.28 s |
| en-US→ar-SA | 5 | 4 | 40.2 | 14.5 | 0 | 0 | 3.56 s / 5.28 s |
| ar-SA→fr-FR | 5 | 5 | 38.8 | 13.2 | 0 | 0 | 6.64 s / 7.68 s |
| ar-SA→en-US | 5 | 5 | 47.8 | 17.8 | 0 | 0 | 6.64 s / 7.68 s |

## Every sentence

### fr-FR · FLEURS 1690
- **Said:** Nous sommes d'accord avec la déclaration de l'USOC (Comité olympique des États-Unis) selon laquelle les intérêts de nos athlètes et de nos clubs, ainsi que de leur sport, pourraient être mieux servis. Cela peut être fait en allant de l'avant et en procédant plutôt à des changements significatifs au sein de notre organisation, qu'à la révocation d'accréditation.
- **Heard:** Nous sommes d'accord avec la déclaration de l'USOC, comité olympique des États-Unis, selon laquelle les intérêts de nos athlètes et de nos clubs ainsi que de leur sport pour tête-tête au mieux servi. Cela peut être fait en allant de l'avant et en procédant plutôt à des changements significatifs au sein de notre organisation qu'à la révocation d'accréditation. — WER 8%
- **en-US:** We agree with the statement by the USOC, the United States Olympic Committee, that the interests of our athletes and clubs and their sport are best served by the creation of a new Olympic Committee. This can be done by moving forward and making significant changes within our organization rather than revoking accreditation. — chrF 65, 8.0 s
  - reference: We agree with the USOC's statement that the interests of our athletes and clubs, and their sport, may be better served by moving forward with meaningful change within our organization, rather than decertification.
- **ar-SA:** ونتفق مع بيان اللجنة الأولمبية الأمريكية، الذي يقول إن مصالح رياضيينا ونوادينا ورياضة الركض التي يمارسونها تخدم على أفضل وجه. ويمكن تحقيق ذلك بالمضي قدما وإجراء تغييرات هامة داخل منظمتنا بدلا من سحب الاعتماد. — chrF 48, 8.0 s
  - reference: نتفق مع بيان اللجنة الأولمبية الأمريكية بأن مصالح الرياضيين والأندية، ورياضتهم، يمكن أن تُلبى بشكل أفضل من خلال المضي قدمًا في تغيير ذي مغزى داخل مؤسستنا، بدلًا من سحب التراخيص.

### fr-FR · FLEURS 1857
- **Said:** Il a ajouté qu’« on ne devrait cependant pas leur demander d’assumer des obligations qui dépassent leur stade de développement, leur responsabilité et leurs capacités. »
- **Heard:** Il ajoutait qu'on ne devrait cependant pas leur demander d'assumer des obligations qui dépasse leur stade de développement, de responsabilité, et leur capacité. — WER 23%
- **en-US:** He added that they should not, however, be asked to assume obligations that exceed their stage of development, responsibility, and capacity. — chrF 68, 5.8 s
  - reference: He added that "they should not, however, be asked to take on obligations that go beyond their development stage, responsibility and capabilities."
- **ar-SA:** وأضاف أنه لا ينبغي أن يُطلب منهم، مع ذلك، أن يتحملوا التزامات تتجاوز مرحلة نموهم ومسؤولياتهم وقدراتهم. — chrF 69, 5.8 s
  - reference: وأضاف أنه "مع ذلك، لا ينبغي أن يُجبروا على تحمل التزامات تتجاوز مرحلة نموهم، ومسؤوليتهم وقدراتهم."

### fr-FR · FLEURS 1913
- **Said:** Le rugissement du tigre ne ressemble pas au rugissement ample du lion, mais plutôt à une phrase dont les mots seraient des cris et des grondements.
- **Heard:** Régissement du tigre n'en ressemble pas au régissement en plus des liants, mais plutôt à une phrase dans les mots. Régissement serait des cris et des gondements. — WER 50%
- **en-US:** Tiger regiment does not look like the regiment in addition to binders, but rather a sentence in words. Regiment would be screams and gondements. — chrF 30, 5.8 s
  - reference: The tiger's roar is not like the full-voiced roar of a lion, but more like a sentence of snarly, shouted words.
- **ar-SA:** لا يبدو نظام النمر مثل نظام الإضافة إلى الملصقات، ولكنه يبدو مثل جملة في الكلمات. ويقال إن صوت الصراخ والغضب كان عالياً. — chrF 25, 5.8 s
  - reference: زئير النمر ليس كزئير الأسد كامل الصوت، لكنه أقرب إلى الصياح بكلمات غاضبة.

### fr-FR · FLEURS 2004
- **Said:** Le même mois, un autre avion de ligne a fait une sortie de piste à Mashhad et a heurté un mur, tuant ainsi dix-sept personnes.
- **Heard:** Mais même moi, un autre avion de ligne a fait une sortie de piste à Machade et heurté un mur. Je suis en ainsi 17 personnes. — WER 35%
- **en-US:** But even I, another airliner made a runway departure in Machade and hit a wall. — chrF 34, 4.8 s
  - reference: The same month saw another airliner overrun a runway at Mashhad and strike a wall, killing seventeen.
- **ar-SA:** ولكن حتى أنا، خرجت طائرة أخرى من المدرج في مشادي واصطدمت بجدار. — chrF 30, 4.8 s
  - reference: أسفر احتياج طائرة ركاب أخرى مدرجاً في مشهد واصطدمت بجدار، وهو ما نتج عنه مقتل سبعة عشر شخصاً.

### fr-FR · FLEURS 1853
- **Said:** Giancarlo Fisichella a perdu le contrôle de sa voiture et a terminé la course peu après le démarrage.
- **Heard:** Jean-Carlo Fitella a perdu le contrôle de sa voiture et a terminé la course peu après le démarrage. — WER 17%
- **en-US:** I am in so 17 people. Jean-Carlo Fitella lost control of his car and finished the race shortly after the start. — chrF 63, 5.6 s
  - reference: Giancarlo Fisichella lost control of his car and ended the race very soon after the start.
- **ar-SA:** وبذلك أصبح عددنا 17 شخصا. فقد جان كارلو فيتيلا السيطرة على سيارته وانتهى السباق بعد وقت قصير من البداية. — chrF 63, 5.6 s
  - reference: فقد جيانكارلو فيشيلا السيطرة على سيارته، وأنهى السباق بعد وقتٍ قصير من بدايته.

### en-US · FLEURS 1904
- **Said:** However, due to the slow communication channels, styles in the west could lag behind by 25 to 30 year.
- **Heard:** the West could lag behind by 25 to 30 years. — WER 53%
- **fr-FR:** L’Occident pourrait prendre un retard de 25 à 30 ans. — chrF 27, 3.1 s
  - reference: Cependant, en raison de la lenteur des moyens de communication, les modes occidentales pouvaient accuser un retard de 25 à 30 ans.
- **ar-SA:** وقد يتخلف الغرب عن الركب بما يتراوح بين 25 و 30 سنة. — chrF 17, 3.1 s
  - reference: وعلى الرغم من ذلك، فنظرا لبطء قنوات التواصل، قد تتأخر الأنماط في الغرب قدر ما يقارب 25 إلى 30 سنة.

### en-US · FLEURS 1675
- **Said:** All nouns, alongside the word Sie for you, always begin with a capital letter, even in the middle of a sentence.
- **Heard:** All nouns alongside the world say for you always begin with a capital letter, even the middle of a sentence. — WER 14%
- **fr-FR:** Tous les noms à côté du monde disent pour vous commencent toujours par une lettre majuscule, même au milieu d'une phrase. — chrF 65, 3.3 s
  - reference: Tous les noms, suivis du mot Sie qui signifie vous, commencent toujours par une majuscule, même au milieu d’une phrase.
- **ar-SA:** كل الأسماء على طول العالم تقول لك دائما تبدأ بحرف كبير، حتى في منتصف الجملة. — chrF 50, 3.3 s
  - reference: جميع الأسماء، بالإضافة إلى كلمة Sie بالنسبة لك، تبدأ دائماً بحرف كبير، حتى في منتصف الجملة.

### en-US · FLEURS 1950
- **Said:** To the north and within easy reach is the romantic and fascinating town of Sintra and which was made famous to foreigners after a glowing account of its splendours recorded by Lord Byron.
- **Heard:** (nothing)
- **fr-FR:** (nothing arrived)
  - reference: La ville romantique et fascinante de Sintra, située au nord, est facilement accessible et a été rendue célèbre auprès des étrangers par le récit éclatant de sa splendeur qu'en a fait Lord Byron.
- **ar-SA:** (nothing arrived)
  - reference: تقع مدينة سنترا الرومانتيكية ذات الجمال الخلاب ناحية الشمال في مكان يسهل الوصول إليه، وهي المدينة التي ذاع صيتها وسط الأجانب بعد سرد اللورد بايرن المبهر لروائعها.

### en-US · FLEURS 1728
- **Said:** The cabbage juice changes color depending on how acidic or basic (alkaline) the chemical is.
- **Heard:** The cabbage juice changes color depending on how acidic, basic alkaline the chemical is. — WER 7%
- **fr-FR:** Le jus de chou change de couleur en fonction de l'acidité, de l'alcalinité basique du produit chimique. — chrF 76, 5.3 s
  - reference: Le jus de chou change de couleur en fonction de l’acidité ou de la basicité (alcalinité) du produit chimique.
- **ar-SA:** عصير الكرنب يتغير اللون اعتمادا على مدى حمضية، قاعدية القلوية الكيميائية. — chrF 52, 5.3 s
  - reference: يتغير لون عصير الملفوف اعتمادًا على مدى حمضية المادة الكيميائية أو قلويتها.

### en-US · FLEURS 1972
- **Said:** Many people don't think about them as dinosaurs because they have feathers and can fly.
- **Heard:** People don't think about them as dinosaurs because they have feathers and can fly. — WER 6%
- **fr-FR:** Les gens ne pensent pas à eux comme des dinosaures parce qu'ils ont des plumes et peuvent voler. — chrF 57, 3.8 s
  - reference: Peu de gens les considèrent comme des dinosaures étant donne qu'ils ont des ailes et peuvent voler.
- **ar-SA:** الناس لا يفكرون فيهم كديناصورات لأنهم لديهم ريش ويمكنهم الطيران — chrF 44, 3.8 s
  - reference: لا يفكر العديد فيها باعتبارها ديناصورات لأن لديها ريشًا ويمكنها الطيران.

### ar-SA · FLEURS 1993
- **Said:** تشكلت في المحيط الأطلسي اليوم عاشر عاصفة مُسماة لموسم الأعاصير الأطلسية، العاصفة شبه الاستوائية جيري.
- **Heard:** تشكلت في المحيط الأطلسي اليوم عايش رعاصفة مسمى لموسى من الأعاصر الأطلسية العاصفة شبه — WER 53%
- **fr-FR:** Il s'est formé dans l'Atlantique aujourd'hui , et il a vécu une tempête appelée Moïse , une tempête quasi-atlantique . — chrF 32, 6.6 s
  - reference: La tempête subtropicale Jerry, 10ème tempête de la saison des ouragans à porter un nom, est apparue ce jour dans l'océan Atlantique.
- **en-US:** Formed in the Atlantic today, a storm named Moses lived in the Atlantic era, a semi-tropical storm. — chrF 45, 6.6 s
  - reference: The tenth named storm of the Atlantic Hurricane season, Subtropical Storm Jerry, formed in the Atlantic Ocean today.

### ar-SA · FLEURS 1730
- **Said:** تغادر الحافلات المحطة الداخلية بين المناطق (عبر النهر) في خلال اليوم على الرغم من أن معظمها وخاصة المتجهة منها إلى الشرق وجاكار/بومثانج تغادر بين 06:30 و 07:30.
- **Heard:** تغادر بحافلات المحطة الدخلية بين المنوطق عبر النهر في خلال اليوم على الرغم من أن نمع عظمها وخاصات المتجه منها إلى الشرق وجكارا بومثانج تغيير بينى 6-3 37 — WER 50%
- **fr-FR:** Les bus partent de la gare d'entrée entre les deux zones de l'autre côté de la rivière pendant la journée , même si nous sommes en pleine nuit . et en particulier vers l'est, et de Jakara Bumthang 6 − 3 32 — chrF 40, 6.9 s
  - reference: Les bus partent de la gare routière interdistricts (située sur l'autre rive) tout au long de la journée, mais la plupart, tout particulièrement ceux qui desservent l'est et Jakar/Bumthang, partent entre 6 h 30 et 7 h 30 du matin.
- **en-US:** Buses leave the entrance station between the districts across the river during the day even though we're glowing. and particularly the eastward sections of Jakara Bumthang 6 - 3 33 — chrF 42, 6.9 s
  - reference: Buses depart the inter-district bus station (across the river) throughout the day, though most, especially those heading to the east and Jakar/Bumthang leave between 06:30 and 07:30.

### ar-SA · FLEURS 1942
- **Said:** نصنع بيوتنا وملابسنا من النباتات . معظم الطعام الذي نتناوله من النباتات كذلك. بدون النباتات، لا يمكن للحيوانات البقاء.
- **Heard:** نعب يوتنا وملابسنا من النباتات مرزم الطعام الذي نتناوله من النباتات كذلك بدون النبتات لا يمكن للحيوانات البقاء — WER 22%
- **fr-FR:** Nous fabriquons nos vêtements et nos chaussures à partir de plantes , et nous mangeons des plantes . Sans plantes , les animaux ne peuvent pas survivre . — chrF 61, 6.2 s
  - reference: Nous fabriquons nos maisons et nos vêtements à base de plantes. La plupart des aliments que nous mangeons sont des plantes. Sans les plantes, les animaux ne survivraient pas.
- **en-US:** We make our blankets and clothes from plants , and the food we eat is made from plants . Without plants, animals can't survive. — chrF 62, 6.2 s
  - reference: We make our houses from plants and make clothes from plants. Most foods that we eat are plants. Without plants, animals could not survive.

### ar-SA · FLEURS 1740
- **Said:** إن عرض الصوت والضوء الهرمي واحد من أمتع الأشياء الموجودة بالمنطقة للأطفال.
- **Heard:** إن عرض الصوت والضوء الهرمي واحد من أمتع الأشياء الموجودة بالمنتقى للأشياء اطفال — WER 25%
- **fr-FR:** La pyramide lumineuse et sonore est l'une des choses les plus amusantes que vous puissiez trouver dans le musée des objets . — chrF 34, 7.7 s
  - reference: Le spectacle son et lumière à la pyramide constitue l'une des attractions les plus intéressantes de la région pour les enfants.
- **en-US:** The sound and light pyramid is one of the most enjoyable things in the Selected Objects. — chrF 53, 7.7 s
  - reference: The pyramid sound and light show is one of the most interesting things in the area for kids.

### ar-SA · FLEURS 1771
- **Said:** تذكر أنه على الرغم من أن الموسيقى في المنصات الرئيسية قد تكون انتهت، إلا أن هناك أقسام من المهرجان قد تستمر في تشغيل الموسيقى حتى وقت متأخر من الليل.
- **Heard:** اذكر انه على الرغم من ان الموسيقى في المنصات الرئيسية قد تكون انتهت الا انه — WER 55%
- **fr-FR:** Je me souviens que même si la musique sur les scènes principales était finie , — chrF 25, -0.1 s
  - reference: N'oubliez pas que même si les spectacles musicaux sont terminés sur les scènes principales, d'autres spectacles musicaux peuvent se poursuivre jusqu'à tard dans la nuit sur d'autres sites du festival.
- **en-US:** I remember that even though the music on the main stages might have ended , it was still there . — chrF 41, -0.1 s
  - reference: Remember that even though music on the main stages may have finished, there may be sections of the festival that will keep playing music until late into the night.
