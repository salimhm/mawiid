# Translation bot test: 2026-11-20 11:56

23 sentences spoken by bots in fr-FR, en-US, ar-SA, read by one listener bot per language, through the real LiveKit server and AI worker. Scored against the FLEURS human references.

**Result: FAIL**: fr-FR→ar-SA: 2 translation(s) never arrived; ar-SA→fr-FR: 1 translation(s) never arrived; ar-SA→en-US: 1 translation(s) never arrived

## Speech-to-text (what the worker heard)

| Spoken language | Sentences | Transcribed | WER (lower is better) |
|---|---|---|---|
| fr-FR | 6 | 6 | 40% |
| en-US | 8 | 8 | 19% |
| ar-SA | 9 | 9 | 38% |

## Translation (what each listener read)

Mean chrF over all directions: **44.9** (text-only reference on these sentences: 54).

| Direction | Sentences | Delivered | chrF | BLEU | Wrong language | Untranslated | Delay p50 / max |
|---|---|---|---|---|---|---|---|
| fr-FR→en-US | 6 | 6 | 46.5 | 17.0 | 0 | 0 | 3.49 s / 7.42 s |
| fr-FR→ar-SA | 6 | 4 | 41.9 | 2.5 | 0 | 0 | 4.04 s / 37.3 s |
| en-US→fr-FR | 8 | 8 | 52.6 | 25.9 | 0 | 0 | 3.2 s / 11.42 s |
| en-US→ar-SA | 8 | 8 | 38.5 | 14.2 | 0 | 0 | 3.2 s / 11.42 s |
| ar-SA→fr-FR | 9 | 8 | 42.5 | 15.8 | 0 | 0 | 8.13 s / 15.25 s |
| ar-SA→en-US | 9 | 8 | 47.7 | 16.7 | 0 | 0 | 8.14 s / 15.25 s |

## Every sentence

### fr-FR · FLEURS 1690
- **Said:** Nous sommes d'accord avec la déclaration de l'USOC (Comité olympique des États-Unis) selon laquelle les intérêts de nos athlètes et de nos clubs, ainsi que de leur sport, pourraient être mieux servis. Cela peut être fait en allant de l'avant et en procédant plutôt à des changements significatifs au sein de notre organisation, qu'à la révocation d'accréditation.
- **Heard:** Nous sommes d'accord avec la déclaration de l'USOC, comité olympique des États-Unis. Nous allons à laquelle les intérêts de nos athlètes et de nos clubs, ainsi que de leur sport, pour être tête au mieux servi. Cela peut être fait en allant de l'avant et en procédant plutôt à des changements significatifs au sein de notre organisation. Qu'est la révocation d'accréditation ? — WER 13%
- **en-US:** We agree with the statement of the USOC, the United States Olympic Committee. We go to which the interests of our athletes and our clubs, as well as their sport, to be head to best served. This can be done by moving forward and rather making significant changes within our organization. What is accreditation revocation? — chrF 61, 3.0 s
  - reference: We agree with the USOC's statement that the interests of our athletes and clubs, and their sport, may be better served by moving forward with meaningful change within our organization, rather than decertification.
- **ar-SA:** ونتفق مع البيان الصادر عن اللجنة الأولمبية الأمريكية. ونحن نعمل على خدمة مصالح رياضيينا ونوادينا، وكذلك رياضة رياضيينا، على أفضل وجه. ويمكن تحقيق ذلك بالمضي قدما وإجراء تغييرات ذات مغزى في منظمتنا. ما هو سحب الاعتماد؟ ماذا عن قدرتهم ؟ .. .. "الإحمرار من مادة الـ TIG" لا يبدو مثل "الإحماء" بالإضافة إلى الرابط، ولكنه يبدو مثل جملة في الكلمات كيف ستكون الصراخ والرقص ؟ — chrF 39, 37.3 s
  - reference: نتفق مع بيان اللجنة الأولمبية الأمريكية بأن مصالح الرياضيين والأندية، ورياضتهم، يمكن أن تُلبى بشكل أفضل من خلال المضي قدمًا في تغيير ذي مغزى داخل مؤسستنا، بدلًا من سحب التراخيص.

