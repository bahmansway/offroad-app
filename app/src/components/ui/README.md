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
| `PillButton` | `variant`: `filled` (main), `tinted`, `gray`, `plain`, `destructive`, `glass`. `size`: `large` 56, `medium` 48, `small` 44. `icon`, `subtitle`, `loading` |
| `IconButton` | Round 44px icon button; `glass` for over maps/photos. Always pass `label` |
| `LinkButton` | Tint text button (44 tall) |
| `SegmentedControl` | iOS segmented control (radiogroup). `glass`, `compact` |
| `ChoicePills` | Scrollable or wrapping pill choices (years, categories) |
| `SearchField` | Rounded search with clear button; `glass` over the map |
| `TextField` | Labelled input in a card; `error`, `hint`, `suffix`, `multiline`, `right` |
| `DifficultyBar` | 5 segments (8px, gap 6), filled = tint, always with "n · word" |
| `Badge` | Soft-tint capsule ("2 · Orta", "Hazırkı") |
| `StarRating` | Read-only (`size` 15) or input (`onChange`, `size` 30) |

## People and photos
| Component | Use |
|---|---|
| `Avatar` | Round photo, or initials on soft tint. `uri` must be absolute: use `photoUri(user.avatarUrl)` from `components/Rows` |
| `Thumb` | Rounded photo or colour tile with an icon (cars, spots, clan logo) |
| `pickPhoto('avatar' \| 'car')` (`lib/photos.ts`) | Picks a photo, crops it, resizes it to 512/1024 and returns JPEG bytes. Upload with `api.uploadAvatar(bytes)` / `api.uploadCarPhoto(id, bytes)` (raw body, token refresh included). For clan logos, use `'avatar'` size and the same raw PUT |

## States
| Component | Use |
|---|---|
| `LoadingState` | Spinner, full page, or `inline` in a list |
| `EmptyState` | Icon in a soft circle, title, text, optional action button |
| `ErrorState` | Message + "Try again" |
| `FormError` | Red announced message under a form |

## For the chat & clans builder
- Replace `app/(tabs)/chat.tsx` (placeholder) with the conversation list; keep `LargeTitleScreen`.
- "Mesaj yaz" on `app/user/[id].tsx` calls the handler from `lib/chatHooks.ts`. Register yours once
  (e.g. in the chat tab layout): `setSendMessageHandler(async (u) => { … router.push(…) })`. Until then it shows "Messages are coming soon".
- `PublicUser` already has `clan` and `isBlocked`; `ReportTarget` includes `message` and `clan`.
- Unread count on the tab: set `tabBarBadge` on the `chat` screen in `app/(tabs)/_layout.tsx`.
- Message bubbles: use `c.tint` / `c.onTint` (mine) and `c.card` / `c.label` (theirs), radius 18.
