# UI kit (iOS-style design system)

Import everything from `components/ui`:

```tsx
import { LargeTitleScreen, Section, Cell, PillButton, useTheme } from '../../components/ui';
```

Colours come from `lib/theme.ts` (tokens from SPEC-v2). Never hard-code a colour in a screen:
use `const { c } = useTheme()` (`c.tint`, `c.card`, `c.label2` …) or `makeStyles((c) => ({…}))`.
Light is the default; dark follows the phone, or the user's choice in Profile → Appearance.
All text must come from `locales/az.ts` + `locales/en.ts`.

## Theme — `lib/theme.ts`, `lib/themeContext.tsx`
| Export | Use |
|---|---|
| `useTheme()` | `{ c, scheme, pref, setPref }`: `c` = palette, `scheme` = `'light' \| 'dark'` |
| `makeStyles(fn)` | Themed `StyleSheet`, cached per scheme |
| `type` | Type scale: `largeTitle` 34/700, `title1`, `title2` 22/700, `title3`, `headline` 17/600, `body` 17, `subhead` 15, `footnote` 13, `caption`, `tab` 11/600 |
| `radius` | `card` 26, `sheet` 34, `tabBar` 32, `thumb` 12, `tile` 16, `pill` |
| `TAP` | 44: minimum tap size |
| `mapStyleUrl(scheme)` | OpenFreeMap positron / dark |
| `terrain(c, tone)` | YOLCHU terrain tones `clay` (trails) · `forest` (camps, open/going) · `sand` (events, waitlist) · `stone` (cars, clans, mods) → `{ solid, soft, text }`. Also on the palette as `c.clay`, `c.claySoft`, `c.clayText` … **Category colour only — never buttons, links or the selected tab** (orange `tint` stays the only action colour) |
| `thumbTone(kind)` | Tone for a `ThumbKind` (`trail` `camp` `car` `event` `clan` `mod`). Colour comes from the type, never the id |
| `signColors(level, scheme)` | Plate/number/word colours of the trail sign (levels 1–5) |
| `c.paper` / `c.paperText`, `c.ink` / `c.onInk` | Level-1 plate + "later" month strip; level-4/5 plate + map cluster |
| `contrastRatio(a, b)` | WCAG ratio, used by tests to keep text ≥ 4.5:1 in light and dark |
| `font('800')` | Extra-bold (sign numbers, date-block day). Inter 800 is loaded on Android/web |

## Building blocks
| Component | What it is |
|---|---|
| `Txt` | Themed text. `variant` (type scale), `tone` (`label`, `label2`, `tint`, `destructive` …) or `color` |
| `Icon` | SF Symbol on iOS, matching SVG elsewhere. Names in `ICON_NAMES` (`chat`, `message`, `camera`, `block`, `flag` …). Decorative: label the button instead |
| `GlassView` | Frosted glass (expo-blur on iOS, CSS backdrop blur on web, solid on Android). `elevated` adds a shadow. Set `borderRadius` in `style` |
| `FloatingTabBar` | Glass pill tab bar. Use as `<Tabs tabBar={(p) => <FloatingTabBar {...p} />}>`. Shows `tabBarBadge` as a red count. Icons per route in `TAB_ICONS` |
| `useTabBarSpace()` | Bottom padding so content clears the floating tab bar |

## Screens
| Component | Use |
|---|---|
| `LargeTitleScreen` | Tab root: large title + optional `right` actions, scrolls above the tab bar, pull to refresh (`onRefresh`) |
| `NavScreen` | Pushed page: nav bar with tint "‹ Back", optional `title`, `right`, `footer` (sticky bottom button) |
| `SheetScreen` | Modal sheet: grabber, `cancelLabel` or `backLabel`, `title` + `subtitle`, `right`, `footer`. Register the route in `app/_layout.tsx` with the `sheet` options (iOS page sheet; web/Android draw the 34px rounded sheet) |
| `NavBar` | The 52pt nav row on its own (e.g. above a full-screen chat) |
| `FloatingBack` | Glass back button over a photo |
| `SectionHeader` | Small uppercase heading + right action ("Modifications · 5 … Add") |
| `goBack(fallback)` | Back, or replace with `fallback` when there is no history (web deep links) |

## Lists
| Component | Use |
|---|---|
| `Section` | Inset grouped card (radius 26) with optional `header`, `footer`, `right`. Draws separators between children |
| `Cell` | Row: `title`, `subtitle`, `value`, `left` (IconTile / Avatar / Thumb), `right`, `onPress`, `checked`, `destructive`, `action` (tint title), `center`. Screen-reader label defaults to title + subtitle + value |
| `SwitchCell` | Row with a switch |
| `IconTile` | Rounded square icon: `bg` = solid + white icon, no `bg` = soft tint |
| `Card` | Plain rounded card (padding 16) |

