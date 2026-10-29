# YOLCHU design pass: changes for the builder

Goal: keep the clean iOS base, but make it feel like an offroad app. We add four small things: **terrain tones**, a **contour texture**, **trail-sign difficulty badges** and the **logo mountain as a motif**. Orange (`tint`) stays the only action colour.

Mockups are on the design canvas, in the row "YOLCHU design pass" (Pass 1–6; before = live screenshot, after = proposal).
All copy goes through `locales/az.ts` and `locales/en.ts`. New keys are listed at the end.

---

## Priority order

### P1. Trail-sign difficulty badge (Pass 1, 6)
New `DifficultySign` in `components/ui/Controls.tsx`. It replaces `Badge` wherever a level is shown (SpotCell, EventCard, event page, participants).
- Shape: a plate with radius 8. On the left is a number square (plate height − 6, radius 6). The word is on the right. Sizes: `small` 28 px (rows) and `large` 36 px (detail pages).
- It always shows the number and the word, so colour is never the only signal. The plate gets darker as the level goes up:

| Level | Light plate / text | Dark plate / text |
|---|---|---|
| 1 Asan | `#E7DCC8` / `#5A4628` | `#4A3E2C` / `#E3CFA8` |
| 2 Orta | `tintSoft` / `tintSoftText` | `tintSoft` / `tintSoftText` |
| 3 Çətin | `tint` / `#FFFFFF` | `tint` / `onTint` |
| 4 Ekstrem | `#1C1C1E` / `#FFFFFF` | `#FFFFFF` / `#000000` |
| 5 Yalnız peşəkarlar | as 4 + 2 px inner ring `tint`, number in `#FF8A3D` (light) / `#C2410C` (dark) | |

- In rows with little space, use the short words `Asan · Orta · Çətin · Ekstrem · Peşəkar`. The accessibility label keeps the full name.
- Keep `DifficultyBar` (the 5 segments) on the spot page, under the large sign.

### P2. Terrain tones for categories (Pass 1, 3, 4, 6)
Add these to `Palette` in `lib/theme.ts` and drop the random `tints` seed for spots, events and cars:

| Token | Use | Light solid / soft / text | Dark solid / soft / text |
|---|---|---|---|
| `clay` | trails | `#B65A3C` / `#F6E4DC` / `#8A3E24` | `#C46A4A` / `#3A2620` / `#F0A487` |
| `forest` | camps, "open" status | `#4F6B4A` / `#E3EBDF` / `#3B5237` | `#5E7F58` / `#1F2A1D` / `#A9C9A0` |
| `sand` | events, waitlist | `#9A7B4F` / `#F3EADB` / `#6B5330` | `#A88A5C` / `#2E2618` / `#E3CFA8` |
| `stone` | cars, clans, mods | `#6E685D` / `#ECEAE5` / `#504B42` | `#7A7468` / `#26241F` / `#CFC8BA` |

- `Thumb` gets the colour from the type, not from the id: trail = clay + trail glyph, camp = forest + tent, car = stone + car silhouette.
- `Badge` gets tones `clay | forest | sand | stone`, using the soft background with the text colour.
- Never use terrain colours for buttons, links or the selected tab.

### P3. Fix the confusing car money and owner actions (Pass 4)
- The owner sees the **real total** (including private prices) as the big number. One line below says what others see: "Başqaları 2 400 AZN görür". Remove "0 AZN · 1 hidden" and the separate "Total incl. private" line.
- Private mod prices show a lock icon and "Yalnız siz" under the price.
- Remove the text "You cannot rate your own car." Just hide the rating input for the owner.
- Move **Delete car** into a `···` menu in the hero, with a confirm. It should not be a big red button under the mods.
- Rating shows as `★ 4.0` with `1 səs` below, instead of 5 tiny stars plus "4 · 1 vote".

