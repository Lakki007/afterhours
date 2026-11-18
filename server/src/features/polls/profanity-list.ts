// Word cloud blocklist. Lives in its own file so the owner can review and edit
// it without touching logic. Everything is lower case and uses the loosest
// spelling; the matcher (words.ts) also folds leetspeak (f*ck, sh1t, b!tch),
// separators (m.c, b-c) and stretched letters (fuuuck).
//
// Two lists because of the Scunthorpe problem (innocent words that contain a
// bad one):
//   EXACT     matches only when the whole entry (a word the attendee typed)
//             equals the entry. Use for short or ambiguous terms.
//   CONTAINS  matches anywhere inside the entry. Only for long, distinctive terms.
//
// Review note for the organisers: this is a first line of defence. The console
// can hide any word live, and hidden words vanish from every screen at once.

export const PROFANITY_EXACT: readonly string[] = [
  // English
  'ass', 'arse', 'cock', 'dick', 'cunt', 'twat', 'slut', 'fag', 'rape', 'rapist', 'sex', 'porn', 'nude', 'nudes',
  'nazi', 'xxx', 'wtf', 'stfu', 'gtfo', 'prick', 'wank', 'piss', 'bollocks',
  // Hindi / Urdu, romanised
  'mc', 'bc', 'mkc', 'bkl', 'bsdk', 'bsdke', 'bhosdi', 'bhosda', 'chut', 'chod', 'chodu', 'chutiya', 'chutiye', 'gand', 'gaand', 'gandu',
  'gaandu', 'lund', 'lauda', 'lavda', 'lavde', 'loda', 'randi', 'raand', 'harami', 'kamina', 'kameena', 'kutti',
  'suar', 'suvar', 'tharki', 'jhatu', 'jhaatu', 'jhant', 'hijra', 'hijda', 'bhadwa', 'bhadwe', 'bhadva',
  'bhenchod', 'behenchod', 'madarchod', 'maderchod',
  // Telugu, romanised (Hyderabad campus usage)
  'lanja', 'lanjodka', 'lanjakodaka', 'lanjakoduku', 'lanjodaka', 'denga', 'dengey', 'dengu', 'dengudu', 'dengutha', 'dengesta', 'dengesey',
  'puku', 'pooku', 'pooka', 'gudda', 'guddalu', 'modda', 'moddha', 'sulli', 'mundakoduku', 'thulla', 'tulla', 'vedava', 'yedava',
  'erripuku', 'erripooku', 'badkhow', 'baadkhow', 'nakodaka', 'naakodaka','ammanudenga',
];

export const PROFANITY_CONTAINS: readonly string[] = [
  // English
  'fuck', 'fuk', 'shit', 'bitch', 'bastard', 'asshole', 'arsehole', 'motherfuck', 'dickhead', 'cocksucker', 'pussy', 'whore', 'slutty',
  'nigger', 'nigga', 'faggot', 'retard', 'blowjob', 'handjob', 'cumshot', 'wanker', 'douche',
  // Hindi / Urdu, romanised
  'madarchod', 'maderchod', 'madrchod', 'mderchod', 'bhenchod', 'behenchod', 'benchod', 'bhanchod', 'bhosdike', 'bhosadi', 'bhosdi', 'chutiya',
  'chutia', 'chutmar', 'gandu', 'gaandu', 'gandmara', 'bakchod', 'bakchodi', 'haramkhor', 'haramzada', 'haramzade', 'harami', 'lavdya',
  'lauda', 'randwa', 'randibaaz', 'kamine', 'kameene', 'kuttiya', 'kutiya', 'bhadwa', 'jhaatu',
  // Telugu, romanised
  'lanjakodaka', 'lanjakoduku', 'lanjodka', 'lanjodaka', 'lanjamunda', 'dengesta', 'dengutha', 'dengey', 'denguthav', 'erripuku', 'erripooku',
  'guddalu', 'mundakoduku', 'baadkhow', 'badkhow', 'nakodaka', 'naakodaka', 'nayala', 'naayala',
];