### fr-FR · FLEURS 1857
- **Said:** Il a ajouté qu’« on ne devrait cependant pas leur demander d’assumer des obligations qui dépassent leur stade de développement, leur responsabilité et leurs capacités. »
- **Heard:** Et leur capacité ? — WER 96%
- **en-US:** And their capacity? — chrF 7, 1.7 s
  - reference: He added that "they should not, however, be asked to take on obligations that go beyond their development stage, responsibility and capabilities."
- **ar-SA:** (nothing arrived)
  - reference: وأضاف أنه "مع ذلك، لا ينبغي أن يُجبروا على تحمل التزامات تتجاوز مرحلة نموهم، ومسؤوليتهم وقدراتهم."

### fr-FR · FLEURS 1913
- **Said:** Le rugissement du tigre ne ressemble pas au rugissement ample du lion, mais plutôt à une phrase dont les mots seraient des cris et des grondements.
- **Heard:** Rougissement du TIG n'en ressemble pas au rougissement en plus du lien, mais plutôt à une phrase dans les mots... Comment seraient les cris et les gondements ? — WER 54%
- **en-US:** Flushing of the TIG does not look like the blushing in addition to the link, but rather a sentence in the words... How would the screams and the gushing be? — chrF 30, 7.4 s
  - reference: The tiger's roar is not like the full-voiced roar of a lion, but more like a sentence of snarly, shouted words.
- **ar-SA:** (nothing arrived)
  - reference: زئير النمر ليس كزئير الأسد كامل الصوت، لكنه أقرب إلى الصياح بكلمات غاضبة.

### fr-FR · FLEURS 2004
- **Said:** Le même mois, un autre avion de ligne a fait une sortie de piste à Mashhad et a heurté un mur, tuant ainsi dix-sept personnes.
- **Heard:** De même moi, un autre avion de ligne a fait une sortie de piste à Machade et heurté un mur. Je suis en, ainsi, 17 personnes. — WER 35%
- **en-US:** Likewise, another airliner made a runway departure in Machade and hit a wall. I am in, so, 17 people. — chrF 34, 2.8 s
  - reference: The same month saw another airliner overrun a runway at Mashhad and strike a wall, killing seventeen.
- **ar-SA:** كذلك خرجت طائرة أخرى من طائرات الخطوط الجوية عن المدرج في مشعد واصطدمت بجدار. وبذلك أصبح عددي 17 شخصا. — chrF 34, 2.8 s
  - reference: أسفر احتياج طائرة ركاب أخرى مدرجاً في مشهد واصطدمت بجدار، وهو ما نتج عنه مقتل سبعة عشر شخصاً.

### fr-FR · FLEURS 1853
- **Said:** Giancarlo Fisichella a perdu le contrôle de sa voiture et a terminé la course peu après le démarrage.
- **Heard:** Jean-Carlo Fitiéla a perdu le contrôle de sa voiture et a terminé la course peu après le démarrage. — WER 17%
- **en-US:** Jean-Carlo Fitiéla lost control of his car and finished the race shortly after the start. — chrF 63, 4.0 s
  - reference: Giancarlo Fisichella lost control of his car and ended the race very soon after the start.
- **ar-SA:** وفقد جان كارلو فيتييلا السيطرة على سيارته وانتهى السباق بعد وقت قصير من البدء. — chrF 65, 4.0 s
  - reference: فقد جيانكارلو فيشيلا السيطرة على سيارته، وأنهى السباق بعد وقتٍ قصير من بدايته.