### P4. Map: pins and the failure state (Pass 1, 6)
- Pins (`components/map/shared.ts` `pinCss` and the native map):
  - Trail: white teardrop (40×48), level number in 800 weight, with a dark hairline.
  - Selected: `tint` fill, white number and white 2 px border.
  - Camp: `forest` teardrop with a white tent.
  - Cluster: `#1C1C1E` circle with a 3 px white border and the count. Today the cluster is a white circle that looks like a pin.
  - Keep the 44 px hit area.
- Map error: show a centred **card** with a wifi icon, the title "Xəritə yüklənmədi", the line "İnterneti yoxlayıb yenidən cəhd edin." and a gray "Yenidən cəhd et" button that reloads the map. Put it on top of a faint contour texture. Today the plain text sits under the cluster bubble and the floating buttons, and on the event page the + pin covers the text.

### P5. Stronger event date block and event cards (Pass 3, 5)
- `DateBlock` becomes a small calendar page, 60 wide:
  - Month strip 20 px: `tint` with white text if the event is within 7 days, otherwise `#E7DCC8` with `#5A4628`.
  - Day number 26 px / 800 weight.
  - Weekday spelled out in 11 px.
  - Card background with a hairline border.
- The Events list gets section headers "BU HƏFTƏ" and "SONRA".
- Seats: participant dots (max 4) + "3/6 maşın" + a thin 4 px progress bar, instead of the grey "1/6 maşın" pill.
- Clan: show the clan **name** in a `stone` chip ("Dəmir · yalnız klan"), not "[D531]".
- Event page:
  - Date block sits on the hero.
  - Chips say each thing once: status (forest), clan (stone), "Siz təşkilatçısınız". Today "Organizer" appears twice and the tag is raw.
  - Minimum level becomes a row in the details card.
  - Event chat moves to an icon in the hero.

### P6. Contour texture (Pass 2–6)
- One shared component `<Contour color opacity seed />`, an SVG of 7 soft wavy lines + 2 ellipses, 1.2 px stroke.
- Use it only in:
  - the no-photo hero (white at 20%)
  - the top-right corner behind large titles (tint at 14%, about 260×140)
  - empty states (tint at 10%)
  - the map error card background
  - terrain thumbs (white at 18%)
- Never put it behind body text or lists.

### P7. Spot page hierarchy (Pass 2)
- Type chip (clay "Marşrut" / forest "Düşərgə") + distance go **above** the title. The "shared by" line goes below the title.
- Large trail sign next to the explanation ("4×4 aşağı ötürmə, AT təkərlər"), with the segment bar under it.
- Three fact tiles: Mövsüm / Uzunluq / Tədbirlər. **Hide rows that have no value** ("Not specified", "Not rated yet"). Rating moves next to the title when it exists.
- No-photo hero: one soft hill shape + contour texture + a chip "Şəkil yoxdur · əlavə et" (owner only).
- Delete moves into the `···` menu (with Report), out of the hero icon row.
- Bottom bar: "Yol göstər" (main) + "Tədbir yarat" (white secondary).

### P8. Logo mountain as motif and car silhouettes (Pass 4, 6)
- `LoadingState`: replace the spinner with the solo logo mountain (`tint` colour, road cut-out). The road can draw in with a stroke-dash or a slow opacity pulse (respect Reduce Motion), plus "Yüklənir…".
- Pull-to-refresh: a small mountain (34 px) above the list. On native, set `RefreshControl tintColor` to `tint` if a custom view is too heavy.
- No-photo car: our side-view 4x4 line drawing (white on `stone` with contour) in the car hero, garage thumbs and the empty garage. The SVG path is in the canvas file `dpCar.dc.html` (`carSil`). Remove the current grey sky / grey car scene in `components/Hero.tsx` `kind="car"`.
- `components/Brand.tsx` comment: update "mountains + road" to "mountain + road" (file names unchanged).

### P9. Empty states with friendlier az copy (Pass 6)
`EmptyState` gets an optional `illustration` (logo mountain or car silhouette) and a contour background.

