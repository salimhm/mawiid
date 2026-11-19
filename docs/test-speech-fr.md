# French test speech

A short script to read aloud while the caption worker is running.
French is deliberate: it is a language Whisper actually supports, so any wrong caption is a pipeline
fault — VAD cut, decode settings, filter — and not the Darija mapping problem. Fix the pipeline here
first, then move to `ar-MA`.

The script is built to break the usual weak points: digits, Moroccan place and person names,
homophones, a run-on sentence with no pause, self-corrections, disfluencies, one-word answers, a
soft sentence, and a stock sign-off that the hallucination filter must not eat when it is real speech.

## How to read it

- Quiet room, microphone about 30 cm away, normal conversational pace. Do not slow down for the
  recogniser; slow speech hides exactly the timing bugs you are looking for.
- Read one numbered line at a time. Leave a natural pause (about one second) between lines — that is
  what ends a phrase in the VAD.
- Line 16 is read noticeably more quietly than the rest.
- After line 17, stay silent for **10 seconds** without muting. That silence is a test, not dead air:
  the worker must produce **zero** captions during it.

## The script

| # | Line to read | What it tests |
| --- | --- | --- |
| 1 | Bonjour à tous et bienvenue dans la réunion de suivi du projet Mawiid. | Baseline; `Mawiid` is out of vocabulary |
| 2 | Nous sommes le mardi 11 novembre 2026, il est 15 heures 30. | Dates, year, clock time |
| 3 | Douze participants sont connectés depuis Casablanca, Tanger et Laâyoune. | Moroccan place names; `Laâyoune` has a rare diacritic |
| 4 | Le budget validé est de 1 250 dirhams par participant et par mois. | Thousands separator, currency |
| 5 | Monsieur El Amrani présente le calendrier : la phase deux commence en janvier. | Person name, colon pause, month |
| 6 | Le client a précisé qu'il préfère un rendez-vous le matin, près du bureau. | Homophones `près` / `prêt`, `rendez-vous` |
| 7 | Nous devons vérifier les accès ouvrir les comptes prévenir les invités confirmer la salle et envoyer le résumé avant vendredi midi. | Long run-on, no punctuation, no pause — must not be cut mid-word |
| 8 | Nous avons… enfin, l'équipe a validé la version finale hier soir. | Self-correction; the abandoned start should not be glued on |
| 9 | Euh, je pense que, euh, la traduction est prête pour les tests. | Disfluencies; must not become `euh euh euh` or a repeat |
| 10 | Oui. | One-word answer; shorter than `detect_min_s` |
| 11 | D'accord. | Elision, one word |
| 12 | Pas maintenant. | Negation, short phrase |
| 13 | Pouvez-vous répéter le numéro de la salle, s'il vous plaît ? | Question intonation, inversion, `s'il vous plaît` |
| 14 | La salle 204 est réservée jusqu'à 17 heures, puis nous libérons l'étage. | Digits spelled as a number, second clock time |
| 15 | Attention : le serveur redémarre à minuit et les sauvegardes prennent vingt minutes. | Abstract nouns, numbers written as words |
| 16 | Je répète plus doucement : la réunion de demain est annulée. | Quiet speech, near the VAD threshold |
| 17 | Merci beaucoup, bonne journée, et à la semaine prochaine. | Stock sign-off that must survive the hallucination filter |

## Expected transcript

Scoring reference (the benchmark's normaliser strips punctuation and case):

```
Bonjour à tous et bienvenue dans la réunion de suivi du projet Mawiid. Nous sommes le mardi 11 novembre 2026, il est 15 heures 30. Douze participants sont connectés depuis Casablanca, Tanger et Laâyoune. Le budget validé est de 1 250 dirhams par participant et par mois. Monsieur El Amrani présente le calendrier : la phase deux commence en janvier. Le client a précisé qu'il préfère un rendez-vous le matin, près du bureau. Nous devons vérifier les accès ouvrir les comptes prévenir les invités confirmer la salle et envoyer le résumé avant vendredi midi. Nous avons… enfin, l'équipe a validé la version finale hier soir. Euh, je pense que, euh, la traduction est prête pour les tests. Oui. D'accord. Pas maintenant. Pouvez-vous répéter le numéro de la salle, s'il vous plaît ? La salle 204 est réservée jusqu'à 17 heures, puis nous libérons l'étage. Attention : le serveur redémarre à minuit et les sauvegardes prennent vingt minutes. Je répète plus doucement : la réunion de demain est annulée. Merci beaucoup, bonne journée, et à la semaine prochaine.
```

## Extra checks

1. **Silence (10 s).** After the last line, say nothing. Pass: no caption is published. Fail: any line appears — that is the invention path, independent of language.
2. **Noise.** Repeat line 1 with a fan or a TV playing in the room. Pass: same words, maybe one error. Fail: caption appears while nobody speaks.
3. **Code-switch.** Say `On se voit demain, inchallah.` followed by `Merci, bonne journée.` Pass: `inchallah` survives as a word instead of being translated or dropped.
4. **Two speakers.** Have a second person say `Oui, je confirme.` while you are mid-sentence in line 7. Pass: the two captions are attributed to the right speakers, even if a word is lost.

## Running it

**Through the product (no setup).** Start `make infra`, the backend and the frontend, join a room from
the browser, turn captions on, and read the script. This is the only path that exercises the whole
chain — VAD, routing, decode, filters, publish — exactly as a guest will hit it. Compare each line
with the expected transcript, then do the four extra checks above.

**As an automated benchmark.** Record yourself reading the lines with any recorder, convert to
**16 kHz mono WAV**, and drop it in `services/ai/data/samples/fr-FR/` next to a `manifest.jsonl` line:

```json
{"audio": "test-speech-fr.wav", "text": "<the expected transcript>", "source": "manual"}
```

Then score it:

```bash
cd services/ai
.venv/bin/python scripts/benchmark.py --languages fr-FR --limit 1 -v
```

No clip is checked in: this machine has only English speech voices installed (`Microsoft David`,
`Zira`, `Mark`), so nothing was synthesised. A synthesiser would flatter the result anyway — no
accent, no room noise, perfect enunciation. Your own take is the reference that matters.