### fr-FR · FLEURS 1980
- **Said:** Malheureusement, il est difficile d'étudier le flux de circulation car le comportement des conducteurs ne peut être prédit avec cent pour cent de certitude.
- **Heard:** Malheureusement, il est difficile d'étudier le flux de circulation car les comportements des conducteurs ne peuvent être prédits avec 100% de certitude. — WER 28%
- **en-US:** Unfortunately, it is difficult to study traffic flow because driver behaviors cannot be predicted with 100% certainty. — chrF 70, 4.1 s
  - reference: Unfortunately, studying traffic flow is difficult because driver behavior cannot be predicted with one-hundred percent certainty.
- **ar-SA:** للأسف، من الصعب دراسة تدفق المرور لأن سلوك السائقين لا يمكن التنبؤ به بنسبة 100٪ من اليقين. — chrF 38, 4.1 s
  - reference: للأسف، دراسة حركة السير صعبة لأنه لا يمكن توقع سلوك السائق بيقين مائة في المئة.

### en-US · FLEURS 1904
- **Said:** However, due to the slow communication channels, styles in the west could lag behind by 25 to 30 year.
- **Heard:** due to the slow communication. Styles in the West could lag behind by 25 to 30 years. — WER 16%
- **fr-FR:** En raison de la lenteur de la communication. Les styles en Occident peuvent prendre du retard de 25 à 30 ans. — chrF 52, 2.9 s
  - reference: Cependant, en raison de la lenteur des moyens de communication, les modes occidentales pouvaient accuser un retard de 25 à 30 ans.
- **ar-SA:** بسبب بطء الاتصال الأساليب في الغرب يمكن أن تتخلف 25 إلى 30 سنة. — chrF 27, 2.9 s
  - reference: وعلى الرغم من ذلك، فنظرا لبطء قنوات التواصل، قد تتأخر الأنماط في الغرب قدر ما يقارب 25 إلى 30 سنة.

### en-US · FLEURS 1675
- **Said:** All nouns, alongside the word Sie for you, always begin with a capital letter, even in the middle of a sentence.
- **Heard:** All nouns alongside the world say for you always begin with a capital letter. Even the middle of the sentence. — WER 19%
- **fr-FR:** Tous les noms à côté du monde disent pour vous commencent toujours par une lettre majuscule. Même au milieu de la phrase. — chrF 58, 2.4 s
  - reference: Tous les noms, suivis du mot Sie qui signifie vous, commencent toujours par une majuscule, même au milieu d’une phrase.
- **ar-SA:** كل الأسماء إلى جانب العالم يقول لك دائما تبدأ بحرف كبير. حتى منتصف الجملة — chrF 41, 2.4 s
  - reference: جميع الأسماء، بالإضافة إلى كلمة Sie بالنسبة لك، تبدأ دائماً بحرف كبير، حتى في منتصف الجملة.

### en-US · FLEURS 1950
- **Said:** To the north and within easy reach is the romantic and fascinating town of Sintra and which was made famous to foreigners after a glowing account of its splendours recorded by Lord Byron.
- **Heard:** of the splinter is recorded by Lord Byron. — WER 82%
- **fr-FR:** La légende de l'éclat est rapportée par Lord Byron. — chrF 14, 2.7 s
  - reference: La ville romantique et fascinante de Sintra, située au nord, est facilement accessible et a été rendue célèbre auprès des étrangers par le récit éclatant de sa splendeur qu'en a fait Lord Byron.
- **ar-SA:** لقد سجل اللورد بايرون فكرة الشظية — chrF 11, 2.7 s
  - reference: تقع مدينة سنترا الرومانتيكية ذات الجمال الخلاب ناحية الشمال في مكان يسهل الوصول إليه، وهي المدينة التي ذاع صيتها وسط الأجانب بعد سرد اللورد بايرن المبهر لروائعها.