| Where | az title | az text | button |
|---|---|---|---|
| Events | Hələ tədbir yoxdur | Yolu birlikdə gedək. İlk səfəri sən planla. | Tədbir yarat |
| Garage | Qaraj boşdur | Maşınını əlavə et, modlarını göstər. | Maşın əlavə et |
| Near you (no spots) | Yaxınlıqda yer yoxdur | Bildiyin yaxşı yeri ilk sən paylaş. | Yer əlavə et |
| Chat | Hələ söhbət yoxdur | Klana qoşul və ya tədbirə yazıl, söhbət burada görünəcək. | Klanlara bax |

en: "No events yet / Let's hit the road together. Plan the first trip." · "Your garage is empty / Add your car and show off its mods." · "Nothing nearby yet / Share a good spot you know." · "No chats yet / Join a clan or an event and your chats appear here."

### P10. Haptics (`lib/haptics.ts`, already used in 17 places)
Add `selectionFeedback()` (selection tick) and `warningFeedback()`.
- Selection: segmented controls, difficulty pick, star tap, category pills.
- Light impact: pin tap, pull-to-refresh release.
- Success: joined event, car saved, spot published, invite accepted.
- Warning: cancel event, leave clan, delete confirm.
- No haptics on scroll, typing or ordinary buttons. Web: no-op.

---

## Smaller usability and consistency fixes
1. **Destructive actions are too easy to hit.** The trash icon in the spot hero and the "Delete car" button sit next to the main content. Put all deletes in a `···` menu with a confirm.
2. **Map error text overlaps controls** (Explore and the event meeting map). Use the card from P4.
3. **Duplicate info on the event page**: "Təşkilatçı" badge + "Təşkilatçı: Aysel"; raw clan tag "[D531] Dəmir 25531".
4. **Empty value rows** ("Season: Not specified", "Rating: Not rated yet", "No events planned here yet.") take space without helping. Hide them or fold them into one muted line.
5. **Random tile colours** (Near you, chat event tiles, clan avatar "DMR" grey) carry no meaning. Use the terrain tone by type (P2). Chat event tiles get a mini date block.
6. **Car rating** "★★★★☆ 4 · 1 vote" reads as "4 votes". Show "★ 4.0 · 1 səs".
7. **Mod form**: the price field shows the "AZN" suffix *and* there is a currency segmented control. Make the suffix follow the chosen currency, or drop it.
8. **Dates in lists** like "29.10.2026" (clan join requests): use relative or short words ("bu gün", "29 okt").
9. **Tap targets**: "See all", "Add" (mods), "Approve" / "Reject" pills and the "Yarat" title pill should reach a 44 px tall hit area (use `hitSlop` if the visual stays smaller).
10. **Section header and link spacing**: section headers have 18 px above and 6 px below. Link-style actions sit on the same baseline as the header (mods "Add" today floats higher).
11. **Login screen**: the wordmark is 28 px tall. Use 32 px with 24 px space under it, and the new mark will show automatically.
12. **Dark mode event card**: the date block on `#3A2A20` is low-key. The new calendar block (P5) fixes this; check `tint` on `card` is ≥ 3:1 for the month strip.

## New translation keys (az / en)
- `common.loadingDots`: "Yüklənir…" / "Loading…"
- `map.errorTitle`: "Xəritə yüklənmədi" / "Map could not load"
- `map.errorText`: "İnterneti yoxlayıb yenidən cəhd edin." / "Check your connection and try again."
- `map.retry`: "Yenidən cəhd et" / "Try again"
- `events.thisWeek`: "Bu həftə" / "This week"
- `events.later`: "Sonra" / "Later"
- `events.youOrganize`: "Siz təşkilatçısınız" / "You're organizing"
- `car.othersSee`: "Başqaları {{amount}} görür" / "Others see {{amount}}"
- `car.onlyYou`: "Yalnız siz" / "Only you"
- `car.votes`: "{{count}} səs" / "{{count}} votes"
- `spot.noPhotoAdd`: "Şəkil yoxdur · əlavə et" / "No photo · add one"
- `spot.length`: "Uzunluq" / "Length"
- Empty-state strings: see the P9 table.
- `levels.short`: ["Asan","Orta","Çətin","Ekstrem","Peşəkar"] / ["Easy","Moderate","Hard","Extreme","Expert"]