## Controls
| Component | Use |
|---|---|
| `PillButton` | `variant`: `filled` (main), `tinted`, `gray`, `plain`, `destructive`, `glass`, `secondary` (white pill, tint text, next to a filled main action in a bottom bar). `size`: `large` 56, `medium` 48, `small` 44. `icon`, `subtitle`, `loading`. No haptics (see Haptics) |
| `IconButton` | Round 44px icon button; `glass` for over maps/photos. Always pass `label` |
| `LinkButton` | Tint text button (44 tall) |
| `SegmentedControl` | iOS segmented control (radiogroup). `glass`, `compact`. Options may carry a decorative `icon` + `iconColor` (Explore: trail in clay, tent in forest) |
| `ChoicePills` | Scrollable or wrapping pill choices (years, categories) |
| `SearchField` | Rounded search with clear button; `glass` over the map |
| `TextField` | Labelled input in a card; `error`, `hint`, `suffix`, `multiline`, `right` |
| `DifficultySign` | **Trail-sign difficulty badge** — use it wherever a level is shown (rows, cards, pages). Plate (radius 8) with a number square + the word; darker plate = harder. `size` `small` 28 (rows) / `large` 36 (detail pages). `short` = short words in tight rows (screen reader still hears the full name). `variant="number"` = just the number plate (pickers, detail rows). Never colour-only |
| `DifficultyBar` | 5 segments (8px, gap 6), filled = tint. Keep it on the spot page, under the large sign (`compact`) |
| `Badge` | Soft capsule. `tone`: `tint`, `gray`, or a terrain tone (`clay` `forest` `sand` `stone`: soft bg + text colour). Optional decorative `icon` |
| `DateBlock` | Calendar page for events, 60 wide: `month`, `day`, `weekday` (spelled out), `soon` (tint strip, use for "within 7 days"), `muted` (over). For an ISO date use `EventDate` from `components/EventCard` (Baku date, works out `soon`). Decorative: put the full date in the parent label |
| `SeatBar` | Up to 4 participant dots + "3/6 maşın" + 4 px progress bar |
| `FactTile` | Small tile: terrain-tone icon square, label, value (spot Season / Events). Don't render it without a value |
| `StarRating` | Read-only (`size` 15) or input (`onChange`, `size` 30) |

## People and photos
| Component | Use |
|---|---|
| `Avatar` | Round photo, or initials on soft tint. `uri` must be absolute: use `photoUri(user.avatarUrl)` from `components/Rows` |
| `Thumb` | Rounded photo, or (no photo) a terrain tile by `kind`: `trail` clay + trail glyph, `camp` forest + tent, `car` stone + 4x4 silhouette, `event` sand, `clan`/`mod` stone; faint white contour. `seed` is ignored now |
| `pickPhoto('avatar' \| 'car')` (`lib/photos.ts`) | Picks a photo, crops it, resizes it to 512/1024 and returns JPEG bytes. Upload with `api.uploadAvatar(bytes)` / `api.uploadCarPhoto(id, bytes)` (raw body, token refresh included). For clan logos, use `'avatar'` size and the same raw PUT |

## Motifs (`Motifs.tsx`, all decorative and hidden from screen readers)
| Component | Use |
|---|---|
| `Contour` | Topographic texture: 7 wavy lines + 2 ellipses, 1.2 px stroke. Fills its parent. Props `color`, `opacity`, `seed`, `width`/`height` (drawing size). **Only** on: no-photo heroes (white 20%), the top-right corner behind large titles (tint 14%, built into `LargeTitleScreen`), empty states (tint 10%, built into `EmptyState`), the map error card, terrain thumbs (white 18%). Never behind body text or lists |
| `MountainMark` | Solo logo mountain with the road cut out (`size`, `color`). `pulse` = slow opacity pulse, off with Reduce Motion |
| `CarSilhouette` | Our side-view 4x4 line drawing (white on `stone`) for cars without a photo. `width`, `color` |
| `HillsArt` | Soft hills for a hero without a photo |
| `useReduceMotion()` | true when the phone asks for less motion |

## States
| Component | Use |
|---|---|
| `LoadingState` | Logo mountain pulsing + "Yüklənir…", full page, or `inline` (small mountain) in a list |
| `EmptyState` | `illustration` (`mountain` or `car`) or `icon`, title, text, optional action button, faint contour behind (`contour={false}` inside small cards) |
| `MapErrorCard` | Centred card for a map that failed: wifi icon, "Xəritə yüklənmədi", one line, grey "Yenidən cəhd et". The maps draw it themselves; pass `errorInsets` to `SpotMap` so it stays clear of floating controls, `errorCompact` for small maps (no icon, no button) |
| `ErrorState` | Message + "Try again" |
| `FormError` | Red announced message under a form |

## Menus
- `MoreMenu` (`components/ActionSheet.tsx`): "···" glass button that opens an `ActionSheet`. Put Delete and Report here, never as a big red button next to content. Destructive actions still ask with `confirmAsync` (which also gives a warning haptic).
- `Hero` (`components/Hero.tsx`): `right` for the glass buttons, `bottomLeft` for a date block or "add photo" pill, `overlay` bottom-right.

## Haptics (`lib/haptics.ts`, silent on web)
| Function | When |
|---|---|
| `selectionFeedback()` | Segmented controls, tabs, difficulty pick, star tap, category pills, steppers (built into the kit controls) |
| `tapFeedback()` | Light impact: map pin tap, pull-to-refresh release, long-press menus |
| `successFeedback()` | Joined event, car saved, spot published, invite accepted |
| `warningFeedback()` | Cancel event, leave clan, delete confirm (`confirmAsync` does it) |
Never on scrolling, typing or ordinary buttons (`PillButton` / `IconButton` have none).

## For the chat & clans builder
- Replace `app/(tabs)/chat.tsx` (placeholder) with the conversation list; keep `LargeTitleScreen`.
- "Mesaj yaz" on `app/user/[id].tsx` calls the handler from `lib/chatHooks.ts`. Register yours once
  (e.g. in the chat tab layout): `setSendMessageHandler(async (u) => { … router.push(…) })`. Until then it shows "Messages are coming soon".
- `PublicUser` already has `clan` and `isBlocked`; `ReportTarget` includes `message` and `clan`.
- Unread count on the tab: set `tabBarBadge` on the `chat` screen in `app/(tabs)/_layout.tsx`.
- Message bubbles: use `c.tint` / `c.onTint` (mine) and `c.card` / `c.label` (theirs), radius 18.