### en-US · FLEURS 1728
- **Said:** The cabbage juice changes color depending on how acidic or basic (alkaline) the chemical is.
- **Heard:** The cabbage juice changes color depending on how acidic, basic alkaline the chemical is. — WER 7%
- **fr-FR:** Le jus de chou change de couleur en fonction de l'acidité, de l'alcalinité basique du produit chimique. — chrF 76, 4.2 s
  - reference: Le jus de chou change de couleur en fonction de l’acidité ou de la basicité (alcalinité) du produit chimique.
- **ar-SA:** عصير الكرنب يتغير اللون اعتمادا على مدى حمضية، قاعدية القلوية الكيميائية. — chrF 52, 4.2 s
  - reference: يتغير لون عصير الملفوف اعتمادًا على مدى حمضية المادة الكيميائية أو قلويتها.

### en-US · FLEURS 1972
- **Said:** Many people don't think about them as dinosaurs because they have feathers and can fly.
- **Heard:** Many people don't think about them as dinosaurs because they have feathers and can fly. — WER 0%
- **fr-FR:** Beaucoup de gens ne pensent pas à eux comme des dinosaures parce qu'ils ont des plumes et peuvent voler. — chrF 59, 2.9 s
  - reference: Peu de gens les considèrent comme des dinosaures étant donne qu'ils ont des ailes et peuvent voler.
- **ar-SA:** الكثير من الناس لا يفكرون فيهم كديناصورات لأنهم لديهم ريش ويمكنهم الطيران. — chrF 45, 2.9 s
  - reference: لا يفكر العديد فيها باعتبارها ديناصورات لأن لديها ريشًا ويمكنها الطيران.

### en-US · FLEURS 1938
- **Said:** The hospital has followed protocol for infection control, including separating the patient from others to prevent possible infection of others.
- **Heard:** The hospital has followed protocol for infection control, including separating the patient from other others to prevent possible infection of others. — WER 5%
- **fr-FR:** L’hôpital a suivi le protocole de contrôle des infections, y compris la séparation du patient des autres pour prévenir une éventuelle infection des autres. — chrF 50, 3.5 s
  - reference: L'hôpital a respecté le protocole pour la prévention des infections, notamment l'isolement du patient afin d'éviter une possible infection d'autres patients.
- **ar-SA:** وقد اتبع المستشفى بروتوكول مكافحة العدوى، بما في ذلك فصل المريض عن غيره من المرضى لمنع احتمال إصابة الآخرين. — chrF 67, 3.5 s
  - reference: اتبعت المستشفى بروتوكول مكافحة العدوى، بما في ذلك فصل المريض عن الآخرين لمنع انتقال العدوى المحتملة للآخرين.

### en-US · FLEURS 1846
- **Said:** The aspect ratio of this format (dividing by twelve to obtain the simplest whole-number ratio) is therefore said to be 3:2.
- **Heard:** The aspect ratio of this format, dividing by 12 to obtain the simplest whole number ratio. is therefore said to be free to two. — WER 17%
- **fr-FR:** Le rapport d'aspect de ce format, divisé par 12 pour obtenir le rapport de nombre entier le plus simple. On dit donc que c'est libre à deux. — chrF 64, 8.2 s
  - reference: On dit donc que le rapport d'aspect de ce format (en divisant par douze pour obtenir le plus simple des rapports de nombres entiers) est de 3:2.
- **ar-SA:** نسبة العرض إلى الارتفاع لهذا الشكل، مقسومة على 12 للحصول على أبسط نسبة عدد صحيح. لذا يقال أن هذا العدد حر إلى اثنين. — chrF 37, 8.2 s
  - reference: نسبة الأبعاد الخاصة بهذه الصورة تكون (عند القسمة على 12 للحصول على النسبة لأبسط عدد صحيح) إذن ستكون 3:2.

### en-US · FLEURS 1806
- **Said:** As light pollution in their heyday was not the kind of problem it is today, they are usually located in cities or at campuses, easier to reach than those built in modern times.
- **Heard:** As light pollution in their heyday was not the kind of problem it is today, they are usually located in cities or at campuses. to reach in those built in modern times — WER 6%
- **fr-FR:** Comme la pollution lumineuse à leur apogée n’était pas le genre de problème qu’elle est aujourd’hui, ils sont généralement situés dans les villes ou sur les campus. Pour atteindre ceux construits dans les temps modernes — chrF 60, 11.4 s
  - reference: Comme la pollution lumineuse à leur époque n'était pas aussi préoccupant qu'aujourd'hui, ils sont généralement situés dans des villes ou sur des campus, plus faciles d'accès que ceux construits à l'époque moderne.
- **ar-SA:** وبما أن التلوث الضوئي لم يكن في أوج نشاطه من المشاكل التي تواجهه اليوم، فإنه يوجد عادة في المدن أو في الحرم الجامعي. في تلك التي بنيت في العصور الحديثة — chrF 40, 11.4 s
  - reference: بينما لم يكن التلوث الضوئي في ذروته إحدى مشاكلهم المهمة كما هي الحال في هذه الأيام، فهم متواجدون عادة في المدن أو حرم الجامعات والوصول إليهم أسهل من الوصول إلى تلك المبنية في العصر الحديث.

### ar-SA · FLEURS 1993
- **Said:** تشكلت في المحيط الأطلسي اليوم عاشر عاصفة مُسماة لموسم الأعاصير الأطلسية، العاصفة شبه الاستوائية جيري.
- **Heard:** تشكلت في المحيط الأطلسي اليوم عايش رعاصفة مسمى لموسى من الأعاصر الأطلسية العاصفة شبه — WER 53%
- **fr-FR:** Il s'est formé dans l'Atlantique aujourd'hui , et il a vécu une tempête appelée Moïse , une tempête quasi-atlantique . — chrF 32, 8.2 s
  - reference: La tempête subtropicale Jerry, 10ème tempête de la saison des ouragans à porter un nom, est apparue ce jour dans l'océan Atlantique.
- **en-US:** Formed in the Atlantic today, a storm named Moses lived in the Atlantic era, a semi-tropical storm. — chrF 45, 8.2 s
  - reference: The tenth named storm of the Atlantic Hurricane season, Subtropical Storm Jerry, formed in the Atlantic Ocean today.

### ar-SA · FLEURS 1730
- **Said:** تغادر الحافلات المحطة الداخلية بين المناطق (عبر النهر) في خلال اليوم على الرغم من أن معظمها وخاصة المتجهة منها إلى الشرق وجاكار/بومثانج تغادر بين 06:30 و 07:30.
- **Heard:** تغدر بحافلات المحطة الدخلية بين المنوطق عبر النهر في خلال اليوم على الرغم من أن نمع عظمها وخاصات المتجه منها إلى الشرق وجكارا بومثانج تغير بينى ستة وتلاتي 37 — WER 53%
- **fr-FR:** Elles se déplacent en bus entre la gare d'entrée et la région de l'autre côté du fleuve pendant la journée , bien que leurs os soient particulièrement fins , et celles qui vont vers l'est , comme Jakara Bumthang , changent entre six et trente-sept . — chrF 38, 12.9 s
  - reference: Les bus partent de la gare routière interdistricts (située sur l'autre rive) tout au long de la journée, mais la plupart, tout particulièrement ceux qui desservent l'est et Jakar/Bumthang, partent entre 6 h 30 et 7 h 30 du matin.
- **en-US:** It's a bus terminal between the area across the river during the day, although it's shiny, especially the one going east, Jakara Bumthang, which changes between 6 and 37. — chrF 40, 12.9 s
  - reference: Buses depart the inter-district bus station (across the river) throughout the day, though most, especially those heading to the east and Jakar/Bumthang leave between 06:30 and 07:30.

### ar-SA · FLEURS 1942
- **Said:** نصنع بيوتنا وملابسنا من النباتات . معظم الطعام الذي نتناوله من النباتات كذلك. بدون النباتات، لا يمكن للحيوانات البقاء.
- **Heard:** نصع بيوتنا وملابسنا من النباتات مرزم الطعام الذي نتناوله من النباتات كذلك بدون النباتات لا يمكن للحيوانات البقاء — WER 11%
- **fr-FR:** La moitié de nos maisons et de nos vêtements sont faits de plantes , la nourriture que nous mangeons est faite de plantes , et sans plantes , les animaux ne peuvent pas survivre . — chrF 56, 8.1 s
  - reference: Nous fabriquons nos maisons et nos vêtements à base de plantes. La plupart des aliments que nous mangeons sont des plantes. Sans les plantes, les animaux ne survivraient pas.
- **en-US:** Half of our houses and half of our clothes are made of plants , half of the food we eat is made of plants , and without plants , animals cannot survive . — chrF 50, 8.1 s
  - reference: We make our houses from plants and make clothes from plants. Most foods that we eat are plants. Without plants, animals could not survive.

### ar-SA · FLEURS 1740
- **Said:** إن عرض الصوت والضوء الهرمي واحد من أمتع الأشياء الموجودة بالمنطقة للأطفال.
- **Heard:** إن عرض الصوت والضوء الهرمي واحد من أمتع الأشياء الموجودة بالمنتقل أطفال — WER 17%
- **fr-FR:** La projection de son et de lumière est l'une des choses les plus amusantes à propos du mobile . — chrF 33, 5.3 s
  - reference: Le spectacle son et lumière à la pyramide constitue l'une des attractions les plus intéressantes de la région pour les enfants.
- **en-US:** The sound and light pyramid is one of the most fun things on the mobile. — chrF 49, 5.3 s
  - reference: The pyramid sound and light show is one of the most interesting things in the area for kids.

### ar-SA · FLEURS 1771
- **Said:** تذكر أنه على الرغم من أن الموسيقى في المنصات الرئيسية قد تكون انتهت، إلا أن هناك أقسام من المهرجان قد تستمر في تشغيل الموسيقى حتى وقت متأخر من الليل.
- **Heard:** تذكر أنه على الرغم من أن الموسيقى في المنصات الرئيسية قد تكون انتهت إلا أن هناك أقصى من المهرجين قد تستمر في تشغيل الموسيقى حتى وقت متأخر — WER 14%
- **fr-FR:** Rappelez-vous que même si la musique sur les plateformes principales est terminée, Il y a un maximum de gens qui peuvent continuer à jouer de la musique tard dans la nuit . — chrF 38, 8.2 s
  - reference: N'oubliez pas que même si les spectacles musicaux sont terminés sur les scènes principales, d'autres spectacles musicaux peuvent se poursuivre jusqu'à tard dans la nuit sur d'autres sites du festival.
- **en-US:** Remember that even though the music on the main stages may be over, There's a maximum of cheerleaders who can keep the music playing late. — chrF 48, 8.2 s
  - reference: Remember that even though music on the main stages may have finished, there may be sections of the festival that will keep playing music until late into the night.

### ar-SA · FLEURS 1976
- **Said:** أدى ضاربا الكرة المتمركزين في الوسط، ساشين تيندولكار وراهول درافيد، جيدًا وأقاما شراكة أكسبت للفريق مائة نقطة.
- **Heard:** أدى ضارب القرى المتمركزين في الوسط ساشين تندو الكار وراهول درافي — WER 71%
- **fr-FR:** Les villageois postés au centre ont joué Sachin Tendulkar et Rahul Dravid — chrF 34, 1.2 s
  - reference: Les batteurs d'ordre moyen, Sachin Tendulkar et Rahul Dravid, ont obtenu de bons résultats et ont accompli un century ensemble.
- **en-US:** Village guards stationed in the middle performed Sachin Tendu Alkar and Rahul Dravid — chrF 44, 1.2 s
  - reference: Middle order batsmen, Sachin Tendulkar and Rahul Dravid, performed well and made a hundred-run partnership.

### ar-SA · FLEURS 1795
- **Said:** ومنذ عام 1988، توجّب أن تكون صناديق الاقتراع شفافة بحيث يمكن للناخبين والمراقبين أن يتأكدوا من عدم وجود مغلفات في بداية التصويت، وأنه لا يتم إضافة مغلفات إلا مغلفات الناخبين المسجلين والمصرّح لهم حسب الأصول والمفوضين.
- **Heard:** منذ عام 1988 توجب أن تكون صنضيق الإقتراع شفافة بحيث يمكن للناخبين والمرقبين أن يتأكدوا من عدم موجود مغلفات في بداية نقلين والمصرح لهم حسب الأصول والمفوضين — WER 39%
- **fr-FR:** Depuis 1988 , les urnes doivent être transparentes . Les électeurs et les observateurs peuvent vérifier qu'il n'y a pas d'enveloppes au début . 2 transporteurs dûment autorisés et habilités à effectuer des transports de marchandises et de personnes ont été déployés dans les zones de Qana et de Tir Quwat. — chrF 53, 15.2 s
  - reference: Depuis 1988, les urnes doivent être transparentes afin que les électeurs et les observateurs puissent constater qu'aucune enveloppe n'est présente au début du vote et qu'aucune enveloppe n'est ajoutée, sauf celles des électeurs dûment comptés et autorisés.
- **en-US:** Since 1988 , ballot boxes have had to be transparent . So that voters and observers can make sure there are no envelopes at the beginning . 2 transports, duly authorized and authorized before and after the operation, and 2 stations of the 1st and 2nd divisions of the 1st and 2nd divisions of the 2nd divisions of the 1st division — chrF 51, 15.2 s
  - reference: Since 1988, ballot boxes must be transparent so that voters and observers can witness that no envelopes are present at the start of the vote and that no envelopes are added except those of the duly counted and authorized voters.

### ar-SA · FLEURS 1947
- **Said:** قبل وصول القوات، لم تواجه هايتي مشاكل متعلقة بالمرض منذ القرن التاسع عشر.
- **Heard:** قبل وصور كوات لم تواجه حيتي مشاكل متعلقة بالمارد منزل قانة 9 — WER 62%
- **fr-FR:** (nothing arrived)
  - reference: Avant l'arrivée des troupes, Haïti n'avait pas rencontré de problèmes liés à la maladie depuis les années 1800.
- **en-US:** (nothing arrived)
  - reference: Prior to the arrival of troops, Haiti had not encountered problems related to the disease since the 1800s.

### ar-SA · FLEURS 1680
- **Said:** بصفته رياضيّاً شاملاً، يمكن للنّمر التّسلق (وإن لم يكن ذلك بشكلٍ جيد) والسّباحة والقفز لمسافاتٍ طويلةٍ والسّحب بقوّة خمسة أضعاف قوّة الإنسان.
- **Heard:** بسفة رياضيا شاملا يمكن للنمر التصلق وإن لم يكن ذلك بشكل جيد والسباح والقفز لمسافة طويلة والسحب بقوة 5 أضعف قوة الإنسان. — WER 27%
- **fr-FR:** Un sportif complet, le tigre peut grimper, mais pas très bien, nager, sauter de longue distance et tirer avec une force cinq fois inférieure à celle de l'homme. — chrF 44, 7.2 s
  - reference: Athlète équilibré, le tigre peut grimper (mais parfois difficilement), nager, sauter de grandes distances et tracter avec cinq fois la force d'un humain puissant.
- **en-US:** With a comprehensive athletic flair, the tiger can climb, though not well, and swim, and jump long distances, and pull with a force five times weaker than human strength. — chrF 54, 7.2 s
  - reference: A well rounded athlete, the tiger can climb (though not well), swim, leap great distances and pull with five times the force of a strong human.
